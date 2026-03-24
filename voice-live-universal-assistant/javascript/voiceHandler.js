/**
 * Voice Live Handler — bridges browser WebSocket ↔ Azure Voice Live SDK.
 * Supports Agent mode (Foundry Agent Service) and Model mode (direct gpt-realtime).
 */

import { VoiceLiveClient, KnownClientEventType } from "@azure/ai-voicelive";

// ---------------------------------------------------------------------------
// VAD type string → SDK object mapping
// ---------------------------------------------------------------------------
const VAD_TYPES = {
  azure_semantic: { type: "azure_semantic_vad" },
  azure_semantic_en: { type: "azure_semantic_vad_en" },
  azure_semantic_multilingual: { type: "azure_semantic_vad_multilingual" },
  server: { type: "server_vad" },
};

// ---------------------------------------------------------------------------
// OpenAI built-in voices (use { type: "openai" } for these)
// ---------------------------------------------------------------------------
const OPENAI_VOICE_TYPE = "openai";

export class VoiceHandler {
  /**
   * @param {string} clientId
   * @param {string} endpoint
   * @param {import("@azure/core-auth").TokenCredential | import("@azure/core-auth").AzureKeyCredential} credential
   * @param {(msg: object) => void} sendMessage — callback to send JSON to browser
   * @param {object} config — session configuration from the frontend
   */
  constructor(clientId, endpoint, credential, sendMessage, config) {
    this.clientId = clientId;
    this.endpoint = endpoint;
    this.credential = credential;
    this.sendMessage = sendMessage;
    this.config = config;

    this.client = null;
    this.session = null;
    this.isRunning = false;
    this.greetingSent = false;
    this._assistantTranscript = "";
  }

  // ------------------------------------------------------------------
  // Public API
  // ------------------------------------------------------------------

  async start() {
    this.isRunning = true;
    try {
      const mode = this.config.mode || "model";
      const model = this.config.model || "gpt-realtime";
      const voice = this.config.voice || "en-US-Ava:DragonHDLatestNeural";

      console.log(
        `[${this.clientId}] Connecting in ${mode} mode (model=${model}, voice=${voice})`
      );

      // 1. Create VoiceLive client — pin to preview API version
      this.client = new VoiceLiveClient(this.endpoint, this.credential, {
        apiVersion: "2026-01-01-preview",
      });

      // 2. Build event handlers BEFORE connecting so we catch onConnected
      //    and session.created events.
      const handlers = this._buildEventHandlers();

      // 3. Start session — pass handlers via sessionHandlers so the SDK
      //    subscribes before connect() (avoids missing onConnected).
      if (mode === "agent") {
        const agentConfig = this._buildAgentConfig();
        this.session = await this.client.startSession(
          { agent: agentConfig },
          { sessionHandlers: handlers },
        );
      } else {
        this.session = await this.client.startSession(
          { model },
          { sessionHandlers: handlers },
        );
      }

      // 4. Configure the session — agent mode uses a leaner config
      //    (no transcription, temperature, instructions — those are agent-managed)
      const sessionConfig =
        mode === "agent"
          ? this._buildAgentSessionConfig()
          : this._buildSessionConfig();
      await this.session.updateSession(sessionConfig);

      console.log(
        `[${this.clientId}] Session config sent (${mode} mode):`,
        JSON.stringify(sessionConfig, null, 2)
      );
    } catch (err) {
      console.error(`[${this.clientId}] Failed to start session:`, err);
      this.sendMessage({ type: "error", message: String(err.message || err) });
      if (this.session) {
        try { await this.session.close(); } catch (_) { /* best-effort */ }
        this.session = null;
      }
      this.isRunning = false;
    }
  }

  async sendAudio(base64Data) {
    if (!this.session) return;
    try {
      const buffer = Buffer.from(base64Data, "base64");
      await this.session.sendAudio(new Uint8Array(buffer));
    } catch (err) {
      console.error(`[${this.clientId}] Error forwarding audio:`, err);
    }
  }

  /**
   * Send a text message via Voice Live (conversation.item.create + response.create).
   * @param {string} text
   */
  async sendText(text) {
    if (!this.session || !text.trim()) return;
    try {
      await this.session.sendEvent({
        type: KnownClientEventType.ConversationItemCreate,
        item: {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: text.trim() }],
        },
      });
      await this.session.sendEvent({
        type: KnownClientEventType.ResponseCreate,
      });
    } catch (err) {
      console.error(`[${this.clientId}] Error sending text:`, err);
    }
  }

  async interrupt() {
    if (!this.session) return;
    try {
      await this.session.sendEvent({
        type: KnownClientEventType.ResponseCancel,
        eventId: `evt_cancel_${Date.now()}`,
      });
    } catch (err) {
      console.debug(`[${this.clientId}] No response to cancel:`, err.message);
    }
  }

  async stop() {
    this.isRunning = false;
    try {
      if (this.session) {
        await this.session.dispose();
        this.session = null;
      }
    } catch (err) {
      console.debug(`[${this.clientId}] Session dispose error:`, err.message);
    }
    this.client = null;
    console.log(`[${this.clientId}] Handler stopped`);
  }

  // ------------------------------------------------------------------
  // Event handler builder
  // ------------------------------------------------------------------

  _buildEventHandlers() {
    return {
      onConnected: async (_args, _context) => {
        console.log(`[${this.clientId}] SDK connected`);
      },

      onDisconnected: async (_args, _context) => {
        console.log(`[${this.clientId}] SDK disconnected`);
        this.isRunning = false;
      },

      onError: async (args, _context) => {
        const message = args?.error?.message || String(args?.error || args);
        console.error(`[${this.clientId}] VoiceLive connection error: ${message}`);
        this.sendMessage({ type: "error", message });
      },

      onServerError: async (event, _context) => {
        const message = event?.error?.message || String(event?.error || event);
        const code = event?.error?.code || "";

        // Benign cancellation errors — don't surface to client
        if (
          code === "response_cancel_not_active" ||
          message.toLowerCase().includes("no active response")
        ) {
          console.debug(`[${this.clientId}] Benign cancel error: ${message}`);
          return;
        }

        console.error(`[${this.clientId}] VoiceLive server error: ${message}`);
        this.sendMessage({ type: "error", message });
      },

      onResponseCreated: async (_event, _context) => {
        this.sendMessage({ type: "status", state: "speaking" });
      },

      onResponseDone: async (_event, _context) => {
        // Flush accumulated assistant transcript as final
        if (this._assistantTranscript) {
          this.sendMessage({
            type: "transcript",
            role: "assistant",
            text: this._assistantTranscript,
            isFinal: true,
          });
          this._assistantTranscript = "";
        }
        this.sendMessage({ type: "status", state: "listening" });
      },

      onResponseAudioDelta: async (event, _context) => {
        if (event.delta) {
          const audioBase64 = Buffer.from(event.delta).toString("base64");
          this.sendMessage({
            type: "audio_data",
            data: audioBase64,
            format: "pcm16",
            sampleRate: 24000,
            channels: 1,
          });
        }
      },

      onResponseAudioTranscriptDelta: async (event, _context) => {
        const deltaText = event.delta || "";
        if (deltaText) {
          this._assistantTranscript += deltaText;
          this.sendMessage({
            type: "transcript",
            role: "assistant",
            text: this._assistantTranscript,
            isFinal: false,
          });
        }
      },

      onInputAudioBufferSpeechStarted: async (_event, _context) => {
        this.sendMessage({ type: "status", state: "listening" });
        this.sendMessage({ type: "stop_playback" });
        // Cancel any in-progress response (barge-in)
        try {
          await this.session?.sendEvent({
            type: KnownClientEventType.ResponseCancel,
            eventId: `evt_bargein_${Date.now()}`,
          });
        } catch (_) {
          // Ignore — may not have an active response
        }
      },

      onInputAudioBufferSpeechStopped: async (_event, _context) => {
        this.sendMessage({ type: "status", state: "thinking" });
      },

      onConversationItemInputAudioTranscriptionCompleted: async (event, _context) => {
        const transcript = event.transcript || "";
        if (transcript) {
          this.sendMessage({
            type: "transcript",
            role: "user",
            text: transcript,
            isFinal: true,
          });
        }
      },

      // Catch-all — handles session events and any other server events
      onServerEvent: async (event, _context) => {
        const eventType = event?.type || "";

        if (eventType === "session.created") {
          this._serviceSessionId = event?.session?.id || "";
          console.log(`[${this.clientId}] SESSION_CREATED — session_id: ${this._serviceSessionId}`);
        }

        if (eventType === "session.updated") {
          this._handleSessionUpdated(event);
        }
      },
    };
  }

  // ------------------------------------------------------------------
  // Session updated handler
  // ------------------------------------------------------------------

  _handleSessionUpdated(event) {
    const sessionObj = event?.session;
    // Pick up session ID if not captured from session.created
    if (!this._serviceSessionId) {
      this._serviceSessionId = sessionObj?.id || "";
    }

    if (sessionObj) {
      try {
        console.log(
          `[${this.clientId}] SESSION_UPDATED — server-confirmed config:`,
          JSON.stringify(sessionObj, null, 2)
        );
      } catch (_) {
        console.log(`[${this.clientId}] SESSION_UPDATED (could not serialize)`);
      }
    } else {
      console.log(`[${this.clientId}] SESSION_UPDATED (no session payload)`);
    }

    this.sendMessage({
      type: "session_started",
      session_id: this._serviceSessionId || this.clientId,
      config: {
        mode: this.config.mode,
        model: this.config.model,
        voice: this.config.voice,
      },
    });
    this.sendMessage({ type: "status", state: "listening" });

    // Proactive greeting — trigger once per session
    if (this.config.proactiveGreeting && !this.greetingSent) {
      this.greetingSent = true;
      if (this.config.greetingType === "pregenerated") {
        this._sendPreGeneratedGreeting();
      } else {
        this._sendLlmGreeting();
      }
    }
  }

  // ------------------------------------------------------------------
  // Proactive greeting helpers
  // ------------------------------------------------------------------

  async _sendPreGeneratedGreeting() {
    const text =
      this.config.greetingText || "Welcome! I'm here to help you get started.";
    try {
      await this.session.sendEvent({
        type: KnownClientEventType.ResponseCreate,
        eventId: `evt_greeting_${Date.now()}`,
        response: {
          preGeneratedAssistantMessage: {
            type: "message",
            role: "assistant",
            content: [{ type: "output_text", text }],
          },
        },
      });
      console.log(`[${this.clientId}] Pre-generated greeting sent`);
    } catch (err) {
      console.warn(`[${this.clientId}] Pre-generated greeting failed:`, err.message);
    }
  }

  async _sendLlmGreeting() {
    const instruction =
      this.config.greetingText ||
      "Greet the user warmly and briefly explain how you can help. Start the conversation in English.";
    try {
      await this.session.addConversationItem({
        type: "message",
        role: "system",
        content: [{ type: "input_text", text: instruction }],
      });
      await this.session.sendEvent({
        type: KnownClientEventType.ResponseCreate,
        eventId: `evt_llmgreeting_${Date.now()}`,
      });
      console.log(`[${this.clientId}] LLM-generated greeting triggered`);
    } catch (err) {
      console.warn(`[${this.clientId}] LLM-generated greeting failed:`, err.message);
    }
  }

  // ------------------------------------------------------------------
  // Session configuration builders
  // ------------------------------------------------------------------

  _buildSessionConfig() {
    const mode = this.config.mode || "model";
    if (mode === "agent") {
      return this._buildAgentSessionConfig();
    }
    return this._buildModelSessionConfig();
  }

  _buildModelSessionConfig() {
    const cfg = {
      modalities: ["text", "audio"],
      inputAudioFormat: "pcm16",
      outputAudioFormat: "pcm16",
      voice: this._getVoice(),
      turnDetection: this._getTurnDetection(),
      inputAudioTranscription: this._getTranscriptionOptions(),
      temperature: this.config.temperature ?? 0.7,
    };

    if (this.config.instructions) {
      cfg.instructions = this.config.instructions;
    }
    if (this.config.echoCancellation !== false) {
      cfg.inputAudioEchoCancellation = { type: "server_echo_cancellation" };
    }
    if (this.config.noiseReduction !== false) {
      cfg.inputAudioNoiseReduction = { type: "azure_deep_noise_suppression" };
    }

    const interim = this._getInterimResponseConfig();
    if (interim) {
      cfg.interimResponse = interim;
    }

    return cfg;
  }

  _buildAgentSessionConfig() {
    const cfg = {
      modalities: ["text", "audio"],
      inputAudioFormat: "pcm16",
      outputAudioFormat: "pcm16",
      voice: this._getVoice(),
      turnDetection: this._getTurnDetection(),
    };

    if (this.config.echoCancellation !== false) {
      cfg.inputAudioEchoCancellation = { type: "server_echo_cancellation" };
    }
    if (this.config.noiseReduction !== false) {
      cfg.inputAudioNoiseReduction = { type: "azure_deep_noise_suppression" };
    }

    const interim = this._getInterimResponseConfig();
    if (interim) {
      cfg.interimResponse = interim;
    }

    return cfg;
  }

  _buildAgentConfig() {
    const cfg = {
      agentName: this.config.agentName || "",
      projectName: this.config.projectName || "",
    };
    if (this.config.agentVersion) cfg.agentVersion = this.config.agentVersion;
    if (this.config.conversationId) cfg.conversationId = this.config.conversationId;
    if (this.config.foundryResourceOverride)
      cfg.foundryResourceOverride = this.config.foundryResourceOverride;
    if (
      this.config.authIdentityClientId &&
      this.config.foundryResourceOverride
    ) {
      cfg.authenticationIdentityClientId = this.config.authIdentityClientId;
    }
    return cfg;
  }

  _getVoice() {
    const voiceName = this.config.voice || "en-US-Ava:DragonHDLatestNeural";
    const voiceType = this.config.voiceType || "azure-standard";
    if (voiceType === OPENAI_VOICE_TYPE) {
      return { type: "openai", name: voiceName };
    }
    return { type: "azure-standard", name: voiceName };
  }

  _getTurnDetection() {
    const vadType = this.config.vadType || "azure_semantic";
    return VAD_TYPES[vadType] || VAD_TYPES.azure_semantic;
  }

  _getTranscriptionOptions() {
    // Auto-correct transcribeModel for cascaded (text) models.
    // In agent mode, we don't know which model the agent uses internally —
    // default to azure-speech to avoid cascaded pipeline errors.
    const MULTIMODAL = ["gpt-realtime", "gpt-realtime-mini", "phi4-mm-realtime", "phi4-mini"];
    if (this.config.mode === "agent" || (!MULTIMODAL.includes(this.config.model) && this.config.transcribeModel !== "azure-speech")) {
      if (this.config.transcribeModel !== "azure-speech") {
        const reason = this.config.mode === "agent" ? "agent mode" : `cascaded model ${this.config.model}`;
        console.log(`[${this.clientId}] Auto-corrected transcribeModel to azure-speech (${reason})`);
        this.config.transcribeModel = "azure-speech";
        this.config.inputLanguage = "";
      }
    }
    const opts = {
      model: this.config.transcribeModel || "gpt-4o-transcribe",
    };
    if (this.config.inputLanguage) {
      opts.language = this.config.inputLanguage;
    }
    return opts;
  }

  _getInterimResponseConfig() {
    if (!this.config.interimResponse) return null;

    const triggers = [];
    if (this.config.interimTriggerTool !== false) triggers.push("tool");
    if (this.config.interimTriggerLatency !== false) triggers.push("latency");
    if (triggers.length === 0) return null;

    const latencyMs =
      this.config.interimTriggerLatency !== false
        ? this.config.interimLatencyMs ?? 100
        : undefined;

    if (this.config.interimResponseType === "static") {
      const rawTexts = this.config.interimStaticTexts || "";
      const texts = rawTexts
        .split("\n")
        .map((t) => t.trim())
        .filter(Boolean);

      return {
        type: "static_interim_response",
        triggers,
        latencyThresholdInMs: latencyMs,
        texts: texts.length > 0 ? texts : ["One moment please..."],
      };
    }

    // Default: LLM interim response
    const instructions =
      this.config.interimInstructions ||
      "Create friendly interim responses indicating wait time due to ongoing processing, if any. Do not include in all responses!";

    return {
      type: "llm_interim_response",
      triggers,
      latencyThresholdInMs: latencyMs,
      instructions,
    };
  }
}
