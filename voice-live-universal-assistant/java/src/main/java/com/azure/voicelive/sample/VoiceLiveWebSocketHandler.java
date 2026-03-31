package com.azure.voicelive.sample;

import java.io.IOException;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.web.socket.CloseStatus;
import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketSession;
import org.springframework.web.socket.handler.TextWebSocketHandler;

/**
 * WebSocket handler that bridges browser clients to Azure Voice Live SDK.
 * Receives JSON messages from frontend and dispatches to VoiceLiveHandler.
 */
public class VoiceLiveWebSocketHandler extends TextWebSocketHandler {

    private static final Logger logger = LoggerFactory.getLogger(VoiceLiveWebSocketHandler.class);
    private static final ObjectMapper mapper = new ObjectMapper();

    private final ConcurrentHashMap<String, VoiceLiveHandler> handlers = new ConcurrentHashMap<>();
    private final Object credential;
    private final String endpoint;
    // SDK calls (.block()) must not run on the WebSocket I/O thread
    private final ExecutorService sdkExecutor = Executors.newCachedThreadPool(r -> {
        Thread t = new Thread(r, "voicelive-sdk");
        t.setDaemon(true);
        return t;
    });

    public VoiceLiveWebSocketHandler(Object credential, String endpoint) {
        this.credential = credential;
        this.endpoint = endpoint;
    }

    @Override
    public void afterConnectionEstablished(WebSocketSession session) {
        String clientId = extractClientId(session);
        // Allow large messages — audio chunks are base64-encoded and can be 100KB+
        session.setTextMessageSizeLimit(512 * 1024);
        session.setBinaryMessageSizeLimit(512 * 1024);
        logger.info("Client {} connected", clientId);
    }

    @Override
    protected void handleTextMessage(WebSocketSession session, TextMessage message) throws Exception {
        String clientId = extractClientId(session);
        try {
            Map<String, Object> msg = mapper.readValue(message.getPayload(),
                    new TypeReference<Map<String, Object>>() {});
            String type = (String) msg.get("type");

            switch (type) {
                case "start_session" -> handleStartSession(clientId, msg, session);
                case "stop_session" -> handleStopSession(clientId, session);
                case "audio_chunk" -> handleAudioChunk(clientId, msg);
                case "interrupt" -> handleInterrupt(clientId);
                case "send_text" -> handleSendText(clientId, msg);
                default -> logger.warn("Unknown message type from {}: {}", clientId, type);
            }
        } catch (Exception e) {
            logger.error("Error handling message from {}: {}", clientId, e.getMessage());
            sendJson(session, Map.of("type", "error", "message", e.getMessage()));
        }
    }

    @Override
    public void afterConnectionClosed(WebSocketSession session, CloseStatus status) {
        String clientId = extractClientId(session);
        logger.info("Client {} disconnected (status={})", clientId, status);
        cleanupClient(clientId);
    }

    @Override
    public void handleTransportError(WebSocketSession session, Throwable exception) {
        String clientId = extractClientId(session);
        logger.error("WebSocket transport error for {}: {}", clientId, exception.getMessage());
        cleanupClient(clientId);
        try {
            if (session.isOpen()) {
                session.close(CloseStatus.SERVER_ERROR);
            }
        } catch (IOException e) {
            logger.debug("Error closing WebSocket after transport error for {}: {}", clientId, e.getMessage());
        }
    }

    /**
     * Shutdown all active handlers (called on application destroy).
     */
    public void shutdownAll() {
        for (String clientId : handlers.keySet()) {
            cleanupClient(clientId);
        }
        handlers.clear();
        sdkExecutor.shutdownNow();
    }

    // ------------------------------------------------------------------
    // Message handlers
    // ------------------------------------------------------------------

    private void handleStartSession(String clientId, Map<String, Object> msg, WebSocketSession wsSession) {
        try {
            if (endpoint == null || endpoint.isBlank()) {
                throw new IllegalStateException("Missing AZURE_VOICELIVE_ENDPOINT");
            }

            // Build SessionConfig from frontend values, with env var defaults
            SessionConfig config = buildSessionConfig(msg);

            // Thread-safe message sender
            java.util.function.Consumer<Map<String, Object>> sendFn = (m) -> {
                sendJson(wsSession, m);
            };

            VoiceLiveHandler handler = new VoiceLiveHandler(
                    clientId, endpoint, credential, sendFn, config);

            // Tear down previous handler
            VoiceLiveHandler prev = handlers.put(clientId, handler);
            if (prev != null) {
                prev.stop();
            }

            // Start in a separate thread to avoid blocking the WebSocket thread
            new Thread(handler::start, "voicelive-" + clientId).start();

            logger.info("Session starting for {} in {} mode", clientId, config.getMode());

        } catch (Exception e) {
            logger.error("Failed to start session for {}: {}", clientId, e.getMessage());
            sendJson(wsSession, Map.of("type", "error", "message", e.getMessage()));
        }
    }

    private void handleStopSession(String clientId, WebSocketSession wsSession) {
        VoiceLiveHandler handler = handlers.remove(clientId);
        if (handler != null) {
            handler.stop();
        }
        sendJson(wsSession, Map.of("type", "session_stopped"));
        // Close the WebSocket with a proper close frame so clients get a clean shutdown
        try {
            if (wsSession.isOpen()) {
                wsSession.close(CloseStatus.NORMAL);
            }
        } catch (IOException e) {
            logger.debug("Error closing WebSocket for {}: {}", clientId, e.getMessage());
        }
        logger.info("Session stopped for {}", clientId);
    }

    private void handleAudioChunk(String clientId, Map<String, Object> msg) {
        VoiceLiveHandler handler = handlers.get(clientId);
        if (handler != null) {
            String data = (String) msg.get("data");
            if (data != null) {
                sdkExecutor.execute(() -> handler.sendAudio(data));
            }
        }
    }

    private void handleInterrupt(String clientId) {
        VoiceLiveHandler handler = handlers.get(clientId);
        if (handler != null) {
            sdkExecutor.execute(handler::interrupt);
        }
    }

    private void handleSendText(String clientId, Map<String, Object> msg) {
        VoiceLiveHandler handler = handlers.get(clientId);
        if (handler != null) {
            String text = (String) msg.get("text");
            if (text != null) {
                sdkExecutor.execute(() -> handler.sendText(text));
            }
        }
    }

    // ------------------------------------------------------------------
    // Session config builder
    // ------------------------------------------------------------------

    private SessionConfig buildSessionConfig(Map<String, Object> msg) {
        SessionConfig config = new SessionConfig();

        config.setMode(getStringOrEnv(msg, "mode", "VOICELIVE_MODE", "model"));
        config.setModel(getStringOrEnv(msg, "model", "VOICELIVE_MODEL", "gpt-realtime"));
        config.setVoice(getStringOrEnv(msg, "voice", "VOICELIVE_VOICE", "en-US-Ava:DragonHDLatestNeural"));
        config.setVoiceType(getStringOrEnv(msg, "voice_type", "VOICELIVE_VOICE_TYPE", "azure-standard"));
        config.setTranscribeModel(getStringOrEnv(msg, "transcribe_model", "VOICELIVE_TRANSCRIBE_MODEL", "gpt-4o-transcribe"));
        config.setInputLanguage(getStringOrDefault(msg, "input_language", ""));
        config.setInstructions(getStringOrEnv(msg, "instructions", "VOICELIVE_INSTRUCTIONS", ""));
        config.setTemperature(getDoubleOrDefault(msg, "temperature",
                Double.parseDouble(envOrDefault("VOICELIVE_TEMPERATURE", "0.7"))));
        config.setVadType(getStringOrEnv(msg, "vad_type", "VOICELIVE_VAD_TYPE", "azure_semantic"));
        config.setNoiseReduction(getBoolOrDefault(msg, "noise_reduction", true));
        config.setEchoCancellation(getBoolOrDefault(msg, "echo_cancellation", true));
        config.setAgentName(getStringOrEnv(msg, "agent_name", "AZURE_VOICELIVE_AGENT_NAME", null));
        config.setProjectName(getStringOrEnv(msg, "project", "AZURE_VOICELIVE_PROJECT", null));
        config.setAgentVersion(getStringOrEnv(msg, "agent_version", "AZURE_VOICELIVE_AGENT_VERSION", null));
        config.setConversationId(getStringOrDefault(msg, "conversation_id", null));
        config.setFoundryResourceOverride(getStringOrEnv(msg, "foundry_resource_override",
                "AZURE_VOICELIVE_FOUNDRY_RESOURCE_OVERRIDE", null));
        config.setAuthIdentityClientId(getStringOrEnv(msg, "auth_identity_client_id",
                "AZURE_VOICELIVE_AUTH_IDENTITY_CLIENT_ID", null));
        config.setByomProfile(envOrDefault("VOICELIVE_BYOM_PROFILE", null));
        config.setProactiveGreeting(getBoolOrDefault(msg, "proactive_greeting", true));
        config.setGreetingType(getStringOrDefault(msg, "greeting_type", "llm"));
        config.setGreetingText(getStringOrDefault(msg, "greeting_text", ""));
        config.setInterimResponse(getBoolOrDefault(msg, "interim_response", false));
        config.setInterimResponseType(getStringOrDefault(msg, "interim_response_type", "llm"));
        config.setInterimTriggerTool(getBoolOrDefault(msg, "interim_trigger_tool", true));
        config.setInterimTriggerLatency(getBoolOrDefault(msg, "interim_trigger_latency", true));
        config.setInterimLatencyMs(getIntOrDefault(msg, "interim_latency_ms", 100));
        config.setInterimInstructions(getStringOrDefault(msg, "interim_instructions", ""));
        config.setInterimStaticTexts(getStringOrDefault(msg, "interim_static_texts", ""));

        return config;
    }

    // ------------------------------------------------------------------
    // Utility
    // ------------------------------------------------------------------

    private String extractClientId(WebSocketSession session) {
        String path = session.getUri() != null ? session.getUri().getPath() : "";
        // Path is /ws/{clientId}
        int lastSlash = path.lastIndexOf('/');
        String raw = lastSlash >= 0 ? path.substring(lastSlash + 1) : "unknown";
        // Allowlist sanitization — only permit safe characters to prevent log injection
        return raw.replaceAll("[^a-zA-Z0-9\\-_.]", "");
    }

    private void cleanupClient(String clientId) {
        VoiceLiveHandler handler = handlers.remove(clientId);
        if (handler != null) {
            handler.stop();
        }
    }

    private void sendJson(WebSocketSession session, Map<String, Object> msg) {
        try {
            synchronized (session) {
                if (session.isOpen()) {
                    session.sendMessage(new TextMessage(mapper.writeValueAsString(msg)));
                }
            }
        } catch (IOException e) {
            // Expected during session teardown — don't log at error level
            logger.debug("Failed to send message: {}", e.getMessage());
        }
    }

    private static String envOrDefault(String envKey, String defaultValue) {
        String v = System.getenv(envKey);
        if (v != null && !v.isBlank()) return v;
        v = System.getProperty(envKey);
        return (v != null && !v.isBlank()) ? v : defaultValue;
    }

    private static String getStringOrDefault(Map<String, Object> msg, String key, String defaultValue) {
        Object v = msg.get(key);
        return (v instanceof String s && !s.isBlank()) ? s : defaultValue;
    }

    private static String getStringOrEnv(Map<String, Object> msg, String key, String envKey, String defaultValue) {
        Object v = msg.get(key);
        if (v instanceof String s && !s.isBlank()) return s;
        return envOrDefault(envKey, defaultValue);
    }

    private static boolean getBoolOrDefault(Map<String, Object> msg, String key, boolean defaultValue) {
        Object v = msg.get(key);
        if (v instanceof Boolean b) return b;
        return defaultValue;
    }

    private static double getDoubleOrDefault(Map<String, Object> msg, String key, double defaultValue) {
        Object v = msg.get(key);
        if (v instanceof Number n) return n.doubleValue();
        if (v instanceof String s) {
            try { return Double.parseDouble(s); } catch (NumberFormatException e) { /* fall through */ }
        }
        return defaultValue;
    }

    private static int getIntOrDefault(Map<String, Object> msg, String key, int defaultValue) {
        Object v = msg.get(key);
        if (v instanceof Number n) return n.intValue();
        if (v instanceof String s) {
            try { return Integer.parseInt(s); } catch (NumberFormatException e) { /* fall through */ }
        }
        return defaultValue;
    }
}
