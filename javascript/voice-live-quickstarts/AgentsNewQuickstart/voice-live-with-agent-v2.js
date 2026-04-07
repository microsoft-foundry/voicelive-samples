// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

// <all>
// Voice Live with Foundry Agent Service v2 - Node.js Console Voice Assistant
// Uses @azure/ai-voicelive SDK with handler-based event subscription pattern.

import "dotenv/config";
import { VoiceLiveClient } from "@azure/ai-voicelive";
import { DefaultAzureCredential } from "@azure/identity";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, appendFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// Logging and conversation log setup
// ---------------------------------------------------------------------------
const logsDir = join(__dirname, "logs");
if (!existsSync(logsDir)) mkdirSync(logsDir, { recursive: true });

const timestamp = new Date()
  .toISOString()
  .replace(/[:.]/g, "-")
  .replace("T", "_")
  .slice(0, 19);
const conversationLogFile = join(logsDir, `conversation_${timestamp}.log`);

function writeConversationLog(message) {
  appendFileSync(conversationLogFile, message + "\n", "utf-8");
}

// ---------------------------------------------------------------------------
// Audio helpers
// ---------------------------------------------------------------------------
// <audio_processor>
/**
 * AudioProcessor manages microphone capture via node-record-lpcm16
 * and playback via the speaker npm package. Audio format: 24 kHz, 16-bit, mono.
 */
class AudioProcessor {
  constructor(enableAudio = true, inputDevice = undefined) {
    this._enableAudio = enableAudio;
    this._inputDevice = inputDevice;
    this._recorder = null;
    this._soxProcess = null;
    this._speaker = null;
    this._skipSeq = 0;
    this._nextSeq = 0;
    this._recordModule = null;
    this._speakerCtor = null;
  }

  async _ensureAudioModulesLoaded() {
    if (!this._enableAudio) return;
    if (this._recordModule && this._speakerCtor) return;

    try {
      const recordModule = await import("node-record-lpcm16");
      const speakerModule = await import("speaker");
      this._recordModule = recordModule.default;
      this._speakerCtor = speakerModule.default;
    } catch {
      throw new Error(
        "Audio dependencies are unavailable. Install optional packages (node-record-lpcm16, speaker) and required native build tools, or run with --no-audio for connectivity-only validation.",
      );
    }
  }

  /** Start capturing microphone audio and forward PCM chunks to the session. */
  async startCapture(session) {
    if (!this._enableAudio) {
      console.log("[audio] --no-audio enabled: microphone capture skipped");
      return;
    }
    if (this._recorder || this._soxProcess) return;

    if (this._inputDevice) {
      console.log(`[audio] Using explicit input device: ${this._inputDevice}`);

      const soxArgs = [
        "-q",
        "-t",
        "waveaudio",
        this._inputDevice,
        "-r",
        "24000",
        "-c",
        "1",
        "-e",
        "signed-integer",
        "-b",
        "16",
        "-t",
        "raw",
        "-",
      ];

      this._soxProcess = spawn("sox", soxArgs, {
        stdio: ["ignore", "pipe", "pipe"],
      });

      this._soxProcess.stdout.on("data", (chunk) => {
        if (session.isConnected) {
          session.sendAudio(new Uint8Array(chunk)).catch(() => {
            /* ignore send errors after disconnect */
          });
        }
      });

      this._soxProcess.stderr.on("data", (data) => {
        const msg = data.toString().trim();
        if (msg) {
          console.error(`[audio] sox stderr: ${msg}`);
        }
      });

      this._soxProcess.on("error", (error) => {
        console.error(`[audio] SoX process error: ${error?.message ?? error}`);
      });

      this._soxProcess.on("close", (code) => {
        if (code !== 0) {
          console.error(`[audio] SoX exited with code ${code}`);
        }
        this._soxProcess = null;
      });

      console.log("[audio] Microphone capture started");
      return;
    }

    await this._ensureAudioModulesLoaded();

    this._recorder = this._recordModule.record({
      sampleRate: 24000,
      channels: 1,
      audioType: "raw",
      recorder: "sox",
      encoding: "signed-integer",
      bitwidth: 16,
    });

    const recorderStream = this._recorder.stream();

    recorderStream.on("data", (chunk) => {
      if (session.isConnected) {
        session.sendAudio(new Uint8Array(chunk)).catch(() => {
          /* ignore send errors after disconnect */
        });
      }
    });

    recorderStream.on("error", (error) => {
      console.error(`[audio] Recorder stream error: ${error?.message ?? error}`);
      console.error(
        "[audio] SoX capture failed. Check microphone permissions/device and run with DEBUG=record for details.",
      );
    });

    console.log("[audio] Microphone capture started");
  }

  /** Initialise the speaker for playback. */
  async startPlayback() {
    if (!this._enableAudio) {
      console.log("[audio] --no-audio enabled: speaker playback skipped");
      return;
    }
    if (this._speaker) return;
    await this._resetSpeaker();
    console.log("[audio] Playback ready");
  }

  /** Queue a PCM16 buffer (base64 from service) for playback. */
  queueAudio(base64Delta) {
    const seq = this._nextSeq++;
    if (seq < this._skipSeq) return; // skip if barge-in happened
    const buf = Buffer.from(base64Delta, "base64");
    if (this._speaker && !this._speaker.destroyed) {
      this._speaker.write(buf);
    }
  }

  /** Discard queued audio (barge-in). */
  skipPendingAudio() {
    if (!this._enableAudio) return;
    this._skipSeq = this._nextSeq++;
    // Reset speaker to flush its internal buffer
    this._resetSpeaker().catch(() => {
      // best-effort reset
    });
  }

  /** Shut down capture and playback. */
  shutdown() {
    if (this._soxProcess) {
      try {
        this._soxProcess.kill();
      } catch {
        /* ignore */
      }
      this._soxProcess = null;
    }

    if (this._recorder) {
      this._recorder.stop();
      this._recorder = null;
    }
    if (this._speaker) {
      this._speaker.end();
      this._speaker = null;
    }
    console.log("[audio] Audio processor shut down");
  }

  /** (Re-)create the Speaker instance. */
  async _resetSpeaker() {
    await this._ensureAudioModulesLoaded();

    if (this._speaker && !this._speaker.destroyed) {
      try {
        this._speaker.destroy();
      } catch {
        /* ignore */
      }
    }
    this._speaker = new this._speakerCtor({
      channels: 1,
      bitDepth: 16,
      sampleRate: 24000,
      signed: true,
    });
    // Swallow speaker errors (e.g. device busy after barge-in reset)
    this._speaker.on("error", () => {});
  }
}
// </audio_processor>

// ---------------------------------------------------------------------------
// BasicVoiceAssistant
// ---------------------------------------------------------------------------
// <voice_assistant>
class BasicVoiceAssistant {
  /**
   * @param {object} opts
   * @param {string} opts.endpoint
   * @param {import("@azure/identity").TokenCredential} opts.credential
   * @param {string} opts.agentName
   * @param {string} opts.projectName
   * @param {string} [opts.agentVersion]
   * @param {string} [opts.conversationId]
   * @param {string} [opts.foundryResourceOverride]
   * @param {string} [opts.authenticationIdentityClientId]
   * @param {string} [opts.audioInputDevice]
   * @param {string} [opts.greetingText]
   * @param {boolean} [opts.noAudio]
   */
  // <agent_config>
  constructor(opts) {
    this.endpoint = opts.endpoint;
    this.credential = opts.credential;
    this.greetingText = opts.greetingText;
    this.noAudio = opts.noAudio;
    this.agentConfig = {
      agentName: opts.agentName,
      projectName: opts.projectName,
      ...(opts.agentVersion && { agentVersion: opts.agentVersion }),
      ...(opts.conversationId && { conversationId: opts.conversationId }),
      ...(opts.foundryResourceOverride && {
        foundryResourceOverride: opts.foundryResourceOverride,
      }),
      ...(opts.foundryResourceOverride &&
        opts.authenticationIdentityClientId && {
          authenticationIdentityClientId: opts.authenticationIdentityClientId,
        }),
    };

    this._session = null;
    this._audio = new AudioProcessor(!opts.noAudio, opts.audioInputDevice);
    this._greetingSent = false;
    this._activeResponse = false;
    this._responseApiDone = false;
  }
  // </agent_config>

  // <start_session>
  /** Connect, subscribe to events, and run until interrupted. */
  async start() {
    const client = new VoiceLiveClient(this.endpoint, this.credential);
    const session = client.createSession({ agent: this.agentConfig });
    this._session = session;

    console.log(
      `[init] Connecting to VoiceLive with agent "${this.agentConfig.agentName}" ` +
        `for project "${this.agentConfig.projectName}" ...`,
    );

    // Subscribe to VoiceLive events BEFORE connecting, so the
    // SESSION_UPDATED event is not missed.
    // <handle_events>
    const subscription = session.subscribe({
      // <session_updated_metadata>
      onSessionUpdated: async (event, context) => {
        const s = event.session;
        const agent = s?.agent;
        const voice = s?.voice;
        console.log(`[session] Session ready: ${context.sessionId}`);
        writeConversationLog(
          [
            `SessionID: ${context.sessionId}`,
            `Agent Name: ${agent?.name ?? ""}`,
            `Agent Description: ${agent?.description ?? ""}`,
            `Agent ID: ${agent?.agentId ?? ""}`,
            `Voice Name: ${voice?.name ?? ""}`,
            `Voice Type: ${voice?.type ?? ""}`,
            "",
          ].join("\n"),
        );
      },
      // </session_updated_metadata>

      onConversationItemInputAudioTranscriptionCompleted: async (event) => {
        const transcript = event.transcript ?? "";
        console.log(`👤 You said:\t${transcript}`);
        writeConversationLog(`User Input:\t${transcript}`);
      },

      onResponseTextDone: async (event) => {
        const text = event.text ?? "";
        console.log(`🤖 Agent responded with text:\t${text}`);
        writeConversationLog(`Agent Text Response:\t${text}`);
      },

      onResponseAudioTranscriptDone: async (event) => {
        const transcript = event.transcript ?? "";
        console.log(`🤖 Agent responded with audio transcript:\t${transcript}`);
        writeConversationLog(`Agent Audio Response:\t${transcript}`);
      },

      onInputAudioBufferSpeechStarted: async () => {
        console.log("🎤 Listening...");
        this._audio.skipPendingAudio();

        // Cancel in-progress response (barge-in)
        if (this._activeResponse && !this._responseApiDone) {
          try {
            await session.sendEvent({ type: "response.cancel" });
          } catch (err) {
            const msg = err?.message ?? "";
            if (!msg.toLowerCase().includes("no active response")) {
              console.warn("[barge-in] Cancel failed:", msg);
            }
          }
        }
      },

      onInputAudioBufferSpeechStopped: async () => {
        console.log("🤔 Processing...");
      },

      onResponseCreated: async () => {
        this._activeResponse = true;
        this._responseApiDone = false;
      },

      onResponseAudioDelta: async (event) => {
        if (event.delta) {
          this._audio.queueAudio(event.delta);
        }
      },

      onResponseAudioDone: async () => {
        console.log("🎤 Ready for next input...");
      },

      onResponseDone: async () => {
        console.log("✅ Response complete");
        this._activeResponse = false;
        this._responseApiDone = true;
      },

      onServerError: async (event) => {
        const msg = event.error?.message ?? "";
        if (msg.includes("Cancellation failed: no active response")) {
          // Benign – ignore
          return;
        }
        console.error(`❌ VoiceLive error: ${msg}`);
      },

      onConversationItemCreated: async (event) => {
        console.log(`[event] Conversation item created: ${event.item?.id ?? ""}`);
      },
    });
    // </handle_events>

    // Connect after subscribing so SESSION_UPDATED is not missed
    await session.connect();
    console.log("[init] Connected to VoiceLive session websocket");

    // Configure session eagerly after connect
    await this._setupSession();

    // Proactive greeting
    if (!this._greetingSent) {
      this._greetingSent = true;
      await this._sendProactiveGreeting();
    }

    // Start audio after session is configured
    await this._audio.startPlayback();
    await this._audio.startCapture(session);

    console.log("\n" + "=".repeat(65));
    console.log("🎤 VOICE ASSISTANT READY");
    console.log("Start speaking to begin conversation");
    console.log("Press Ctrl+C to exit");
    console.log("=".repeat(65) + "\n");

    if (this.noAudio) {
      setTimeout(() => {
        process.emit("SIGINT");
      }, 6000);
    }

    // Keep the process alive until disconnect or Ctrl+C
    await new Promise((resolve) => {
      const onSigint = () => {
        resolve();
      };
      process.once("SIGINT", onSigint);
      process.once("SIGTERM", onSigint);

      // Also resolve if subscription closes (e.g. server-side disconnect)
      const poll = setInterval(() => {
        if (!session.isConnected) {
          clearInterval(poll);
          resolve();
        }
      }, 500);
    });

    // Cleanup
    await subscription.close();
    try {
      await session.disconnect();
    } catch {
      // ignore disconnect errors during shutdown
    }
    this._audio.shutdown();
    try {
      await session.dispose();
    } catch {
      // ignore dispose errors during shutdown
    }
  }
  // </start_session>

  // <proactive_greeting>
  /**
   * Send a proactive greeting when the session starts.
   * Supports pre-defined (--greeting-text) or LLM-generated (default).
   */
  async _sendProactiveGreeting() {
    const session = this._session;

    if (this.greetingText) {
      // Pre-generated assistant message (deterministic)
      console.log("[session] Sending pre-generated greeting ...");
      try {
        await session.sendEvent({
          type: "response.create",
          response: {
            preGeneratedAssistantMessage: {
              content: [{ type: "text", text: this.greetingText }],
            },
          },
        });
      } catch (err) {
        console.error("[session] Failed to send pre-generated greeting:", err.message);
      }
    } else {
      // LLM-generated greeting (default)
      console.log("[session] Sending proactive greeting ...");
      try {
        await session.addConversationItem({
          type: "message",
          role: "system",
          content: [
            {
              type: "input_text",
              text: "Say something to welcome the user in English.",
            },
          ],
        });
        await session.sendEvent({ type: "response.create" });
      } catch (err) {
        console.error("[session] Failed to send greeting:", err.message);
      }
    }
  }
  // </proactive_greeting>

  // <setup_session>
  /** Configure session modalities, audio format, and interim response. */
  async _setupSession() {
    console.log("[session] Configuring session ...");
    await this._session.updateSession({
      modalities: ["text", "audio"],
      inputAudioFormat: "pcm16",
      outputAudioFormat: "pcm16",
      interimResponse: {
        type: "llm_interim_response",
        triggers: ["tool", "latency"],
        latencyThresholdInMs: 100,
        instructions:
          "Create friendly interim responses indicating wait time due to ongoing processing, if any. " +
          "Do not include in all responses! Do not say you don't have real-time access to information when calling tools!",
      },
    });
    console.log("[session] Session configuration sent");
  }
  // </setup_session>
}
// </voice_assistant>

// ---------------------------------------------------------------------------
// CLI helpers
// ---------------------------------------------------------------------------

function printUsage() {
  console.log("Usage: node voice-live-with-agent-v2.js [options]");
  console.log("");
  console.log("Options:");
  console.log("  --endpoint <url>            VoiceLive endpoint URL");
  console.log("  --agent-name <name>         Foundry agent name");
  console.log("  --project-name <name>       Foundry project name");
  console.log("  --agent-version <ver>       Agent version");
  console.log("  --conversation-id <id>      Conversation ID to resume");
  console.log("  --foundry-resource <name>   Foundry resource override");
  console.log("  --auth-client-id <id>       Authentication identity client ID");
  console.log("  --audio-input-device <name> Explicit SoX input device name (Windows)");
  console.log("  --list-audio-devices        List available audio input devices and exit");
  console.log("  --greeting-text <text>      Send a pre-defined greeting instead of LLM-generated");
  console.log("  --no-audio                  Connect and configure session without mic/speaker");
  console.log("  -h, --help                  Show this help text");
}

function parseArguments(argv) {
  const parsed = {
    endpoint: process.env.VOICELIVE_ENDPOINT ?? "",
    agentName: process.env.AGENT_NAME ?? "",
    projectName: process.env.PROJECT_NAME ?? "",
    agentVersion: process.env.AGENT_VERSION,
    conversationId: process.env.CONVERSATION_ID,
    foundryResourceOverride: process.env.FOUNDRY_RESOURCE_OVERRIDE,
    authenticationIdentityClientId:
      process.env.AGENT_AUTHENTICATION_IDENTITY_CLIENT_ID,
    audioInputDevice: process.env.AUDIO_INPUT_DEVICE,
    listAudioDevices: false,
    greetingText: undefined,
    noAudio: false,
    help: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case "--endpoint":
        parsed.endpoint = argv[++i];
        break;
      case "--agent-name":
        parsed.agentName = argv[++i];
        break;
      case "--project-name":
        parsed.projectName = argv[++i];
        break;
      case "--agent-version":
        parsed.agentVersion = argv[++i];
        break;
      case "--conversation-id":
        parsed.conversationId = argv[++i];
        break;
      case "--foundry-resource":
        parsed.foundryResourceOverride = argv[++i];
        break;
      case "--auth-client-id":
        parsed.authenticationIdentityClientId = argv[++i];
        break;
      case "--audio-input-device":
        parsed.audioInputDevice = argv[++i];
        break;
      case "--list-audio-devices":
        parsed.listAudioDevices = true;
        break;
      case "--greeting-text":
        parsed.greetingText = argv[++i];
        break;
      case "--no-audio":
        parsed.noAudio = true;
        break;
      case "--help":
      case "-h":
        parsed.help = true;
        break;
      default:
        if (arg?.startsWith("-")) {
          throw new Error(`Unknown option: ${arg}`);
        }
        break;
    }
  }

  return parsed;
}

/**
 * List available audio input devices on Windows (AudioEndpoint via WMI).
 */
async function listAudioDevices() {
  if (process.platform !== "win32") {
    console.log("Device listing is currently supported on Windows only.");
    console.log("On macOS/Linux, run: sox -V6 -n -t coreaudio -n trim 0 0  (or similar)");
    return;
  }

  const { execSync } = await import("node:child_process");
  try {
    const output = execSync(
      'powershell -NoProfile -Command "Get-CimInstance Win32_PnPEntity | Where-Object { $_.PNPClass -eq \'AudioEndpoint\' } | Select-Object -ExpandProperty Name"',
      { encoding: "utf-8", timeout: 10000 },
    ).trim();

    if (!output) {
      console.log("No audio endpoint devices found.");
      return;
    }

    console.log("Available audio endpoint devices:");
    console.log("");
    for (const line of output.split(/\r?\n/)) {
      const name = line.trim();
      if (name) console.log(`  ${name}`);
    }
    console.log("");
    console.log("Use the device name (or a unique substring) with --audio-input-device.");
    console.log('Example: node voice-live-with-agent-v2.js --audio-input-device "Microphone"');
  } catch (err) {
    console.error("Failed to query audio devices:", err.message);
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
// <main>
async function main() {
  let args;
  try {
    args = parseArguments(process.argv.slice(2));
  } catch (err) {
    console.error(`❌ ${err.message}`);
    printUsage();
    process.exit(1);
  }

  if (args.help) {
    printUsage();
    return;
  }

  if (args.listAudioDevices) {
    await listAudioDevices();
    return;
  }

  if (!args.endpoint || !args.agentName || !args.projectName) {
    console.error(
      "❌ Set VOICELIVE_ENDPOINT, AGENT_NAME, and PROJECT_NAME in your .env file or pass via CLI.",
    );
    printUsage();
    process.exit(1);
  }

  console.log("Configuration:");
  console.log(`  VOICELIVE_ENDPOINT: ${args.endpoint}`);
  console.log(`  AGENT_NAME: ${args.agentName}`);
  console.log(`  PROJECT_NAME: ${args.projectName}`);
  console.log(`  AGENT_VERSION: ${args.agentVersion ?? "(not set)"}`);
  console.log(`  CONVERSATION_ID: ${args.conversationId ?? "(not set)"}`);
  console.log(
    `  FOUNDRY_RESOURCE_OVERRIDE: ${args.foundryResourceOverride ?? "(not set)"}`,
  );
  console.log(
    `  AGENT_AUTHENTICATION_IDENTITY_CLIENT_ID: ${args.authenticationIdentityClientId ?? "(not set)"}`,
  );
  console.log(`  AUDIO_INPUT_DEVICE: ${args.audioInputDevice ?? "(not set)"}`);
  if (args.greetingText) {
    console.log(`  Proactive greeting: pre-defined`);
  } else {
    console.log(`  Proactive greeting: LLM-generated (default)`);
  }
  console.log(`  No audio mode: ${args.noAudio ? "enabled" : "disabled"}`);

  const credential = new DefaultAzureCredential();

  const assistant = new BasicVoiceAssistant({
    endpoint: args.endpoint,
    credential,
    agentName: args.agentName,
    projectName: args.projectName,
    agentVersion: args.agentVersion,
    conversationId: args.conversationId,
    foundryResourceOverride: args.foundryResourceOverride,
    authenticationIdentityClientId: args.authenticationIdentityClientId,
    audioInputDevice: args.audioInputDevice,
    greetingText: args.greetingText,
    noAudio: args.noAudio,
  });

  try {
    await assistant.start();
  } catch (err) {
    if (err?.code === "ERR_USE_AFTER_CLOSE") return; // normal on Ctrl+C
    console.error("Fatal error:", err);
    process.exit(1);
  }
}

// </main>

console.log("🎙️  Basic Foundry Voice Agent with Azure VoiceLive SDK (Agent Mode)");
console.log("=".repeat(65));
main().then(
  () => console.log("\n👋 Voice assistant shut down. Goodbye!"),
  (err) => {
    console.error("Unhandled error:", err);
    process.exit(1);
  },
);
// </all>
