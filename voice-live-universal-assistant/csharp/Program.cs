using System.Collections.Concurrent;
using System.Net.WebSockets;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using Azure;
using Azure.Core;
using Azure.Identity;
using Microsoft.Extensions.FileProviders;
using VoiceLive.Sample;

// ---------------------------------------------------------------------------
// Environment
// ---------------------------------------------------------------------------
DotNetEnv.Env.Load();

var builder = WebApplication.CreateBuilder(args);

// Listen on port 8000
builder.WebHost.UseUrls("http://0.0.0.0:8000");

// CORS — allow all for development
builder.Services.AddCors(options =>
{
    options.AddPolicy("AllowAll", policy =>
        policy.AllowAnyOrigin().AllowAnyMethod().AllowAnyHeader());
});

var app = builder.Build();

var logger = app.Services.GetRequiredService<ILoggerFactory>().CreateLogger("VoiceLive");

// ---------------------------------------------------------------------------
// Shared state
// ---------------------------------------------------------------------------
var handlers = new ConcurrentDictionary<string, VoiceLiveHandler>();
object? sharedCredential = null;
List<string>? sttLocalesCache = null;
var httpClient = new HttpClient { Timeout = TimeSpan.FromSeconds(15) };
var jsonOptions = new JsonSerializerOptions
{
    PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
    WriteIndented = false,
};

// ---------------------------------------------------------------------------
// Credential (shared, created once)
// ---------------------------------------------------------------------------
object GetCredential()
{
    if (sharedCredential != null) return sharedCredential;
    var apiKey = Environment.GetEnvironmentVariable("AZURE_VOICELIVE_API_KEY");
    if (!string.IsNullOrWhiteSpace(apiKey))
    {
        sharedCredential = new AzureKeyCredential(apiKey);
        logger.LogInformation("Using API key credential");
    }
    else
    {
        sharedCredential = new DefaultAzureCredential();
        logger.LogInformation("Using DefaultAzureCredential");
    }
    return sharedCredential;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
string EnvOrDefault(string key, string defaultValue)
{
    var v = Environment.GetEnvironmentVariable(key);
    return !string.IsNullOrWhiteSpace(v) ? v : defaultValue;
}

string? EnvOrNull(string key)
{
    var v = Environment.GetEnvironmentVariable(key);
    return !string.IsNullOrWhiteSpace(v) ? v : null;
}

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------
app.UseCors("AllowAll");
app.UseWebSockets();

// -- WebSocket middleware --------------------------------------------------
app.Use(async (context, next) =>
{
    if (context.Request.Path.StartsWithSegments("/ws") && context.WebSockets.IsWebSocketRequest)
    {
        var pathSegments = context.Request.Path.Value?.TrimEnd('/').Split('/');
        var clientId = pathSegments?.LastOrDefault() ?? "unknown";

        using var ws = await context.WebSockets.AcceptWebSocketAsync();
        logger.LogInformation("Client {ClientId} connected", clientId);

        // Thread-safe WebSocket sender
        var sendLock = new SemaphoreSlim(1, 1);
        async Task SendToClient(Dictionary<string, object> msg)
        {
            await sendLock.WaitAsync();
            try
            {
                if (ws.State == WebSocketState.Open)
                {
                    var json = JsonSerializer.Serialize(msg, jsonOptions);
                    var bytes = Encoding.UTF8.GetBytes(json);
                    await ws.SendAsync(bytes, WebSocketMessageType.Text, true, CancellationToken.None);
                }
            }
            catch (Exception ex)
            {
                logger.LogError("Failed to send to {ClientId}: {Error}", clientId, ex.Message);
            }
            finally
            {
                sendLock.Release();
            }
        }

        try
        {
            await HandleWebSocketAsync(ws, clientId, SendToClient);
        }
        finally
        {
            await CleanupClientAsync(clientId);
            sendLock.Dispose();
            logger.LogInformation("Client {ClientId} disconnected", clientId);
        }
    }
    else
    {
        await next();
    }
});

// -- Static files ---------------------------------------------------------
string? staticDir = null;
foreach (var candidate in new[]
{
    Path.Combine(AppContext.BaseDirectory, "wwwroot"),
    Path.Combine(Directory.GetCurrentDirectory(), "wwwroot"),
    Path.Combine(Directory.GetCurrentDirectory(), "..", "frontend", "dist"),
})
{
    if (Directory.Exists(candidate))
    {
        staticDir = Path.GetFullPath(candidate);
        break;
    }
}

PhysicalFileProvider? fileProvider = null;
if (staticDir != null)
{
    fileProvider = new PhysicalFileProvider(staticDir);
    app.UseDefaultFiles(new DefaultFilesOptions { FileProvider = fileProvider });
    app.UseStaticFiles(new StaticFileOptions { FileProvider = fileProvider });
    logger.LogInformation("Serving static files from {Dir}", staticDir);
}

// ---------------------------------------------------------------------------
// REST endpoints
// ---------------------------------------------------------------------------
app.MapGet("/health", () => new { status = "healthy", service = "voicelive-websocket" });

app.MapGet("/config", () =>
{
    var apiKey = EnvOrNull("AZURE_VOICELIVE_API_KEY");
    return new
    {
        mode = EnvOrDefault("VOICELIVE_MODE", "model"),
        model = EnvOrDefault("VOICELIVE_MODEL", "gpt-realtime"),
        voice = EnvOrDefault("VOICELIVE_VOICE", "en-US-Ava:DragonHDLatestNeural"),
        voiceType = EnvOrDefault("VOICELIVE_VOICE_TYPE", "azure-standard"),
        transcribeModel = EnvOrDefault("VOICELIVE_TRANSCRIBE_MODEL", "gpt-4o-transcribe"),
        instructions = EnvOrDefault("VOICELIVE_INSTRUCTIONS",
            "You are a helpful AI assistant. Respond naturally and conversationally. Keep your responses concise but engaging."),
        agentName = EnvOrDefault("AZURE_VOICELIVE_AGENT_NAME", ""),
        project = EnvOrDefault("AZURE_VOICELIVE_PROJECT", ""),
        authMethod = apiKey != null ? "api_key" : "default_credential",
    };
});

app.MapGet("/languages", async () =>
{
    var locales = await FetchSttLocalesAsync();
    return new { azureSpeechLocales = locales };
});

// -- SPA fallback ---------------------------------------------------------
if (fileProvider != null)
{
    app.MapFallbackToFile("index.html", new StaticFileOptions { FileProvider = fileProvider });
}

// ---------------------------------------------------------------------------
// Graceful shutdown
// ---------------------------------------------------------------------------
app.Lifetime.ApplicationStopping.Register(() =>
{
    logger.LogInformation("Shutting down — cleaning up {Count} active handlers", handlers.Count);
    foreach (var handler in handlers.Values)
    {
        handler.StopAsync().GetAwaiter().GetResult();
    }
    handlers.Clear();
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------
logger.LogInformation("Starting Voice Live WebSocket server …");
app.Run();

// ===========================================================================
// WebSocket handling
// ===========================================================================

async Task HandleWebSocketAsync(WebSocket ws, string clientId, Func<Dictionary<string, object>, Task> sendToClient)
{
    var buffer = new byte[8192];
    using var ms = new MemoryStream();

    while (ws.State == WebSocketState.Open)
    {
        WebSocketReceiveResult result;
        try
        {
            result = await ws.ReceiveAsync(new ArraySegment<byte>(buffer), CancellationToken.None);
        }
        catch (WebSocketException)
        {
            break;
        }

        if (result.MessageType == WebSocketMessageType.Close)
        {
            try { await ws.CloseAsync(WebSocketCloseStatus.NormalClosure, "", CancellationToken.None); }
            catch { }
            break;
        }

        ms.Write(buffer, 0, result.Count);
        if (!result.EndOfMessage) continue;

        var text = Encoding.UTF8.GetString(ms.ToArray());
        ms.SetLength(0);

        try
        {
            var node = JsonNode.Parse(text);
            var msgType = node?["type"]?.GetValue<string>();

            switch (msgType)
            {
                case "start_session":
                    await StartSessionAsync(clientId, node!, sendToClient);
                    break;
                case "stop_session":
                    await StopSessionAsync(clientId, sendToClient);
                    break;
                case "audio_chunk":
                    if (handlers.TryGetValue(clientId, out var audioHandler))
                    {
                        var data = node?["data"]?.GetValue<string>();
                        if (data != null) await audioHandler.SendAudioAsync(data);
                    }
                    break;
                case "interrupt":
                    if (handlers.TryGetValue(clientId, out var interruptHandler))
                    {
                        await interruptHandler.InterruptAsync();
                    }
                    break;
                case "send_text":
                    if (handlers.TryGetValue(clientId, out var textHandler))
                    {
                        var messageText = node?["text"]?.GetValue<string>();
                        if (messageText != null) await textHandler.SendTextAsync(messageText);
                    }
                    break;
                default:
                    logger.LogWarning("Unknown message type from {ClientId}: {Type}", clientId, msgType);
                    break;
            }
        }
        catch (Exception ex)
        {
            logger.LogError("Error handling message from {ClientId}: {Error}", clientId, ex.Message);
            await sendToClient(new Dictionary<string, object> { ["type"] = "error", ["message"] = ex.Message });
        }
    }
}

// ===========================================================================
// Session lifecycle
// ===========================================================================

async Task StartSessionAsync(string clientId, JsonNode msg, Func<Dictionary<string, object>, Task> sendToClient)
{
    try
    {
        var endpoint = Environment.GetEnvironmentVariable("AZURE_VOICELIVE_ENDPOINT");
        if (string.IsNullOrWhiteSpace(endpoint))
            throw new InvalidOperationException("Missing AZURE_VOICELIVE_ENDPOINT");

        var credential = GetCredential();

        // Build SessionConfig — frontend values override .env defaults
        var config = BuildSessionConfig(msg);

        var handlerLogger = app.Services.GetRequiredService<ILoggerFactory>().CreateLogger<VoiceLiveHandler>();
        var handler = new VoiceLiveHandler(clientId, endpoint, credential, sendToClient, config, handlerLogger);

        // Tear down previous handler for this client
        if (handlers.TryRemove(clientId, out var prev))
        {
            await prev.StopAsync();
        }

        handlers[clientId] = handler;
        await handler.StartAsync();

        logger.LogInformation("Session started for {ClientId} in {Mode} mode", clientId, config.Mode);
    }
    catch (Exception ex)
    {
        logger.LogError("Failed to start session for {ClientId}: {Error}", clientId, ex.Message);
        await sendToClient(new Dictionary<string, object> { ["type"] = "error", ["message"] = ex.Message });
    }
}

async Task StopSessionAsync(string clientId, Func<Dictionary<string, object>, Task> sendToClient)
{
    if (handlers.TryRemove(clientId, out var handler))
    {
        await handler.StopAsync();
    }
    await sendToClient(new Dictionary<string, object> { ["type"] = "session_stopped" });
    logger.LogInformation("Session stopped for {ClientId}", clientId);
}

async Task CleanupClientAsync(string clientId)
{
    if (handlers.TryRemove(clientId, out var handler))
    {
        await handler.StopAsync();
    }
}

// ===========================================================================
// Session config builder
// ===========================================================================

SessionConfig BuildSessionConfig(JsonNode msg)
{
    return new SessionConfig
    {
        Mode = GetStringOrEnv(msg, "mode", "VOICELIVE_MODE", "model"),
        Model = GetStringOrEnv(msg, "model", "VOICELIVE_MODEL", "gpt-realtime"),
        Voice = GetStringOrEnv(msg, "voice", "VOICELIVE_VOICE", "en-US-Ava:DragonHDLatestNeural"),
        VoiceType = GetStringOrEnv(msg, "voice_type", "VOICELIVE_VOICE_TYPE", "azure-standard"),
        TranscribeModel = GetStringOrEnv(msg, "transcribe_model", "VOICELIVE_TRANSCRIBE_MODEL", "gpt-4o-transcribe"),
        InputLanguage = GetStringOrDefault(msg, "input_language", ""),
        Instructions = GetStringOrEnv(msg, "instructions", "VOICELIVE_INSTRUCTIONS", ""),
        Temperature = GetFloatOrDefault(msg, "temperature",
            float.Parse(EnvOrDefault("VOICELIVE_TEMPERATURE", "0.7"))),
        VadType = GetStringOrEnv(msg, "vad_type", "VOICELIVE_VAD_TYPE", "azure_semantic"),
        NoiseReduction = GetBoolOrDefault(msg, "noise_reduction", true),
        EchoCancellation = GetBoolOrDefault(msg, "echo_cancellation", true),
        AgentName = GetStringOrEnv(msg, "agent_name", "AZURE_VOICELIVE_AGENT_NAME", null) ?? "",
        ProjectName = GetStringOrEnv(msg, "project", "AZURE_VOICELIVE_PROJECT", null) ?? "",
        AgentVersion = GetStringOrEnv(msg, "agent_version", "AZURE_VOICELIVE_AGENT_VERSION", null),
        ConversationId = GetStringOrDefault(msg, "conversation_id", null),
        FoundryResourceOverride = GetStringOrEnv(msg, "foundry_resource_override",
            "AZURE_VOICELIVE_FOUNDRY_RESOURCE_OVERRIDE", null),
        AuthIdentityClientId = GetStringOrEnv(msg, "auth_identity_client_id",
            "AZURE_VOICELIVE_AUTH_IDENTITY_CLIENT_ID", null),
        ByomProfile = EnvOrNull("VOICELIVE_BYOM_PROFILE"),
        ProactiveGreeting = GetBoolOrDefault(msg, "proactive_greeting", true),
        GreetingType = GetStringOrDefault(msg, "greeting_type", "llm"),
        GreetingText = GetStringOrDefault(msg, "greeting_text", "") ?? "",
        InterimResponse = GetBoolOrDefault(msg, "interim_response", false),
        InterimResponseType = GetStringOrDefault(msg, "interim_response_type", "llm") ?? "llm",
        InterimTriggerTool = GetBoolOrDefault(msg, "interim_trigger_tool", true),
        InterimTriggerLatency = GetBoolOrDefault(msg, "interim_trigger_latency", true),
        InterimLatencyMs = GetIntOrDefault(msg, "interim_latency_ms", 100),
        InterimInstructions = GetStringOrDefault(msg, "interim_instructions", "") ?? "",
        InterimStaticTexts = GetStringOrDefault(msg, "interim_static_texts", "") ?? "",
    };
}

// ===========================================================================
// STT locale discovery (cached)
// ===========================================================================

async Task<List<string>> FetchSttLocalesAsync()
{
    if (sttLocalesCache != null) return sttLocalesCache;

    var endpoint = EnvOrDefault("AZURE_VOICELIVE_ENDPOINT", "").TrimEnd('/');
    if (string.IsNullOrWhiteSpace(endpoint)) return new List<string>();

    var apiVersion = EnvOrDefault("SPEECH_API_VERSION", "2025-10-15");
    var url = $"{endpoint}/speechtotext/transcriptions/locales?api-version={apiVersion}";

    try
    {
        var request = new HttpRequestMessage(HttpMethod.Get, url);

        var apiKey = EnvOrNull("AZURE_VOICELIVE_API_KEY");
        if (apiKey != null)
        {
            request.Headers.Add("Ocp-Apim-Subscription-Key", apiKey);
        }
        else
        {
            // Token auth
            var cred = GetCredential();
            if (cred is TokenCredential tokenCred)
            {
                var tokenContext = new TokenRequestContext(new[] { "https://cognitiveservices.azure.com/.default" });
                var token = await tokenCred.GetTokenAsync(tokenContext, CancellationToken.None);
                request.Headers.Add("Authorization", $"Bearer {token.Token}");
            }
        }

        var response = await httpClient.SendAsync(request);
        response.EnsureSuccessStatusCode();

        var body = await response.Content.ReadAsStringAsync();
        var data = JsonSerializer.Deserialize<Dictionary<string, JsonElement>>(body);

        var allLocales = new SortedSet<string>();
        if (data != null)
        {
            foreach (var kv in data)
            {
                if (kv.Value.ValueKind == JsonValueKind.Array)
                {
                    foreach (var item in kv.Value.EnumerateArray())
                    {
                        if (item.ValueKind == JsonValueKind.String)
                        {
                            allLocales.Add(item.GetString()!);
                        }
                    }
                }
            }
        }

        sttLocalesCache = allLocales.ToList();
        logger.LogInformation("Fetched {Count} STT locales from API", sttLocalesCache.Count);
        return sttLocalesCache;
    }
    catch (Exception ex)
    {
        logger.LogWarning("Failed to fetch STT locales: {Error}", ex.Message);
        return new List<string>();
    }
}

// ===========================================================================
// JSON extraction helpers
// ===========================================================================

string GetStringOrDefault(JsonNode msg, string key, string? defaultValue)
{
    var v = msg[key];
    if (v != null)
    {
        var s = v.GetValue<string>();
        if (!string.IsNullOrWhiteSpace(s)) return s;
    }
    return defaultValue ?? "";
}

string GetStringOrEnv(JsonNode msg, string key, string envKey, string? defaultValue)
{
    var v = msg[key];
    if (v != null)
    {
        try
        {
            var s = v.GetValue<string>();
            if (!string.IsNullOrWhiteSpace(s)) return s;
        }
        catch { }
    }
    return EnvOrDefault(envKey, defaultValue ?? "");
}

bool GetBoolOrDefault(JsonNode msg, string key, bool defaultValue)
{
    var v = msg[key];
    if (v != null)
    {
        try { return v.GetValue<bool>(); } catch { }
    }
    return defaultValue;
}

float GetFloatOrDefault(JsonNode msg, string key, float defaultValue)
{
    var v = msg[key];
    if (v != null)
    {
        try { return v.GetValue<float>(); } catch { }
        try { return float.Parse(v.GetValue<string>()); } catch { }
    }
    return defaultValue;
}

int GetIntOrDefault(JsonNode msg, string key, int defaultValue)
{
    var v = msg[key];
    if (v != null)
    {
        try { return v.GetValue<int>(); } catch { }
        try { return int.Parse(v.GetValue<string>()); } catch { }
    }
    return defaultValue;
}
