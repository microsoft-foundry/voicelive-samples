# Voice Live — Python Backend

FastAPI WebSocket server that bridges a browser frontend with Azure Voice Live SDK.

## Architecture

```
Frontend (React+Vite) → WebSocket → app.py → voice_handler.py → Azure Voice Live SDK
```

The Python backend follows SDK-idiomatic patterns using a `@dataclass SessionConfig` with typed
builder methods that return SDK objects directly:

- `SessionConfig.get_voice()` → `AzureStandardVoice`
- `SessionConfig.get_turn_detection()` → `AzureSemanticVad` / `ServerVad` / etc.
- `SessionConfig.get_transcription_options()` → `AudioInputTranscriptionOptions`
- `SessionConfig.get_interim_response_config()` → `LlmInterimResponseConfig` / `StaticInterimResponseConfig`
- `SessionConfig.build_model_session()` → `RequestSession`
- `SessionConfig.build_agent_session()` → `RequestSession`

## Quick Start

```bash
cd python

# Create and activate virtual environment
python -m venv .venv
.venv\Scripts\activate        # Windows
# source .venv/bin/activate   # macOS/Linux

# Install dependencies
pip install -r requirements.txt

# Configure environment
cp .env.sample .env
# Edit .env with your Azure Voice Live credentials

# Run the server
uvicorn app:app --host localhost --port 8000 --reload
```

## Connection Modes

Set `VOICELIVE_MODE` in `.env`:

| Mode    | Description                                      |
|---------|--------------------------------------------------|
| `model` | Connects directly to a model (e.g. gpt-realtime) — default |
| `agent` | Connects via Foundry Agent Service               |

## Settings

All settings are configurable from the frontend UI. Default values can be set via `.env`:

| Setting | Env Variable | Default |
|---------|-------------|---------|
| Model | `VOICELIVE_MODEL` | `gpt-realtime` |
| Voice | `VOICELIVE_VOICE` | `en-US-Ava:DragonHDLatestNeural` |
| Temperature | `VOICELIVE_TEMPERATURE` | `0.7` |
| VAD Type | `VOICELIVE_VAD_TYPE` | `azure_semantic` |
| Instructions | `VOICELIVE_INSTRUCTIONS` | _(empty)_ |
| Agent Name | `AZURE_VOICELIVE_AGENT_NAME` | _(required for agent mode)_ |
| Project | `AZURE_VOICELIVE_PROJECT` | _(required for agent mode)_ |

## Running Tests

```bash
pip install pytest httpx
python -m pytest tests/test_settings_e2e.py tests/test_agent_routing.py tests/test_ws_auth.py -v
```

## Notes

No Python-specific limitations at this time. All frontend features are supported.

## WebSocket Protocol

Connect to `ws://localhost:8000/ws/{client_id}` and exchange JSON messages:

**Client → Server:**
- `{ "type": "start_session", "mode": "model", "model": "gpt-realtime", ... }` — start voice session
- `{ "type": "audio_chunk", "data": "<base64 PCM16>" }` — stream microphone audio
- `{ "type": "interrupt" }` — cancel current response
- `{ "type": "stop_session" }` — end session

**Server → Client:**
- `{ "type": "session_started", "config": { ... } }`
- `{ "type": "audio_data", "data": "<base64 PCM16>", "sampleRate": 24000 }`
- `{ "type": "transcript", "role": "user"|"assistant", "text": "...", "isFinal": bool }`
- `{ "type": "status", "state": "listening"|"thinking"|"speaking" }`
- `{ "type": "stop_playback" }`
- `{ "type": "session_stopped" }`
- `{ "type": "error", "message": "..." }`
