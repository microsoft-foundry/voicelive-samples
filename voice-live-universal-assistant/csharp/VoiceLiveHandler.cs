using System.Text;
using System.Text.Json;

using Azure;
using Azure.AI.VoiceLive;
using Azure.Core;
using Microsoft.Extensions.Logging;

namespace VoiceLive.Sample;

/// <summary>
/// Bridges the browser WebSocket to the Azure Voice Live SDK.
/// Manages a single VoiceLive session for one WebSocket client.
/// Equivalent to Python's VoiceLiveHandler / Java's VoiceLiveHandler.
/// </summary>
public class VoiceLiveHandler
{
    private readonly string _clientId;
    private readonly string _endpoint;
    private readonly object _credential;
    private readonly Func<Dictionary<string, object>, Task> _sendMessage;
    private readonly SessionConfig _config;
    private readonly ILogger _logger;

    private VoiceLiveClient? _client;
    private volatile VoiceLiveSession? _session;
    private CancellationTokenSource? _cts;
    private Task? _eventTask;
    private volatile bool _running;
    private bool _greetingSent;
    private string _serviceSessionId = "";
    private readonly StringBuilder _assistantTranscript = new();

    public VoiceLiveHandler(
        string clientId,
        string endpoint,
        object credential,
        Func<Dictionary<string, object>, Task> sendMessage,
        SessionConfig config,
        ILogger logger)
    {
        _clientId = clientId;
        _endpoint = endpoint;
        _credential = credential;
        _sendMessage = sendMessage;
        _config = config;
        _logger = logger;
    }

    // ------------------------------------------------------------------
    // Public API
    // ------------------------------------------------------------------

    /// <summary>Open VoiceLive connection and begin processing events.</summary>
    public Task StartAsync()
    {
        _running = true;
        _cts = new CancellationTokenSource();
        _eventTask = RunAsync(_cts.Token);
        return Task.CompletedTask;
    }

    /// <summary>Forward base64-encoded PCM16 audio from the browser to VoiceLive.</summary>
    public async Task SendAudioAsync(string audioBase64)
    {
        var session = _session;
        if (session != null && _running)
        {
            try
            {
                var audioBytes = Convert.FromBase64String(audioBase64);
                await session.SendInputAudioAsync(audioBytes);
            }
            catch (Exception ex)
            {
                _logger.LogError("[{ClientId}] Error forwarding audio: {Error}", _clientId, ex.Message);
            }
        }
    }

    /// <summary>Send a text message via Voice Live (conversation.item.create + response.create).</summary>
    public async Task SendTextAsync(string text)
    {
        var session = _session;
        if (session != null && _running && !string.IsNullOrWhiteSpace(text))
        {
            try
            {
                await session.SendCommandAsync(BinaryData.FromObjectAsJson(new
                {
                    type = "conversation.item.create",
                    item = new
                    {
                        type = "message",
                        role = "user",
                        content = new[] { new { type = "input_text", text = text.Trim() } },
                    },
                }));
                await session.SendCommandAsync(BinaryData.FromObjectAsJson(new
                {
                    type = "response.create",
                }));
            }
            catch (Exception ex)
            {
                _logger.LogError("[{ClientId}] Error sending text: {Error}", _clientId, ex.Message);
            }
        }
    }

    /// <summary>Cancel the current response (user barge-in).</summary>
    public async Task InterruptAsync()
    {
        var session = _session;
        if (session != null)
        {
            try
            {
                await session.CancelResponseAsync();
            }
            catch (Exception ex)
            {
                _logger.LogDebug("[{ClientId}] No response to cancel: {Error}", _clientId, ex.Message);
            }
        }
    }

    /// <summary>Gracefully shut down the handler.</summary>
    public async Task StopAsync()
    {
        _running = false;
        try { _cts?.Cancel(); } catch { }
        if (_eventTask != null)
        {
            try { await _eventTask; } catch { }
        }
        _logger.LogInformation("[{ClientId}] Handler stopped", _clientId);
    }

    public bool IsRunning => _running;

    // ------------------------------------------------------------------
    // Connection + session setup
    // ------------------------------------------------------------------

    private async Task RunAsync(CancellationToken ct)
    {
        try
        {
            _logger.LogInformation("[{ClientId}] Connecting in {Mode} mode (model={Model}, voice={Voice})",
                _clientId, _config.Mode, _config.Model, _config.Voice);

            _client = CreateClient();

            // Start session — agent mode uses AgentSessionConfig, model mode uses model string
            if (_config.Mode == "agent"
                && !string.IsNullOrWhiteSpace(_config.AgentName)
                && !string.IsNullOrWhiteSpace(_config.ProjectName))
            {
                var agentConfig = new AgentSessionConfig(_config.AgentName, _config.ProjectName);
                if (!string.IsNullOrWhiteSpace(_config.AgentVersion))
                    agentConfig.AgentVersion = _config.AgentVersion;
                if (!string.IsNullOrWhiteSpace(_config.ConversationId))
                    agentConfig.ConversationId = _config.ConversationId;
                if (!string.IsNullOrWhiteSpace(_config.FoundryResourceOverride))
                    agentConfig.FoundryResourceOverride = _config.FoundryResourceOverride;
                if (!string.IsNullOrWhiteSpace(_config.AuthIdentityClientId)
                    && !string.IsNullOrWhiteSpace(_config.FoundryResourceOverride))
                    agentConfig.AuthenticationIdentityClientId = _config.AuthIdentityClientId;

                _session = await _client.StartSessionAsync(agentConfig);
                _logger.LogInformation("[{ClientId}] Started agent session (agent={Agent}, project={Project})",
                    _clientId, _config.AgentName, _config.ProjectName);
            }
            else
            {
                _session = await _client.StartSessionAsync(_config.Model);
                _logger.LogInformation("[{ClientId}] Started model session (model={Model})", _clientId, _config.Model);
            }

            // Configure session
            await ConfigureSessionAsync();

            // Event loop
            await ProcessEventsAsync(ct);
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested)
        {
            _logger.LogInformation("[{ClientId}] Event loop cancelled", _clientId);
        }
        catch (Exception ex)
        {
            _logger.LogError("[{ClientId}] VoiceLive error: {Error}", _clientId, ex.Message);
            try { await _sendMessage(new Dictionary<string, object> { ["type"] = "error", ["message"] = ex.Message }); }
            catch { }
        }
        finally
        {
            _running = false;
            try { _session?.Dispose(); } catch { }
            _session = null;
            _client = null;
        }
    }

    private VoiceLiveClient CreateClient()
    {
        var options = new VoiceLiveClientOptions(VoiceLiveClientOptions.ServiceVersion.V2026_01_01_PREVIEW);

        return _credential switch
        {
            AzureKeyCredential keyCred => new VoiceLiveClient(new Uri(_endpoint), keyCred, options),
            TokenCredential tokenCred => new VoiceLiveClient(new Uri(_endpoint), tokenCred, options),
            _ => throw new InvalidOperationException($"Unsupported credential type: {_credential.GetType().Name}")
        };
    }

    // ------------------------------------------------------------------
    // Session configuration
    // ------------------------------------------------------------------

    private async Task ConfigureSessionAsync()
    {
        var session = _session!;
        var options = new VoiceLiveSessionOptions();

        // Voice
        if (_config.VoiceType == "openai")
        {
            options.Voice = new OpenAIVoice(new OAIVoice(_config.Voice));
        }
        else
        {
            options.Voice = new AzureStandardVoice(_config.Voice);
        }

        // VAD
        options.TurnDetection = _config.VadType switch
        {
            "azure_semantic_en" => new AzureSemanticVadTurnDetectionEn(),
            "azure_semantic_multilingual" => new AzureSemanticVadTurnDetectionMultilingual(),
            "server" => new ServerVadTurnDetection(),
            _ => new AzureSemanticVadTurnDetection(),
        };

        // Modalities & audio format
        options.Modalities.Add(InteractionModality.Text);
        options.Modalities.Add(InteractionModality.Audio);
        options.InputAudioFormat = InputAudioFormat.Pcm16;
        options.OutputAudioFormat = OutputAudioFormat.Pcm16;

        // Echo cancellation & noise reduction
        if (_config.EchoCancellation)
        {
            options.InputAudioEchoCancellation = new AudioEchoCancellation();
        }
        if (_config.NoiseReduction)
        {
            options.InputAudioNoiseReduction = new AudioNoiseReduction(AudioNoiseReductionType.AzureDeepNoiseSuppression);
        }

        // Model-mode-only settings: temperature, instructions, transcription
        // In agent mode, these are managed by the agent config on the server.
        if (_config.Mode == "model")
        {
            options.Temperature = _config.Temperature;

            if (!string.IsNullOrWhiteSpace(_config.Instructions))
            {
                options.Instructions = _config.Instructions;
            }

            // Auto-correct transcribeModel for cascaded (text) models
            var multimodal = new[] { "gpt-realtime", "gpt-realtime-mini", "phi4-mm-realtime", "phi4-mini" };
            if (!multimodal.Contains(_config.Model) && _config.TranscribeModel != "azure-speech")
            {
                _logger.LogInformation("[{ClientId}] Auto-corrected transcribeModel to azure-speech for cascaded model {Model}",
                    _clientId, _config.Model);
                _config.TranscribeModel = "azure-speech";
                _config.InputLanguage = "";
            }

            var transcription = new AudioInputTranscriptionOptions(
                new AudioInputTranscriptionOptionsModel(_config.TranscribeModel));
            if (!string.IsNullOrWhiteSpace(_config.InputLanguage))
            {
                transcription.Language = _config.InputLanguage;
            }
            options.InputAudioTranscription = transcription;
        }

        // Interim response configuration
        if (_config.InterimResponse)
        {
            if (_config.InterimResponseType == "static"
                && !string.IsNullOrWhiteSpace(_config.InterimStaticTexts))
            {
                var staticConfig = new StaticInterimResponseConfig();
                foreach (var text in _config.InterimStaticTexts.Split('\n', StringSplitOptions.RemoveEmptyEntries))
                {
                    staticConfig.Texts.Add(text.Trim());
                }
                if (_config.InterimTriggerTool)
                    staticConfig.Triggers.Add(InterimResponseTrigger.Tool);
                if (_config.InterimTriggerLatency)
                    staticConfig.Triggers.Add(InterimResponseTrigger.Latency);
                if (_config.InterimLatencyMs > 0)
                    staticConfig.LatencyThresholdMs = _config.InterimLatencyMs;
                options.InterimResponse = BinaryData.FromObjectAsJson(staticConfig);
            }
            else
            {
                var llmConfig = new LlmInterimResponseConfig();
                if (!string.IsNullOrWhiteSpace(_config.InterimInstructions))
                    llmConfig.Instructions = _config.InterimInstructions;
                if (_config.InterimTriggerTool)
                    llmConfig.Triggers.Add(InterimResponseTrigger.Tool);
                if (_config.InterimTriggerLatency)
                    llmConfig.Triggers.Add(InterimResponseTrigger.Latency);
                if (_config.InterimLatencyMs > 0)
                    llmConfig.LatencyThresholdMs = _config.InterimLatencyMs;
                options.InterimResponse = BinaryData.FromObjectAsJson(llmConfig);
            }
        }

        await session.ConfigureSessionAsync(options);

        _logger.LogInformation("[{ClientId}] Session configured ({Mode} mode, voice={Voice}, vad={Vad})",
            _clientId, _config.Mode, _config.Voice, _config.VadType);
    }

    // ------------------------------------------------------------------
    // Proactive greeting helpers
    // ------------------------------------------------------------------

    private async Task SendLlmGeneratedGreetingAsync()
    {
        var session = _session;
        if (session == null) return;

        try
        {
            var instruction = !string.IsNullOrWhiteSpace(_config.GreetingText)
                ? _config.GreetingText
                : "Greet the user warmly and briefly explain how you can help. Start the conversation in English.";

            var item = new SystemMessageItem(new[] { new InputTextContentPart(instruction) });
            await session.AddItemAsync(item);
            await session.StartResponseAsync();

            _logger.LogInformation("[{ClientId}] LLM-generated greeting triggered", _clientId);
        }
        catch (Exception ex)
        {
            _logger.LogWarning("[{ClientId}] LLM-generated greeting failed: {Error}", _clientId, ex.Message);
        }
    }

    private async Task SendPreGeneratedGreetingAsync()
    {
        var session = _session;
        if (session == null) return;

        try
        {
            var text = !string.IsNullOrWhiteSpace(_config.GreetingText)
                ? _config.GreetingText
                : "Welcome! I'm here to help you get started.";

            // Send via raw command — typed API for response.create with
            // pre_generated_assistant_message is internal in the C# SDK.
            var cmd = new
            {
                type = "response.create",
                response = new
                {
                    pre_generated_assistant_message = new
                    {
                        type = "message",
                        role = "assistant",
                        content = new[] { new { type = "output_text", text } },
                    },
                },
            };
            await session.SendCommandAsync(BinaryData.FromObjectAsJson(cmd));

            _logger.LogInformation("[{ClientId}] Pre-generated greeting sent", _clientId);
        }
        catch (Exception ex)
        {
            _logger.LogWarning("[{ClientId}] Pre-generated greeting failed: {Error}", _clientId, ex.Message);
        }
    }

    // ------------------------------------------------------------------
    // Event loop
    // ------------------------------------------------------------------

    private async Task ProcessEventsAsync(CancellationToken ct)
    {
        var session = _session!;
        await foreach (var serverEvent in session.GetUpdatesAsync(ct))
        {
            if (!_running) break;
            try
            {
                await HandleEventAsync(serverEvent);
            }
            catch (Exception ex)
            {
                _logger.LogError("[{ClientId}] Event handling error: {Error}", _clientId, ex.Message);
            }
        }
    }

    private async Task HandleEventAsync(SessionUpdate serverEvent)
    {
        switch (serverEvent)
        {
            // -- Session created (carries service session ID) -----------------
            case SessionUpdateSessionCreated created:
                var createdSession = created.Session;
                _serviceSessionId = createdSession?.Id ?? "";
                _logger.LogInformation("[{ClientId}] SESSION_CREATED — session_id: {SessionId}", _clientId, _serviceSessionId);
                break;

            // -- Session ready ------------------------------------------------
            case SessionUpdateSessionUpdated updated:
                // Pick up session ID if not captured from SESSION_CREATED
                if (string.IsNullOrEmpty(_serviceSessionId))
                {
                    _serviceSessionId = updated.Session?.Id ?? "";
                }

                await _sendMessage(new Dictionary<string, object>
                {
                    ["type"] = "session_started",
                    ["session_id"] = !string.IsNullOrEmpty(_serviceSessionId) ? _serviceSessionId : _clientId,
                    ["config"] = new Dictionary<string, object>
                    {
                        ["mode"] = _config.Mode,
                        ["model"] = _config.Model,
                        ["voice"] = _config.Voice,
                    },
                });
                await _sendMessage(new Dictionary<string, object> { ["type"] = "status", ["state"] = "listening" });

                // Proactive greeting — trigger once per session
                if (_config.ProactiveGreeting && !_greetingSent)
                {
                    _greetingSent = true;
                    if (_config.GreetingType == "pregenerated")
                        await SendPreGeneratedGreetingAsync();
                    else
                        await SendLlmGeneratedGreetingAsync();
                }
                break;

            // -- User starts speaking (barge-in) ------------------------------
            case SessionUpdateInputAudioBufferSpeechStarted:
                await _sendMessage(new Dictionary<string, object> { ["type"] = "status", ["state"] = "listening" });
                await _sendMessage(new Dictionary<string, object> { ["type"] = "stop_playback" });
                try { await _session!.CancelResponseAsync(); } catch { }
                break;

            // -- User stops speaking ------------------------------------------
            case SessionUpdateInputAudioBufferSpeechStopped:
                await _sendMessage(new Dictionary<string, object> { ["type"] = "status", ["state"] = "thinking" });
                break;

            // -- Response lifecycle -------------------------------------------
            case SessionUpdateResponseCreated:
                await _sendMessage(new Dictionary<string, object> { ["type"] = "status", ["state"] = "speaking" });
                break;

            case SessionUpdateResponseAudioDelta audioDelta:
                var delta = audioDelta.Delta;
                if (delta != null)
                {
                    var audioBytes = delta.ToArray();
                    if (audioBytes.Length > 0)
                    {
                        var audioB64 = Convert.ToBase64String(audioBytes);
                        await _sendMessage(new Dictionary<string, object>
                        {
                            ["type"] = "audio_data",
                            ["data"] = audioB64,
                            ["format"] = "pcm16",
                            ["sampleRate"] = 24000,
                            ["channels"] = 1,
                        });
                    }
                }
                break;

            case SessionUpdateResponseAudioDone:
                _logger.LogDebug("[{ClientId}] Audio response complete", _clientId);
                break;

            case SessionUpdateResponseDone:
                // Flush accumulated assistant transcript as final
                if (_assistantTranscript.Length > 0)
                {
                    await _sendMessage(new Dictionary<string, object>
                    {
                        ["type"] = "transcript",
                        ["role"] = "assistant",
                        ["text"] = _assistantTranscript.ToString(),
                        ["isFinal"] = true,
                    });
                    _assistantTranscript.Clear();
                }
                await _sendMessage(new Dictionary<string, object> { ["type"] = "status", ["state"] = "listening" });
                break;

            // -- Transcription ------------------------------------------------
            case SessionUpdateConversationItemInputAudioTranscriptionCompleted transcription:
                var userText = transcription.Transcript;
                if (!string.IsNullOrWhiteSpace(userText))
                {
                    await _sendMessage(new Dictionary<string, object>
                    {
                        ["type"] = "transcript",
                        ["role"] = "user",
                        ["text"] = userText,
                        ["isFinal"] = true,
                    });
                }
                break;

            case SessionUpdateResponseAudioTranscriptDelta transcriptDelta:
                var deltaText = transcriptDelta.Delta;
                if (!string.IsNullOrEmpty(deltaText))
                {
                    _assistantTranscript.Append(deltaText);
                    await _sendMessage(new Dictionary<string, object>
                    {
                        ["type"] = "transcript",
                        ["role"] = "assistant",
                        ["text"] = _assistantTranscript.ToString(),
                        ["isFinal"] = false,
                    });
                }
                break;

            // -- Errors -------------------------------------------------------
            case SessionUpdateError errorEvent:
                var errorDetails = errorEvent.Error;
                var message = errorDetails?.Message ?? serverEvent.ToString() ?? "";
                var code = errorDetails?.Code ?? "";

                // Benign cancellation errors — don't surface to client
                if (code == "response_cancel_not_active" || message.Contains("no active response", StringComparison.OrdinalIgnoreCase))
                {
                    _logger.LogDebug("[{ClientId}] Benign cancel error: {Msg}", _clientId, message);
                    break;
                }
                _logger.LogError("[{ClientId}] VoiceLive error event: {Msg}", _clientId, message);
                await _sendMessage(new Dictionary<string, object> { ["type"] = "error", ["message"] = message });
                break;
        }
    }
}
