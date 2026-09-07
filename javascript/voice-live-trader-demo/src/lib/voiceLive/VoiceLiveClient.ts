import { VoiceLiveClient as AzureVoiceLiveClient, VoiceLiveSession } from "@azure/ai-voicelive";
import { AzureKeyCredential } from "@azure/core-auth";
import { bytesToBase64, base64ToBytes } from "@/lib/base64";
import { Pcm16Player, pcm16Base64ToChunk } from "@/lib/audio";
import type {
  UsageTotals,
  VoiceLiveClientEvent,
  VoiceLiveConnectionConfig,
  VoiceLiveServerEvent,
  VoiceLiveTool,
  WireStats,
} from "@/lib/voiceLive/types";
import { normalizeResourceHost } from "@/lib/voiceLive/normalize";

export type VoiceLiveStatus = "disconnected" | "connecting" | "connected";

export type VoiceLiveCallbacks = {
  onStatus?: (status: VoiceLiveStatus) => void;
  onServerEvent?: (event: VoiceLiveServerEvent) => void;
  onAssistantTextDelta?: (delta: string) => void;
  onAssistantTextDone?: (text: string) => void;
  onUserTranscript?: (text: string) => void;
  onError?: (message: string) => void;
  onStats?: (stats: { usage: UsageTotals; wire: WireStats }) => void;
};

export type FunctionCallHandler = (payload: {
  name: string;
  callId: string;
  argumentsJson: string;
}) => Promise<{ output: string }>; // output must be a string (often JSON)

function emptyUsage(): UsageTotals {
  return {
    turns: 0,
    totalTokens: 0,
    inputTokens: 0,
    outputTokens: 0,
    inputTextTokens: 0,
    inputAudioTokens: 0,
    inputTextCachedTokens: 0,
    inputAudioCachedTokens: 0,
    inputCachedTokens: 0,
    outputTextTokens: 0,
    outputAudioTokens: 0,
    outputTextCachedTokens: 0,
    outputAudioCachedTokens: 0,
    outputCachedTokens: 0,

    speechEndToFirstResponseMsMin: 0,
    speechEndToFirstResponseMsAvg: 0,
    speechEndToFirstResponseMsP90: 0,
    speechEndToFirstResponseCount: 0,
  };
}

function emptyWire(): WireStats {
  return {
    wsSentBytes: 0,
    wsReceivedBytes: 0,
    audioSentBytes: 0,
    audioReceivedBytes: 0,
    toolCalls: 0,
  };
}

export class VoiceLiveClient {
  private session: VoiceLiveSession | null = null;
  private subscription: { close: () => Promise<void> } | null = null;
  private callbacks: VoiceLiveCallbacks;
  private functionHandler: FunctionCallHandler;
  private tools: VoiceLiveTool[];

  private enableBargeIn = false;
  private userSpeaking = false;

  private player: Pcm16Player;
  private audioContext: AudioContext | null = null;
  private mediaStream: MediaStream | null = null;
  private workletNode: AudioWorkletNode | null = null;

  private usage: UsageTotals = emptyUsage();
  private wire: WireStats = emptyWire();
  private currentAssistantText = "";
  
  private lastSpeechStoppedAt: number | null = null;
  private latencySamples: number[] = [];

  // Track pending function calls to know their name when arguments are done.
  private pendingFunctionCallsById = new Map<string, { name: string; itemId: string }>();

  constructor(options: {
    tools: VoiceLiveTool[];
    functionHandler: FunctionCallHandler;
    callbacks: VoiceLiveCallbacks;
  }) {
    this.tools = options.tools;
    this.functionHandler = options.functionHandler;
    this.callbacks = options.callbacks;
    this.player = new Pcm16Player(); 
  }

  async connect(config: VoiceLiveConnectionConfig) {
    if (this.session) {
      throw new Error("Already connected");
    }

    this.callbacks.onStatus?.("connecting");

    this.enableBargeIn = !!config.enableBargeIn;
    this.userSpeaking = false;

    try {
      const host = normalizeResourceHost(config.resourceHost);
      if (!host) throw new Error("Invalid resource host");
      const endpoint = `https://${host}`;

      const client = new AzureVoiceLiveClient(
        endpoint,
        new AzureKeyCredential(config.apiKey),
        { apiVersion: config.apiVersion }
      );

      this.session = await client.startSession(config.model);

      this.subscription = this.session.subscribe({
        onConnected: async () => {
          this.callbacks.onStatus?.("connected");
        },
        onDisconnected: async () => {
          this.callbacks.onStatus?.("disconnected");
          this.cleanup();
        },
        onError: async (args) => {
          this.callbacks.onError?.(args.error.message);
        },
        onServerEvent: async (event) => {
          // Pass through all server events for logging/debugging
          this.callbacks.onServerEvent?.(event as unknown as VoiceLiveServerEvent);
          
          // Update wire stats for received bytes (approximate)
          // The SDK doesn't expose raw bytes easily, so we might skip exact byte counting or estimate it.
          // For now, we won't update wsReceivedBytes accurately.
        },
        onInputAudioBufferSpeechStarted: async () => {
            this.userSpeaking = true;

            // Barge-in UX: stop any currently playing assistant audio immediately.
            if (this.enableBargeIn) {
              this.player.stop();
            }

            this.callbacks.onServerEvent?.({ type: "input_audio_buffer.speech_started" } as any);
        },
        onInputAudioBufferSpeechStopped: async () => {
            this.userSpeaking = false;
            this.lastSpeechStoppedAt = Date.now();
            this.callbacks.onServerEvent?.({ type: "input_audio_buffer.speech_stopped" } as any);
        },
        onResponseAudioDelta: async (event) => {
          if (event.delta) {
            // If the user is currently speaking and barge-in is enabled, suppress assistant audio.
            if (this.enableBargeIn && this.userSpeaking) return;

            if (this.lastSpeechStoppedAt) {
                const latency = Date.now() - this.lastSpeechStoppedAt;
                this.lastSpeechStoppedAt = null;
                this.updateLatencyStats(latency);
            }

            // event.delta is Uint8Array in the SDK
            const chunk = { sampleRate: 24000, bytes: event.delta };
            this.player.enqueue(chunk);
            this.wire.audioReceivedBytes += chunk.bytes.byteLength;
            this.emitStats();
          }
        },
        onResponseTextDelta: async (event) => {
          if (event.delta) {
            if (this.lastSpeechStoppedAt) {
                const latency = Date.now() - this.lastSpeechStoppedAt;
                this.lastSpeechStoppedAt = null;
                this.updateLatencyStats(latency);
            }
            this.currentAssistantText += event.delta;
            this.callbacks.onAssistantTextDelta?.(event.delta);
          }
        },
        onResponseTextDone: async (event) => {
          const text = this.currentAssistantText;
          this.currentAssistantText = "";
          this.callbacks.onAssistantTextDone?.(text); 
        },
        onConversationItemInputAudioTranscriptionCompleted: async (event) => {
          if (event.transcript) {
            this.callbacks.onUserTranscript?.(event.transcript);
          }
        },
        onResponseOutputItemAdded: async (event) => {
          const item = event.item;
          if (item && item.type === "function_call") {
            const callItem = item as any;
            const callId = callItem.call_id ?? callItem.callId;
            if (typeof callId === "string" && callId) {
              this.pendingFunctionCallsById.set(callId, { name: callItem.name, itemId: callItem.id });
            }
          }
        },
        onResponseFunctionCallArgumentsDone: async (event) => {
          const callId: string | undefined = (event as any).callId ?? (event as any).call_id;
          const args: string | undefined = (event as any).arguments ?? (event as any).args;

          if (!callId) return;
          const pending = this.pendingFunctionCallsById.get(callId);
          
          if (pending && this.session) {
            this.wire.toolCalls++;
            this.emitStats();

            try {
              const result = await this.functionHandler({
                name: pending.name,
                callId,
                argumentsJson: args ?? "{}",
              });

              await this.session.addConversationItem({
                type: "function_call_output",
                callId,
                call_id: callId,
                output: result.output,
              } as any);

              // Request a response to process the tool output
              await this.session.sendEvent({ type: "response.create" });

            } catch (e) {
              const message = e instanceof Error ? e.message : String(e);
              await this.session.addConversationItem({
                type: "function_call_output",
                callId,
                call_id: callId,
                output: JSON.stringify({ error: message }),
              } as any);
              await this.session.sendEvent({ type: "response.create" });
            } finally {
              this.pendingFunctionCallsById.delete(callId);
            }
          }
        },
        onResponseDone: async (event) => {
            const response = (event as any).response;
            if (response?.usage) {
                const u = response.usage;
                this.usage.turns++;
                this.usage.totalTokens += u.totalTokens ?? u.total_tokens ?? 0;
                this.usage.inputTokens += u.inputTokens ?? u.input_tokens ?? 0;
                this.usage.outputTokens += u.outputTokens ?? u.output_tokens ?? 0;

                const inputDetails = u.inputTokenDetails ?? u.input_token_details;
                if (inputDetails) {
                    this.usage.inputTextTokens += inputDetails.textTokens ?? inputDetails.text_tokens ?? 0;
                    this.usage.inputAudioTokens += inputDetails.audioTokens ?? inputDetails.audio_tokens ?? 0;
                    this.usage.inputCachedTokens += inputDetails.cachedTokens ?? inputDetails.cached_tokens ?? 0;
                    
                    const cachedDetails = inputDetails.cachedTokensDetails ?? inputDetails.cached_tokens_details;
                    if (cachedDetails) {
                         this.usage.inputTextCachedTokens += cachedDetails.textTokens ?? cachedDetails.text_tokens ?? 0;
                         this.usage.inputAudioCachedTokens += cachedDetails.audioTokens ?? cachedDetails.audio_tokens ?? 0;
                    }
                }

                const outputDetails = u.outputTokenDetails ?? u.output_token_details;
                if (outputDetails) {
                    this.usage.outputTextTokens += outputDetails.textTokens ?? outputDetails.text_tokens ?? 0;
                    this.usage.outputAudioTokens += outputDetails.audioTokens ?? outputDetails.audio_tokens ?? 0;
                }
                
                this.emitStats();
            }
        }
      });

      await this.session.connect();
      this.callbacks.onStatus?.("connected");

      // Initial configuration
      await this.session.updateSession({
        instructions: config.instructions,
        voice: config.voice.type === "azure-standard" 
            ? { type: "azure-standard", name: config.voice.name, temperature: config.voice.temperature }
            : { type: "openai", name: config.voice.name },
        inputAudioFormat: "pcm16",
        outputAudioFormat: "pcm16",
        turnDetection: config.enableBargeIn ? {
           type: "azure_semantic_vad",
           threshold: config.vadThreshold ?? 0.5,
           prefix_padding_ms: config.vadPrefixPaddingMs ?? 300,
           silence_duration_ms: config.vadSilenceDurationMs ?? 200
        } : undefined,
        inputAudioNoiseReduction: { type: "azure_deep_noise_suppression" },
        inputAudioEchoCancellation: { type: "server_echo_cancellation" },
        tools: this.tools as any, // Cast to any as SDK types might differ slightly but structure is compatible
        toolChoice: "auto",
      } as any);

    } catch (e) {
      this.callbacks.onError?.(e instanceof Error ? e.message : String(e));
      this.callbacks.onStatus?.("disconnected");
      this.cleanup();
    }
  }

  async disconnect() {
    if (this.session) {
      await this.session.disconnect();
      this.cleanup();
    }
  }

  private cleanup() {
    this.stopMicrophone();
    this.player.stop();
    this.subscription?.close();
    this.subscription = null;
    this.session = null;
    this.pendingFunctionCallsById.clear();
  }

  async startMicrophone() {
    if (!this.session) throw new Error("Connect first");
    if (this.workletNode) return;

    await this.player.ensureRunning();

    const ac = new AudioContext();
    this.audioContext = ac;

    const workletUrl = new URL("worklets/pcm16-downsampler.js", document.baseURI).toString();
    await ac.audioWorklet.addModule(workletUrl);

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
    });
    this.mediaStream = stream;

    const source = ac.createMediaStreamSource(stream);
    const worklet = new AudioWorkletNode(ac, "pcm16-downsampler");
    this.workletNode = worklet;

    worklet.port.onmessage = (e) => {
      const buffer = e.data as ArrayBuffer;
      const pcm16Bytes = new Uint8Array(buffer);
      this.wire.audioSentBytes += pcm16Bytes.byteLength;
      
      if (this.session) {
        this.session.sendAudio(pcm16Bytes);
      }
    };

    const gain = ac.createGain();
    gain.gain.value = 0;

    source.connect(worklet);
    worklet.connect(gain);
    gain.connect(ac.destination);
  }

  stopMicrophone() {
    this.workletNode?.disconnect();
    this.workletNode = null;

    if (this.mediaStream) {
      for (const t of this.mediaStream.getTracks()) t.stop();
    }
    this.mediaStream = null;

    if (this.audioContext) {
      this.audioContext.close();
    }
    this.audioContext = null;
  }

  async sendTextMessage(text: string) {
    if (!this.session) return;
    const trimmed = text.trim();
    if (!trimmed) return;

    await this.session.addConversationItem({
      type: "message",
      role: "user",
      content: [{ type: "input_text", text: trimmed }],
    } as any);
    
    await this.session.sendEvent({ type: "response.create" });
  }

  private emitStats() {
    this.callbacks.onStats?.({ usage: { ...this.usage }, wire: { ...this.wire } });
  }

  private updateLatencyStats(latency: number) {
    this.latencySamples.push(latency);
    this.usage.speechEndToFirstResponseCount = this.latencySamples.length;
    
    // Min
    if (this.usage.speechEndToFirstResponseMsMin === 0 || latency < this.usage.speechEndToFirstResponseMsMin) {
        this.usage.speechEndToFirstResponseMsMin = latency;
    }

    // Avg
    const sum = this.latencySamples.reduce((a, b) => a + b, 0);
    this.usage.speechEndToFirstResponseMsAvg = sum / this.latencySamples.length;

    // P90
    const sorted = [...this.latencySamples].sort((a, b) => a - b);
    const p90Index = Math.ceil(sorted.length * 0.9) - 1;
    this.usage.speechEndToFirstResponseMsP90 = sorted[p90Index];
  }
}
