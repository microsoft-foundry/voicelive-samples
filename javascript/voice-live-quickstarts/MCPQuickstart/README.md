# JavaScript – MCP Quickstart

This sample demonstrates **MCP (Model Context Protocol) server integration** with Voice Live using the Azure AI Voice Live SDK for JavaScript (Node.js).

Like the Model Quickstart, this sample connects directly to a model (e.g. `gpt-realtime`) — but additionally configures remote MCP servers as tools, enabling the assistant to call external services (DeepWiki, Azure Docs) during the conversation and prompting the user for approval when required.

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
AZURE_VOICELIVE_INSTRUCTIONS=You are a helpful AI assistant with access to MCP tools. Use the tools to help answer user questions. Respond naturally and conversationally.
# Optional (Windows/SoX): explicit microphone device name
# AUDIO_INPUT_DEVICE=Microphone
```

## Run

### API key authentication

```bash
node mcp-quickstart.js
```

### Azure credential authentication

```bash
az login
node mcp-quickstart.js --use-token-credential
```

### Smoke test without local audio devices/build tools

```bash
node mcp-quickstart.js --no-audio
```

## Command Line Options

- `--api-key`: Azure Voice Live API key
- `--endpoint`: Azure Voice Live endpoint URL
- `--model`: Voice Live model to use (default: `gpt-realtime`)
- `--voice`: Voice for the assistant (default: `en-US-Ava:DragonHDLatestNeural`)
- `--instructions`: System instructions for the model session
- `--audio-input-device`: Explicit SoX input device name (use when default device is not configured)
- `--use-token-credential`: Use `DefaultAzureCredential` instead of API key
- `--no-audio`: Connect and configure session without mic/speaker (for smoke tests)

## What This Sample Demonstrates

- Direct model session with MCP servers added to the tools list
- Session configuration for:
  - text + audio modalities
  - PCM16 input/output audio
  - server VAD turn detection
  - echo cancellation + noise reduction
  - input audio transcription (`azure-speech`)
- **MCP-specific features:**
  - Defining MCP servers with `type: "mcp"` in the tools array
  - `require_approval: "never"` vs `"always"` per server
  - `allowed_tools` to restrict which tools are exposed
  - MCP tool discovery events (`onMcpListToolsCompleted` / `onMcpListToolsFailed`)
  - MCP tool call events (`onResponseMcpCallInProgress` / `onResponseMcpCallCompleted` / `onResponseMcpCallFailed`)
  - Interactive approval flow for `mcp_approval_request` conversation items
- Real-time microphone streaming and speaker playback
- Barge-in handling (`response.cancel` when user interrupts)

## Troubleshooting

| Symptom | Resolution |
| --- | --- |
| Missing endpoint/authentication error | Verify `.env` values or pass CLI arguments. |
| SoX not found / microphone errors | Ensure SoX is installed and on your `PATH`. |
| `Audio dependencies are unavailable` | Install Visual Studio Build Tools with **Desktop development with C++**, then reinstall (`npm install --include=optional`). |
| Authentication errors with token credential | Run `az login` and verify resource access. |
| MCP tool discovery failed | Check that MCP server URLs are reachable from your network. |
| Approval prompt not appearing | Only servers with `require_approval: "always"` trigger the prompt. |
| `ERR_USE_AFTER_CLOSE` during shutdown | This can occur during Ctrl+C and is treated as a normal shutdown. |

## Additional Resources

- [Voice Live Documentation](https://learn.microsoft.com/azure/ai-services/speech-service/voice-live)
- [JavaScript SDK Documentation](https://learn.microsoft.com/javascript/api/overview/azure/ai-voicelive-readme)
- [Model Context Protocol](https://modelcontextprotocol.io/)
- [Support Guide](../../../SUPPORT.md)
