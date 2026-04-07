# JavaScript – MCP Quickstart

> **For common setup instructions, troubleshooting, and detailed information, see the [JavaScript Samples README](../../README.md)**

This sample demonstrates **MCP (Model Context Protocol) server integration** with Voice Live using the Azure AI Voice Live SDK for JavaScript (Node.js).

Like the Model Quickstart, this sample connects directly to a model (e.g. `gpt-realtime`) — but additionally configures remote MCP servers as tools, enabling the assistant to call external services (DeepWiki, Azure Docs) during the conversation. It implements a **voice-based approval flow** where the assistant verbally asks the user for permission before using tools that require consent.

## What Makes This Sample Unique

- **MCP Server Integration**: Configure remote MCP servers as session tools via raw tool objects
- **Voice-Based Approval**: Instead of blocking on a console prompt, the assistant verbally asks *"Do you approve?"* and interprets the user's spoken *yes* or *no*
- **Context-Aware Repeat Approvals**: When the model needs additional searches, the prompt changes to *"I need one more search. Should I continue?"*
- **MCP Tool Announcements**: For auto-approved tools, the assistant says a brief acknowledgement while the call runs
- **Barge-In Handling**: Interrupting during an MCP call prompts the assistant to acknowledge and reassure the user
- **MCP Stall Detection**: If a tool call takes >15 seconds, the assistant proactively tells the user it's still waiting

## Voice UX Considerations for MCP Integration

Integrating MCP servers into a voice assistant introduces unique UX challenges that don't exist in text-based or console-based MCP clients.

MCP servers can be configured with different approval policies:
- **`require_approval: "never"`** — tool calls proceed automatically (e.g., DeepWiki in this sample)
- **`require_approval: "always"`** — every tool call requires explicit user consent before execution (e.g., Azure Docs in this sample)

In a text-based client, approval is typically a simple `y/n` console prompt. In a voice UX, this needs to be handled conversationally — and several additional challenges arise around latency, silence, and repeated calls. This quickstart demonstrates patterns to address them:

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

MCP servers may require multiple searches to gather complete information. Each search triggers a separate approval if `require_approval="always"`. Rather than asking the identical question each time, this quickstart tracks the call count per server:

- **First call**: *"I'd like to search the azure_doc service. Do you approve?"*
- **Subsequent calls**: *"I need one more search for complete information. Should I continue?"*
- **After 3 approved calls**: Auto-denied to prevent infinite loops — the model responds with what it has

The counter resets when results are fully delivered or the user denies a request.

### Silence During Tool Calls Must Be Filled

MCP tool calls can take 3–60+ seconds. Without feedback, the user thinks the assistant is broken. This quickstart uses two complementary layers to keep the user informed throughout:

1. **Tool announcements** (immediate, client-side): For auto-approved servers, the assistant says *"Let me look that up"* when the call starts. Skipped for approval-required servers since the approval prompt already communicates. This covers the first few seconds.

2. **Stall detection** (client-side, repeating timer): If a tool call runs longer than expected, the assistant proactively tells the user it's still waiting. This quickstart uses a **10-second interval with a maximum of 3 notifications** — tune these values based on your expected MCP server latency:
   - **Fast servers (< 5s)**: Stall timer rarely fires. Consider increasing the interval or reducing max notifications.
   - **Medium servers (5–15s)**: The default 10s/3-max works well. The first notification arrives before most users lose patience.
   - **Slow servers (15–60s+)**: Consider shorter intervals (e.g. 8s) or more notifications (e.g. 5) to keep the user engaged. However, note that MCP calls **cannot be cancelled** — the notifications are status updates, not actionable options.

Together, these two layers ensure continuous feedback: the announcement handles seconds 0–5, and the stall timer covers 10s+ with periodic reassurance.

### Batched Response After Tool Completion

When the model makes multiple MCP calls in a single turn (common with search-heavy servers), this quickstart waits for **all calls to complete** before generating a response. This prevents partial results from being spoken prematurely and avoids the model making additional tool calls based on incomplete data.

For approval-required servers, once the user approves the first call, subsequent calls to the **same server within the same turn are auto-approved** — avoiding repeated voice prompts for what is logically a single task.

### Barge-In During MCP Calls

Users will naturally try to interrupt or ask *"Are you still there?"* during long tool calls. Rather than ignoring this, the quickstart injects a system message so the model can acknowledge the user and respond to what they said. If the original MCP call completes later, its result is introduced as a **late result** (e.g. *"By the way, those results from earlier just came in..."*). Note: since MCP calls cannot be cancelled, the call continues running in the background regardless of what the user says.

Barge-in in the MCP quickstart is more complex than in the Model or Agents quickstarts. Those simpler samples have a trivial `onResponseDone` handler (just reset flags), so cancelling a response is straightforward — the cancelled response's `onResponseDone` is a harmless no-op. In the MCP quickstart, `onResponseDone` processes **deferred actions** — pending approval prompts, queued MCP results, and deferred `response.create` calls. Without protection, the cancelled response's `onResponseDone` would immediately trigger a new response that overlaps the user's speech.

To prevent this, the quickstart uses a `_bargeInActive` flag:
1. **Set `true`** in `onInputAudioBufferSpeechStarted` just before calling `response.cancel`
2. **Checked** at the top of `onResponseDone` — if set, all deferred processing is skipped and the flag is cleared
3. All deferred flags (`_needsResponseCreate`, `_mcpResultsPending`) are also cleared unconditionally on barge-in

This ensures the cancelled response exits cleanly without side effects, and the user's new turn drives the next response.

### Response Collision Handling

MCP flows generate rapid event sequences where `response.create` calls can collide with active responses. This quickstart defers collisions to the next `onResponseDone` event via a flag, ensuring tool results and approval prompts are never silently dropped.

### MCP Server Selection: Latency Matters

Not all MCP servers are well-suited for voice UX. Servers that respond quickly (< 5 seconds) provide a seamless experience, while slow servers (10–60+ seconds) create awkward silence even with stall notifications. When choosing MCP servers for a voice assistant:

- **Prefer low-latency servers** — search APIs, simple lookups, and cached data sources work best
- **Avoid servers that perform heavy computation** — large repo analysis, complex document retrieval, or multi-step workflows can take 30–60+ seconds, degrading the voice experience
- **MCP calls cannot be cancelled** — once a call starts, it runs until the server responds or times out. There is no client-side or API-level cancellation mechanism
- **Late results arrive out of context** — if the user moves on during a slow MCP call, the result arrives asynchronously and must be introduced as a late result, which can feel disjointed
- **Consider whether async results are acceptable** for your use case. If users expect real-time answers, long-running MCP servers will frustrate them. If they expect a research-assistant style interaction where results trickle in, it may be acceptable

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

## Quick Start

1. **Install dependencies**:
   ```bash
   npm install
   ```

   If native audio modules cannot compile in your environment, you can still run a cloud connectivity smoke test with `--no-audio`. For automated Windows setup (Node.js, SoX, Build Tools), see the [helper scripts](../helper-scripts/).

2. **Create a `.env` file** in this folder:

```plaintext
AZURE_VOICELIVE_ENDPOINT=https://<your-endpoint>.services.ai.azure.com/
AZURE_VOICELIVE_API_KEY=<your-api-key>
AZURE_VOICELIVE_MODEL=gpt-realtime
AZURE_VOICELIVE_VOICE=en-US-Ava:DragonHDLatestNeural

# Optional
# AUDIO_INPUT_DEVICE=Microphone
```

3. **Run the sample**:
   ```bash
   node mcp-quickstart.js
   # or with Azure authentication:
   az login
   node mcp-quickstart.js --use-token-credential
   ```

## Run Examples

### With explicit microphone device (Windows/SoX)

```bash
node mcp-quickstart.js --audio-input-device "Microphone (Yeti X)"
```

### List available audio input devices (Windows)

```bash
node mcp-quickstart.js --list-audio-devices
```

### Smoke test without local audio devices

```bash
node mcp-quickstart.js --no-audio
```

### Show all CLI options

```bash
node mcp-quickstart.js --help
```

## Command Line Options

All settings can be provided via environment variables (`.env`) or CLI flags. CLI flags take precedence.

| Flag | Description |
|---|---|
| `--api-key` | Azure Voice Live API key |
| `--endpoint` | Azure Voice Live endpoint URL |
| `--model` | Voice Live model to use (default: `gpt-realtime`) |
| `--voice` | Voice for the assistant (default: `en-US-Ava:DragonHDLatestNeural`) |
| `--instructions` | System instructions for the model session |
| `--audio-input-device` | Explicit SoX input device name (use when default device is not configured) |
| `--list-audio-devices` | List available audio input devices on Windows and exit |
| `--use-token-credential` | Use `DefaultAzureCredential` instead of API key |
| `--no-audio` | Connect and configure session without mic/speaker (smoke test) |
| `-h, --help` | Show help text |

## Sample Trigger Phrases

| Say this | MCP Server | Approval | What happens |
|---|---|---|---|
| *"What is the GitHub repo fastapi about?"* | DeepWiki | Auto (`never`) | Assistant announces lookup, calls tools, speaks results |
| *"Search the Azure documentation for Voice Live API"* | Azure Docs | Voice prompt (`always`) | Assistant asks *"Do you approve?"*, waits for your *yes* or *no* |

## How It Works

1. **MCP Server Definitions**: MCP server tool objects added to the session tools array
2. **Session Configuration**: `session.update` with model, voice, VAD, and MCP tools
3. **Tool Discovery**: Voice Live connects to each MCP server and discovers available tools
4. **Tool Announcements**: Auto-approved tool calls trigger a brief spoken acknowledgement
5. **Voice Approval**: For `require_approval="always"` servers, a system message is injected prompting the model to ask verbally. The user's spoken response is parsed for *yes*/*no* using word-boundary regex
6. **Result Delivery**: After MCP call completion, `response.create` kicks the model to speak the results

## Known Limitations

- **Brief audio overlap on barge-in**: When interrupting the assistant, a short burst of audio (50–200ms) may continue playing before stopping. This is inherent to the Node.js `speaker` module — once PCM data has been handed off to the OS audio driver buffer, it cannot be flushed from userspace JavaScript. The quickstart minimizes this by using `destroy()` (immediate discard) instead of `end()` (graceful drain) and by suppressing deferred response creation via the `_bargeInActive` flag, but a small overlap is unavoidable at the Node.js level.

## Troubleshooting

| Symptom | Resolution |
| --- | --- |
| Missing endpoint/authentication error | Verify `.env` values or pass CLI arguments. |
| SoX not found / microphone errors | Ensure SoX is installed and on your `PATH`. |
| `sox has exited with error code 1` | SoX cannot find the default recording device. Run `--list-audio-devices` to see available devices, then pass the device name with `--audio-input-device`. |
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
