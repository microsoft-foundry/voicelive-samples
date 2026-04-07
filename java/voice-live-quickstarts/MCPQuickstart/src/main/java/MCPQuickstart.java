// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import com.azure.ai.voicelive.VoiceLiveAsyncClient;
import com.azure.ai.voicelive.VoiceLiveClientBuilder;
import com.azure.ai.voicelive.VoiceLiveServiceVersion;
import com.azure.ai.voicelive.VoiceLiveSessionAsyncClient;
import com.azure.ai.voicelive.models.AudioEchoCancellation;
import com.azure.ai.voicelive.models.AudioInputTranscriptionOptions;
import com.azure.ai.voicelive.models.AudioInputTranscriptionOptionsModel;
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
import java.io.FileWriter;
import java.io.IOException;
import java.io.InputStream;
import java.io.PrintWriter;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Map;
import java.util.Properties;
import java.util.Queue;
import java.util.Set;
import java.util.concurrent.BlockingQueue;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ConcurrentLinkedQueue;
import java.util.concurrent.Executors;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;
import java.util.regex.Pattern;

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
        + "Respond naturally and conversationally. "
        + "Some tools require user approval before they can be used. When you receive a "
        + "system message asking you to request permission, you MUST clearly ask the user "
        + "for their explicit approval before proceeding. Always wait for the user to say "
        + "yes or no. Never skip the approval question or assume permission is granted. "
        + "If a tool result arrives after the conversation has moved to a different topic, "
        + "briefly introduce it as a late result before sharing the findings.";

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

    private static final ScheduledExecutorService SCHEDULER = Executors.newSingleThreadScheduledExecutor(r -> {
        Thread t = new Thread(r, "MCP-StallTimer");
        t.setDaemon(true);
        return t;
    });

    private static final Pattern YES_PATTERN = Pattern.compile("\\byes\\b", Pattern.CASE_INSENSITIVE);
    private static final Pattern NO_PATTERN = Pattern.compile("\\b(no|stop|cancel)\\b", Pattern.CASE_INSENSITIVE);

    private static final String LOG_FILENAME = "conversation_"
            + LocalDateTime.now().format(DateTimeFormatter.ofPattern("yyyyMMdd_HHmmss")) + ".log";

    /**
     * Mutable session state shared across event handlers.
     * All fields are thread-safe (volatile or concurrent collections).
     */
    private static class SessionState {
        volatile ApprovalInfo pendingApproval;
        final Queue<ApprovalInfo> approvalQueue = new ConcurrentLinkedQueue<>();
        volatile boolean approvalPromptNeeded;
        final AtomicInteger mcpCallInProgress = new AtomicInteger(0);
        final Set<String> handledMcpCompletions = ConcurrentHashMap.newKeySet();
        volatile boolean needsResponseCreate;
        final Map<String, Integer> approvalCallCount = new ConcurrentHashMap<>();
        final Map<String, String> mcpItemToServer = new ConcurrentHashMap<>();
        Set<String> approvalServers = Set.of();
        volatile ScheduledFuture<?> mcpStallTimer;
        volatile boolean responseActive;
        final Set<String> activeMcpItems = ConcurrentHashMap.newKeySet();
        final Set<String> staleMcpItems = ConcurrentHashMap.newKeySet();
        volatile boolean mcpResultsPending;
        final Set<String> approvedServersThisTurn = ConcurrentHashMap.newKeySet();

        static class ApprovalInfo {
            final String approvalId;
            final String serverLabel;
            final String functionName;

            ApprovalInfo(String approvalId, String serverLabel, String functionName) {
                this.approvalId = approvalId;
                this.serverLabel = serverLabel;
                this.functionName = functionName;
            }

            String approvalId() { return approvalId; }
            String serverLabel() { return serverLabel; }
            String functionName() { return functionName; }
        }
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
            .setRequireApproval(BinaryData.fromString("never")));

        mcpTools.add(new MCPServer("azure_doc", "https://learn.microsoft.com/api/mcp")
            .setRequireApproval(BinaryData.fromString("always")));

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

        // Enable input audio transcription so we receive user speech as text
        AudioInputTranscriptionOptionsModel transcriptionModel = config.model.toLowerCase().contains("realtime")
            ? AudioInputTranscriptionOptionsModel.WHISPER_1
            : AudioInputTranscriptionOptionsModel.fromString("azure-speech");
        AudioInputTranscriptionOptions transcriptionOptions =
            new AudioInputTranscriptionOptions(transcriptionModel);

        VoiceLiveSessionOptions options = new VoiceLiveSessionOptions()
            .setInstructions(config.instructions)
            .setVoice(BinaryData.fromObject(new AzureStandardVoice(config.voice)))
            .setModalities(Arrays.asList(InteractionModality.TEXT, InteractionModality.AUDIO))
            .setInputAudioFormat(InputAudioFormat.PCM16)
            .setOutputAudioFormat(OutputAudioFormat.PCM16)
            .setInputAudioSamplingRate(SAMPLE_RATE)
            .setInputAudioNoiseReduction(new AudioNoiseReduction(AudioNoiseReductionType.NEAR_FIELD))
            .setInputAudioEchoCancellation(new AudioEchoCancellation())
            .setInputAudioTranscription(transcriptionOptions)
            .setTurnDetection(turnDetection);

        // Add MCP servers to the tools list
        List<VoiceLiveToolDefinition> mcpServers = defineMCPServers();
        options.setTools(mcpServers);

        return options;
    }
    // </configure_session>

    // <handle_mcp_events>
    /**
     * Handle incoming server events, including MCP-specific events
     * and voice-based approval flow.
     */
    private static void handleServerEvent(SessionUpdate event, AudioProcessor audioProcessor,
                                           SessionState state, VoiceLiveSessionAsyncClient session) {
        ServerEventType eventType = event.getType();

        try {
            if (eventType == ServerEventType.SESSION_UPDATED) {
                System.out.println("✓ Session updated - starting microphone");
                writeLog("Session updated");
                audioProcessor.startCapture();

            } else if (eventType == ServerEventType.INPUT_AUDIO_BUFFER_SPEECH_STARTED) {
                System.out.println("🎤 Listening...");
                audioProcessor.skipPendingAudio();

                // Cancel any active response — prevents duplicate result playback
                // when the user interrupts during MCP result speech (matches C#/Python/JS)
                if (state.responseActive) {
                    session.send(BinaryData.fromString("{\"type\":\"response.cancel\"}"))
                        .subscribeOn(Schedulers.boundedElastic())
                        .subscribe(v -> {}, err -> {});
                }

                // Clear deferred response flags if no MCP calls are in progress.
                // Without this, a stale needsResponseCreate from a collision during
                // the approval flow causes the model to re-speak results after the
                // user interrupts.
                if (state.mcpCallInProgress.get() <= 0) {
                    state.needsResponseCreate = false;
                    state.mcpResultsPending = false;
                }

                // Reset approved-servers-this-turn when user starts a new topic
                if (state.pendingApproval == null && state.mcpCallInProgress.get() <= 0) {
                    state.approvedServersThisTurn.clear();
                }

                // If an MCP call is running and no approval is pending, mark as stale
                if (state.mcpCallInProgress.get() > 0 && state.pendingApproval == null) {
                    state.staleMcpItems.addAll(state.activeMcpItems);
                    System.out.println("[barge-in] Marking " + state.activeMcpItems.size() + " MCP calls as stale");
                    sendSystemMessage(session,
                        "A tool call is still running in the background. The user just spoke. "
                        + "Respond to what the user said. If a tool result arrives later, "
                        + "briefly introduce it as a late result from an earlier request.")
                        .subscribeOn(Schedulers.boundedElastic())
                        .subscribe(v -> {}, err -> {});
                }

            } else if (eventType == ServerEventType.INPUT_AUDIO_BUFFER_SPEECH_STOPPED) {
                System.out.println("🤔 Processing...");

            } else if (eventType == ServerEventType.RESPONSE_CREATED) {
                state.responseActive = true;

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
                state.responseActive = false;
                System.out.println("✅ Response complete");
                writeLog("--- Response complete ---");

                // If an approval prompt needs to be injected, do it now
                if (state.approvalPromptNeeded && state.pendingApproval != null) {
                    state.approvalPromptNeeded = false;
                    sendApprovalVoicePrompt(state, session);
                // If MCP results are pending and all calls are now done, create response
                } else if (state.mcpResultsPending && state.mcpCallInProgress.get() <= 0 && state.pendingApproval == null) {
                    state.mcpResultsPending = false;
                    try {
                        session.send(BinaryData.fromString("{\"type\":\"response.create\"}"))
                            .subscribeOn(Schedulers.boundedElastic())
                            .subscribe(v -> {}, err -> {});
                    } catch (Exception e) {
                        // best-effort
                    }
                } else if (state.needsResponseCreate) {
                    // Deferred response.create — retry now that no response is active
                    state.needsResponseCreate = false;
                    try {
                        session.send(BinaryData.fromString("{\"type\":\"response.create\"}"))
                            .subscribeOn(Schedulers.boundedElastic())
                            .subscribe(v -> {}, err -> {});
                    } catch (Exception e) {
                        // best-effort retry
                    }
                }

            // <voice_approval_transcription>
            } else if (eventType == ServerEventType.CONVERSATION_ITEM_INPUT_AUDIO_TRANSCRIPTION_COMPLETED) {
                String eventJson = BinaryData.fromObject(event).toString();
                String transcript = extractJsonField(eventJson, "transcript");
                System.out.println("👤 You said:\t" + transcript);
                writeLog("User Input:\t" + transcript);

                // Interpret as an approval answer if we have a pending approval
                if (state.pendingApproval != null) {
                    resolveVoiceApproval(transcript, state, session);
                }
            // </voice_approval_transcription>

            } else if (eventType == ServerEventType.ERROR) {
                // Reset response state — errors can terminate a response without RESPONSE_DONE
                state.responseActive = false;
                if (event instanceof SessionUpdateError) {
                    String msg = ((SessionUpdateError) event).getError().getMessage();
                    if (msg.contains("no active response")) {
                        // suppress
                    } else if (msg.toLowerCase().contains("interim response")) {
                        // non-fatal
                    } else if (msg.toLowerCase().contains("active response")) {
                        // expected during MCP flow
                    } else {
                        System.out.println("❌ Error: " + msg);
                        writeLog("ERROR: " + msg);
                    }
                }

            // MCP-specific events
            } else if (eventType == ServerEventType.MCP_LIST_TOOLS_COMPLETED) {
                System.out.println("🔧 MCP tools discovered successfully");
                writeLog("MCP tools discovered successfully");

            } else if (eventType == ServerEventType.MCP_LIST_TOOLS_FAILED) {
                System.out.println("❌ MCP tool discovery failed");
                writeLog("ERROR: MCP tool discovery failed");

            } else if (eventType == ServerEventType.RESPONSE_MCP_CALL_IN_PROGRESS) {
                System.out.println("⏳ MCP tool call in progress...");
                writeLog("MCP call in progress");
                state.mcpCallInProgress.incrementAndGet();
                String inProgressJson = BinaryData.fromObject(event).toString();
                String inProgressItemId = extractJsonField(inProgressJson, "item_id");
                if (inProgressItemId != null) state.activeMcpItems.add(inProgressItemId);
                startMcpStallTimer(state, session);

            } else if (eventType == ServerEventType.RESPONSE_MCP_CALL_COMPLETED) {
                String eventJson = BinaryData.fromObject(event).toString();
                String itemId = extractJsonField(eventJson, "item_id");
                state.mcpCallInProgress.updateAndGet(v -> Math.max(0, v - 1));
                if (itemId != null) state.activeMcpItems.remove(itemId);
                cancelMcpStallTimer(state);

                if (state.handledMcpCompletions.contains(itemId)) {
                    // duplicate — ignore
                } else {
                    state.handledMcpCompletions.add(itemId);
                    boolean isStale = itemId != null && state.staleMcpItems.remove(itemId);
                    System.out.println("✅ MCP tool call completed (stale=" + isStale + ")");
                    writeLog("MCP call completed: " + itemId + " (stale=" + isStale + ")");
                    state.mcpItemToServer.remove(itemId);

                    // Reset approval counter if no more approvals pending
                    if (state.pendingApproval == null && state.approvalQueue.isEmpty()) {
                        state.approvalCallCount.clear();
                    }

                    // If the user moved on during this call, tell the model it's a late result.
                    // Chain any late-result context message with the response.create below
                    // to ensure the system message arrives first.
                    Mono<Void> preResponseMono = Mono.empty();
                    if (isStale) {
                        preResponseMono = sendSystemMessage(session,
                            "This tool result is from an earlier request. The user has "
                            + "since moved on. Briefly introduce it as a late result, e.g. "
                            + "'By the way, those results from earlier just came in...' "
                            + "then share the key findings concisely.");
                    }

                    // Batch response: only call response.create when ALL MCP calls for this
                    // turn have completed. This prevents partial results and repeated tool calls.
                    if (state.pendingApproval == null && state.approvalQueue.isEmpty()
                            && state.mcpCallInProgress.get() <= 0) {
                        preResponseMono
                            .then(session.send(BinaryData.fromString("{\"type\":\"response.create\"}")))
                            .subscribeOn(Schedulers.boundedElastic())
                            .subscribe(v -> {}, err -> {
                                if (err.getMessage().toLowerCase().contains("active response")) {
                                    state.needsResponseCreate = true;
                                }
                            });
                    } else {
                        preResponseMono
                            .subscribeOn(Schedulers.boundedElastic())
                            .subscribe(v -> {}, err -> {});
                        state.mcpResultsPending = true;
                        System.out.println("[mcp] MCP calls still in progress (" + state.mcpCallInProgress.get() + ") or approval pending — deferring response");
                    }
                }

            } else if (eventType == ServerEventType.RESPONSE_MCP_CALL_FAILED) {
                System.out.println("❌ MCP tool call failed");
                writeLog("ERROR: MCP tool call failed");
                String failedJson = BinaryData.fromObject(event).toString();
                String failedItemId = extractJsonField(failedJson, "item_id");
                state.mcpCallInProgress.updateAndGet(v -> Math.max(0, v - 1));
                if (failedItemId != null) {
                    state.activeMcpItems.remove(failedItemId);
                    state.staleMcpItems.remove(failedItemId);
                }
                cancelMcpStallTimer(state);
                try {
                    session.send(BinaryData.fromString("{\"type\":\"response.create\"}"))
                        .subscribeOn(Schedulers.boundedElastic())
                        .subscribe(v -> {}, err -> {});
                } catch (Exception e) {
                    // best effort
                }

            } else if (eventType == ServerEventType.CONVERSATION_ITEM_CREATED) {
                handleMCPConversationItem(event, state, session);
            }
        } catch (Exception e) {
            System.err.println("❌ Error handling event: " + e.getMessage());
        }
    }
    // </handle_mcp_events>

    // <handle_approval>
    /**
     * Handle MCP conversation items: approval requests, tool call announcements,
     * and item-to-server tracking.
     */
    private static void handleMCPConversationItem(SessionUpdate event, SessionState state,
                                                    VoiceLiveSessionAsyncClient session) {
        String eventJson = BinaryData.fromObject(event).toString();

        if (eventJson.contains("mcp_approval_request")) {
            // Extract approval details
            String approvalId = extractJsonField(eventJson, "id");
            String serverLabel = extractJsonField(eventJson, "server_label");
            String functionName = extractJsonField(eventJson, "name");

            if ("unknown".equals(approvalId)) {
                return;
            }

            final int MAX_APPROVAL_CALLS_PER_TASK = 3;
            int currentCount = state.approvalCallCount.getOrDefault(serverLabel, 0);
            if (currentCount >= MAX_APPROVAL_CALLS_PER_TASK) {
                System.out.println("   Auto-denied: " + serverLabel + "/" + functionName
                    + " (max " + MAX_APPROVAL_CALLS_PER_TASK + " calls reached)");
                try {
                    String denyJson = String.format(
                        "{\"type\":\"conversation.item.create\",\"item\":"
                        + "{\"type\":\"mcp_approval_response\","
                        + "\"approval_request_id\":\"%s\","
                        + "\"approve\":false}}",
                        approvalId);
                    session.send(BinaryData.fromString(denyJson))
                        .subscribeOn(Schedulers.boundedElastic())
                        .subscribe(v -> {}, err ->
                            System.err.println("Failed to send auto-deny: " + err.getMessage()));
                } catch (Exception e) {
                    System.err.println("Failed to send auto-deny: " + e.getMessage());
                }
                return;
            }

            // Auto-approve if user already approved this server earlier in the same turn
            if (state.approvedServersThisTurn.contains(serverLabel)) {
                System.out.println("   Auto-approved: " + serverLabel + "/" + functionName
                    + " (already approved this turn)");
                try {
                    String approveJson = String.format(
                        "{\"type\":\"conversation.item.create\",\"item\":"
                        + "{\"type\":\"mcp_approval_response\","
                        + "\"approval_request_id\":\"%s\","
                        + "\"approve\":true}}",
                        approvalId);
                    session.send(BinaryData.fromString(approveJson))
                        .subscribeOn(Schedulers.boundedElastic())
                        .subscribe(v -> {}, err ->
                            System.err.println("Failed to send auto-approve: " + err.getMessage()));
                } catch (Exception e) {
                    System.err.println("Failed to send auto-approve: " + e.getMessage());
                }
                return;
            }

            // If another approval is already pending, queue this one
            if (state.pendingApproval != null) {
                state.approvalQueue.add(
                    new SessionState.ApprovalInfo(approvalId, serverLabel, functionName));
                return;
            }

            System.out.println();
            System.out.println("🔐 MCP Approval Request (voice-based):");
            System.out.println("   Server: " + serverLabel + "  Tool: " + functionName);
            writeLog("Approval request: server=" + serverLabel + " tool=" + functionName);

            state.pendingApproval =
                new SessionState.ApprovalInfo(approvalId, serverLabel, functionName);

            if (!state.responseActive) {
                sendApprovalVoicePrompt(state, session);
            } else {
                state.approvalPromptNeeded = true;
            }

        } else if (eventJson.contains("\"type\":\"mcp_call\"")) {
            // Track MCP call items and announce non-approval tool calls
            String itemId = extractJsonField(eventJson, "id");
            String serverLabel = extractJsonField(eventJson, "server_label");
            String functionName = extractJsonField(eventJson, "name");
            System.out.println("🔧 MCP tool call: " + serverLabel + "/" + functionName);
            state.mcpItemToServer.put(itemId, serverLabel + "/" + functionName);

            // Announce to the user if this server doesn't require approval
            if (state.pendingApproval == null && !state.approvalServers.contains(serverLabel)) {
                sendSystemMessage(session,
                    "Briefly tell the user you're looking something up. One short sentence only.")
                    .then(session.send(BinaryData.fromString("{\"type\":\"response.create\"}")))
                    .subscribeOn(Schedulers.boundedElastic())
                    .subscribe(v -> {}, err -> {});
            }
        }
    }

    /**
     * Inject a system message asking the model to verbally request permission.
     */
    private static void sendApprovalVoicePrompt(SessionState state,
                                                  VoiceLiveSessionAsyncClient session) {
        SessionState.ApprovalInfo pending = state.pendingApproval;
        if (pending == null) return;

        int callCount = state.approvalCallCount.getOrDefault(pending.serverLabel(), 0);
        state.approvalCallCount.put(pending.serverLabel(), callCount + 1);

        String prompt;
        if (callCount == 0) {
            prompt = "You MUST ask the user for explicit permission before proceeding. "
                + "Say exactly: \"I'd like to search the " + pending.serverLabel()
                + " service for information. Do you approve? Please say yes or no.\"";
        } else {
            prompt = "You MUST ask the user for permission again. "
                + "Say exactly: \"I need to do one more search to get complete information. "
                + "Should I continue? Please say yes or no.\"";
        }

        sendSystemMessage(session, prompt)
            .then(session.send(BinaryData.fromString("{\"type\":\"response.create\"}")))
            .subscribeOn(Schedulers.boundedElastic())
            .subscribe(v -> {}, err ->
                System.err.println("❌ Failed to send approval voice prompt: " + err.getMessage()));
    }

    /**
     * Interpret the user's spoken response as approval or denial.
     */
    private static void resolveVoiceApproval(String transcript, SessionState state,
                                               VoiceLiveSessionAsyncClient session) {
        SessionState.ApprovalInfo pending = state.pendingApproval;
        if (pending == null) return;

        String text = transcript.trim().toLowerCase();
        boolean approved = YES_PATTERN.matcher(text).find();
        boolean denied = NO_PATTERN.matcher(text).find();

        if (!approved && !denied) {
            // Ambiguous — ask again at next RESPONSE_DONE
            state.approvalPromptNeeded = true;
            return;
        }
        if (approved && denied) {
            approved = false; // conflicting signals — deny for safety
        }

        state.pendingApproval = null;
        if (approved) {
            state.approvedServersThisTurn.add(pending.serverLabel());
        } else {
            state.approvalCallCount.clear();
            state.approvedServersThisTurn.remove(pending.serverLabel());
        }

        System.out.println("   Voice approval: " + (approved ? "Approved ✅" : "Denied ❌"));
        writeLog("Approval resolved: " + (approved ? "APPROVED" : "DENIED") + " for " + pending.serverLabel() + "/" + pending.functionName());

        // Send approval/denial response via raw JSON.
        // Chain processNextApproval after the send completes to avoid racing.
        String approvalJson = String.format(
            "{\"type\":\"conversation.item.create\",\"item\":"
            + "{\"type\":\"mcp_approval_response\","
            + "\"approval_request_id\":\"%s\","
            + "\"approve\":%s}}",
            pending.approvalId(), approved);

        session.send(BinaryData.fromString(approvalJson))
            .subscribeOn(Schedulers.boundedElastic())
            .subscribe(
                v -> processNextApproval(state, session),
                error -> {
                    System.err.println("❌ Failed to send approval response: " + error.getMessage());
                    processNextApproval(state, session);
                }
            );
    }

    /**
     * Pop the next queued approval and ask via voice.
     */
    private static void processNextApproval(SessionState state,
                                              VoiceLiveSessionAsyncClient session) {
        SessionState.ApprovalInfo next = state.approvalQueue.poll();
        if (next == null) return;

        // Auto-approve if user already approved this server earlier in the same turn
        if (state.approvedServersThisTurn.contains(next.serverLabel())) {
            System.out.println("   Auto-approved (queued): " + next.serverLabel() + "/" + next.functionName());
            String approveJson = String.format(
                "{\"type\":\"conversation.item.create\",\"item\":"
                + "{\"type\":\"mcp_approval_response\","
                + "\"approval_request_id\":\"%s\","
                + "\"approve\":true}}",
                next.approvalId());
            session.send(BinaryData.fromString(approveJson))
                .subscribeOn(Schedulers.boundedElastic())
                .subscribe(
                    v -> processNextApproval(state, session),
                    err -> {
                        System.err.println("Failed to send queued auto-approve: " + err.getMessage());
                        processNextApproval(state, session);
                    });
            return;
        }

        state.pendingApproval = next;
        if (!state.responseActive) {
            sendApprovalVoicePrompt(state, session);
        } else {
            state.approvalPromptNeeded = true;
        }
    }
    // </handle_approval>

    // <mcp_stall_detection>
    /**
     * Start a timer that verbally updates the user if an MCP call takes too long.
     */
    private static void startMcpStallTimer(SessionState state,
                                             VoiceLiveSessionAsyncClient session) {
        cancelMcpStallTimer(state);
        final AtomicInteger stallCount = new AtomicInteger(0);
        state.mcpStallTimer = SCHEDULER.scheduleAtFixedRate(() -> {
            if (state.mcpCallInProgress.get() <= 0) {
                cancelMcpStallTimer(state);
                return;
            }
            int count = stallCount.incrementAndGet();
            if (count > 3) {
                cancelMcpStallTimer(state);
                return;
            }
            // MCP calls cannot be cancelled — only honest status updates are possible.
            String msg = "The tool call is still running. "
                + "Briefly reassure the user that you're still waiting for results. "
                + "One short sentence only.";
            sendSystemMessage(session, msg)
                .then(session.send(BinaryData.fromString("{\"type\":\"response.create\"}")))
                .subscribeOn(Schedulers.boundedElastic())
                .subscribe(v -> {}, err -> {
                    if (err.getMessage() != null
                        && err.getMessage().toLowerCase().contains("active response")) {
                        state.needsResponseCreate = true;
                    }
                });
        }, 10, 10, TimeUnit.SECONDS);
    }

    /**
     * Cancel the MCP stall timer if running.
     */
    private static void cancelMcpStallTimer(SessionState state) {
        ScheduledFuture<?> timer = state.mcpStallTimer;
        if (timer != null && !timer.isDone()) {
            timer.cancel(false);
        }
        state.mcpStallTimer = null;
    }
    // </mcp_stall_detection>

    /**
     * Send a system message to the model via raw JSON.
     * Returns a Mono so callers can chain subsequent sends sequentially,
     * avoiding FAIL_NON_SERIALIZED errors from concurrent sends.
     */
    private static Mono<Void> sendSystemMessage(VoiceLiveSessionAsyncClient session, String text) {
        String escaped = text.replace("\\", "\\\\").replace("\"", "\\\"");
        String json = "{\"type\":\"conversation.item.create\",\"item\":"
            + "{\"type\":\"message\",\"role\":\"system\",\"content\":"
            + "[{\"type\":\"input_text\",\"text\":\"" + escaped + "\"}]}}";
        return session.send(BinaryData.fromString(json));
    }

    /**
     * Write a line to the conversation log file.
     */
    private static void writeLog(String message) {
        try {
            Path logDir = Paths.get("logs");
            Files.createDirectories(logDir);
            try (PrintWriter writer = new PrintWriter(
                    new FileWriter(logDir.resolve(LOG_FILENAME).toString(), true))) {
                writer.println(message);
            }
        } catch (IOException e) {
            System.err.println("Failed to write conversation log: " + e.getMessage());
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

        // Session state for voice-based MCP approval flow
        SessionState state = new SessionState();
        state.approvalServers = Set.of("azure_doc");

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
                            event -> handleServerEvent(event, audioProcessor, state, session),
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
                    System.out.println("Approve MCP tool calls by voice — say 'yes' or 'no' when asked.");
                    System.out.println("Press Ctrl+C to exit");
                    System.out.println("=".repeat(70));
                    System.out.println();

                    Runtime.getRuntime().addShutdownHook(new Thread(() -> {
                        System.out.println("\n🛑 Shutting down...");
                        audioProcessor.shutdown();
                        SCHEDULER.shutdownNow();
                    }));

                    return Mono.never();
                })
                .doFinally(signalType -> {
                    AudioProcessor ap = audioProcessorRef.get();
                    if (ap != null) ap.shutdown();
                    SCHEDULER.shutdownNow();
                })
                .block();

        } catch (Exception e) {
            System.err.println("❌ Fatal error: " + e.getMessage());
        }
    }
}
