// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import com.azure.ai.voicelive.VoiceLiveAsyncClient;
import com.azure.ai.voicelive.VoiceLiveClientBuilder;
import com.azure.ai.voicelive.VoiceLiveServiceVersion;
import com.azure.ai.voicelive.VoiceLiveSessionAsyncClient;
import com.azure.ai.voicelive.models.AudioEchoCancellation;
import com.azure.ai.voicelive.models.AudioNoiseReduction;
import com.azure.ai.voicelive.models.AudioNoiseReductionType;
import com.azure.ai.voicelive.models.AzureStandardVoice;
import com.azure.ai.voicelive.models.ClientEventSessionUpdate;
import com.azure.ai.voicelive.models.InputAudioFormat;
import com.azure.ai.voicelive.models.InteractionModality;
import com.azure.ai.voicelive.models.MCPServer;
import com.azure.ai.voicelive.models.OutputAudioFormat;
import com.azure.ai.voicelive.models.ServerEventType;
import com.azure.ai.voicelive.models.ServerVadTurnDetection;
import com.azure.ai.voicelive.models.SessionUpdate;
import com.azure.ai.voicelive.models.SessionUpdateError;
import com.azure.ai.voicelive.models.SessionUpdateResponseAudioDelta;
import com.azure.ai.voicelive.models.VoiceLiveSessionOptions;
import com.azure.ai.voicelive.models.VoiceLiveToolDefinition;
import com.azure.core.credential.KeyCredential;
import com.azure.core.credential.TokenCredential;
import com.azure.core.util.BinaryData;
import com.azure.identity.AzureCliCredentialBuilder;
import reactor.core.publisher.Mono;
import reactor.core.scheduler.Schedulers;

import javax.sound.sampled.AudioFormat;
import javax.sound.sampled.AudioSystem;
import javax.sound.sampled.DataLine;
import javax.sound.sampled.LineUnavailableException;
import javax.sound.sampled.SourceDataLine;
import javax.sound.sampled.TargetDataLine;

import java.io.FileInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Properties;
import java.util.Scanner;
import java.util.concurrent.BlockingQueue;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;

/**
 * MCP Quickstart - demonstrates MCP server integration with the VoiceLive SDK.
 * Shows how to define MCP servers, handle MCP tool calls, and implement
 * an approval flow for tool calls that require user consent.
 *
 * <p><strong>Environment Variables Required:</strong></p>
 * <ul>
 *   <li>AZURE_VOICELIVE_ENDPOINT - The VoiceLive service endpoint URL</li>
 *   <li>AZURE_VOICELIVE_API_KEY - The API key (required if not using --use-token-credential)</li>
 * </ul>
 *
 * <p><strong>How to Run:</strong></p>
 * <pre>{@code
 * mvn compile exec:java -Dexec.mainClass="MCPQuickstart" -q
 * }</pre>
 */
public final class MCPQuickstart {

    private static final String DEFAULT_MODEL = "gpt-realtime";
    private static final String DEFAULT_VOICE = "en-US-Ava:DragonHDLatestNeural";
    private static final String DEFAULT_INSTRUCTIONS =
        "You are a helpful AI assistant with access to MCP tools. "
        + "Use the tools to help answer user questions. "
        + "Respond naturally and conversationally.";

    private static final String ENV_ENDPOINT = "AZURE_VOICELIVE_ENDPOINT";
    private static final String ENV_API_KEY = "AZURE_VOICELIVE_API_KEY";

    private static final int SAMPLE_RATE = 24000;
    private static final int CHANNELS = 1;
    private static final int SAMPLE_SIZE_BITS = 16;
    private static final int CHUNK_SIZE = 1200;
    private static final int AUDIO_BUFFER_SIZE_MULTIPLIER = 4;

    private MCPQuickstart() {
        throw new UnsupportedOperationException("Utility class");
    }

    private static class AudioPlaybackPacket {
        final int sequenceNumber;
        final byte[] audioData;

        AudioPlaybackPacket(int sequenceNumber, byte[] audioData) {
            this.sequenceNumber = sequenceNumber;
            this.audioData = audioData;
        }
    }

    /**
     * Audio processor for real-time capture and playback.
     */
    private static class AudioProcessor {
        private final VoiceLiveSessionAsyncClient session;
        private final AudioFormat audioFormat;

        private TargetDataLine microphone;
        private SourceDataLine speaker;
        private final AtomicBoolean isCapturing = new AtomicBoolean(false);
        private final AtomicBoolean isPlaying = new AtomicBoolean(false);
        private final BlockingQueue<AudioPlaybackPacket> playbackQueue = new LinkedBlockingQueue<>();
        private final AtomicInteger nextSequenceNumber = new AtomicInteger(0);
        private final AtomicInteger playbackBase = new AtomicInteger(0);

        AudioProcessor(VoiceLiveSessionAsyncClient session) {
            this.session = session;
            this.audioFormat = new AudioFormat(
                AudioFormat.Encoding.PCM_SIGNED,
                SAMPLE_RATE, SAMPLE_SIZE_BITS, CHANNELS,
                CHANNELS * SAMPLE_SIZE_BITS / 8, SAMPLE_RATE, false
            );
        }

        void startCapture() {
            if (isCapturing.get()) return;

            try {
                DataLine.Info micInfo = new DataLine.Info(TargetDataLine.class, audioFormat);
                microphone = (TargetDataLine) AudioSystem.getLine(micInfo);
                microphone.open(audioFormat, CHUNK_SIZE * AUDIO_BUFFER_SIZE_MULTIPLIER);
                microphone.start();
                isCapturing.set(true);

                Thread captureThread = new Thread(this::captureAudioLoop, "VoiceLive-AudioCapture");
                captureThread.setDaemon(true);
                captureThread.start();
                System.out.println("🎤 Microphone capture started");
            } catch (LineUnavailableException e) {
                throw new RuntimeException("Failed to initialize microphone", e);
            }
        }

        void startPlayback() {
            if (isPlaying.get()) return;

            try {
                DataLine.Info speakerInfo = new DataLine.Info(SourceDataLine.class, audioFormat);
                speaker = (SourceDataLine) AudioSystem.getLine(speakerInfo);
                speaker.open(audioFormat, CHUNK_SIZE * AUDIO_BUFFER_SIZE_MULTIPLIER);
                speaker.start();
                isPlaying.set(true);

                Thread playbackThread = new Thread(this::playbackAudioLoop, "VoiceLive-AudioPlayback");
                playbackThread.setDaemon(true);
                playbackThread.start();
                System.out.println("🔊 Audio playback started");
            } catch (LineUnavailableException e) {
                throw new RuntimeException("Failed to initialize speaker", e);
            }
        }

        private void captureAudioLoop() {
            byte[] buffer = new byte[CHUNK_SIZE * 2];
            while (isCapturing.get() && microphone != null) {
                try {
                    int bytesRead = microphone.read(buffer, 0, buffer.length);
                    if (bytesRead > 0) {
                        byte[] audioChunk = Arrays.copyOf(buffer, bytesRead);
                        session.sendInputAudio(BinaryData.fromBytes(audioChunk))
                            .subscribeOn(Schedulers.boundedElastic())
                            .subscribe(v -> {}, error -> {
                                if (!error.getMessage().contains("cancelled")) {
                                    System.err.println("❌ Error sending audio: " + error.getMessage());
                                }
                            });
                    }
                } catch (Exception e) {
                    if (isCapturing.get()) {
                        System.err.println("❌ Error in audio capture: " + e.getMessage());
                    }
                    break;
                }
            }
        }

        private void playbackAudioLoop() {
            while (isPlaying.get()) {
                try {
                    AudioPlaybackPacket packet = playbackQueue.take();
                    if (packet.audioData == null) break;
                    if (packet.sequenceNumber < playbackBase.get()) continue;
                    if (speaker != null && speaker.isOpen()) {
                        speaker.write(packet.audioData, 0, packet.audioData.length);
                    }
                } catch (InterruptedException e) {
                    Thread.currentThread().interrupt();
                    break;
                }
            }
        }

        void queueAudio(byte[] audioData) {
            if (audioData != null && audioData.length > 0) {
                int seqNum = nextSequenceNumber.getAndIncrement();
                playbackQueue.offer(new AudioPlaybackPacket(seqNum, audioData));
            }
        }

        void skipPendingAudio() {
            playbackBase.set(nextSequenceNumber.get());
            playbackQueue.clear();
            if (speaker != null && speaker.isOpen()) speaker.flush();
        }

        void shutdown() {
            isCapturing.set(false);
            if (microphone != null) { microphone.stop(); microphone.close(); microphone = null; }
            isPlaying.set(false);
            playbackQueue.offer(new AudioPlaybackPacket(-1, null));
            if (speaker != null) { speaker.stop(); speaker.close(); speaker = null; }
            System.out.println("🔇 Audio processor shut down");
        }
    }

    private static class Config {
        String endpoint;
        String apiKey;
        String model = DEFAULT_MODEL;
        String voice = DEFAULT_VOICE;
        String instructions = DEFAULT_INSTRUCTIONS;
        boolean useTokenCredential = false;

        static Config load(String[] args) {
            Config config = new Config();
            Properties props = loadProperties();
            if (props != null) {
                config.endpoint = props.getProperty("azure.voicelive.endpoint");
                config.apiKey = props.getProperty("azure.voicelive.api-key");
                config.model = props.getProperty("azure.voicelive.model", DEFAULT_MODEL);
                config.voice = props.getProperty("azure.voicelive.voice", DEFAULT_VOICE);
            }
            if (System.getenv(ENV_ENDPOINT) != null) config.endpoint = System.getenv(ENV_ENDPOINT);
            if (System.getenv(ENV_API_KEY) != null) config.apiKey = System.getenv(ENV_API_KEY);

            for (int i = 0; i < args.length; i++) {
                switch (args[i]) {
                    case "--endpoint": if (i + 1 < args.length) config.endpoint = args[++i]; break;
                    case "--api-key": if (i + 1 < args.length) config.apiKey = args[++i]; break;
                    case "--model": if (i + 1 < args.length) config.model = args[++i]; break;
                    case "--voice": if (i + 1 < args.length) config.voice = args[++i]; break;
                    case "--use-token-credential": config.useTokenCredential = true; break;
                }
            }
            return config;
        }
    }

    private static Properties loadProperties() {
        Properties props = new Properties();
        try (InputStream input = new FileInputStream("application.properties")) {
            props.load(input);
            return props;
        } catch (IOException e) {
            return null;
        }
    }

    // <define_mcp_servers>
    /**
     * Define MCP servers that Voice Live can use during the session.
     * Each server is an MCPServer instance added to the session options tools list.
     */
    private static List<VoiceLiveToolDefinition> defineMCPServers() {
        List<VoiceLiveToolDefinition> mcpTools = new ArrayList<>();

        mcpTools.add(new MCPServer("deepwiki", "https://mcp.deepwiki.com/mcp")
            .setAllowedTools(Arrays.asList("read_wiki_structure", "ask_question"))
            .setRequireApproval(BinaryData.fromString("\"never\"")));

        mcpTools.add(new MCPServer("azure_doc", "https://learn.microsoft.com/api/mcp")
            .setRequireApproval(BinaryData.fromString("\"always\"")));

        return mcpTools;
    }
    // </define_mcp_servers>

    // <configure_session>
    /**
     * Create session configuration with MCP servers in the tools list.
     */
    private static VoiceLiveSessionOptions createSessionOptions(Config config) {
        ServerVadTurnDetection turnDetection = new ServerVadTurnDetection()
            .setThreshold(0.5)
            .setPrefixPaddingMs(300)
            .setSilenceDurationMs(500)
            .setInterruptResponse(true)
            .setAutoTruncate(true)
            .setCreateResponse(true);

        VoiceLiveSessionOptions options = new VoiceLiveSessionOptions()
            .setInstructions(config.instructions)
            .setVoice(BinaryData.fromObject(new AzureStandardVoice(config.voice)))
            .setModalities(Arrays.asList(InteractionModality.TEXT, InteractionModality.AUDIO))
            .setInputAudioFormat(InputAudioFormat.PCM16)
            .setOutputAudioFormat(OutputAudioFormat.PCM16)
            .setInputAudioSamplingRate(SAMPLE_RATE)
            .setInputAudioNoiseReduction(new AudioNoiseReduction(AudioNoiseReductionType.NEAR_FIELD))
            .setInputAudioEchoCancellation(new AudioEchoCancellation())
            .setTurnDetection(turnDetection);

        // Add MCP servers to the tools list
        List<VoiceLiveToolDefinition> mcpServers = defineMCPServers();
        options.setTools(mcpServers);

        return options;
    }
    // </configure_session>

    // <handle_mcp_events>
    /**
     * Handle incoming server events, including MCP-specific events.
     */
    private static void handleServerEvent(SessionUpdate event, AudioProcessor audioProcessor,
                                           Scanner scanner, VoiceLiveSessionAsyncClient session) {
        ServerEventType eventType = event.getType();

        try {
            if (eventType == ServerEventType.SESSION_UPDATED) {
                System.out.println("✓ Session updated - starting microphone");
                audioProcessor.startCapture();

            } else if (eventType == ServerEventType.INPUT_AUDIO_BUFFER_SPEECH_STARTED) {
                System.out.println("🎤 Listening...");
                audioProcessor.skipPendingAudio();

            } else if (eventType == ServerEventType.INPUT_AUDIO_BUFFER_SPEECH_STOPPED) {
                System.out.println("🤔 Processing...");

            } else if (eventType == ServerEventType.RESPONSE_AUDIO_DELTA) {
                if (event instanceof SessionUpdateResponseAudioDelta) {
                    SessionUpdateResponseAudioDelta audioEvent = (SessionUpdateResponseAudioDelta) event;
                    byte[] audioData = audioEvent.getDelta();
                    if (audioData != null && audioData.length > 0) {
                        audioProcessor.queueAudio(audioData);
                    }
                }

            } else if (eventType == ServerEventType.RESPONSE_AUDIO_DONE) {
                System.out.println("🎤 Ready for next input...");

            } else if (eventType == ServerEventType.RESPONSE_DONE) {
                System.out.println("✅ Response complete");

            } else if (eventType == ServerEventType.ERROR) {
                if (event instanceof SessionUpdateError) {
                    String msg = ((SessionUpdateError) event).getError().getMessage();
                    if (!msg.contains("no active response")) {
                        System.out.println("❌ Error: " + msg);
                    }
                }

            // MCP-specific events
            } else if (eventType == ServerEventType.MCP_LIST_TOOLS_COMPLETED) {
                System.out.println("🔧 MCP tools discovered successfully");

            } else if (eventType == ServerEventType.MCP_LIST_TOOLS_FAILED) {
                System.out.println("❌ MCP tool discovery failed");

            } else if (eventType == ServerEventType.RESPONSE_MCP_CALL_IN_PROGRESS) {
                System.out.println("⏳ MCP tool call in progress...");

            } else if (eventType == ServerEventType.RESPONSE_MCP_CALL_COMPLETED) {
                System.out.println("✅ MCP tool call completed");

            } else if (eventType == ServerEventType.RESPONSE_MCP_CALL_FAILED) {
                System.out.println("❌ MCP tool call failed");

            } else if (eventType == ServerEventType.CONVERSATION_ITEM_CREATED) {
                // Check for MCP approval request in conversation items
                handleMCPConversationItem(event, scanner, session);
            }
        } catch (Exception e) {
            System.err.println("❌ Error handling event: " + e.getMessage());
        }
    }
    // </handle_mcp_events>

    // <handle_approval>
    /**
     * Handle MCP approval requests by prompting the user in the console
     * and sending the approval/denial response back to the server.
     */
    private static void handleMCPConversationItem(SessionUpdate event, Scanner scanner,
                                                    VoiceLiveSessionAsyncClient session) {
        // Parse the event JSON to check for MCP approval requests
        String eventJson = BinaryData.fromObject(event).toString();

        if (eventJson.contains("mcp_approval_request")) {
            // Extract approval details from the event JSON for display
            String approvalId = extractJsonField(eventJson, "id");
            String serverLabel = extractJsonField(eventJson, "server_label");
            String toolName = extractJsonField(eventJson, "name");
            String arguments = extractJsonField(eventJson, "arguments");

            System.out.println();
            System.out.println("🔐 MCP Approval Request:");
            System.out.println("   Server:    " + serverLabel);
            System.out.println("   Tool:      " + toolName);
            System.out.println("   Arguments: " + arguments);

            // Prompt the user for approval
            boolean approved = false;
            while (true) {
                System.out.print("   Approve MCP call? (y/n): ");
                String input = scanner.nextLine().trim().toLowerCase();
                if ("y".equals(input)) { approved = true; break; }
                if ("n".equals(input)) { approved = false; break; }
                System.out.println("   Invalid input. Please type 'y' or 'n'.");
            }

            System.out.println("   Response: " + (approved ? "Approved ✅" : "Denied ❌"));

            // Send the approval or denial response back to the server.
            // MCP approval responses use raw JSON via send(BinaryData) because
            // the typed SDK classes do not yet cover mcp_approval_response.
            String approvalJson = String.format(
                "{\"type\":\"conversation.item.create\",\"item\":"
                + "{\"type\":\"mcp_approval_response\","
                + "\"approval_request_id\":\"%s\","
                + "\"approve\":%s}}",
                approvalId, approved);

            session.send(BinaryData.fromString(approvalJson))
                .then(session.send(BinaryData.fromString("{\"type\":\"response.create\"}")))
                .subscribeOn(Schedulers.boundedElastic())
                .subscribe(
                    v -> {},
                    error -> System.err.println("❌ Failed to send approval response: " + error.getMessage())
                );
        }
    }

    /**
     * Extract a simple string field value from a JSON string.
     */
    private static String extractJsonField(String json, String fieldName) {
        String pattern = "\"" + fieldName + "\":\"";
        int start = json.indexOf(pattern);
        if (start < 0) return "unknown";
        start += pattern.length();
        int end = json.indexOf("\"", start);
        if (end < 0) return "unknown";
        return json.substring(start, end);
    }
    // </handle_approval>

    private static boolean checkAudioSystem() {
        try {
            AudioFormat format = new AudioFormat(SAMPLE_RATE, SAMPLE_SIZE_BITS, CHANNELS, true, false);
            if (!AudioSystem.isLineSupported(new DataLine.Info(TargetDataLine.class, format))) {
                System.err.println("❌ No compatible microphone found");
                return false;
            }
            if (!AudioSystem.isLineSupported(new DataLine.Info(SourceDataLine.class, format))) {
                System.err.println("❌ No compatible speaker found");
                return false;
            }
            System.out.println("✓ Audio system check passed");
            return true;
        } catch (Exception e) {
            System.err.println("❌ Audio system check failed: " + e.getMessage());
            return false;
        }
    }

    public static void main(String[] args) {
        Config config = Config.load(args);

        if (config.endpoint == null) {
            System.err.println("❌ Missing endpoint. Set AZURE_VOICELIVE_ENDPOINT or pass --endpoint.");
            return;
        }
        if (!config.useTokenCredential && config.apiKey == null) {
            System.err.println("❌ No authentication. Set AZURE_VOICELIVE_API_KEY or use --use-token-credential.");
            return;
        }
        if (!checkAudioSystem()) return;

        System.out.println("🎙️ Starting Voice Assistant with MCP...");

        Scanner scanner = new Scanner(System.in);

        try {
            VoiceLiveAsyncClient client;
            if (config.useTokenCredential) {
                TokenCredential credential = new AzureCliCredentialBuilder().build();
                client = new VoiceLiveClientBuilder()
                    .endpoint(config.endpoint)
                    .credential(credential)
                    .serviceVersion(VoiceLiveServiceVersion.V2026_01_01_PREVIEW)
                    .buildAsyncClient();
                System.out.println("🔑 Using Token Credential authentication");
            } else {
                client = new VoiceLiveClientBuilder()
                    .endpoint(config.endpoint)
                    .credential(new KeyCredential(config.apiKey))
                    .serviceVersion(VoiceLiveServiceVersion.V2026_01_01_PREVIEW)
                    .buildAsyncClient();
                System.out.println("🔑 Using API Key authentication");
            }

            VoiceLiveSessionOptions sessionOptions = createSessionOptions(config);
            AtomicReference<AudioProcessor> audioProcessorRef = new AtomicReference<>();

            client.startSession(config.model)
                .flatMap(session -> {
                    System.out.println("✓ Session started");

                    AudioProcessor audioProcessor = new AudioProcessor(session);
                    audioProcessorRef.set(audioProcessor);

                    session.receiveEvents()
                        .subscribe(
                            event -> handleServerEvent(event, audioProcessor, scanner, session),
                            error -> System.err.println("❌ Event error: " + error.getMessage())
                        );

                    ClientEventSessionUpdate updateEvent = new ClientEventSessionUpdate(sessionOptions);
                    session.sendEvent(updateEvent).subscribe();

                    audioProcessor.startPlayback();

                    System.out.println();
                    System.out.println("=".repeat(70));
                    System.out.println("🎤 VOICE ASSISTANT WITH MCP READY");
                    System.out.println("Try saying:");
                    System.out.println("  • 'Can you summarize the GitHub repo azure-sdk-for-java?'");
                    System.out.println("  • 'Search the Azure documentation for Voice Live API.'");
                    System.out.println("You may need to approve some MCP tool calls in the console.");
                    System.out.println("Press Ctrl+C to exit");
                    System.out.println("=".repeat(70));
                    System.out.println();

                    Runtime.getRuntime().addShutdownHook(new Thread(() -> {
                        System.out.println("\n🛑 Shutting down...");
                        audioProcessor.shutdown();
                    }));

                    return Mono.never();
                })
                .doFinally(signalType -> {
                    AudioProcessor ap = audioProcessorRef.get();
                    if (ap != null) ap.shutdown();
                })
                .block();

        } catch (Exception e) {
            System.err.println("❌ Fatal error: " + e.getMessage());
        } finally {
            scanner.close();
        }
    }
}
