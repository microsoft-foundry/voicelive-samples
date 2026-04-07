# JavaScript – Agents New Quickstart

This sample demonstrates the **Voice Live + Foundry Agent v2** flow using the Azure AI Voice Live SDK for JavaScript (Node.js). It contains two scripts:

- **`create-agent-with-voicelive.js`** – Creates (or updates) a Foundry agent and stores the Voice Live session configuration in the agent's metadata.
- **`voice-live-with-agent-v2.js`** – Connects to Voice Live using `AgentSessionConfig`, captures microphone audio, and plays back the agent's responses in real-time.

## Prerequisites

- [Node.js](https://nodejs.org/) 18 or later
- A working microphone and speakers
- [SoX](http://sox.sourceforge.net/) installed and on your `PATH` (used by `node-record-lpcm16` for microphone capture)
  - **Windows**: Download from the SoX website or via `choco install sox`
  - **macOS**: `brew install sox`
  - **Linux**: `sudo apt-get install sox`
- [Azure CLI](https://learn.microsoft.com/cli/azure/install-azure-cli) installed and logged in (`az login`)
- An [Azure AI Foundry project](https://learn.microsoft.com/azure/ai-studio/how-to/create-projects) with:
  - A model deployment (e.g., `gpt-4o-mini`)
  - A Voice Live endpoint

## Setup

1. **Install dependencies**:
   ```bash
   npm install
   ```

2. **Create a `.env` file** in this folder with the following variables:
   ```plaintext
   # Required for create-agent-with-voicelive.js
   PROJECT_ENDPOINT=https://<your-project>.services.ai.azure.com/
   AGENT_NAME=my-voice-agent
   MODEL_DEPLOYMENT_NAME=gpt-4o-mini

   # Required for voice-live-with-agent-v2.js
   VOICELIVE_ENDPOINT=https://<your-voicelive-endpoint>.services.ai.azure.com/
   PROJECT_NAME=<your-project-name>
   # AGENT_NAME is shared between both scripts

   # Optional for voice-live-with-agent-v2.js
   # AGENT_VERSION=
   # CONVERSATION_ID=
   # FOUNDRY_RESOURCE_OVERRIDE=
   # AGENT_AUTHENTICATION_IDENTITY_CLIENT_ID=
   # AUDIO_INPUT_DEVICE=Microphone
   ```

## Step 1 – Create an agent

Run the agent-creation script to register your agent and embed the Voice Live configuration in its metadata:

```bash
node create-agent-with-voicelive.js
```

Expected output:
```
Agent created: my-voice-agent (id: asst_...)

Voice Live configuration:
{
  "session": {
    "voice": { "name": "en-US-Ava:DragonHDLatestNeural", ... },
    ...
  }
}
```

The script stores the Voice Live session settings (voice, VAD, noise reduction, etc.) as chunked metadata entries on the agent so the service can apply them automatically at connection time.

## Step 2 – Run the voice assistant

Start the interactive voice assistant:

```bash
node voice-live-with-agent-v2.js
```

Expected output:
```
🎙️  Basic Foundry Voice Agent with Azure VoiceLive SDK (Agent Mode)
=================================================================
Configuration:
  VOICELIVE_ENDPOINT: https://...
  ...
[init] Connecting to VoiceLive with agent "my-voice-agent" for project "..." ...

=================================================================
🎤 VOICE ASSISTANT READY
Start speaking to begin conversation
Press Ctrl+C to exit
=================================================================
```

The assistant will:
1. Connect to Voice Live using your agent's configuration.
2. Play a proactive greeting.
3. Capture your microphone input and stream it to the agent.
4. Play back the agent's audio responses in real-time.
5. Support barge-in (interrupting the agent while it is speaking).

### With explicit microphone device (Windows/SoX)

```bash
node voice-live-with-agent-v2.js --audio-input-device "Microphone (Yeti X)"
```

### List available audio input devices (Windows)

```bash
node voice-live-with-agent-v2.js --list-audio-devices
```

### Smoke test without local audio devices

```bash
node voice-live-with-agent-v2.js --no-audio
```

### Pre-defined greeting instead of LLM-generated

```bash
node voice-live-with-agent-v2.js --greeting-text "Welcome! How can I help?"
```

### Show all CLI options

```bash
node voice-live-with-agent-v2.js --help
```

## Command Line Options

All settings can be provided via environment variables (`.env`) or CLI flags. CLI flags take precedence.

| Flag | Description |
|---|---|
| `--endpoint` | VoiceLive endpoint URL |
| `--agent-name` | Foundry agent name |
| `--project-name` | Foundry project name |
| `--agent-version` | Agent version |
| `--conversation-id` | Resume a previous conversation |
| `--foundry-resource` | Foundry resource override |
| `--auth-client-id` | Authentication identity client ID |
| `--audio-input-device` | Explicit SoX input device name (use when default device is not configured) |
| `--list-audio-devices` | List available audio input devices on Windows and exit |
| `--greeting-text` | Send a pre-defined greeting instead of LLM-generated |
| `--no-audio` | Connect and configure session without mic/speaker (smoke test) |
| `-h, --help` | Show help text |

Conversation transcripts and session details are written to a timestamped file in the `logs/` subfolder.

Press **Ctrl+C** to exit gracefully.

## Environment Variables Reference

### `create-agent-with-voicelive.js`

| Variable | Required | Description |
|---|---|---|
| `PROJECT_ENDPOINT` | ✅ | Azure AI Foundry project endpoint URL |
| `AGENT_NAME` | ✅ | Name of the agent to create |
| `MODEL_DEPLOYMENT_NAME` | ✅ | Model deployment name (e.g., `gpt-4o-mini`) |

### `voice-live-with-agent-v2.js`

| Variable | Required | Description |
|---|---|---|
| `VOICELIVE_ENDPOINT` | ✅ | Voice Live service endpoint URL |
| `AGENT_NAME` | ✅ | Name of the agent to connect to |
| `PROJECT_NAME` | ✅ | Azure AI Foundry project name |
| `AGENT_VERSION` | ☐ | Pin to a specific agent version |
| `CONVERSATION_ID` | ☐ | Resume a previous conversation |
| `FOUNDRY_RESOURCE_OVERRIDE` | ☐ | Cross-resource Foundry endpoint |
| `AGENT_AUTHENTICATION_IDENTITY_CLIENT_ID` | ☐ | Managed identity client ID for cross-resource auth |

## Troubleshooting

| Symptom | Resolution |
|---|---|
| `Set VOICELIVE_ENDPOINT, AGENT_NAME, and PROJECT_NAME` | Check your `.env` file contains all required variables. |
| SoX not found / microphone errors | Ensure SoX is installed and available on your `PATH`. |
| `sox has exited with error code 1` | SoX cannot find the default recording device. Run `--list-audio-devices` to see available devices, then pass the device name with `--audio-input-device`. |
| Authentication errors | Run `az login` and ensure your account has access to the Foundry project. |
| Agent not found | Run `create-agent-with-voicelive.js` first to create the agent, or verify `AGENT_NAME` matches an existing agent. |
| `ERR_USE_AFTER_CLOSE` on exit | This is expected when pressing Ctrl+C; the process exits cleanly. |

## Additional Resources

- [Voice Live Documentation](https://learn.microsoft.com/azure/ai-services/speech-service/voice-live)
- [Azure AI Foundry Documentation](https://learn.microsoft.com/azure/ai-studio/)
- [JavaScript SDK Documentation](https://learn.microsoft.com/javascript/api/overview/azure/ai-voicelive-readme)
- [Support Guide](../../../SUPPORT.md)
