# JavaScript – MCP Quickstart

This sample demonstrates **MCP (Model Context Protocol) server integration** with Voice Live using the Azure AI Voice Live SDK for JavaScript (Node.js).

Like the Model Quickstart, this sample connects directly to a model (e.g. `gpt-realtime`) — but additionally configures remote MCP servers as tools, enabling the assistant to call external services (DeepWiki, Azure Docs) during the conversation. It implements a **voice-based approval flow** where the assistant verbally asks the user for permission before using tools that require consent.

## What Makes This Sample Unique

- **MCP Server Integration**: Configure remote MCP servers as session tools via raw tool objects
- **Voice-Based Approval**: Instead of blocking on a console prompt, the assistant verbally asks *"Do you approve?"* and interprets the user's spoken *yes* or *no*
- **Context-Aware Repeat Approvals**: When the model needs additional searches, the prompt changes to *"I need one more search. Should I continue?"*
- **MCP Tool Announcements**: For auto-approved tools, the assistant says a brief acknowledgement while the call runs
- **Barge-In Handling**: Interrupting during an MCP call triggers a *"Do you want to keep waiting or skip?"* inquiry
- **MCP Stall Detection**: If a tool call takes >15 seconds, the assistant proactively tells the user it's still waiting

## Voice UX Considerations for MCP Integration

Integrating MCP servers into a voice assistant introduces unique UX challenges that don't exist in text-based or console-based MCP clients. This quickstart demonstrates patterns to address them. When building your own voice-enabled MCP application, consider the following:

### Tool Approval Must Be Voice-Native

Console-based MCP samples typically use blocking `input()` or `readline` for approval — fine for a terminal demo, but it freezes the audio pipeline and breaks the voice experience. In a voice UX, approvals should be handled conversationally:

- Inject a system message instructing the model to **verbally ask for permission**
- Parse the user's spoken response for clear intent (`yes`, `no`, `stop`, `cancel`)
- Allow **barge-in** — the user should be able to say "yes" without waiting for the full approval prompt to finish

This quickstart uses word-boundary regex (`\byes\b`, `\b(no|stop|cancel)\b`) to avoid false positives from words like "yesterday" or "nobody".

### System Instructions Must Teach the Model About Approval

The model needs explicit instructions about the approval flow. Without them, it may paraphrase the permission request into a generic *"Let me look that up"* — skipping the actual question. This quickstart includes in the system prompt:

> *"Some tools require user approval. When you receive a system message asking you to request permission, you MUST clearly ask the user for their explicit approval. Never skip the approval question or assume permission is granted."*

The per-request system messages use `"Say exactly:"` phrasing to prevent the model from rewording the question.

### Repeated Tool Calls Need Contextual Messaging

MCP servers like Azure Docs may require multiple searches to gather complete information. Each search triggers a separate approval if `require_approval: "always"`. Rather than asking the identical question each time, this quickstart tracks the call count per server:

- **First call**: *"I'd like to search the azure_doc service. Do you approve?"*
- **Subsequent calls**: *"I need one more search for complete information. Should I continue?"*

The counter resets when results are fully delivered or the user denies a request.

### Silence During Tool Calls Must Be Filled

MCP tool calls can take 3–60+ seconds. Without feedback, the user thinks the assistant is broken. This quickstart uses two layers:

1. **Tool announcements** (immediate): For auto-approved servers, the assistant says *"Let me look that up"* when the call starts. Skipped for approval-required servers since the approval prompt already communicates.
2. **Stall detection** (client-side, 15s timer): If the MCP call takes >15 seconds, the assistant proactively says *"Still waiting for results..."*.

### Barge-In During MCP Calls

Users will naturally try to interrupt or ask *"Are you still there?"* during long tool calls. Rather than ignoring this, the quickstart injects a system message asking the model to check: *"Do you want to keep waiting or skip?"* The model handles the conversation naturally from there.

### Response Collision Handling

MCP flows generate rapid event sequences where `response.create` calls can collide with active responses. This quickstart defers collisions to the next `onResponseDone` event via a flag, ensuring tool results and approval prompts are never silently dropped.

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

## Sample Trigger Phrases

| Say this | MCP Server | Approval | What happens |
|---|---|---|---|
| *"Can you summarize the GitHub repo azure-sdk-for-python?"* | DeepWiki | Auto (`never`) | Assistant announces lookup, calls tools, speaks results |
| *"Search the Azure documentation for Voice Live API"* | Azure Docs | Voice prompt (`always`) | Assistant asks *"Do you approve?"*, waits for your *yes* or *no* |

## Troubleshooting

| Symptom | Resolution |
| --- | --- |
| Missing endpoint/authentication error | Verify `.env` values or pass CLI arguments. |
| SoX not found / microphone errors | Ensure SoX is installed and on your `PATH`. |
| `Audio dependencies are unavailable` | Install Visual Studio Build Tools with **Desktop development with C++**, then reinstall (`npm install --include=optional`). |
| MCP tool discovery failed | Check that MCP server URLs are reachable from your network. |
| Repeated approval prompts | Expected — the model may need multiple searches. Say *"no"* or *"stop"* to deny. |
| Session hit maximum duration | VoiceLive sessions have a 30-minute limit. Restart the sample. |
| `ERR_USE_AFTER_CLOSE` during shutdown | This can occur during Ctrl+C and is treated as a normal shutdown. |

## Additional Resources

- [Voice Live Documentation](https://learn.microsoft.com/azure/ai-services/speech-service/voice-live)
- [JavaScript SDK Documentation](https://learn.microsoft.com/javascript/api/overview/azure/ai-voicelive-readme)
- [Model Context Protocol](https://modelcontextprotocol.io/)
- [Support Guide](../../../SUPPORT.md)
