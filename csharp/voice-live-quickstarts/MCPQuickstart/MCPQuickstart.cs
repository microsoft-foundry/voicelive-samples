// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Channels;
using System.Threading.Tasks;
using Azure.AI.VoiceLive;
using Azure.Identity;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;
using NAudio.Wave;

namespace Azure.AI.VoiceLive.Samples
{
    /// <summary>
    /// MCP Quickstart - demonstrates MCP server integration with VoiceLive SDK.
    /// Shows how to define MCP servers, handle MCP tool calls, and implement
    /// an approval flow for tool calls that require user consent.
    /// </summary>
    public class Program
    {
        public static async Task<int> Main(string[] args)
        {
            // Setup configuration
            var configuration = new ConfigurationBuilder()
                .AddJsonFile("appsettings.json", optional: true)
                .AddEnvironmentVariables()
                .Build();

            var apiKey = configuration["VoiceLive:ApiKey"] ?? Environment.GetEnvironmentVariable("AZURE_VOICELIVE_API_KEY");
            var endpoint = configuration["VoiceLive:Endpoint"] ?? Environment.GetEnvironmentVariable("AZURE_VOICELIVE_ENDPOINT") ?? "https://your-resource-name.services.ai.azure.com/";
            var model = configuration["VoiceLive:Model"] ?? Environment.GetEnvironmentVariable("AZURE_VOICELIVE_MODEL") ?? "gpt-realtime";
            var voice = configuration["VoiceLive:Voice"] ?? Environment.GetEnvironmentVariable("AZURE_VOICELIVE_VOICE") ?? "en-US-Ava:DragonHDLatestNeural";
            var instructions = configuration["VoiceLive:Instructions"] ?? "You are a helpful AI assistant with access to MCP tools. Use the tools to help answer user questions. Respond naturally and conversationally. Some tools require user approval before they can be used. When you receive a system message asking you to request permission, you MUST clearly ask the user for their explicit approval before proceeding. Always wait for the user to say yes or no. Never skip the approval question or assume permission is granted. If a tool result arrives after the conversation has moved to a different topic, briefly introduce it as a late result before sharing the findings.";
            var useTokenCredential = args.Length > 0 && args[0] == "--use-token-credential";

            // Setup logging
            using var loggerFactory = LoggerFactory.Create(builder =>
            {
                builder.AddConsole();
                builder.SetMinimumLevel(LogLevel.Information);
            });

            var logger = loggerFactory.CreateLogger<Program>();

            // Validate credentials
            if (string.IsNullOrEmpty(apiKey) && !useTokenCredential)
            {
                Console.WriteLine("❌ Error: No authentication provided");
                Console.WriteLine("Set AZURE_VOICELIVE_API_KEY or use --use-token-credential.");
                return 1;
            }

            // Check audio system
            if (!CheckAudioSystem(logger))
                return 1;

            try
            {
                VoiceLiveClient client;
                if (useTokenCredential)
                {
                    client = new VoiceLiveClient(new Uri(endpoint), new DefaultAzureCredential(), new VoiceLiveClientOptions());
                    logger.LogInformation("Using Azure token credential");
                }
                else
                {
                    client = new VoiceLiveClient(new Uri(endpoint), new AzureKeyCredential(apiKey!), new VoiceLiveClientOptions());
                    logger.LogInformation("Using API key credential");
                }

                using var assistant = new MCPVoiceAssistant(client, model, voice, instructions, loggerFactory);
                using var cts = new CancellationTokenSource();

                Console.CancelKeyPress += (sender, e) =>
                {
                    e.Cancel = true;
                    cts.Cancel();
                };

                await assistant.StartAsync(cts.Token).ConfigureAwait(false);
            }
            catch (OperationCanceledException)
            {
                Console.WriteLine("\n👋 Voice assistant with MCP shut down. Goodbye!");
            }
            catch (Exception ex)
            {
                logger.LogError(ex, "Fatal error");
                Console.WriteLine($"❌ Error: {ex.Message}");
                return 1;
            }

            return 0;
        }

        private static bool CheckAudioSystem(ILogger logger)
        {
            try
            {
                using var waveIn = new WaveInEvent { WaveFormat = new WaveFormat(24000, 16, 1), BufferMilliseconds = 50 };
                waveIn.DataAvailable += (_, __) => { };
                waveIn.StartRecording();
                waveIn.StopRecording();

                var buffer = new BufferedWaveProvider(new WaveFormat(24000, 16, 1)) { BufferDuration = TimeSpan.FromMilliseconds(200) };
                using var waveOut = new WaveOutEvent { DesiredLatency = 100 };
                waveOut.Init(buffer);
                waveOut.Play();
                waveOut.Stop();

                logger.LogInformation("Audio system check passed");
                return true;
            }
            catch (Exception ex)
            {
                Console.WriteLine($"❌ Audio system check failed: {ex.Message}");
                return false;
            }
        }
    }

    /// <summary>
    /// Voice assistant with MCP server integration.
    /// </summary>
    public class MCPVoiceAssistant : IDisposable
    {
        private readonly VoiceLiveClient _client;
        private readonly string _model;
        private readonly string _voice;
        private readonly string _instructions;
        private readonly ILogger<MCPVoiceAssistant> _logger;
        private readonly ILoggerFactory _loggerFactory;

        private VoiceLiveSession? _session;
        private AudioProcessor? _audioProcessor;
        private bool _disposed;
        private bool _responseActive;
        private bool _canCancelResponse;

        // Voice-based MCP approval state
        private record ApprovalInfo(string ApprovalId, string ServerLabel, string FunctionName);
        private ApprovalInfo? _pendingApproval;
        private readonly Queue<ApprovalInfo> _approvalQueue = new();
        private bool _approvalPromptNeeded;
        private int _mcpCallInProgress;
        private readonly HashSet<string> _handledMcpCompletions = new();
        private bool _needsResponseCreate;
        private readonly Dictionary<string, int> _approvalCallCount = new();
        private readonly Dictionary<string, string> _mcpItemToServer = new();
        private HashSet<string> _approvalServers = new();
        private CancellationTokenSource? _mcpStallCts;
        private readonly HashSet<string> _activeMcpItems = new();
        private readonly HashSet<string> _staleMcpItems = new();
        private bool _mcpResultsPending;
        private readonly HashSet<string> _approvedServersThisTurn = new();
        private static readonly string LogFilename = $"conversation_{DateTime.Now:yyyyMMdd_HHmmss}.log";

        public MCPVoiceAssistant(
            VoiceLiveClient client,
            string model,
            string voice,
            string instructions,
            ILoggerFactory loggerFactory)
        {
            _client = client;
            _model = model;
            _voice = voice;
            _instructions = instructions;
            _loggerFactory = loggerFactory;
            _logger = loggerFactory.CreateLogger<MCPVoiceAssistant>();
        }

        public async Task StartAsync(CancellationToken cancellationToken = default)
        {
            try
            {
                _logger.LogInformation("Connecting to VoiceLive API with model {Model}", _model);

                _session = await _client.StartSessionAsync(_model, cancellationToken).ConfigureAwait(false);
                _audioProcessor = new AudioProcessor(_session, _loggerFactory.CreateLogger<AudioProcessor>());

                await SetupSessionAsync(cancellationToken).ConfigureAwait(false);

                await _audioProcessor.StartPlaybackAsync().ConfigureAwait(false);
                await _audioProcessor.StartCaptureAsync().ConfigureAwait(false);

                _logger.LogInformation("Voice assistant with MCP ready!");
                Console.WriteLine();
                Console.WriteLine(new string('=', 70));
                Console.WriteLine("🎤 VOICE ASSISTANT WITH MCP READY");
                Console.WriteLine("Try saying:");
                Console.WriteLine("  • 'What is the GitHub repo fastapi about?'");
                Console.WriteLine("  • 'Search the Azure documentation for Voice Live API.'");
                Console.WriteLine("You may need to approve some MCP tool calls in the console.");
                Console.WriteLine("Press Ctrl+C to exit");
                Console.WriteLine(new string('=', 70));
                Console.WriteLine();

                await ProcessEventsAsync(cancellationToken).ConfigureAwait(false);
            }
            catch (OperationCanceledException)
            {
                _logger.LogInformation("Shutting down...");
            }
            finally
            {
                if (_audioProcessor != null)
                    await _audioProcessor.CleanupAsync().ConfigureAwait(false);
            }
        }

        // <define_mcp_servers>
        /// <summary>
        /// Define MCP servers that Voice Live can use during the session.
        /// Each server is a VoiceLiveMcpServerDefinition instance added to the session options tools list.
        /// </summary>
        private List<VoiceLiveToolDefinition> DefineMCPServers()
        {
            var mcpTools = new List<VoiceLiveToolDefinition>
            {
                new VoiceLiveMcpServerDefinition("deepwiki", "https://mcp.deepwiki.com/mcp")
                {
                    AllowedTools = { "read_wiki_structure", "ask_question" },
                    RequireApproval = BinaryData.FromString("\"never\""),
                },
                new VoiceLiveMcpServerDefinition("azure_doc", "https://learn.microsoft.com/api/mcp")
                {
                    RequireApproval = BinaryData.FromString("\"always\""),
                },
            };

            return mcpTools;
        }
        // </define_mcp_servers>

        // <configure_session>
        private async Task SetupSessionAsync(CancellationToken cancellationToken)
        {
            _logger.LogInformation("Setting up session with MCP tools...");

            var azureVoice = new AzureStandardVoice(_voice);
            var turnDetection = new ServerVadTurnDetection
            {
                Threshold = 0.5f,
                PrefixPadding = TimeSpan.FromMilliseconds(300),
                SilenceDuration = TimeSpan.FromMilliseconds(500)
            };

            // Create session options and add MCP servers to the tools list
            var sessionOptions = new VoiceLiveSessionOptions
            {
                InputAudioEchoCancellation = new AudioEchoCancellation(),
                Model = _model,
                Instructions = _instructions,
                Voice = azureVoice,
                InputAudioFormat = InputAudioFormat.Pcm16,
                OutputAudioFormat = OutputAudioFormat.Pcm16,
                TurnDetection = turnDetection
            };

            // Enable input audio transcription so we receive
            // SessionUpdateConversationItemInputAudioTranscriptionCompleted events
            // (required for the voice-based approval flow).
            sessionOptions.InputAudioTranscription = new AudioInputTranscriptionOptions(
                _model.Contains("realtime", StringComparison.OrdinalIgnoreCase) ? "whisper-1" : "azure-speech");

            sessionOptions.Modalities.Clear();
            sessionOptions.Modalities.Add(InteractionModality.Text);
            sessionOptions.Modalities.Add(InteractionModality.Audio);

            // Add MCP servers to the tools list
            var mcpServers = DefineMCPServers();
            foreach (var tool in mcpServers)
            {
                sessionOptions.Tools.Add(tool);
            }

            // Track which servers require approval for per-turn loop prevention
            _approvalServers = new HashSet<string> { "azure_doc" };

            await _session!.ConfigureSessionAsync(sessionOptions, cancellationToken).ConfigureAwait(false);
            _logger.LogInformation("Session with MCP tools configured");
        }
        // </configure_session>

        private async Task ProcessEventsAsync(CancellationToken cancellationToken)
        {
            try
            {
                await foreach (SessionUpdate serverEvent in _session!.GetUpdatesAsync(cancellationToken).ConfigureAwait(false))
                {
                    await HandleSessionUpdateAsync(serverEvent, cancellationToken).ConfigureAwait(false);
                }
            }
            catch (OperationCanceledException) { }
        }

        // <handle_mcp_events>
        private async Task HandleSessionUpdateAsync(SessionUpdate serverEvent, CancellationToken cancellationToken)
        {
            switch (serverEvent)
            {
                case SessionUpdateSessionUpdated sessionUpdated:
                    _logger.LogInformation("Session updated");
                    WriteLog($"SessionID: {sessionUpdated.Session?.Id}");
                    WriteLog($"Model: {_model}");
                    WriteLog($"Voice: {_voice}");
                    WriteLog("");
                    if (_audioProcessor != null)
                        await _audioProcessor.StartCaptureAsync().ConfigureAwait(false);
                    break;

                case SessionUpdateInputAudioBufferSpeechStarted:
                    Console.WriteLine("🎤 Listening...");
                    if (_audioProcessor != null)
                        await _audioProcessor.StopPlaybackAsync().ConfigureAwait(false);
                    if (_responseActive && _canCancelResponse)
                    {
                        try { await _session!.CancelResponseAsync(cancellationToken).ConfigureAwait(false); }
                        catch { }
                        try { await _session!.ClearStreamingAudioAsync(cancellationToken).ConfigureAwait(false); }
                        catch { }
                    }
                    // Do NOT reset _approvalCallCount here — the counter should only
                    // reset on task completion (in MCP-call-completed when no pending/queued
                    // approvals remain) or on explicit denial (in ResolveVoiceApprovalAsync).
                    // Resetting on every speech-start would let the model retry denied calls.

                    // Clear deferred response flags if no MCP calls are in progress.
                    // Prevents stale needsResponseCreate from re-triggering result playback
                    // after the user interrupts.
                    if (_mcpCallInProgress <= 0)
                    {
                        _needsResponseCreate = false;
                        _mcpResultsPending = false;
                    }

                    // Reset approved-servers-this-turn when user starts a new topic
                    if (_pendingApproval == null && _mcpCallInProgress <= 0)
                        _approvedServersThisTurn.Clear();

                    // If an MCP call is running, ask the user if they want to wait or skip
                    if (_mcpCallInProgress > 0 && _pendingApproval == null)
                    {
                        foreach (var id in _activeMcpItems) _staleMcpItems.Add(id);
                        _logger.LogInformation("User spoke during MCP call — marking {Count} calls as stale", _activeMcpItems.Count);
                        try
                        {
                            await _session!.SendCommandAsync(BinaryData.FromObjectAsJson(new
                            {
                                type = "conversation.item.create",
                                item = new
                                {
                                    type = "message",
                                    role = "system",
                                    content = new[] { new { type = "input_text", text = "A tool call is still running in the background. The user just spoke. Respond to what the user said. If a tool result arrives later, briefly introduce it as a late result from an earlier request." } }
                                }
                            }), cancellationToken).ConfigureAwait(false);
                        }
                        catch (Exception ex) { _logger.LogWarning("Failed to inject MCP status update: {Error}", ex.Message); }
                    }
                    break;

                case SessionUpdateInputAudioBufferSpeechStopped:
                    Console.WriteLine("🤔 Processing...");
                    if (_audioProcessor != null)
                        await _audioProcessor.StartPlaybackAsync().ConfigureAwait(false);
                    break;

                case SessionUpdateResponseCreated:
                    _responseActive = true;
                    _canCancelResponse = true;
                    break;

                case SessionUpdateResponseAudioDelta audioDelta:
                    if (audioDelta.Delta != null && _audioProcessor != null)
                        await _audioProcessor.QueueAudioAsync(audioDelta.Delta.ToArray()).ConfigureAwait(false);
                    break;

                case SessionUpdateResponseAudioDone:
                    Console.WriteLine("🎤 Ready for next input...");
                    break;

                case SessionUpdateResponseDone:
                    _responseActive = false;
                    _canCancelResponse = false;
                    WriteLog("--- Response complete ---");
                    // If an approval prompt needs to be injected, do it now
                    if (_approvalPromptNeeded && _pendingApproval != null)
                    {
                        _approvalPromptNeeded = false;
                        await SendApprovalVoicePromptAsync(cancellationToken).ConfigureAwait(false);
                    }
                    // If MCP results are pending and all calls are now done, create response
                    else if (_mcpResultsPending && _mcpCallInProgress <= 0 && _pendingApproval == null)
                    {
                        _mcpResultsPending = false;
                        try { await _session!.SendCommandAsync(BinaryData.FromObjectAsJson(new { type = "response.create" }), cancellationToken).ConfigureAwait(false); }
                        catch { }
                    }
                    else if (_needsResponseCreate)
                    {
                        _needsResponseCreate = false;
                        try { await _session!.SendCommandAsync(BinaryData.FromObjectAsJson(new { type = "response.create" }), cancellationToken).ConfigureAwait(false); }
                        catch { }
                    }
                    break;

                case SessionUpdateError errorEvent:
                    var msg = errorEvent.Error?.Message ?? "";
                    if (!msg.Contains("no active response", StringComparison.OrdinalIgnoreCase))
                    {
                        // Suppress non-fatal interim/collision errors
                        if (msg.Contains("interim response", StringComparison.OrdinalIgnoreCase))
                        {
                            _logger.LogWarning("Interim response not supported with this model pipeline (non-fatal)");
                        }
                        else if (msg.Contains("active response", StringComparison.OrdinalIgnoreCase))
                        {
                            _logger.LogDebug("Response collision (expected during MCP flow): {Message}", msg);
                        }
                        else
                        {
                            Console.WriteLine($"❌ Error: {msg}");
                            WriteLog($"ERROR: {msg}");
                        }
                    }
                    _responseActive = false;
                    _canCancelResponse = false;
                    break;

                // Transcription event — used for voice-based approval resolution
                case SessionUpdateConversationItemInputAudioTranscriptionCompleted transcription:
                    var transcript = transcription.Transcript ?? "";
                    _logger.LogInformation("User said: {Transcript}", transcript);
                    Console.WriteLine($"👤 You said:\t{transcript}");
                    WriteLog($"User Input:\t{transcript}");
                    if (_pendingApproval != null)
                    {
                        await ResolveVoiceApprovalAsync(transcript, cancellationToken).ConfigureAwait(false);
                    }
                    break;

                // MCP-specific events
                case SessionUpdateMcpListToolsCompleted mcpListDone:
                    Console.WriteLine("🔧 MCP tools discovered successfully");
                    WriteLog("MCP tools discovered successfully");
                    _logger.LogInformation("MCP tools discovered for server");
                    break;

                case SessionUpdateMcpListToolsFailed:
                    Console.WriteLine("❌ MCP tool discovery failed");
                    WriteLog("ERROR: MCP tool discovery failed");
                    break;

                case SessionUpdateResponseMcpCallInProgress mcpInProgress:
                    Console.WriteLine("⏳ MCP tool call in progress...");
                    WriteLog($"MCP call in progress: {mcpInProgress.ItemId}");
                    _mcpCallInProgress++;
                    _activeMcpItems.Add(mcpInProgress.ItemId ?? "");
                    StartMcpStallTimer(cancellationToken);
                    break;

                case SessionUpdateResponseMcpCallCompleted mcpCompleted:
                {
                    var itemId = mcpCompleted.ItemId ?? "";
                    _mcpCallInProgress = Math.Max(0, _mcpCallInProgress - 1);
                    _activeMcpItems.Remove(itemId);
                    CancelMcpStallTimer();
                    if (_handledMcpCompletions.Contains(itemId))
                    {
                        _logger.LogDebug("Ignoring duplicate MCP completion for {ItemId}", itemId);
                    }
                    else
                    {
                        _handledMcpCompletions.Add(itemId);
                        bool isStale = _staleMcpItems.Remove(itemId);
                        _logger.LogInformation("MCP call completed for {ItemId} (stale={IsStale})", itemId, isStale);
                        Console.WriteLine("✅ MCP tool call completed successfully");
                        WriteLog($"MCP call completed: {itemId} (stale={isStale})");

                        // Clean up item mapping
                        _mcpItemToServer.Remove(itemId);

                        // Reset approval counter if no more approvals are pending
                        if (_pendingApproval == null && _approvalQueue.Count == 0)
                            _approvalCallCount.Clear();

                        // If the user moved on during this call, tell the model it's a late result
                        if (isStale)
                        {
                            try
                            {
                                await _session!.SendCommandAsync(BinaryData.FromObjectAsJson(new
                                {
                                    type = "conversation.item.create",
                                    item = new
                                    {
                                        type = "message",
                                        role = "system",
                                        content = new[] { new { type = "input_text", text = "This tool result is from an earlier request. The user has since moved on. Briefly introduce it as a late result, e.g. 'By the way, those results from earlier just came in...' then share the key findings concisely." } }
                                    }
                                }), cancellationToken).ConfigureAwait(false);
                            }
                            catch (Exception ex) { _logger.LogWarning("Failed to inject late-result context: {Error}", ex.Message); }
                        }

                        // Batch response: only call response.create when ALL MCP calls for this
                        // turn have completed. This prevents partial results and repeated tool calls.
                        if (_pendingApproval == null && _approvalQueue.Count == 0 && _mcpCallInProgress <= 0)
                        {
                            try
                            {
                                await _session!.SendCommandAsync(BinaryData.FromObjectAsJson(new { type = "response.create" }), cancellationToken).ConfigureAwait(false);
                            }
                            catch (Exception ex)
                            {
                                if (ex.Message.Contains("active response", StringComparison.OrdinalIgnoreCase))
                                    _needsResponseCreate = true;
                                else
                                    _logger.LogWarning("Failed to create response after MCP call: {Error}", ex.Message);
                            }
                        }
                        else
                        {
                            _mcpResultsPending = true;
                            _logger.LogInformation("MCP calls still in progress ({Count}) — deferring response", _mcpCallInProgress);
                        }
                    }
                    break;
                }

                case SessionUpdateResponseMcpCallFailed mcpFailed:
                {
                    var failedItemId = mcpFailed.ItemId ?? "";
                    Console.WriteLine("❌ MCP tool call failed");
                    WriteLog($"ERROR: MCP call failed: {failedItemId}");
                    _mcpCallInProgress = Math.Max(0, _mcpCallInProgress - 1);
                    _activeMcpItems.Remove(failedItemId);
                    _staleMcpItems.Remove(failedItemId);
                    CancelMcpStallTimer();
                    try { await _session!.SendCommandAsync(BinaryData.FromObjectAsJson(new { type = "response.create" }), cancellationToken).ConfigureAwait(false); }
                    catch { }
                    break;
                }

                case SessionUpdateConversationItemCreated itemCreated
                    when itemCreated.Item is SessionResponseMcpApprovalRequestItem mcpApproval:
                    await HandleMCPApprovalAsync(mcpApproval, cancellationToken).ConfigureAwait(false);
                    break;

                case SessionUpdateConversationItemCreated itemCreated:
                    _logger.LogDebug("Conversation item created: {ItemType}", itemCreated.Item?.GetType().Name);
                    // Track mcp_call items for server mapping and announce non-approval tool calls
                    if (itemCreated.Item is SessionResponseMcpCallItem mcpCallItem)
                    {
                        var serverLabel = mcpCallItem.ServerLabel ?? "";
                        var functionName = mcpCallItem.Name ?? "";
                        var mcpItemId = mcpCallItem.Id ?? "";
                        _logger.LogInformation("MCP Call triggered: server_label={Server}, function_name={Function}", serverLabel, functionName);
                        Console.WriteLine($"🔧 MCP tool call: {serverLabel}/{functionName}");
                        if (!string.IsNullOrEmpty(mcpItemId))
                            _mcpItemToServer[mcpItemId] = $"{serverLabel}/{functionName}";

                        // Announce the tool call so the user knows something is happening
                        if (_pendingApproval == null && !_approvalServers.Contains(serverLabel))
                        {
                            try
                            {
                                await _session!.SendCommandAsync(BinaryData.FromObjectAsJson(new
                                {
                                    type = "conversation.item.create",
                                    item = new
                                    {
                                        type = "message",
                                        role = "system",
                                        content = new[] { new { type = "input_text", text = "Briefly tell the user you're looking something up. One short sentence only." } }
                                    }
                                }), cancellationToken).ConfigureAwait(false);
                                await _session!.SendCommandAsync(BinaryData.FromObjectAsJson(new { type = "response.create" }), cancellationToken).ConfigureAwait(false);
                            }
                            catch (Exception ex)
                            {
                                if (!ex.Message.Contains("active response", StringComparison.OrdinalIgnoreCase))
                                    _logger.LogWarning("Failed to create tool announcement: {Error}", ex.Message);
                            }
                        }
                    }
                    break;

                default:
                    _logger.LogDebug("Unhandled event: {EventType}", serverEvent.GetType().Name);
                    break;
            }
        }
        // </handle_mcp_events>

        // <handle_approval>
        /// <summary>
        /// Handle MCP approval request by asking the user via voice.
        /// </summary>
        private async Task HandleMCPApprovalAsync(SessionResponseMcpApprovalRequestItem approvalItem, CancellationToken cancellationToken)
        {
            var approvalId = approvalItem.Id;
            var serverLabel = approvalItem.ServerLabel ?? "";
            var toolName = approvalItem.Name ?? "";

            if (string.IsNullOrEmpty(approvalId))
            {
                _logger.LogError("MCP approval item missing ID");
                return;
            }

            // If another approval is already pending, queue this one
            if (_pendingApproval != null)
            {
                _logger.LogInformation("Queuing approval for {Tool} — another is already pending", toolName);
                _approvalQueue.Enqueue(new ApprovalInfo(approvalId, serverLabel, toolName));
                return;
            }

            const int MaxApprovalCallsPerTask = 3;
            _approvalCallCount.TryGetValue(serverLabel, out var currentCount);
            if (currentCount >= MaxApprovalCallsPerTask)
            {
                _logger.LogInformation("Auto-denying {Tool} — reached {Count} calls this task", toolName, currentCount);
                Console.WriteLine($"   Auto-denied: {serverLabel}/{toolName} (max {MaxApprovalCallsPerTask} calls reached)");
                try
                {
                    await _session!.SendCommandAsync(BinaryData.FromObjectAsJson(new
                    {
                        type = "conversation.item.create",
                        item = new
                        {
                            type = "mcp_approval_response",
                            approval_request_id = approvalId,
                            approve = false
                        }
                    }), cancellationToken).ConfigureAwait(false);
                }
                catch (Exception ex)
                {
                    _logger.LogWarning("Failed to send auto-deny: {Error}", ex.Message);
                }
                return;
            }

            // Auto-approve if user already approved this server earlier in the same turn
            if (_approvedServersThisTurn.Contains(serverLabel))
            {
                _logger.LogInformation("Auto-approving {Tool} — server already approved this turn", toolName);
                Console.WriteLine($"   Auto-approved: {serverLabel}/{toolName} (already approved this turn)");
                try
                {
                    await _session!.SendCommandAsync(BinaryData.FromObjectAsJson(new
                    {
                        type = "conversation.item.create",
                        item = new
                        {
                            type = "mcp_approval_response",
                            approval_request_id = approvalId,
                            approve = true
                        }
                    }), cancellationToken).ConfigureAwait(false);
                }
                catch (Exception ex)
                {
                    _logger.LogWarning("Failed to send auto-approve: {Error}", ex.Message);
                }
                return;
            }

            _logger.LogInformation("MCP approval request: server={Server} tool={Tool}", serverLabel, toolName);
            Console.WriteLine();
            Console.WriteLine($"🔐 MCP Approval Request (voice-based):");
            Console.WriteLine($"   Server: {serverLabel}  Tool: {toolName}");
            WriteLog($"Approval request: server={serverLabel} tool={toolName}");

            _pendingApproval = new ApprovalInfo(approvalId, serverLabel, toolName);

            if (!_responseActive)
            {
                await SendApprovalVoicePromptAsync(cancellationToken).ConfigureAwait(false);
            }
            else
            {
                _approvalPromptNeeded = true;
            }
        }

        /// <summary>
        /// Inject a system message asking the model to verbally request permission.
        /// </summary>
        private async Task SendApprovalVoicePromptAsync(CancellationToken cancellationToken)
        {
            var pending = _pendingApproval;
            if (pending == null) return;

            var server = pending.ServerLabel;
            _approvalCallCount.TryGetValue(server, out var callCount);
            _approvalCallCount[server] = callCount + 1;

            string prompt;
            if (callCount == 0)
            {
                prompt = "You MUST ask the user for explicit permission before proceeding. "
                       + $"Say exactly: \"I'd like to search the {server} service for information. "
                       + "Do you approve? Please say yes or no.\"";
            }
            else
            {
                prompt = "You MUST ask the user for permission again. "
                       + "Say exactly: \"I need to do one more search to get complete information. "
                       + "Should I continue? Please say yes or no.\"";
            }

            try
            {
                await _session!.SendCommandAsync(BinaryData.FromObjectAsJson(new
                {
                    type = "conversation.item.create",
                    item = new
                    {
                        type = "message",
                        role = "system",
                        content = new[] { new { type = "input_text", text = prompt } }
                    }
                }), cancellationToken).ConfigureAwait(false);
                await _session!.SendCommandAsync(BinaryData.FromObjectAsJson(new { type = "response.create" }), cancellationToken).ConfigureAwait(false);
            }
            catch (Exception ex)
            {
                _logger.LogWarning("Failed to send approval voice prompt: {Error}", ex.Message);
            }
        }

        // <voice_approval_transcription>
        /// <summary>
        /// Interpret the user's spoken response as approval or denial.
        /// </summary>
        private async Task ResolveVoiceApprovalAsync(string transcript, CancellationToken cancellationToken)
        {
            var pending = _pendingApproval;
            if (pending == null) return;

            var text = transcript.Trim().ToLowerInvariant();

            bool approved = Regex.IsMatch(text, @"\byes\b");
            bool denied = Regex.IsMatch(text, @"\b(no|stop|cancel)\b");

            if (!approved && !denied)
            {
                // Ambiguous — ask again via the deferred prompt mechanism
                _logger.LogInformation("Ambiguous approval response: {Transcript}", transcript);
                _approvalPromptNeeded = true;
                return;
            }

            if (approved && denied)
            {
                // Conflicting signals — treat as denial for safety
                approved = false;
            }

            // Clear the pending state before sending the response
            _pendingApproval = null;
            if (approved)
                _approvedServersThisTurn.Add(pending.ServerLabel);
            else
            {
                _approvalCallCount.Clear();
                _approvedServersThisTurn.Remove(pending.ServerLabel);
            }

            try
            {
                await _session!.SendCommandAsync(BinaryData.FromObjectAsJson(new
                {
                    type = "conversation.item.create",
                    item = new
                    {
                        type = "mcp_approval_response",
                        approval_request_id = pending.ApprovalId,
                        approve = approved,
                    }
                }), cancellationToken).ConfigureAwait(false);
            }
            catch (Exception ex)
            {
                _logger.LogError("Failed to send approval response: {Error}", ex.Message);
                return;
            }
            _logger.LogInformation("Voice approval resolved: {Approved} for {Tool}", approved, pending.FunctionName);
            Console.WriteLine($"   Voice approval: {(approved ? "Approved ✅" : "Denied ❌")}");
            WriteLog($"Approval resolved: {(approved ? "APPROVED" : "DENIED")} for {pending.ServerLabel}/{pending.FunctionName}");

            // Process next queued approval, if any
            await ProcessNextApprovalAsync(cancellationToken).ConfigureAwait(false);
        }

        /// <summary>
        /// Pop the next queued approval and ask via voice.
        /// </summary>
        private async Task ProcessNextApprovalAsync(CancellationToken cancellationToken)
        {
            if (_approvalQueue.Count == 0) return;

            var next = _approvalQueue.Dequeue();
            _pendingApproval = next;

            if (!_responseActive)
            {
                await SendApprovalVoicePromptAsync(cancellationToken).ConfigureAwait(false);
            }
            else
            {
                _approvalPromptNeeded = true;
            }
        }
        // </voice_approval_transcription>
        // </handle_approval>

        // <mcp_stall_detection>
        private void StartMcpStallTimer(CancellationToken ct)
        {
            CancelMcpStallTimer();
            _mcpStallCts = CancellationTokenSource.CreateLinkedTokenSource(ct);
            var token = _mcpStallCts.Token;
            _ = Task.Run(async () =>
            {
                int stallCount = 0;
                while (_mcpCallInProgress > 0 && stallCount < 3)
                {
                    await Task.Delay(10000, token).ConfigureAwait(false);
                    if (_mcpCallInProgress <= 0 || _session == null)
                        break;
                    stallCount++;
                    // MCP calls cannot be cancelled — only honest status updates are possible.
                    string msg = "The tool call is still running. Briefly reassure the user that you're still waiting for results. One short sentence only.";
                    try
                    {
                        await _session.SendCommandAsync(BinaryData.FromObjectAsJson(new
                        {
                            type = "conversation.item.create",
                            item = new
                            {
                                type = "message",
                                role = "system",
                                content = new[] { new { type = "input_text", text = msg } }
                            }
                        }), token).ConfigureAwait(false);
                        await _session.SendCommandAsync(BinaryData.FromObjectAsJson(new { type = "response.create" }), token).ConfigureAwait(false);
                    }
                    catch (Exception ex)
                    {
                        if (ex.Message.Contains("active response", StringComparison.OrdinalIgnoreCase))
                            _needsResponseCreate = true;
                    }
                }
            }, token);
        }

        private void CancelMcpStallTimer()
        {
            if (_mcpStallCts != null)
            {
                _mcpStallCts.Cancel();
                _mcpStallCts.Dispose();
                _mcpStallCts = null;
            }
        }
        // </mcp_stall_detection>

        private static void WriteLog(string message)
        {
            try
            {
                var logDir = Path.Combine(Directory.GetCurrentDirectory(), "logs");
                Directory.CreateDirectory(logDir);
                var logPath = Path.Combine(logDir, LogFilename);
                File.AppendAllText(logPath, $"[{DateTime.Now:HH:mm:ss}] {message}{Environment.NewLine}");
            }
            catch (IOException) { }
        }

        public void Dispose()
        {
            if (_disposed) return;
            CancelMcpStallTimer();
            _audioProcessor?.Dispose();
            _session?.Dispose();
            _disposed = true;
        }
    }

    /// <summary>
    /// Audio processor for real-time capture and playback.
    /// Same pattern as ModelQuickstart - handles PCM16 24kHz mono audio.
    /// </summary>
    public class AudioProcessor : IDisposable
    {
        private readonly VoiceLiveSession _session;
        private readonly ILogger<AudioProcessor> _logger;

        private const int SampleRate = 24000;
        private const int Channels = 1;
        private const int BitsPerSample = 16;

        private WaveInEvent? _waveIn;
        private WaveOutEvent? _waveOut;
        private BufferedWaveProvider? _playbackBuffer;

        private bool _isCapturing;
        private bool _isPlaying;

        private readonly Channel<byte[]> _audioSendChannel;
        private readonly ChannelWriter<byte[]> _audioSendWriter;
        private readonly ChannelReader<byte[]> _audioSendReader;
        private readonly Channel<byte[]> _audioPlaybackChannel;
        private readonly ChannelWriter<byte[]> _audioPlaybackWriter;
        private readonly ChannelReader<byte[]> _audioPlaybackReader;

        private Task? _audioSendTask;
        private Task? _audioPlaybackTask;
        private readonly CancellationTokenSource _cancellationTokenSource;
        private CancellationTokenSource _playbackCancellationTokenSource;

        public AudioProcessor(VoiceLiveSession session, ILogger<AudioProcessor> logger)
        {
            _session = session;
            _logger = logger;

            _audioSendChannel = Channel.CreateUnbounded<byte[]>();
            _audioSendWriter = _audioSendChannel.Writer;
            _audioSendReader = _audioSendChannel.Reader;

            _audioPlaybackChannel = Channel.CreateUnbounded<byte[]>();
            _audioPlaybackWriter = _audioPlaybackChannel.Writer;
            _audioPlaybackReader = _audioPlaybackChannel.Reader;

            _cancellationTokenSource = new CancellationTokenSource();
            _playbackCancellationTokenSource = new CancellationTokenSource();
        }

        public Task StartCaptureAsync()
        {
            if (_isCapturing) return Task.CompletedTask;
            _isCapturing = true;

            _waveIn = new WaveInEvent
            {
                WaveFormat = new WaveFormat(SampleRate, BitsPerSample, Channels),
                BufferMilliseconds = 50
            };

            _waveIn.DataAvailable += (sender, e) =>
            {
                if (_isCapturing && e.BytesRecorded > 0)
                {
                    var audioData = new byte[e.BytesRecorded];
                    Array.Copy(e.Buffer, 0, audioData, 0, e.BytesRecorded);
                    _audioSendWriter.TryWrite(audioData);
                }
            };

            _waveIn.StartRecording();
            _audioSendTask = ProcessAudioSendAsync(_cancellationTokenSource.Token);
            _logger.LogInformation("Started audio capture");
            return Task.CompletedTask;
        }

        public Task StartPlaybackAsync()
        {
            if (_isPlaying) return Task.CompletedTask;
            _isPlaying = true;

            _waveOut = new WaveOutEvent { DesiredLatency = 100 };
            _playbackBuffer = new BufferedWaveProvider(new WaveFormat(SampleRate, BitsPerSample, Channels))
            {
                BufferDuration = TimeSpan.FromSeconds(10),
                DiscardOnBufferOverflow = true
            };

            _waveOut.Init(_playbackBuffer);
            _waveOut.Play();

            _playbackCancellationTokenSource = new CancellationTokenSource();
            _audioPlaybackTask = ProcessAudioPlaybackAsync();
            _logger.LogInformation("Audio playback ready");
            return Task.CompletedTask;
        }

        public async Task StopPlaybackAsync()
        {
            if (!_isPlaying) return;
            _isPlaying = false;

            while (_audioPlaybackReader.TryRead(out _)) { }
            _playbackBuffer?.ClearBuffer();

            if (_waveOut != null) { _waveOut.Stop(); _waveOut.Dispose(); _waveOut = null; }
            _playbackBuffer = null;
            _playbackCancellationTokenSource.Cancel();

            if (_audioPlaybackTask != null)
            {
                await _audioPlaybackTask.ConfigureAwait(false);
                _audioPlaybackTask = null;
            }
        }

        public async Task QueueAudioAsync(byte[] audioData)
        {
            if (_isPlaying && audioData.Length > 0)
                await _audioPlaybackWriter.WriteAsync(audioData).ConfigureAwait(false);
        }

        public async Task CleanupAsync()
        {
            _isCapturing = false;
            if (_waveIn != null) { _waveIn.StopRecording(); _waveIn.Dispose(); _waveIn = null; }
            _audioSendWriter.TryComplete();
            if (_audioSendTask != null) await _audioSendTask.ConfigureAwait(false);

            await StopPlaybackAsync().ConfigureAwait(false);
            _cancellationTokenSource.Cancel();
            _logger.LogInformation("Audio processor cleaned up");
        }

        private async Task ProcessAudioSendAsync(CancellationToken ct)
        {
            try
            {
                await foreach (var audioData in _audioSendReader.ReadAllAsync(ct).ConfigureAwait(false))
                {
                    try { await _session.SendInputAudioAsync(audioData, ct).ConfigureAwait(false); }
                    catch { }
                }
            }
            catch (OperationCanceledException) { }
        }

        private async Task ProcessAudioPlaybackAsync()
        {
            try
            {
                var ct = CancellationTokenSource.CreateLinkedTokenSource(
                    _playbackCancellationTokenSource.Token, _cancellationTokenSource.Token).Token;

                await foreach (var audioData in _audioPlaybackReader.ReadAllAsync(ct).ConfigureAwait(false))
                {
                    if (_playbackBuffer != null && _isPlaying)
                        _playbackBuffer.AddSamples(audioData, 0, audioData.Length);
                }
            }
            catch (OperationCanceledException) { }
        }

        public void Dispose()
        {
            CleanupAsync().Wait();
            _cancellationTokenSource.Dispose();
        }
    }
}
