// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import "dotenv/config";
import { VoiceLiveClient } from "@azure/ai-voicelive";
import { AzureKeyCredential } from "@azure/core-auth";
import { DefaultAzureCredential } from "@azure/identity";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, appendFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

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

function printUsage() {
  console.log("Usage: node mcp-quickstart.js [options]");
  console.log("");
  console.log("Options:");
  console.log("  --api-key <key>             VoiceLive API key");
  console.log("  --endpoint <url>            VoiceLive endpoint URL");
  console.log("  --model <name>              Model to use (default: gpt-realtime)");
  console.log(
    "  --voice <name>              Voice (default: en-US-Ava:DragonHDLatestNeural)",
  );
  console.log("  --instructions <text>       System instructions for the assistant");
  console.log("  --audio-input-device <name> Explicit SoX input device name (Windows)");
  console.log("  --list-audio-devices        List available audio input devices and exit");
  console.log("  --use-token-credential      Use Azure credential instead of API key");
  console.log("  --no-audio                  Connect and configure session without mic/speaker");
  console.log("  -h, --help                  Show this help text");
}

function parseArguments(argv) {
  const parsed = {
    apiKey: process.env.AZURE_VOICELIVE_API_KEY,
    endpoint: process.env.AZURE_VOICELIVE_ENDPOINT,
    model: process.env.AZURE_VOICELIVE_MODEL ?? "gpt-realtime",
    voice:
      process.env.AZURE_VOICELIVE_VOICE ?? "en-US-Ava:DragonHDLatestNeural",
    instructions:
      process.env.AZURE_VOICELIVE_INSTRUCTIONS ??
      "You are a helpful AI assistant with access to MCP tools. Always respond in English. When a user asks a question, use the appropriate tool once to find information, then summarize the results conversationally. IMPORTANT: Never call the same tool more than once per user question. After receiving a tool result, always respond to the user with what you found — do not search again. Some tools require user approval before they can be used. When you receive a system message asking you to request permission, you MUST clearly ask the user for their explicit approval before proceeding. Always wait for the user to say yes or no. Never skip the approval question or assume permission is granted. If a tool result arrives after the conversation has moved to a different topic, briefly introduce it as a late result before sharing the findings.",
    audioInputDevice: process.env.AUDIO_INPUT_DEVICE,
    listAudioDevices: false,
    useTokenCredential: false,
    noAudio: false,
    help: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case "--api-key":
        parsed.apiKey = argv[++i];
        break;
      case "--endpoint":
        parsed.endpoint = argv[++i];
        break;
      case "--model":
        parsed.model = argv[++i];
        break;
      case "--voice":
        parsed.voice = argv[++i];
        break;
      case "--instructions":
        parsed.instructions = argv[++i];
        break;
      case "--audio-input-device":
        parsed.audioInputDevice = argv[++i];
        break;
      case "--list-audio-devices":
        parsed.listAudioDevices = true;
        break;
      case "--use-token-credential":
        parsed.useTokenCredential = true;
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
    console.log('Example: node mcp-quickstart.js --audio-input-device "Microphone"');
  } catch (err) {
    console.error("Failed to query audio devices:", err.message);
  }
}

function resolveVoiceConfig(voiceName) {
  const looksLikeAzureVoice = voiceName.includes("-") || voiceName.includes(":");
  if (looksLikeAzureVoice) {
    return { type: "azure-standard", name: voiceName };
  }
  return { type: "openai", name: voiceName };
}

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
        "Audio dependencies are unavailable. Install optional packages (node-record-lpcm16, speaker) " +
        "and required native build tools, or run with --no-audio for connectivity-only validation.",
      );
    }
  }

  async startCapture(session) {
    if (!this._enableAudio) {
      console.log("[audio] --no-audio enabled: microphone capture skipped");
      return;
    }
    if (this._recorder || this._soxProcess) return;

    if (this._inputDevice) {
      console.log(`[audio] Using explicit input device: ${this._inputDevice}`);

      const soxArgs = [
        "-q", "-t", "waveaudio", this._inputDevice,
        "-r", "24000", "-c", "1", "-e", "signed-integer", "-b", "16",
        "-t", "raw", "-",
      ];

      this._soxProcess = spawn("sox", soxArgs, {
        stdio: ["ignore", "pipe", "pipe"],
      });

      this._soxProcess.stdout.on("data", (chunk) => {
        if (session.isConnected) {
          session.sendAudio(new Uint8Array(chunk)).catch(() => {});
        }
      });

      this._soxProcess.stderr.on("data", (data) => {
        const msg = data.toString().trim();
        if (msg) console.error(`[audio] sox stderr: ${msg}`);
      });

      this._soxProcess.on("error", (error) => {
        console.error(`[audio] SoX process error: ${error?.message ?? error}`);
      });

      this._soxProcess.on("close", (code) => {
        if (code !== 0) console.error(`[audio] SoX exited with code ${code}`);
        this._soxProcess = null;
      });

      console.log("[audio] Microphone capture started");
      return;
    }

    await this._ensureAudioModulesLoaded();

    const recorderOptions = {
      sampleRate: 24000,
      channels: 1,
      audioType: "raw",
      recorder: "sox",
      encoding: "signed-integer",
      bitwidth: 16,
    };

    this._recorder = this._recordModule.record(recorderOptions);
    const recorderStream = this._recorder.stream();

    recorderStream.on("data", (chunk) => {
      if (session.isConnected) {
        session.sendAudio(new Uint8Array(chunk)).catch(() => {});
      }
    });

    recorderStream.on("error", (error) => {
      console.error(`[audio] Recorder stream error: ${error?.message ?? error}`);
    });

    console.log("[audio] Microphone capture started");
  }

  async startPlayback() {
    if (!this._enableAudio) {
      console.log("[audio] --no-audio enabled: speaker playback skipped");
      return;
    }
    if (this._speaker) return;
    await this._resetSpeaker();
    console.log("[audio] Playback ready");
  }

  queueAudio(base64Delta) {
    const seq = this._nextSeq++;
    if (seq < this._skipSeq) return;
    const chunk = Buffer.from(base64Delta, "base64");
    if (this._speaker && !this._speaker.destroyed) {
      this._speaker.write(chunk);
    }
  }

  skipPendingAudio() {
    if (!this._enableAudio) return;
    this._skipSeq = this._nextSeq++;
    this._resetSpeaker().catch(() => {});
  }

  shutdown() {
    if (this._soxProcess) {
      try { this._soxProcess.kill(); } catch { /* no-op */ }
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

  async _resetSpeaker() {
    await this._ensureAudioModulesLoaded();
    if (this._speaker && !this._speaker.destroyed) {
      // Use destroy() instead of end() to immediately discard buffered audio.
      // end() drains the buffer (plays it out), which causes old MCP response
      // audio to keep playing after barge-in.
      try { this._speaker.destroy(); } catch { /* no-op */ }
    }
    this._speaker = new this._speakerCtor({
      channels: 1,
      bitDepth: 16,
      sampleRate: 24000,
      signed: true,
    });
    this._speaker.on("error", () => {});
  }
}

// <define_mcp_servers>
/**
 * Define MCP servers that Voice Live can use during the session.
 * Each server is an MCPTool object added to the session tools array.
 */
function defineMCPServers() {
  return [
    {
      type: "mcp",
      serverLabel: "deepwiki",
      serverUrl: "https://mcp.deepwiki.com/mcp",
      allowedTools: ["read_wiki_structure", "ask_question"],
      requireApproval: "never",
    },
    {
      type: "mcp",
      serverLabel: "azure_doc",
      serverUrl: "https://learn.microsoft.com/api/mcp",
      requireApproval: "always",
    },
  ];
}
// </define_mcp_servers>

class MCPVoiceAssistant {
  constructor(options) {
    this.endpoint = options.endpoint;
    this.credential = options.credential;
    this.model = options.model;
    this.voice = options.voice;
    this.instructions = options.instructions;
    this.audioInputDevice = options.audioInputDevice;
    this.noAudio = options.noAudio;

    this._session = null;
    this._subscription = null;
    this._audio = new AudioProcessor(!options.noAudio, options.audioInputDevice);
    this._activeResponse = false;
    this._responseApiDone = false;
    this._pendingApproval = null;
    this._approvalQueue = [];
    this._approvalPromptNeeded = false;
    this._mcpCallInProgress = 0;
    this._handledMcpCompletions = new Set();
    this._needsResponseCreate = false;
    this._approvalCallCount = {};
    this._mcpItemToServer = {};
    this._approvalServers = new Set();
    this._mcpStallTimer = null;
    this._activeMcpItems = new Set();
    this._staleMcpItems = new Set();
    this._mcpResultsPending = false;
    this._approvedServersThisTurn = new Set();
    this._bargeInActive = false;
  }

  // <configure_session>
  /**
   * Configure the session with MCP servers in the tools list.
   */
  async _setupSession() {
    console.log("[session] Configuring session with MCP tools...");

    const mcpServers = defineMCPServers();

    this._approvalServers = new Set(
      mcpServers.filter(s => s.requireApproval === "always").map(s => s.serverLabel)
    );

    await this._session.updateSession({
      model: this.model,
      modalities: ["text", "audio"],
      instructions: this.instructions,
      voice: resolveVoiceConfig(this.voice),
      inputAudioFormat: "pcm16",
      outputAudioFormat: "pcm16",
      turnDetection: {
        type: "server_vad",
        threshold: 0.5,
        prefixPaddingInMs: 300,
        silenceDurationInMs: 500,
      },
      inputAudioEchoCancellation: { type: "server_echo_cancellation" },
      inputAudioNoiseReduction: { type: "azure_deep_noise_suppression" },
      inputAudioTranscription: { model: this.model.toLowerCase().includes("realtime") ? "whisper-1" : "azure-speech" },
      tools: mcpServers,
    });

    console.log("[session] Session configuration with MCP tools sent");
  }
  // </configure_session>

  // <handle_mcp_events>
  /**
   * Subscribe to session events, including MCP-specific events.
   */
  _subscribeToEvents(session) {
    this._subscription = session.subscribe({
      onSessionUpdated: async (event, context) => {
        const s = event.session;
        const model = s?.model;
        const voice = s?.voice;
        console.log(`[session] Session ready: ${context.sessionId}`);
        console.log(
          `  Model: ${typeof model === "string" ? model : model?.toString?.() ?? ""}`,
        );
        console.log(`  Voice: ${voice?.name ?? ""}`);
        writeConversationLog(
          [
            `SessionID: ${context.sessionId}`,
            `Model: ${typeof model === "string" ? model : model?.toString?.() ?? ""}`,
            `Voice Name: ${voice?.name ?? ""}`,
            `Voice Type: ${voice?.type ?? ""}`,
            `Log File: ${conversationLogFile}`,
            "",
          ].join("\n"),
        );
      },

      onConversationItemInputAudioTranscriptionCompleted: async (event) => {
        const transcript = event.transcript ?? "";
        console.log(`👤 You said:\t${transcript}`);
        writeConversationLog(`User Input:\t${transcript}`);
        if (this._pendingApproval !== null) {
          await this._resolveVoiceApproval(transcript, session);
        }
      },

      onResponseTextDone: async (event) => {
        const text = event.text ?? "";
        console.log(`🤖 Assistant text:\t${text}`);
        writeConversationLog(`Assistant Text Response:\t${text}`);
      },

      onResponseAudioTranscriptDone: async (event) => {
        const transcript = event.transcript ?? "";
        console.log(`🤖 Assistant audio transcript:\t${transcript}`);
        writeConversationLog(`Assistant Audio Response:\t${transcript}`);
      },

      onInputAudioBufferSpeechStarted: async () => {
        console.log("🎤 Listening...");
        this._audio.skipPendingAudio();

        // Do NOT reset _approvalCallCount here — the counter should only
        // reset on task completion (in onResponseMcpCallCompleted when no
        // pending/queued approvals remain) or on denial (in _resolveVoiceApproval).
        // Resetting on every speech-start would let the model retry denied calls.

        // Clear ALL deferred response flags on barge-in.
        // This prevents onResponseDone (fired by the cancelled response)
        // from immediately creating a new response that overlaps the user.
        this._needsResponseCreate = false;
        this._mcpResultsPending = false;

        // Reset approved-servers-this-turn when user starts a new topic
        if (this._pendingApproval === null && this._mcpCallInProgress <= 0) {
          this._approvedServersThisTurn.clear();
        }

        if (this._activeResponse && !this._responseApiDone) {
          // Mark barge-in so onResponseDone skips deferred actions
          this._bargeInActive = true;
          try {
            await session.sendEvent({ type: "response.cancel" });
          } catch (err) {
            const msg = err?.message ?? "";
            if (!msg.toLowerCase().includes("no active response")) {
              console.warn("[barge-in] Cancel failed:", msg);
            }
          }
          try {
            await session.sendEvent({ type: "input_audio_buffer.clear" });
          } catch { /* best-effort */ }
        }

        if (this._mcpCallInProgress > 0 && this._pendingApproval === null) {
          this._staleMcpItems = new Set([...this._staleMcpItems, ...this._activeMcpItems]);
          console.log(`[barge-in] Marking ${this._activeMcpItems.size} MCP calls as stale`);
          try {
            await session.addConversationItem({ type: "message", role: "system", content: [{ type: "input_text", text: "A tool call is still running in the background. The user just spoke. Respond to what the user said. If a tool result arrives later, briefly introduce it as a late result from an earlier request." }] });
          } catch {}
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
        writeConversationLog("--- Response complete ---");
        this._activeResponse = false;
        this._responseApiDone = true;

        // If this response.done is the result of a barge-in cancel,
        // skip all deferred actions — the user's new turn will handle things.
        if (this._bargeInActive) {
          this._bargeInActive = false;
          return;
        }

        if (this._approvalPromptNeeded && this._pendingApproval !== null) {
          this._approvalPromptNeeded = false;
          await this._sendApprovalVoicePrompt(session);
        } else if (this._mcpResultsPending && this._mcpCallInProgress <= 0 && this._pendingApproval === null) {
          this._mcpResultsPending = false;
          try { await session.sendEvent({ type: "response.create" }); } catch {}
        } else if (this._needsResponseCreate) {
          this._needsResponseCreate = false;
          try { await session.sendEvent({ type: "response.create" }); } catch {}
        }
      },

      onServerError: async (event) => {
        const msg = event.error?.message ?? "";
        // Reset response state — errors can terminate a response without onResponseDone
        this._activeResponse = false;
        this._responseApiDone = true;
        if (msg.includes("Cancellation failed: no active response")) return;
        if (msg.toLowerCase().includes("interim response")) {
          console.log("[session] Interim response not supported (non-fatal)");
          return;
        }
        if (msg.toLowerCase().includes("active response")) return;
        console.error(`❌ VoiceLive error: ${msg}`);
        writeConversationLog(`ERROR: ${msg}`);
      },

      // MCP-specific event handlers
      onMcpListToolsCompleted: async (event) => {
        console.log(`🔧 MCP tools discovered successfully`);
        writeConversationLog("MCP tools discovered successfully");
      },

      onMcpListToolsFailed: async (event) => {
        console.error(`❌ MCP tool discovery failed`);
        writeConversationLog("ERROR: MCP tool discovery failed");
      },

      onResponseMcpCallInProgress: async (event) => {
        console.log("⏳ MCP tool call in progress...");
        writeConversationLog(`MCP call in progress: ${event.item_id ?? ""}`);
        this._mcpCallInProgress++;
        this._activeMcpItems.add(event.item_id);
        this._startMcpStallTimer(session);
      },

      onResponseMcpCallArgumentsDone: async (event) => {
        const name = event.name ?? "";
        console.log(`📋 MCP tool call arguments ready: ${name}`);
      },

      onResponseMcpCallCompleted: async (event) => {
        const itemId = event.item_id ?? "";
        this._mcpCallInProgress = Math.max(0, this._mcpCallInProgress - 1);
        this._activeMcpItems.delete(itemId);
        this._cancelMcpStallTimer();
        if (this._handledMcpCompletions.has(itemId)) return;
        this._handledMcpCompletions.add(itemId);

        const isStale = this._staleMcpItems.has(itemId);
        this._staleMcpItems.delete(itemId);
        console.log(`✅ MCP tool call completed (stale=${isStale})`);
        writeConversationLog(`MCP call completed: ${itemId} (stale=${isStale})`);

        delete this._mcpItemToServer[itemId];
        if (this._pendingApproval === null && this._approvalQueue.length === 0) {
          this._approvalCallCount = {};
        }

        if (isStale) {
          try {
            await session.addConversationItem({ type: "message", role: "system", content: [{ type: "input_text", text: "This tool result is from an earlier request. The user has since moved on. Briefly introduce it as a late result, e.g. 'By the way, those results from earlier just came in...' then share the key findings concisely." }] });
          } catch {}
        }

        // Batch response: only call response.create when ALL MCP calls for this
        // turn have completed. This prevents partial results and repeated tool calls.
        if (this._mcpCallInProgress <= 0 && this._pendingApproval === null && this._approvalQueue.length === 0) {
          try {
            await session.sendEvent({ type: "response.create" });
          } catch (e) {
            if (e?.message?.toLowerCase().includes("active response")) {
              this._needsResponseCreate = true;
            }
          }
        } else {
          this._mcpResultsPending = true;
          console.log(`[mcp] MCP calls still in progress (${this._mcpCallInProgress}) — deferring response`);
        }
      },

      onResponseMcpCallFailed: async (event) => {
        const itemId = event.item_id ?? "";
        console.error("❌ MCP tool call failed");
        writeConversationLog(`ERROR: MCP call failed: ${itemId}`);
        this._mcpCallInProgress = Math.max(0, this._mcpCallInProgress - 1);
        this._activeMcpItems.delete(itemId);
        this._staleMcpItems.delete(itemId);
        this._cancelMcpStallTimer();
        try { await session.sendEvent({ type: "response.create" }); } catch {}
      },

      onConversationItemCreated: async (event) => {
        const item = event.item;
        if (item?.type === "mcp_call") {
          const sl = item.serverLabel ?? item.server_label ?? "";
          const fn = item.name ?? "";
          this._mcpItemToServer[item.id] = `${sl}/${fn}`;
          console.log(`🔧 MCP tool call: ${sl}/${fn}`);
          writeConversationLog(`MCP tool call: ${sl}/${fn} (id=${item.id})`);
          if (!this._pendingApproval && !this._approvalServers.has(sl)) {
            try {
              await session.addConversationItem({ type: "message", role: "system", content: [{ type: "input_text", text: "Briefly tell the user you're looking something up. One short sentence only." }] });
              await session.sendEvent({ type: "response.create" });
            } catch {}
          }
        }
        if (item?.type === "mcp_approval_request") {
          writeConversationLog(`MCP approval request: ${item.serverLabel ?? item.server_label ?? ""} / ${item.name ?? ""} (id=${item.id ?? ""})`);
          await this._handleApprovalRequest(item, session);
        }
      },
    });
  }
  // </handle_mcp_events>

  // <handle_approval>
  /**
   * Handle MCP approval requests via voice-based approval flow.
   */
  async _handleApprovalRequest(item, session) {
    const approvalId = item.id ?? "unknown";
    const serverLabel = item.serverLabel ?? item.server_label ?? "unknown";
    const functionName = item.name ?? "unknown";

    console.log();
    console.log("🔐 MCP Approval Request");
    console.log(`   Server: ${serverLabel}`);
    console.log(`   Tool: ${functionName}`);
    console.log(`   Approval ID: ${approvalId}`);

    const MAX_APPROVAL_CALLS_PER_TASK = 3;
    const currentCount = this._approvalCallCount[serverLabel] ?? 0;
    if (currentCount >= MAX_APPROVAL_CALLS_PER_TASK) {
      console.log(`   Auto-denied: ${serverLabel}/${functionName} (max ${MAX_APPROVAL_CALLS_PER_TASK} calls reached)`);
      try {
        await session.addConversationItem({
          type: "mcp_approval_response",
          approvalRequestId: approvalId,
          approve: false,
        });
      } catch (err) {
        console.warn("Failed to send auto-deny:", err?.message ?? err);
      }
      return;
    }

    // Auto-approve if user already approved this server earlier in the same turn
    if (this._approvedServersThisTurn.has(serverLabel)) {
      console.log(`   Auto-approved: ${serverLabel}/${functionName} (already approved this turn)`);
      try {
        await session.addConversationItem({
          type: "mcp_approval_response",
          approvalRequestId: approvalId,
          approve: true,
        });
      } catch (err) {
        console.warn("Failed to send auto-approve:", err?.message ?? err);
      }
      return;
    }

    if (this._pendingApproval !== null) {
      this._approvalQueue.push({ approvalId, serverLabel, functionName });
      console.log("   (queued — another approval is pending)");
      return;
    }

    this._pendingApproval = { approvalId, serverLabel, functionName };

    if (!this._activeResponse) {
      await this._sendApprovalVoicePrompt(session);
    } else {
      this._approvalPromptNeeded = true;
    }
  }

  async _sendApprovalVoicePrompt(session) {
    const pending = this._pendingApproval;
    if (!pending) return;

    const server = pending.serverLabel;
    const count = this._approvalCallCount[server] ?? 0;
    this._approvalCallCount[server] = count + 1;

    let prompt;
    if (count === 0) {
      prompt = `You MUST ask the user for explicit permission before proceeding. Say exactly: "I'd like to search the ${server} service for information. Do you approve? Please say yes or no."`;
    } else {
      prompt = `You MUST ask the user for permission again. Say exactly: "I need to do one more search to get complete information. Should I continue? Please say yes or no."`;
    }

    try {
      await session.addConversationItem({
        type: "message",
        role: "system",
        content: [{ type: "input_text", text: prompt }],
      });
      await session.sendEvent({ type: "response.create" });
    } catch (err) {
      console.error("❌ Failed to send approval voice prompt:", err?.message ?? err);
    }
  }

  // <voice_approval_transcription>
  async _resolveVoiceApproval(transcript, session) {
    if (this._pendingApproval === null) return;

    const lower = transcript.toLowerCase();
    let approved = /\byes\b/.test(lower);
    const denied = /\b(no|stop|cancel)\b/.test(lower);

    if (!approved && !denied) {
      // Ambiguous — will re-prompt at next response.done
      this._approvalPromptNeeded = true;
      return;
    }

    if (approved && denied) {
      approved = false; // Conflicting signals — deny for safety
    }

    const { approvalId, serverLabel } = this._pendingApproval;

    console.log(`   Voice response: ${approved ? "Approved ✅" : "Denied ❌"}`);
    writeConversationLog(`Voice approval: ${approved ? "Approved" : "Denied"} for ${serverLabel}`);

    this._pendingApproval = null;

    if (approved) {
      this._approvedServersThisTurn.add(serverLabel);
    } else {
      this._approvalCallCount = {};
      this._approvedServersThisTurn.delete(serverLabel);
    }

    try {
      await session.addConversationItem({
        type: "mcp_approval_response",
        approvalRequestId: approvalId,
        approve: approved,
      });
    } catch (err) {
      console.error("❌ Failed to send approval response:", err?.message ?? err);
    }

    await this._processNextApproval(session);
  }

  async _processNextApproval(session) {
    if (this._approvalQueue.length === 0) return;

    const next = this._approvalQueue.shift();

    // Auto-approve if user already approved this server earlier in the same turn
    if (this._approvedServersThisTurn.has(next.serverLabel)) {
      console.log(`   Auto-approved (queued): ${next.serverLabel}/${next.functionName}`);
      try {
        await session.addConversationItem({
          type: "mcp_approval_response",
          approvalRequestId: next.approvalId,
          approve: true,
        });
      } catch (err) {
        console.warn("Failed to send queued auto-approve:", err?.message ?? err);
      }
      await this._processNextApproval(session);
      return;
    }

    this._pendingApproval = next;

    if (!this._activeResponse) {
      await this._sendApprovalVoicePrompt(session);
    } else {
      this._approvalPromptNeeded = true;
    }
  }
  // </voice_approval_transcription>

  // </handle_approval>

  // <mcp_stall_detection>
  _startMcpStallTimer(session) {
    this._cancelMcpStallTimer();
    let stallCount = 0;
    const MCP_STALL_MAX_NOTIFICATIONS = 3;
    this._mcpStallTimer = setInterval(async () => {
      if (this._mcpCallInProgress <= 0) {
        this._cancelMcpStallTimer();
        return;
      }
      stallCount++;
      if (stallCount > MCP_STALL_MAX_NOTIFICATIONS) {
        this._cancelMcpStallTimer();
        return;
      }
      // MCP calls cannot be cancelled — only honest status updates are possible.
      const msg = "The tool call is still running. Briefly reassure the user that you're still waiting for results. One short sentence only.";
      try {
        await session.addConversationItem({ type: "message", role: "system", content: [{ type: "input_text", text: msg }] });
        await session.sendEvent({ type: "response.create" });
      } catch (e) {
        if (e?.message?.toLowerCase().includes("active response")) {
          this._needsResponseCreate = true;
        }
      }
    }, 10000);
  }

  _cancelMcpStallTimer() {
    if (this._mcpStallTimer) {
      clearInterval(this._mcpStallTimer);
      this._mcpStallTimer = null;
    }
  }
  // </mcp_stall_detection>

  async start() {
    const client = new VoiceLiveClient(this.endpoint, this.credential, {
      apiVersion: "2026-01-01-preview",
    });
    const session = client.createSession({ model: this.model });
    this._session = session;

    console.log(
      `[init] Connecting to VoiceLive with model "${this.model}" at "${this.endpoint}" ...`,
    );

    this._subscribeToEvents(session);

    await session.connect();
    console.log("[init] Connected to VoiceLive session websocket");

    await this._setupSession();

    await this._audio.startPlayback();
    await this._audio.startCapture(session);

    console.log("\n" + "=".repeat(70));
    console.log("🎤 VOICE ASSISTANT WITH MCP READY");
    console.log("Try saying:");
    console.log('  • "Can you summarize the GitHub repo azure-sdk-for-java?"');
    console.log('  • "Search the Azure documentation for Voice Live API."');
    console.log("You may need to approve some MCP tool calls by voice.");
    console.log("Press Ctrl+C to exit");
    console.log("=".repeat(70) + "\n");

    if (this.noAudio) {
      setTimeout(() => {
        process.emit("SIGINT");
      }, 6000);
    }

    await new Promise((resolve) => {
      const onSignal = () => resolve();
      process.once("SIGINT", onSignal);
      process.once("SIGTERM", onSignal);

      const poll = setInterval(() => {
        if (!session.isConnected) {
          clearInterval(poll);
          resolve();
        }
      }, 500);
    });

    await this.shutdown();
  }

  async shutdown() {
    this._cancelMcpStallTimer();

    if (this._subscription) {
      await this._subscription.close();
      this._subscription = null;
    }

    if (this._session) {
      try {
        await this._session.disconnect();
      } catch {
        // ignore disconnect errors during shutdown
      }

      this._audio.shutdown();

      try {
        await this._session.dispose();
      } catch {
        // ignore dispose errors during shutdown
      }

      this._session = null;
    }
  }
}

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

  if (!args.endpoint) {
    console.error(
      "❌ Missing endpoint. Set AZURE_VOICELIVE_ENDPOINT or pass --endpoint.",
    );
    process.exit(1);
  }

  if (!args.apiKey && !args.useTokenCredential) {
    console.error("❌ No authentication provided.");
    console.error(
      "Provide --api-key / AZURE_VOICELIVE_API_KEY or use --use-token-credential.",
    );
    process.exit(1);
  }

  const credential = args.useTokenCredential
    ? new DefaultAzureCredential()
    : new AzureKeyCredential(args.apiKey);

  console.log("Configuration:");
  console.log(`  AZURE_VOICELIVE_ENDPOINT: ${args.endpoint}`);
  console.log(`  AZURE_VOICELIVE_MODEL: ${args.model}`);
  console.log(`  AZURE_VOICELIVE_VOICE: ${args.voice}`);
  console.log(`  AUDIO_INPUT_DEVICE: ${args.audioInputDevice ?? "(not set)"}`);
  console.log(`  No audio mode: ${args.noAudio ? "enabled" : "disabled"}`);
  console.log(
    `  Authentication: ${args.useTokenCredential ? "DefaultAzureCredential" : "API Key"}`,
  );
  console.log(`  Log file: ${conversationLogFile}`);

  const assistant = new MCPVoiceAssistant({
    endpoint: args.endpoint,
    credential,
    model: args.model,
    voice: args.voice,
    instructions: args.instructions,
    audioInputDevice: args.audioInputDevice,
    noAudio: args.noAudio,
  });

  try {
    await assistant.start();
  } catch (err) {
    if (err?.code === "ERR_USE_AFTER_CLOSE") return;
    console.error("Fatal error:", err);
    process.exit(1);
  }
}

console.log("🎙️  Voice Assistant with MCP - Azure VoiceLive SDK");
console.log("=".repeat(70));
main().then(
  () => console.log("\n👋 Voice assistant shut down. Goodbye!"),
  (err) => {
    console.error("Unhandled error:", err);
    process.exit(1);
  },
);
