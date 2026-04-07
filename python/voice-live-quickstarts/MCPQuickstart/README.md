# Python – MCP Quickstart

> **For common setup instructions, troubleshooting, and detailed information, see the [Python Samples README](../../README.md)**

This sample demonstrates **MCP (Model Context Protocol) server integration** with Voice Live using the Azure AI Voice Live SDK for Python.

Like the Model Quickstart, this sample connects directly to a model (e.g. `gpt-realtime`) — but additionally configures remote MCP servers as tools, enabling the assistant to call external services (DeepWiki, Azure Docs) during the conversation. It implements a **voice-based approval flow** where the assistant verbally asks the user for permission before using tools that require consent.

## What Makes This Sample Unique

- **MCP Server Integration**: Configure remote MCP servers as session tools via `MCPServer` model objects
- **Voice-Based Approval**: Instead of blocking on a console prompt, the assistant verbally asks *"Do you approve?"* and interprets the user's spoken *yes* or *no*
- **Context-Aware Repeat Approvals**: When the model needs additional searches, the prompt changes to *"I need one more search. Should I continue?"*
- **MCP Tool Announcements**: For auto-approved tools, the assistant says a brief acknowledgement while the call runs
- **Barge-In Handling**: Interrupting during an MCP call prompts the assistant to acknowledge and reassure the user
- **MCP Stall Detection**: If a tool call takes >15 seconds, the assistant proactively tells the user it's still waiting
- **Interim Response**: Automatically enabled for non-realtime model pipelines to bridge latency gaps

## Voice UX Considerations for MCP Integration

Integrating MCP servers into a voice assistant introduces unique UX challenges that don't exist in text-based or console-based MCP clients.

MCP servers can be configured with different approval policies:
- **`require_approval: "never"`** — tool calls proceed automatically (e.g., DeepWiki in this sample)
- **`require_approval: "always"`** — every tool call requires explicit user consent before execution (e.g., Azure Docs in this sample)

In a text-based client, approval is typically a simple `y/n` console prompt. In a voice UX, this needs to be handled conversationally — and several additional challenges arise around latency, silence, and repeated calls. This quickstart demonstrates patterns to address them:

### Tool Approval Must Be Voice-Native

Console-based MCP samples typically use blocking `input()` for approval — fine for a terminal demo, but it freezes the audio pipeline and breaks the voice experience. In a voice UX, approvals should be handled conversationally:

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

MCP tool calls can take 3–60+ seconds. Without feedback, the user thinks the assistant is broken. This quickstart uses three complementary layers to keep the user informed throughout:

1. **Tool announcements** (immediate, client-side): For auto-approved servers, the assistant says *"Let me look that up"* when the call starts. Skipped for approval-required servers since the approval prompt already communicates. This covers the first few seconds.

2. **Interim response** (server-side, non-realtime models only): `LlmInterimResponseConfig` with `TOOL` and `LATENCY` triggers lets the service generate natural filler speech while tools run. Automatically skipped for `gpt-realtime` (not supported on the realtime pipeline). This fills the gap between the initial announcement and the stall timer.

3. **Stall detection** (client-side, repeating timer): If a tool call runs longer than expected, the assistant proactively tells the user it's still waiting. This quickstart uses a **10-second interval with a maximum of 3 notifications** — tune these values based on your expected MCP server latency:
   - **Fast servers (< 5s)**: Stall timer rarely fires. Consider increasing the interval or reducing max notifications.
   - **Medium servers (5–15s)**: The default 10s/3-max works well. The first notification arrives before most users lose patience.
   - **Slow servers (15–60s+)**: Consider shorter intervals (e.g. 8s) or more notifications (e.g. 5) to keep the user engaged. However, note that MCP calls **cannot be cancelled** — the notifications are status updates, not actionable options.

Together, these three layers ensure continuous feedback: the announcement handles seconds 0–5, interim response (when available) fills 2–10s, and the stall timer covers 10s+ with periodic reassurance.

### Batched Response After Tool Completion

When the model makes multiple MCP calls in a single turn (common with search-heavy servers), this quickstart waits for **all calls to complete** before generating a response. This prevents partial results from being spoken prematurely and avoids the model making additional tool calls based on incomplete data.

For approval-required servers, once the user approves the first call, subsequent calls to the **same server within the same turn are auto-approved** — avoiding repeated voice prompts for what is logically a single task.

### Barge-In During MCP Calls

Users will naturally try to interrupt or ask *"Are you still there?"* during long tool calls. Rather than ignoring this, the quickstart injects a system message so the model can acknowledge the user and respond to what they said. If the original MCP call completes later, its result is introduced as a **late result** (e.g. *"By the way, those results from earlier just came in..."*). Note: since MCP calls cannot be cancelled, the call continues running in the background regardless of what the user says.

### Response Collision Handling

MCP flows generate rapid event sequences where `response.create` calls can collide with active responses. This quickstart defers collisions to the next `RESPONSE_DONE` event via a flag, ensuring tool results and approval prompts are never silently dropped.

### MCP Server Selection: Latency Matters

Not all MCP servers are well-suited for voice UX. Servers that respond quickly (< 5 seconds) provide a seamless experience, while slow servers (10–60+ seconds) create awkward silence even with stall notifications. When choosing MCP servers for a voice assistant:

- **Prefer low-latency servers** — search APIs, simple lookups, and cached data sources work best
- **Avoid servers that perform heavy computation** — large repo analysis, complex document retrieval, or multi-step workflows can take 30–60+ seconds, degrading the voice experience
- **MCP calls cannot be cancelled** — once a call starts, it runs until the server responds or times out. There is no client-side or API-level cancellation mechanism
- **Late results arrive out of context** — if the user moves on during a slow MCP call, the result arrives asynchronously and must be introduced as a late result, which can feel disjointed
- **Consider whether async results are acceptable** for your use case. If users expect real-time answers, long-running MCP servers will frustrate them. If they expect a research-assistant style interaction where results trickle in, it may be acceptable

## Prerequisites

- [AI Foundry resource](https://learn.microsoft.com/en-us/azure/ai-services/multi-service-resource)
- API key or [Azure CLI](https://learn.microsoft.com/cli/azure/install-azure-cli) for authentication
- See [Python Samples README](../../README.md) for common prerequisites

## Quick Start

1. **Create and activate virtual environment**:
   ```bash
   python -m venv .venv

   # On Windows
   .venv\Scripts\activate

   # On Linux/macOS
   source .venv/bin/activate
   ```

2. **Install dependencies**:
   ```bash
   pip install -r requirements.txt
   ```

3. **Update `.env` file** (in the parent `voice-live-quickstarts/` folder):
   ```plaintext
   AZURE_VOICELIVE_ENDPOINT=https://your-endpoint.services.ai.azure.com/
   AZURE_VOICELIVE_API_KEY=your-api-key
   ```

4. **Run the sample**:
   ```bash
   python mcp-quickstart.py
   # or with Azure authentication:
   python mcp-quickstart.py --use-token-credential
   ```

## Command Line Options

| Flag | Description |
|---|---|
| `--api-key` | Azure VoiceLive API key (or set `AZURE_VOICELIVE_API_KEY` env var) |
| `--endpoint` | Azure VoiceLive endpoint (default: from `AZURE_VOICELIVE_ENDPOINT` env var) |
| `--model` | VoiceLive model to use (default: `gpt-realtime`) |
| `--voice` | Voice for the assistant (default: `en-US-Ava:DragonHDLatestNeural`) |
| `--instructions` | Custom system instructions for the AI |
| `--use-token-credential` | Use Azure authentication instead of API key |
| `--verbose` | Enable detailed logging |

## Sample Trigger Phrases

| Say this | MCP Server | Approval | What happens |
|---|---|---|---|
| *"What is the GitHub repo fastapi about?"* | DeepWiki | Auto (`never`) | Assistant announces lookup, calls tools, speaks results |
| *"Search the Azure documentation for Voice Live API"* | Azure Docs | Voice prompt (`always`) | Assistant asks *"Do you approve?"*, waits for your *yes* or *no* |

## How It Works

1. **MCP Server Definitions**: `MCPServer` instances added to the session tools list
2. **Session Configuration**: `session.update` with model, voice, VAD, MCP tools, and (for non-realtime models) interim response
3. **Tool Discovery**: Voice Live connects to each MCP server and discovers available tools
4. **Tool Announcements**: Auto-approved tool calls trigger a brief spoken acknowledgement
5. **Voice Approval**: For `require_approval="always"` servers, a system message is injected prompting the model to ask verbally. The user's spoken response is parsed for *yes*/*no* using word-boundary regex
6. **Result Delivery**: After MCP call completion, `response.create` kicks the model to speak the results

## Troubleshooting

| Symptom | Resolution |
|---|---|
| `❌ No audio input devices found` | Connect a microphone and restart. |
| Authentication errors | Run `az login` or verify `AZURE_VOICELIVE_API_KEY` in `.env`. |
| MCP tool discovery failed | Check that MCP server URLs are reachable from your network. |
| Repeated approval prompts | Expected — the model may need multiple searches. Say *"no"* or *"stop"* to deny. |
| Session hit maximum duration | VoiceLive sessions have a 30-minute limit. Restart the sample. |
| Interim response not supported | Expected with `gpt-realtime`. Use a non-realtime model for interim response. |
| Results take long or don't arrive | MCP server latency varies. Interrupt and ask the assistant what it found. |

See [Python Samples README](../../README.md) for available voices and additional troubleshooting.

## Additional Resources

- [Voice Live Documentation](https://learn.microsoft.com/azure/ai-services/speech-service/voice-live)
- [Python SDK Documentation](https://learn.microsoft.com/python/api/overview/azure/ai-voicelive-readme)
- [Model Context Protocol](https://modelcontextprotocol.io/)
- [Support Guide](../../../SUPPORT.md)
