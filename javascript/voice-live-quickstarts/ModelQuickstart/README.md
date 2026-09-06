# JavaScript – Model Quickstart

This sample demonstrates **direct Voice Live model integration** using the stable Azure AI Voice Live SDK for JavaScript (Node.js).

Unlike the agent quickstart, this flow connects directly to a model (for example `gpt-realtime`) and configures instructions, voice, and turn detection at runtime.

## Prerequisites

- [Node.js](https://nodejs.org/) 18 or later
- A working microphone and speakers
- [SoX](http://sox.sourceforge.net/) installed and available on your `PATH` (used by `node-record-lpcm16`)
  - **Windows**: Download from the SoX website or install with `choco install sox`
  - **macOS**: `brew install sox`
  - **Linux**: `sudo apt-get install sox`
- Voice Live endpoint and either:
  - API key authentication, or
  - Azure CLI authentication (`az login`) for `DefaultAzureCredential`

## Setup

- **Install dependencies**:

```bash
npm install
```

If native audio modules cannot compile in your environment, you can still run a cloud connectivity smoke test with `--no-audio`. For automated Windows setup (Node.js, SoX, Build Tools), see the [helper scripts](../helper-scripts/).

- **Create a `.env` file** in this folder:

```plaintext
AZURE_VOICELIVE_ENDPOINT=https://<your-endpoint>.services.ai.azure.com/
AZURE_VOICELIVE_API_KEY=<your-api-key>
AZURE_VOICELIVE_MODEL=gpt-realtime
AZURE_VOICELIVE_VOICE=en-US-Ava:DragonHDLatestNeural
AZURE_VOICELIVE_INSTRUCTIONS=You are a helpful AI assistant. Respond naturally and conversationally.
# Optional (Windows/SoX): explicit microphone device name
# AUDIO_INPUT_DEVICE=Microphone
```

## Run

### API key authentication

```bash
node model-quickstart.js
```

### Azure credential authentication

```bash
az login
node model-quickstart.js --use-token-credential
```

### With custom model, voice, and instructions

```bash
node model-quickstart.js --model gpt-realtime --voice en-US-JennyNeural --instructions "You are a concise support assistant"
```

### With explicit microphone device (Windows/SoX)

```bash
node model-quickstart.js --audio-input-device "Microphone"
```

### Smoke test without local audio devices/build tools

```bash
node model-quickstart.js --no-audio
```

### List available audio input devices (Windows)

```bash
node model-quickstart.js --list-audio-devices
```

### Proactive greeting (LLM-generated)

By default, the assistant speaks first with a dynamically generated welcome message (same pattern as the AgentsNewQuickstart). No flag needed:

```bash
node model-quickstart.js
```

### Proactive greeting (pre-defined text)

Send a deterministic, branded greeting instead of LLM-generated:

```bash
node model-quickstart.js --greeting-text "Welcome! I'm your AI assistant. How can I help you today?"
```

## Command Line Options

- `--api-key`: Azure Voice Live API key
- `--endpoint`: Azure Voice Live endpoint URL
- `--model`: Voice Live model to use (default: `gpt-realtime`)
- `--voice`: Voice for the assistant
- `--instructions`: System instructions for the model session
- `--audio-input-device`: Explicit SoX input device name (use when default device is not configured)
- `--list-audio-devices`: List available audio input devices on Windows and exit
- `--greeting-text`: Send a pre-defined greeting instead of LLM-generated
- `--use-token-credential`: Use `DefaultAzureCredential` instead of API key
- `--no-audio`: Connect and configure session without mic/speaker (for smoke tests)

## What This Sample Demonstrates

- Direct model session (`model` mode, no Foundry agent dependency)
- Session configuration for:
  - text + audio modalities
  - PCM16 input/output audio
  - server VAD turn detection
  - echo cancellation + noise reduction
  - input audio transcription (`azure-speech`)
- Real-time microphone streaming and speaker playback
- Barge-in handling (service-managed response interruption and immediate local playback cleanup)
- Proactive greeting support (default: on):
  - LLM-generated (default) — adaptive, context-aware greetings
  - Pre-defined (`--greeting-text`) — deterministic, branded messaging
- Conversation and transcript logging to `logs/`

## Troubleshooting

| Symptom | Resolution |
| --- | --- |
| Missing endpoint/authentication error | Verify `.env` values or pass CLI arguments. |
| SoX not found / microphone errors | Ensure SoX is installed and on your `PATH`. |
| `Audio dependencies are unavailable` | Install Visual Studio Build Tools with **Desktop development with C++**, then reinstall (`npm install --include=optional`). |
| Authentication errors with token credential | Run `az login` and verify resource access. |
| `ERR_USE_AFTER_CLOSE` during shutdown | This can occur during Ctrl+C and is treated as a normal shutdown. |

## Additional Resources

- [Voice Live Documentation](https://learn.microsoft.com/azure/ai-services/speech-service/voice-live)
- [JavaScript SDK Documentation](https://learn.microsoft.com/javascript/api/overview/azure/ai-voicelive-readme)
- [Support Guide](../../../SUPPORT.md)
