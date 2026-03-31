/**
 * Express WebSocket server for Azure Voice Live.
 * Supports Agent mode (Foundry Agent Service) and Model mode (direct gpt-realtime / BYOM).
 */

import "dotenv/config";
import express from "express";
import expressWs from "express-ws";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { AzureKeyCredential } from "@azure/core-auth";
import { DefaultAzureCredential } from "@azure/identity";
import { VoiceHandler } from "./voiceHandler.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// Credential
// ---------------------------------------------------------------------------
let _credential = null;

function getCredential() {
  if (!_credential) {
    const apiKey = process.env.AZURE_VOICELIVE_API_KEY;
    if (apiKey) {
      _credential = new AzureKeyCredential(apiKey);
      console.log("[AUTH] Using API key credential");
    } else {
      _credential = new DefaultAzureCredential();
      console.log("[AUTH] Using DefaultAzureCredential");
    }
  }
  return _credential;
}

// ---------------------------------------------------------------------------
// App setup
// ---------------------------------------------------------------------------
const app = express();
expressWs(app);

// CORS
app.use((_req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.header("Access-Control-Allow-Headers", "*");
  next();
});

app.use(express.json());

// ---------------------------------------------------------------------------
// REST endpoints
// ---------------------------------------------------------------------------

app.get("/health", (_req, res) => {
  res.json({ status: "healthy", service: "voicelive-websocket" });
});

app.get("/config", (_req, res) => {
  res.json({
    mode: process.env.VOICELIVE_MODE || "model",
    model: process.env.VOICELIVE_MODEL || "gpt-realtime",
    voice:
      process.env.VOICELIVE_VOICE || "en-US-Ava:DragonHDLatestNeural",
    voiceType: process.env.VOICELIVE_VOICE_TYPE || "azure-standard",
    transcribeModel:
      process.env.VOICELIVE_TRANSCRIBE_MODEL || "gpt-4o-transcribe",
    instructions:
      process.env.VOICELIVE_INSTRUCTIONS ||
      "You are a helpful AI assistant. Respond naturally and conversationally. Keep your responses concise but engaging.",
    agentName: process.env.AZURE_VOICELIVE_AGENT_NAME || "",
    project: process.env.AZURE_VOICELIVE_PROJECT || "",
    authMethod: process.env.AZURE_VOICELIVE_API_KEY
      ? "api_key"
      : "default_credential",
  });
});

// ---------------------------------------------------------------------------
// Speech-to-text locale discovery (cached)
// ---------------------------------------------------------------------------
let _sttLocalesCache = null;

async function fetchSttLocales() {
  if (_sttLocalesCache) return _sttLocalesCache;

  const endpoint = (process.env.AZURE_VOICELIVE_ENDPOINT || "").replace(
    /\/$/,
    ""
  );
  if (!endpoint) return [];

  const apiVersion = process.env.SPEECH_API_VERSION || "2025-10-15";
  const url = `${endpoint}/speechtotext/transcriptions/locales?api-version=${apiVersion}`;

  try {
    const headers = {};
    const apiKey = process.env.AZURE_VOICELIVE_API_KEY;
    if (apiKey) {
      headers["Ocp-Apim-Subscription-Key"] = apiKey;
    } else {
      const credential = getCredential();
      const token = await credential.getToken(
        "https://cognitiveservices.azure.com/.default"
      );
      headers["Authorization"] = `Bearer ${token.token}`;
    }

    const resp = await fetch(url, {
      headers,
      signal: AbortSignal.timeout(15000),
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = await resp.json();

    // API returns {"Submit": [...], "Transcribe": [...]} — merge all unique locales
    const allLocales = new Set();
    for (const locales of Object.values(data)) {
      if (Array.isArray(locales)) {
        locales.forEach((l) => allLocales.add(l));
      }
    }
    _sttLocalesCache = [...allLocales].sort();
    console.log(
      `[LANG] Fetched ${_sttLocalesCache.length} STT locales from API`
    );
    return _sttLocalesCache;
  } catch (err) {
    console.warn(`[LANG] Failed to fetch STT locales: ${err.message}`);
    return [];
  }
}

app.get("/languages", async (_req, res) => {
  try {
    const locales = await fetchSttLocales();
    res.json({ azureSpeechLocales: locales });
  } catch (err) {
    res.json({ azureSpeechLocales: [] });
  }
});

// ---------------------------------------------------------------------------
// Active handlers per client
// ---------------------------------------------------------------------------
const _handlers = new Map();

async function cleanupClient(clientId) {
  const handler = _handlers.get(clientId);
  if (handler) {
    _handlers.delete(clientId);
    await handler.stop();
  }
}

// ---------------------------------------------------------------------------
// WebSocket endpoint
// ---------------------------------------------------------------------------

app.ws("/ws/:clientId", (ws, req) => {
  const clientId = req.params.clientId;
  console.log(`[WS] Client ${clientId} connected`);

  ws.on("message", async (data) => {
    try {
      const message = JSON.parse(data.toString());
      await handleMessage(clientId, message, ws);
    } catch (err) {
      console.error(`[WS] Error handling message from ${clientId}:`, err);
    }
  });

  ws.on("close", () => {
    console.log(`[WS] Client ${clientId} disconnected`);
    cleanupClient(clientId);
  });

  ws.on("error", (err) => {
    console.error(`[WS] Error for ${clientId}:`, err);
    cleanupClient(clientId);
  });
});

async function handleMessage(clientId, message, ws) {
  const msgType = message.type;

  if (msgType === "start_session") {
    const config = { ...message };
    delete config.type;
    await startSession(clientId, config, ws);
  } else if (msgType === "stop_session") {
    await stopSession(clientId, ws);
  } else if (msgType === "audio_chunk") {
    const handler = _handlers.get(clientId);
    if (handler) await handler.sendAudio(message.data || "");
  } else if (msgType === "send_text") {
    const handler = _handlers.get(clientId);
    if (handler) await handler.sendText(message.text || "");
  } else if (msgType === "interrupt") {
    const handler = _handlers.get(clientId);
    if (handler) await handler.interrupt();
  } else {
    console.warn(`[WS] Unknown message type from ${clientId}: ${msgType}`);
  }
}

// ---------------------------------------------------------------------------
// Session lifecycle
// ---------------------------------------------------------------------------

function sendToClient(ws, clientId) {
  return (msg) => {
    try {
      if (ws.readyState === 1) {
        ws.send(JSON.stringify(msg));
      }
    } catch (err) {
      console.error(`[WS] Failed to send to ${clientId}:`, err);
    }
  };
}

async function startSession(clientId, frontendConfig, ws) {
  try {
    const endpoint = process.env.AZURE_VOICELIVE_ENDPOINT;
    if (!endpoint) throw new Error("Missing AZURE_VOICELIVE_ENDPOINT");

    const credential = getCredential();
    const send = sendToClient(ws, clientId);

    // Build typed session config — frontend values override .env defaults
    const config = {
      mode: frontendConfig.mode || process.env.VOICELIVE_MODE || "model",
      model: frontendConfig.model || process.env.VOICELIVE_MODEL || "gpt-realtime",
      voice:
        frontendConfig.voice ||
        process.env.VOICELIVE_VOICE ||
        "en-US-Ava:DragonHDLatestNeural",
      voiceType:
        frontendConfig.voice_type ||
        process.env.VOICELIVE_VOICE_TYPE ||
        "azure-standard",
      transcribeModel:
        frontendConfig.transcribe_model ||
        process.env.VOICELIVE_TRANSCRIBE_MODEL ||
        "gpt-4o-transcribe",
      inputLanguage: frontendConfig.input_language || "",
      instructions:
        frontendConfig.instructions ||
        process.env.VOICELIVE_INSTRUCTIONS ||
        "",
      temperature: parseFloat(
        frontendConfig.temperature ??
          process.env.VOICELIVE_TEMPERATURE ??
          "0.7"
      ),
      vadType:
        frontendConfig.vad_type ||
        process.env.VOICELIVE_VAD_TYPE ||
        "azure_semantic",
      noiseReduction: frontendConfig.noise_reduction ?? true,
      echoCancellation: frontendConfig.echo_cancellation ?? true,
      agentName:
        frontendConfig.agent_name || process.env.AZURE_VOICELIVE_AGENT_NAME || "",
      projectName:
        frontendConfig.project || process.env.AZURE_VOICELIVE_PROJECT || "",
      agentVersion:
        frontendConfig.agent_version ||
        process.env.AZURE_VOICELIVE_AGENT_VERSION ||
        "",
      conversationId: frontendConfig.conversation_id || "",
      foundryResourceOverride:
        frontendConfig.foundry_resource_override ||
        process.env.AZURE_VOICELIVE_FOUNDRY_RESOURCE_OVERRIDE ||
        "",
      authIdentityClientId:
        frontendConfig.auth_identity_client_id ||
        process.env.AZURE_VOICELIVE_AUTH_IDENTITY_CLIENT_ID ||
        "",
      proactiveGreeting: frontendConfig.proactive_greeting ?? true,
      greetingType: frontendConfig.greeting_type || "llm",
      greetingText: frontendConfig.greeting_text || "",
      interimResponse: frontendConfig.interim_response ?? false,
      interimResponseType: frontendConfig.interim_response_type || "llm",
      interimTriggerTool: frontendConfig.interim_trigger_tool ?? true,
      interimTriggerLatency: frontendConfig.interim_trigger_latency ?? true,
      interimLatencyMs: frontendConfig.interim_latency_ms ?? 100,
      interimInstructions: frontendConfig.interim_instructions || "",
      interimStaticTexts: frontendConfig.interim_static_texts || "",
    };

    // Tear down any previous handler for this client
    await cleanupClient(clientId);

    const handler = new VoiceHandler(
      clientId,
      endpoint,
      credential,
      send,
      config
    );
    _handlers.set(clientId, handler);
    await handler.start();

    console.log(
      `[APP] Session started for ${clientId} in ${config.mode} mode`
    );
  } catch (err) {
    console.error(`[APP] Failed to start session for ${clientId}:`, err);
    try {
      if (ws.readyState === 1) {
        ws.send(
          JSON.stringify({ type: "error", message: String(err.message || err) })
        );
      }
    } catch (_) {
      // ignore send failure
    }
  }
}

async function stopSession(clientId, ws) {
  await cleanupClient(clientId);
  try {
    if (ws.readyState === 1) {
      ws.send(JSON.stringify({ type: "session_stopped" }));
    }
  } catch (_) {
    // ignore
  }
  console.log(`[APP] Session stopped for ${clientId}`);
}

// ---------------------------------------------------------------------------
// Static files — checked after API routes
// ---------------------------------------------------------------------------
const staticCandidates = [
  join(__dirname, "static"),
  join(__dirname, "..", "frontend", "dist"),
];

let staticDir = null;
for (const candidate of staticCandidates) {
  if (existsSync(candidate)) {
    staticDir = candidate;
    break;
  }
}

if (staticDir) {
  app.use(express.static(staticDir));
  // SPA fallback — serve index.html for unmatched routes
  app.get("*", (_req, res) => {
    res.sendFile(join(staticDir, "index.html"));
  });
  console.log(`[STATIC] Serving static files from ${staticDir}`);
} else {
  app.get("/", (_req, res) => {
    res.json({ message: "Voice Live WebSocket Server", version: "1.0.0" });
  });
}

// ---------------------------------------------------------------------------
// Graceful shutdown
// ---------------------------------------------------------------------------
async function shutdown() {
  console.log("[APP] Shutting down…");
  for (const [clientId] of _handlers) {
    await cleanupClient(clientId);
  }
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------
const PORT = parseInt(process.env.PORT || "8000", 10);

app.listen(PORT, () => {
  console.log(`[APP] Voice Live WebSocket server listening on port ${PORT}`);
});
