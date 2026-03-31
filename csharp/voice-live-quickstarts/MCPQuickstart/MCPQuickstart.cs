// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

using System;
using System.Collections.Generic;
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
            var instructions = configuration["VoiceLive:Instructions"] ?? "You are a helpful AI assistant with access to MCP tools. Use the tools to help answer user questions. Respond naturally and conversationally.";
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
                Console.WriteLine("  • 'Can you summarize the GitHub repo azure-sdk-for-net?'");
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
                    RequireApproval = BinaryData.FromObjectAsJson(MCPApprovalType.Never),
                },
                new VoiceLiveMcpServerDefinition("azure_doc", "https://learn.microsoft.com/api/mcp")
                {
                    RequireApproval = BinaryData.FromObjectAsJson(MCPApprovalType.Always),
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

            sessionOptions.Modalities.Clear();
            sessionOptions.Modalities.Add(InteractionModality.Text);
            sessionOptions.Modalities.Add(InteractionModality.Audio);

            // Add MCP servers to the tools list
            var mcpServers = DefineMCPServers();
            foreach (var tool in mcpServers)
            {
                sessionOptions.Tools.Add(tool);
            }

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
                case SessionUpdateSessionUpdated:
                    _logger.LogInformation("Session updated");
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
                    break;

                case SessionUpdateError errorEvent:
                    var msg = errorEvent.Error?.Message ?? "";
                    if (!msg.Contains("no active response", StringComparison.OrdinalIgnoreCase))
                    {
                        Console.WriteLine($"❌ Error: {msg}");
                    }
                    _responseActive = false;
                    _canCancelResponse = false;
                    break;

                // MCP-specific events
                case SessionUpdateMcpListToolsCompleted mcpListDone:
                    Console.WriteLine("🔧 MCP tools discovered successfully");
                    _logger.LogInformation("MCP tools discovered for server");
                    break;

                case SessionUpdateMcpListToolsFailed:
                    Console.WriteLine("❌ MCP tool discovery failed");
                    break;

                case SessionUpdateResponseMcpCallInProgress mcpInProgress:
                    Console.WriteLine("⏳ MCP tool call in progress...");
                    break;

                case SessionUpdateResponseMcpCallCompleted mcpCompleted:
                    Console.WriteLine("✅ MCP tool call completed");
                    _logger.LogInformation("MCP call completed");
                    break;

                case SessionUpdateResponseMcpCallFailed mcpFailed:
                    Console.WriteLine("❌ MCP tool call failed");
                    break;

                case SessionUpdateConversationItemCreated itemCreated
                    when itemCreated.Item is SessionResponseMcpApprovalRequestItem mcpApproval:
                    await HandleMCPApprovalAsync(mcpApproval, cancellationToken).ConfigureAwait(false);
                    break;

                default:
                    _logger.LogDebug("Unhandled event: {EventType}", serverEvent.GetType().Name);
                    break;
            }
        }
        // </handle_mcp_events>

        // <handle_approval>
        /// <summary>
        /// Handle MCP approval request by prompting the user in the console.
        /// </summary>
        private async Task HandleMCPApprovalAsync(SessionResponseMcpApprovalRequestItem approvalItem, CancellationToken cancellationToken)
        {
            var approvalId = approvalItem.Id;
            var serverLabel = approvalItem.ServerLabel;
            var toolName = approvalItem.Name;
            var arguments = approvalItem.Arguments;

            Console.WriteLine();
            Console.WriteLine("🔐 MCP Approval Request:");
            Console.WriteLine($"   Server:    {serverLabel}");
            Console.WriteLine($"   Tool:      {toolName}");
            Console.WriteLine($"   Arguments: {arguments}");

            // Prompt the user for approval
            bool approved = false;
            while (true)
            {
                Console.Write("   Approve? (y/n): ");
                var input = Console.ReadLine()?.Trim().ToLowerInvariant();
                if (input == "y") { approved = true; break; }
                if (input == "n") { approved = false; break; }
                Console.WriteLine("   Invalid input. Please type 'y' or 'n'.");
            }

            // Send the approval or denial response via SendCommandAsync with raw JSON
            await _session!.SendCommandAsync(BinaryData.FromObjectAsJson(new
            {
                type = "conversation.item.create",
                item = new
                {
                    type = "mcp_approval_response",
                    approval_request_id = approvalId,
                    approve = approved,
                }
            }), cancellationToken).ConfigureAwait(false);
            _logger.LogInformation("Sent MCP approval response: {Approved} for {Tool}", approved, toolName);
        }
        // </handle_approval>

        public void Dispose()
        {
            if (_disposed) return;
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
