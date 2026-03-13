# Voice Live Web Samples

Web-based code samples for the [Azure Speech Voice Live API](https://learn.microsoft.com/azure/ai-services/speech-service/voice-live-overview) featuring a shared React frontend and language-specific backends.

## Architecture

```
┌─────────────────────┐   WebSocket    ┌──────────────────┐   Voice Live SDK   ┌──────────────┐
│  React + Vite       │◄──────────────►│  Backend Server  │◄─────────────────►│  Azure Voice  │
│  (shared frontend)  │  JSON + PCM16  │  (Python/JS/…)   │   PCM16 + events  │  Live Service │
│                     │  or JSON text  │                  │                    │              │
│  Voice mode: mic    │                │                  │                    │              │
│  Text mode: chat    │                │                  │                    │              │
└─────────────────────┘                └──────────────────┘                    └──────────────┘
```

The frontend builds to static files served by the backend — no separate frontend server needed in production.

## Prerequisites

- **Node.js** 20+ and npm (for building the frontend; also for the JavaScript backend)
- **Python** 3.9+ (for the Python backend)
- **Java** 17+ and Maven 3.8+ (for the Java backend)
- **.NET** 8.0 SDK (for the C# backend)
- An **Azure AI Services** resource with Voice Live API access

## Authentication

**Recommended (RBAC):** Use `DefaultAzureCredential` — no API keys required.

```bash
az login   # Local development — authenticates via Azure CLI
```

For deployed environments, the `azd` infrastructure provisions a **system-assigned managed identity** with the **Cognitive Services User** role, enabling token-based auth without any keys.

**Fallback (API key):** Set `AZURE_VOICELIVE_API_KEY` in `.env` only if token-based auth is unavailable for your resource.

## Quick Start (Python)

### 1. Build the frontend

```bash
cd frontend
npm install
npm run build
```

This creates `frontend/dist/` with the static files that the backend will serve.

### 2. Set up the Python backend

```bash
cd python

# Create and activate a virtual environment
python -m venv .venv

# Activate the venv
# Windows (PowerShell):
.venv\Scripts\Activate.ps1
# Windows (cmd):
.venv\Scripts\activate.bat
# macOS / Linux:
source .venv/bin/activate

# Install dependencies
pip install -r requirements.txt
```

### 3. Configure environment variables

```bash
cp .env.sample .env
```

Edit `.env` with your credentials:

```env
# Required
AZURE_VOICELIVE_ENDPOINT=https://your-resource.cognitiveservices.azure.com/

# Authentication: DefaultAzureCredential is used by default (az login).
# Set API key below only as a fallback if token auth is unavailable.
AZURE_VOICELIVE_API_KEY=

# Connection mode: "model" (default) or "agent" (Foundry Agent Service)
VOICELIVE_MODE=model

# Model mode settings (default — works with just a Foundry resource)
VOICELIVE_MODEL=gpt-realtime
VOICELIVE_VOICE=en-US-Ava:DragonHDLatestNeural
VOICELIVE_TRANSCRIBE_MODEL=gpt-4o-transcribe

# Agent mode settings (when VOICELIVE_MODE=agent)
AZURE_VOICELIVE_AGENT_NAME=your-agent-name
AZURE_VOICELIVE_PROJECT=your-project-name
```

### 4. Run the server

```bash
python app.py
```

Open **http://localhost:8000** in your browser. Click **Start session** and allow microphone access when prompted.

## Quick Start (Java)

### 1. Build the frontend

```bash
cd frontend
npm install
npm run build
```

### 2. Set up the Java backend

```bash
cd java
cp .env.sample .env
# Edit .env with your Azure Voice Live endpoint
```

### 3. Build and run

```bash
mvn clean package -DskipTests
java -jar target/voice-live-universal-assistant-1.0.0.jar
```

Or with Maven directly:

```bash
mvn spring-boot:run
```

Open **http://localhost:8000** in your browser.

> **Note:** See the Java backend [README](java/README.md#notes) for environment and ecosystem notes.

## Quick Start (JavaScript / Node.js)

### 1. Build the frontend

```bash
cd frontend
npm install
npm run build
```

### 2. Set up the Node.js backend

```bash
cd javascript
npm install
cp .env.sample .env
# Edit .env with your Azure Voice Live endpoint
```

### 3. Run

```bash
npm start
```

Open **http://localhost:8000** in your browser.

## Quick Start (C# / ASP.NET Core)

### 1. Build the frontend

```bash
cd frontend
npm install
npm run build
```

### 2. Set up the C# backend

```bash
cd csharp
cp .env.sample .env
# Edit .env with your Azure Voice Live endpoint
```

### 3. Build and run

```bash
dotnet run
```

Open **http://localhost:8000** in your browser.

## Connection Modes

| Mode    | Use case | How it works |
|---------|----------|-------------|
| `model` | Direct model access / BYOM (default) | Caller configures model, voice, system prompt. Works with just an endpoint — no agent setup required. Set `VOICELIVE_MODEL` and `VOICELIVE_VOICE`. |
| `agent` | Foundry Agent Service integration | Agent defines instructions, tools, and voice. Set `AZURE_VOICELIVE_AGENT_NAME` and `AZURE_VOICELIVE_PROJECT`. Auto-set when deploying with `CREATE_AGENT=true`. |

Switch modes by setting `VOICELIVE_MODE` in `.env` or via the Settings panel in the UI.

## Frontend URL Query Parameters

The frontend accepts URL query parameters to customize behavior without changing server configuration. These parameters control UI appearance, input mode, and pre-fill settings.

| Parameter | Values | Default | Description |
|-----------|--------|---------|-------------|
| `?mode=voice\|text` | `voice`, `text` | `voice` | Lock the input mode. `voice` = microphone-based interaction with real-time audio. `text` = chat-style text input. When set, the mode toggle in the menu is hidden. |
| `?lock=true` | `true` | `false` | Kiosk/embed mode — hides the settings gear and mode toggle entirely. The app uses only server-provided configuration. |
| `?agent=NAME` | any string | — | Pre-fills the agent name in settings and automatically sets connection mode to `agent` (when used together with `?project=`). |
| `?project=NAME` | any string | — | Pre-fills the project name in settings and automatically sets connection mode to `agent` (when used together with `?agent=`). |
| `?theme=light\|dark` | `light`, `dark` | system | Override the UI theme. Without this, the app follows the system preference. |
| `?greeting=false` | `false` | `true` | Disable the proactive greeting that the agent sends when a session starts. |

**Examples:**

```
# Voice mode with agent pre-configured (typical embed scenario)
https://your-app.azurecontainerapps.io/?agent=my-agent&project=my-project&lock=true

# Text mode for chat-style interaction
https://your-app.azurecontainerapps.io/?mode=text

# Light theme, no greeting
https://your-app.azurecontainerapps.io/?theme=light&greeting=false
```

## Text Mode

The text mode (`?mode=text`) provides a chat-style text input interface as an alternative to voice interaction.

> **Important:** Text mode is powered by the **Voice Live API's text modality**, not the Foundry Agent Service REST API. The same WebSocket connection and Voice Live session are used — the only difference is that user input is sent as text messages (`send_text`) instead of audio chunks. The agent's response audio can be optionally played back or muted.

**Text mode features:**
- Chat-style message bubbles with auto-scroll
- **Audio playback toggle** (speaker icon) — defaults to **off**; when enabled, the agent's spoken response audio plays through the browser
- **Barge-in** — sending a new message automatically interrupts any playing agent audio
- Text input bar with send button, positioned within the main content area
- Dismiss (✕) button to end the session

**Text vs Voice comparison:**

| Aspect | Voice Mode | Text Mode |
|--------|-----------|-----------|
| User input | Microphone audio (PCM16) | Typed text messages |
| Agent response | Audio playback (always on) | Text bubbles (audio optional, default off) |
| Barge-in | Speaking interrupts agent | Sending text interrupts agent |
| Transport | Voice Live WebSocket | Voice Live WebSocket (same) |
| API | Voice Live text+audio modality | Voice Live text modality |
| Backend | Same session handler | Same session handler |

## Project Structure

```
voice-live-universal-assistant/
├── frontend/                  # Shared React + Vite + TypeScript frontend
│   ├── public/
│   │   ├── audio-capture-worklet.js    # Mic capture AudioWorklet (24kHz PCM16)
│   │   └── audio-playback-worklet.js   # Audio playback AudioWorklet
│   └── src/
│       ├── components/        # UI components (VoiceOrb, StartScreen, etc.)
│       ├── hooks/             # React hooks (useAudioCapture, useAudioPlayback, useVoiceSession)
│       ├── types.ts           # Shared TypeScript types
│       ├── App.tsx            # Root component
│       └── main.tsx           # Entry point
├── python/                    # Python backend (FastAPI + Voice Live SDK)
│   ├── app.py                 # FastAPI server with WebSocket endpoint
│   ├── voice_handler.py       # VoiceLiveHandler — SDK bridge
│   ├── tests/                 # 91 automated tests (settings + agent mode)
│   ├── requirements.txt       # Python dependencies
│   ├── .env.sample            # Environment variable template
│   └── README.md              # Python-specific docs
├── java/                      # Java backend (Spring Boot + Voice Live SDK)
│   ├── src/                   # Spring Boot application source
│   ├── pom.xml                # Maven config (azure-ai-voicelive 1.0.0-beta.5)
│   ├── .env.sample            # Environment variable template
│   └── README.md              # Java-specific docs
├── javascript/                # JavaScript/Node.js backend (Express + Voice Live SDK)
│   ├── app.js                 # Express server with WebSocket endpoint
│   ├── voiceHandler.js        # VoiceHandler — SDK bridge
│   ├── package.json           # npm config (@azure/ai-voicelive 1.0.0-beta.3)
│   ├── .env.sample            # Environment variable template
│   └── README.md              # JavaScript-specific docs
├── csharp/                    # C# ASP.NET Core backend (Voice Live SDK)
│   ├── Program.cs             # ASP.NET Core minimal API + WebSocket middleware
│   ├── VoiceLiveHandler.cs    # VoiceLiveHandler — SDK bridge
│   ├── SessionConfig.cs       # Session configuration POCO
│   ├── VoiceLiveWebApp.csproj # .NET project (Azure.AI.VoiceLive 1.1.0-beta.3)
│   ├── .env.sample            # Environment variable template
│   └── README.md              # C#-specific docs
├── infra/                     # Azure Bicep IaC
│   ├── main.bicep             # Entry point (Container Apps + optional Foundry + Agent)
│   ├── main-app.bicep         # Container App with Voice Live env vars
│   ├── main-infrastructure.bicep  # Log Analytics, ACR, Container Apps Env
│   ├── modules/
│   │   ├── foundry.bicep      # AI Foundry account + project (optional)
│   │   └── foundry-rbac.bicep # Azure AI User role for tracing
│   └── core/host/             # Reusable modules (container-app, container-registry)
├── deployment/
│   ├── hooks/
│   │   ├── postprovision.ps1  # RBAC assignment (+ Foundry RBAC when enabled)
│   │   ├── predeploy.ps1      # ACR cloud build + Container App update
│   │   └── postdeploy.ps1     # Foundry Agent creation (when createAgent=true)
│   └── scripts/
│       └── create_agent.py    # Agent creation with Voice Live metadata
├── tests/                     # E2E test suite (WebSocket + Playwright)
└── README.md                  # This file
```

## Deployment (Azure Developer CLI)

### Option 1: Basic — Container App only (default)

Deploys the web app connecting to your **existing** Azure AI Services resource in **model mode** (no agent required):

```bash
azd auth login
azd init

# Required: set your Voice Live endpoint
azd env set AZURE_VOICELIVE_ENDPOINT "https://your-resource.cognitiveservices.azure.com/"

# Optional: choose backend language (default: python)
azd env set BACKEND_LANGUAGE java   # python | java | javascript | csharp

# Optional: API key (only if token auth is unavailable for your resource)
azd env set AZURE_VOICELIVE_API_KEY "your-api-key"

azd up
```

> **Want agent mode instead?** See [Option 3](#option-3-with-agent--foundry--gpt-41-mini--foundry-agent) for a fully automated setup, or configure manually:
> ```bash
> azd env set VOICELIVE_MODE agent
> azd env set AZURE_VOICELIVE_AGENT_NAME "your-agent-name"
> azd env set AZURE_VOICELIVE_PROJECT "your-project-name"
> ```

This provisions:
- **Container Apps Environment** with Log Analytics
- **Container Registry** (ACR cloud build — no local Docker required)
- **Container App** with system-assigned managed identity
- **RBAC** — Cognitive Services User for token-based auth

### Option 2: With Foundry — Create AI Foundry + model mode

Provisions a new AI Foundry resource with `gpt-realtime` model deployment and configures the app for **model mode** — no additional configuration required:

```bash
azd auth login
azd init
azd env set CREATE_FOUNDRY true
# Optional: choose backend language (default: python)
azd env set BACKEND_LANGUAGE java
azd up
```

This adds (fully automatic — no manual endpoint/model config needed):
- **AI Services Account** (kind: AIServices) with system-assigned identity
- **AI Foundry Project** under the account
- **gpt-4o-realtime-preview** model deployment (as `gpt-realtime`)
- **Azure AI User** + **Azure AI Developer** roles
- Container App configured with provisioned endpoint + model mode

### Option 3: With Agent — Foundry + GPT-4.1-mini + Foundry Agent

Full end-to-end: provisions Foundry, deploys GPT-4.1-mini, and creates an agent with Voice Live configuration — no additional configuration required:

```bash
azd auth login
azd init
azd env set CREATE_AGENT true
# Optional: customize agent name (default: voicelive-assistant)
azd env set AGENT_NAME "my-voice-assistant"
azd up
```

> **Note:** `CREATE_AGENT` automatically enables `CREATE_FOUNDRY` — you don't need to set both.

This adds (fully automatic):
- Everything from Option 2
- **GPT-4.1-mini** model deployment (for the agent)
- **Foundry Agent** created via Python SDK with Voice Live session config (Azure voice, semantic VAD, noise suppression, echo cancellation)
- Container App configured with agent name, project, and **agent mode**

### Deployment parameters

| Parameter | Default | Description |
|-----------|---------|-------------|
| `BACKEND_LANGUAGE` | `python` | Backend language: `python`, `java`, `javascript`, `csharp` |
| `AZURE_VOICELIVE_ENDPOINT` | — | Voice Live endpoint (required for basic, auto-set with Foundry) |
| `VOICELIVE_MODE` | `model` | Connection mode (`model` by default; auto-set to `agent` when `CREATE_AGENT=true`) |
| `AZURE_VOICELIVE_AGENT_NAME` | — | Agent name (auto-set when `CREATE_AGENT=true`) |
| `AZURE_VOICELIVE_PROJECT` | — | Foundry project (auto-set when Foundry provisioned) |
| `CREATE_FOUNDRY` | `false` | Create AI Foundry account + project + model |
| `CREATE_AGENT` | `false` | Create Foundry Agent (implies `CREATE_FOUNDRY`; sets mode to `agent`) |
| `FOUNDRY_ACCOUNT_NAME` | auto-generated | Custom name for the AI Services account |
| `FOUNDRY_PROJECT_NAME` | `voicelive-project` | Name for the Foundry project |
| `AGENT_MODEL_DEPLOYMENT_NAME` | `gpt-4.1-mini` | Model deployment name for agent |
| `AGENT_NAME` | `voicelive-assistant` | Name for the created agent |

## Development

For local development with hot-reload on both frontend and backend:

**Terminal 1 — Frontend dev server** (with proxy to backend):
```bash
cd frontend
npm run dev
```

**Terminal 2 — Python backend**:
```bash
cd python
.venv\Scripts\Activate.ps1   # or source .venv/bin/activate
python app.py
```

The Vite dev server at `http://localhost:5173` proxies WebSocket and API calls to `http://localhost:8000`.

## WebSocket Protocol

The frontend and backend communicate over WebSocket at `/ws/{clientId}`.

| Direction | Message | Description |
|-----------|---------|-------------|
| Client → Server | `start_session` | Begin voice session with config |
| Client → Server | `audio_chunk` | Base64 PCM16 mic audio (24kHz, mono) |
| Client → Server | `interrupt` | Cancel current agent response |
| Client → Server | `send_text` | Send text message (text mode) |
| Client → Server | `stop_session` | End the session |
| Server → Client | `session_started` | Session ready, includes config and session_id |
| Server → Client | `audio_data` | Base64 PCM16 agent audio response |
| Server → Client | `transcript` | User or assistant transcript text |
| Server → Client | `status` | State change (listening/thinking/speaking) |
| Server → Client | `stop_playback` | Stop audio playback (barge-in) |
| Server → Client | `session_stopped` | Session ended |
| Server → Client | `error` | Error message |

## SDK Versions & Known Issues

All backends pin the API version to `2026-01-01-preview` (the SDK defaults to GA which lacks agent mode and interim response support).

| Backend | SDK | Version | Language-Specific Notes |
|---------|-----|---------|------------------------|
| Python  | `azure-ai-voicelive` | 1.0.0b1 | No known limitations |
| Java    | `azure-ai-voicelive` | 1.0.0-beta.5 | `.env` loaded via custom parser; Netty version mismatch warning (no runtime impact) |
| JavaScript | `@azure/ai-voicelive` | 1.0.0-beta.3 | Node.js 20+ required. No known limitations |
| C#      | `Azure.AI.VoiceLive` | 1.1.0-beta.3 | No known limitations |

### Frontend UX Guards

- **Interim Response** is disabled (greyed out) when a realtime model is selected in model mode — it only works with agent mode or text models using cascaded pipelines (Azure Speech transcription).
- **Start Session** button is disabled when in agent mode and Agent Name or Project are empty, with a helper message directing the user to Settings.
- **Transcription model** is auto-corrected to `azure-speech` when a text model is selected (cascaded pipelines only support `azure-speech`).
- **Agent mode toggle** is disabled in Settings when no agent is configured on the server (agent name and project both empty). This prevents users from switching to agent mode when the server has no agent setup.
- **Audio playback** in text mode defaults to off. When muted, audio data from the service is completely skipped (not decoded) to avoid unnecessary resource usage.

### Validation Guard Matrix

Shows where each validation is enforced — frontend-only guards rely on the UI to prevent invalid input, while backend guards provide server-side enforcement.

| Guard | Frontend | Python | Java | JavaScript | C# |
|-------|----------|--------|------|------------|-----|
| Agent mode requires name + project | ✅ Disables Start btn | — SDK validates | ✅ Falls back to model | — SDK validates | ✅ Falls back to model |
| Transcribe model auto-correction | ✅ On model change | — | — | ✅ For agent/cascaded | ✅ For cascaded models |
| Interim response disabled for realtime | ✅ Greys out toggle | — | — | — | ❌ SDK gap (ignored) |
| Session cleanup on start failure | — | ✅ | ✅ | ✅ | ✅ |
| Auth identity requires resource override | — | ✅ | ✅ | ✅ | ✅ |

> **Legend:** ✅ = enforced, — = not needed / passed through to SDK, ❌ = not supported

### Backend Feature Matrix

| Feature | Python | Java | JavaScript | C# |
|---------|--------|------|------------|-----|
| Model mode (realtime) | ✅ | ✅ | ✅ | ✅ |
| Model mode (text/cascaded) | ✅ | ✅ | ✅ | ✅ |
| Agent mode | ✅ | ✅ | ✅ | ✅ |
| Interim response | ✅ | ✅ | ✅ | ❌ SDK gap |
| Echo cancellation | ✅ | ✅ | ✅ | ✅ |
| Noise reduction | ✅ | ✅ | ✅ | ✅ |

## Future Improvements

- **Agent mode fail-fast:** When `mode=agent` but `agentName` or `projectName` are missing, the C# and Java backends silently fall back to model mode. The frontend already prevents this (Start button is disabled until both fields are set), but the backends should return an explicit error instead of downgrading. Python and JavaScript pass the config through and let the SDK validate.
- **Align backend validation guards:** As shown in the [Validation Guard Matrix](#validation-guard-matrix), transcribe model auto-correction and interim response guards are inconsistent across backends. Python and Java rely entirely on the frontend for these validations. All backends should enforce the same server-side guards to prevent invalid configurations when the frontend is bypassed (e.g., direct WebSocket clients).

## Testing

An E2E test suite is available in [`tests/e2e_all_backends.py`](tests/e2e_all_backends.py) covering all four backends with two test types:

- **WebSocket tests** — connect directly to the backend WebSocket endpoint, send a `start_session` message, stream real WAV audio as PCM16 chunks, and verify that audio and transcript responses are received.
- **Playwright browser tests** — open the frontend UI in a headless Chromium browser with a mocked microphone (oscillator tone), click Start, and verify the page loads, the voice orb renders, and a session becomes active.

### Prerequisites

```bash
pip install websockets playwright
python -m playwright install chromium
```

WebSocket tests use WAV audio files when available, or fall back to a synthetic 440Hz sine wave. Set `E2E_AUDIO_DIR` to a folder containing `.wav` files for real speech testing. Backend URLs can be overridden via environment variables (`E2E_PYTHON_URL`, `E2E_CSHARP_URL`, `E2E_JAVASCRIPT_URL`, `E2E_JAVA_URL`).

### Running Tests

```bash
cd voice-live-universal-assistant

# All backends, both test types (model mode)
python tests/e2e_all_backends.py

# WebSocket tests only
python tests/e2e_all_backends.py --ws-only

# Playwright browser tests only
python tests/e2e_all_backends.py --browser-only

# Agent mode (default is model)
python tests/e2e_all_backends.py --mode agent

# Single backend URL
python tests/e2e_all_backends.py --url https://your-backend.azurecontainerapps.io
```

Backend URLs default to the development deployment and can be overridden via environment variables.

## License

This project is licensed under the MIT License - see the [LICENSE](../LICENSE) file for details.

Copyright (c) Microsoft Corporation. All rights reserved.
