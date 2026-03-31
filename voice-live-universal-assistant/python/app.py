"""
FastAPI WebSocket server for Azure Voice Live.
Supports Agent mode (Foundry Agent Service) and Model mode (direct gpt-realtime / BYOM).
"""

import asyncio
import json
import logging
import os
import sys
from contextlib import asynccontextmanager
from typing import Any, Dict, List, Optional

import aiohttp
import uvicorn
from azure.core.credentials import AzureKeyCredential
from azure.identity.aio import DefaultAzureCredential
from dotenv import load_dotenv
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from voice_handler import SessionConfig, VoiceLiveHandler

# ---------------------------------------------------------------------------
# Environment
# ---------------------------------------------------------------------------
load_dotenv()

# ---------------------------------------------------------------------------
# Logging — file + console
# ---------------------------------------------------------------------------
LOG_DIR = os.path.join(os.path.dirname(__file__), "logs")
os.makedirs(LOG_DIR, exist_ok=True)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(name)s %(levelname)s %(message)s",
    handlers=[
        logging.StreamHandler(sys.stdout),
        logging.FileHandler(os.path.join(LOG_DIR, "server.log"), encoding="utf-8"),
    ],
)
logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# App
# ---------------------------------------------------------------------------

# Track active handlers per client
_handlers: Dict[str, VoiceLiveHandler] = {}

# Shared credential — created once, reused across sessions
_credential: Optional[Any] = None


def _get_credential() -> Any:
    """Return a shared credential instance (API key or DefaultAzureCredential)."""
    global _credential
    if _credential is None:
        api_key = os.getenv("AZURE_VOICELIVE_API_KEY")
        if api_key:
            _credential = AzureKeyCredential(api_key)
            logger.info("Using API key credential")
        else:
            _credential = DefaultAzureCredential()
            logger.info("Using DefaultAzureCredential")
    return _credential


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Starting Voice Live WebSocket server …")
    yield
    # Cleanup all active handlers on shutdown
    for cid in list(_handlers):
        await _handlers[cid].stop()
    _handlers.clear()
    # Close shared credential if it supports async close
    if _credential and hasattr(_credential, "close"):
        await _credential.close()
    logger.info("Server shut down.")


app = FastAPI(
    title="Voice Live WebSocket API",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---------------------------------------------------------------------------
# REST endpoints (defined BEFORE static mount)
# ---------------------------------------------------------------------------


@app.get("/health")
async def health():
    return {"status": "healthy", "service": "voicelive-websocket"}


@app.get("/config")
async def get_config():
    return {
        "mode": os.getenv("VOICELIVE_MODE", "model"),
        "model": os.getenv("VOICELIVE_MODEL", "gpt-realtime"),
        "voice": os.getenv("VOICELIVE_VOICE", "en-US-Ava:DragonHDLatestNeural"),
        "voiceType": os.getenv("VOICELIVE_VOICE_TYPE", "azure-standard"),
        "transcribeModel": os.getenv("VOICELIVE_TRANSCRIBE_MODEL", "gpt-4o-transcribe"),
        "instructions": os.getenv("VOICELIVE_INSTRUCTIONS", "You are a helpful AI assistant. Respond naturally and conversationally. Keep your responses concise but engaging."),
        "agentName": os.getenv("AZURE_VOICELIVE_AGENT_NAME", ""),
        "project": os.getenv("AZURE_VOICELIVE_PROJECT", ""),
        "authMethod": "api_key" if os.getenv("AZURE_VOICELIVE_API_KEY") else "default_credential",
    }


# ---------------------------------------------------------------------------
# Speech-to-text locale discovery (cached)
# ---------------------------------------------------------------------------
_stt_locales_cache: Optional[List[str]] = None


async def _fetch_stt_locales() -> List[str]:
    """Fetch supported STT locales from the Azure Speech-to-Text API."""
    global _stt_locales_cache
    if _stt_locales_cache is not None:
        return _stt_locales_cache

    endpoint = os.getenv("AZURE_VOICELIVE_ENDPOINT", "").rstrip("/")
    if not endpoint:
        return []

    api_version = os.getenv("SPEECH_API_VERSION", "2025-10-15")
    url = f"{endpoint}/speechtotext/transcriptions/locales?api-version={api_version}"

    try:
        api_key = os.getenv("AZURE_VOICELIVE_API_KEY")
        if api_key:
            headers = {"Ocp-Apim-Subscription-Key": api_key}
        else:
            # Use shared credential for token acquisition
            credential = _get_credential()
            token = await credential.get_token("https://cognitiveservices.azure.com/.default")
            headers = {"Authorization": f"Bearer {token.token}"}

        async with aiohttp.ClientSession() as session:
            async with session.get(url, headers=headers, timeout=aiohttp.ClientTimeout(total=15)) as resp:
                resp.raise_for_status()
                data = await resp.json()
                # API returns {"Submit": [...], "Transcribe": [...]} — merge all unique locales
                all_locales: set[str] = set()
                for locales in data.values():
                    if isinstance(locales, list):
                        all_locales.update(locales)
                _stt_locales_cache = sorted(all_locales)
                logger.info(f"Fetched {len(_stt_locales_cache)} STT locales from API")
                return _stt_locales_cache
    except Exception as e:
        logger.warning(f"Failed to fetch STT locales: {e}")
        return []


@app.get("/languages")
async def get_languages():
    locales = await _fetch_stt_locales()
    return {"azureSpeechLocales": locales}


# ---------------------------------------------------------------------------
# WebSocket endpoint
# ---------------------------------------------------------------------------


@app.websocket("/ws/{client_id}")
async def websocket_endpoint(websocket: WebSocket, client_id: str):
    # Sanitize user-controlled client_id to prevent log injection
    client_id = client_id.replace("\n", "").replace("\r", "").replace("\t", "")
    await websocket.accept()
    logger.info(f"Client {client_id} connected")

    try:
        while True:
            data = await websocket.receive_text()
            message = json.loads(data)
            await _handle_message(client_id, message, websocket)

    except WebSocketDisconnect:
        logger.info(f"Client {client_id} disconnected")
    except Exception as e:
        logger.error(f"WebSocket error for {client_id}: {e}")
    finally:
        await _cleanup_client(client_id)


async def _handle_message(client_id: str, message: dict, websocket: WebSocket):
    msg_type = message.get("type")

    if msg_type == "start_session":
        # Config fields are spread at the top level of the message
        config = {k: v for k, v in message.items() if k != "type"}
        await _start_session(client_id, config, websocket)

    elif msg_type == "stop_session":
        await _stop_session(client_id, websocket)

    elif msg_type == "audio_chunk":
        handler = _handlers.get(client_id)
        if handler:
            await handler.send_audio(message.get("data", ""))

    elif msg_type == "send_text":
        handler = _handlers.get(client_id)
        if handler:
            await handler.send_text(message.get("text", ""))

    elif msg_type == "interrupt":
        handler = _handlers.get(client_id)
        if handler:
            await handler.interrupt()

    else:
        logger.warning(f"Unknown message type from {client_id}: {msg_type}")


# ---------------------------------------------------------------------------
# Session lifecycle
# ---------------------------------------------------------------------------


async def _start_session(client_id: str, config: dict, websocket: WebSocket):
    try:
        endpoint = os.getenv("AZURE_VOICELIVE_ENDPOINT")
        if not endpoint:
            raise ValueError("Missing AZURE_VOICELIVE_ENDPOINT")

        credential = _get_credential()

        async def send_to_client(msg: dict):
            try:
                await websocket.send_text(json.dumps(msg))
            except Exception as e:
                logger.error(f"Failed to send to {client_id}: {e}")

        # Build typed session config — frontend values override .env defaults
        session_config = SessionConfig(
            mode=config.get("mode", os.getenv("VOICELIVE_MODE", "model")),
            model=config.get("model", os.getenv("VOICELIVE_MODEL", "gpt-realtime")),
            voice=config.get("voice", os.getenv("VOICELIVE_VOICE", "en-US-Ava:DragonHDLatestNeural")),
            voice_type=config.get("voice_type", os.getenv("VOICELIVE_VOICE_TYPE", "azure-standard")),
            transcribe_model=config.get("transcribe_model", os.getenv("VOICELIVE_TRANSCRIBE_MODEL", "gpt-4o-transcribe")),
            input_language=config.get("input_language", ""),
            instructions=config.get("instructions", os.getenv("VOICELIVE_INSTRUCTIONS", "")),
            temperature=float(config.get("temperature", os.getenv("VOICELIVE_TEMPERATURE", "0.7"))),
            vad_type=config.get("vad_type", os.getenv("VOICELIVE_VAD_TYPE", "azure_semantic")),
            noise_reduction=config.get("noise_reduction", True),
            echo_cancellation=config.get("echo_cancellation", True),
            agent_name=config.get("agent_name") or os.getenv("AZURE_VOICELIVE_AGENT_NAME"),
            project_name=config.get("project") or os.getenv("AZURE_VOICELIVE_PROJECT"),
            agent_version=config.get("agent_version") or os.getenv("AZURE_VOICELIVE_AGENT_VERSION"),
            conversation_id=config.get("conversation_id"),
            foundry_resource_override=config.get("foundry_resource_override") or os.getenv("AZURE_VOICELIVE_FOUNDRY_RESOURCE_OVERRIDE"),
            auth_identity_client_id=config.get("auth_identity_client_id") or os.getenv("AZURE_VOICELIVE_AUTH_IDENTITY_CLIENT_ID"),
            byom_profile=os.getenv("VOICELIVE_BYOM_PROFILE"),
            proactive_greeting=config.get("proactive_greeting", True),
            greeting_type=config.get("greeting_type", "llm"),
            greeting_text=config.get("greeting_text", ""),
            interim_response=config.get("interim_response", False),
            interim_response_type=config.get("interim_response_type", "llm"),
            interim_trigger_tool=config.get("interim_trigger_tool", True),
            interim_trigger_latency=config.get("interim_trigger_latency", True),
            interim_latency_ms=config.get("interim_latency_ms", 100),
            interim_instructions=config.get("interim_instructions", ""),
            interim_static_texts=config.get("interim_static_texts", ""),
        )

        handler = VoiceLiveHandler(
            client_id=client_id,
            endpoint=endpoint,
            credential=credential,
            send_message=send_to_client,
            config=session_config,
        )

        # Tear down any previous handler for this client
        if client_id in _handlers:
            await _handlers[client_id].stop()

        _handlers[client_id] = handler
        await handler.start()

        logger.info(f"Session started for {client_id} in {session_config.mode} mode")

    except Exception as e:
        logger.error(f"Failed to start session for {client_id}: {e}")
        try:
            await websocket.send_text(
                json.dumps({"type": "error", "message": str(e)})
            )
        except Exception:
            pass


async def _stop_session(client_id: str, websocket: WebSocket):
    handler = _handlers.pop(client_id, None)
    if handler:
        await handler.stop()
    try:
        await websocket.send_text(json.dumps({"type": "session_stopped"}))
    except Exception:
        pass
    logger.info(f"Session stopped for {client_id}")


async def _cleanup_client(client_id: str):
    handler = _handlers.pop(client_id, None)
    if handler:
        await handler.stop()


# ---------------------------------------------------------------------------
# Static files — mounted last so API routes take priority
# ---------------------------------------------------------------------------
_static_candidates = [
    os.path.join(os.path.dirname(__file__), "static"),
    os.path.join(os.path.dirname(__file__), "..", "frontend", "dist"),
]
for _candidate in _static_candidates:
    if os.path.isdir(_candidate):
        app.mount("/", StaticFiles(directory=_candidate, html=True), name="static")
        logger.info(f"Serving static files from {_candidate}")
        break
else:

    @app.get("/")
    async def root():
        return {"message": "Voice Live WebSocket Server", "version": "1.0.0"}


# ---------------------------------------------------------------------------
# Entrypoint
# ---------------------------------------------------------------------------
if __name__ == "__main__":
    uvicorn.run("app:app", host="0.0.0.0", port=8000, reload=True, log_level="info")
