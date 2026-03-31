# Python – MCP Quickstart

> **For common setup instructions, troubleshooting, and detailed information, see the [Python Samples README](../../README.md)**

This sample demonstrates **MCP (Model Context Protocol) server integration** with Voice Live using the Azure AI Voice Live SDK for Python.

Like the Model Quickstart, this sample connects directly to a model (e.g. `gpt-realtime`) — but additionally configures remote MCP servers as tools, enabling the assistant to call external services (DeepWiki, Azure Docs) during the conversation. It implements a **voice-based approval flow** where the assistant verbally asks the user for permission before using tools that require consent.

## What Makes This Sample Unique

This sample showcases:

- **MCP Server Integration**: Configure remote MCP servers as session tools via `MCPServer` model objects
- **Voice-Based Approval**: Instead of blocking on a console prompt, the assistant verbally asks *"Should I go ahead?"* and interprets the user's spoken *yes* or *no*
- **MCP Tool Announcements**: For auto-approved tools, the assistant says *"Let me look that up..."* while the call runs
- **Barge-In Handling**: Interrupting during an MCP call triggers a *"Do you want to keep waiting or skip?"* inquiry
- **Per-Turn Loop Prevention**: Approval-required servers are guarded against repeated tool calls per user turn
- **Interim Response**: Automatically enabled for non-realtime model pipelines to bridge latency gaps

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
   ```

## Run

### API key authentication

```bash
python mcp-quickstart.py
```

### Azure credential authentication

```bash
az login
python mcp-quickstart.py --use-token-credential
```

### With verbose logging

```bash
python mcp-quickstart.py --use-token-credential --verbose
```

## Command Line Options

- `--api-key`: Azure VoiceLive API key (or set `AZURE_VOICELIVE_API_KEY` env var)
- `--endpoint`: Azure VoiceLive endpoint (default: from `AZURE_VOICELIVE_ENDPOINT` env var)
- `--model`: VoiceLive model to use (default: `gpt-realtime`)
- `--voice`: Voice for the assistant (default: `en-US-Ava:DragonHDLatestNeural`)
- `--instructions`: Custom system instructions for the AI
- `--use-token-credential`: Use Azure authentication instead of API key
- `--verbose`: Enable detailed logging

## Sample Trigger Phrases

| Say this | MCP Server | Approval | What happens |
|---|---|---|---|
| *"Can you summarize the GitHub repo azure-sdk-for-python?"* | DeepWiki | Auto (`never`) | Assistant announces lookup, calls `read_wiki_structure` → `ask_question`, speaks results |
| *"Search the Azure documentation for Voice Live API"* | Azure Docs | Voice prompt (`always`) | Assistant asks *"Should I go ahead?"*, waits for your *yes* or *no* |

## How It Works

The sample extends the Model Quickstart pattern with MCP:

1. **MCP Server Definitions**: Adds `MCPServer` instances to the session tools list alongside standard session configuration
2. **Session Configuration**: Sends `session.update` with model, voice, VAD, MCP tools, and (for non-realtime models) interim response
3. **Tool Discovery**: Voice Live connects to each MCP server and discovers available tools
4. **Tool Announcements**: When an auto-approved tool call starts, the assistant speaks a brief acknowledgement
5. **Voice Approval Flow**: For `require_approval="always"` servers, a system message is injected asking the model to verbally request permission. The user's spoken response is parsed for *yes*/*no* (word-boundary matching)
6. **Result Delivery**: After MCP call completion, `response.create` kicks the model to speak the results

## Design Decisions: MCP in Voice UX

This quickstart demonstrates several design patterns specific to integrating MCP servers in a voice-first experience:

### Voice-Based Approval vs Console Prompts

The [SDK sample](https://github.com/Azure/azure-sdk-for-python/blob/main/sdk/voicelive/azure-ai-voicelive/samples/async_mcp_sample.py) uses blocking `input()` for approval — fine for a console demo, but it freezes the audio pipeline. This quickstart instead:

- Injects a system message prompting the model to ask verbally
- Waits for the next `CONVERSATION_ITEM_INPUT_AUDIO_TRANSCRIPTION_COMPLETED` event
- Parses for `\byes\b` or `\bno\b` using word-boundary regex
- On ambiguous input, re-prompts via voice

### Per-Turn Loop Prevention (Approval Servers Only)

MCP tool calls that require approval can cause loops: approve → call completes → `response.create` → model calls the same tool again → new approval needed. This quickstart guards **only approval-required servers** against repeated calls in the same user turn. Auto-approved servers (like DeepWiki) are allowed to make multiple calls freely, since their multi-step patterns (e.g. `read_wiki_structure` → `ask_question`) are useful and don't interrupt the user.

### Deferred Response Creation

The approval voice prompt requires `response.create` to make the model speak. If a response is already active (common during MCP flows), the prompt is deferred to the next `RESPONSE_DONE` event via an `_approval_prompt_needed` flag. The same pattern applies to `response.create` after MCP completion — if it collides with an active response, it's retried at `RESPONSE_DONE`.

### Approval Queuing

If the model fires multiple tool calls requiring approval before the user can respond, subsequent requests are queued and asked one-by-one after each resolution. This avoids auto-approving without consent.

### Barge-In During MCP Calls

If the user speaks while an MCP call is running, the assistant asks whether to keep waiting or skip. If the user barges in during an unanswered approval prompt, the approval is re-queued and re-asked after the user's turn completes.

### Interim Response

`LlmInterimResponseConfig` with `TOOL` and `LATENCY` triggers is configured to bridge silence during tool calls. This is automatically skipped for `gpt-realtime` (not supported on the realtime pipeline) and enabled for other models.

## Troubleshooting

| Symptom | Resolution |
|---|---|
| `❌ No audio input devices found` | Connect a microphone and restart. |
| `❌ No audio output devices found` | Connect speakers or headphones and restart. |
| Authentication errors | Run `az login` or verify `AZURE_VOICELIVE_API_KEY` in `.env`. |
| MCP tool discovery failed | Check that MCP server URLs are reachable from your network. |
| Assistant doesn't ask for approval | Only servers with `require_approval="always"` trigger the voice prompt. |
| Repeated approval prompts for same tool | Expected if the model decides to search again. The per-turn guard limits this to once per approval-required tool per user turn. |
| Session hit maximum duration | VoiceLive sessions have a 30-minute server-side limit. Restart the sample. |
| Interim response not supported | Expected with `gpt-realtime`. Use a non-realtime model (e.g. `gpt-4o-mini`) for interim response support. |

## Additional Resources

- [Voice Live Documentation](https://learn.microsoft.com/azure/ai-services/speech-service/voice-live)
- [Python SDK Documentation](https://learn.microsoft.com/python/api/overview/azure/ai-voicelive-readme)
- [Model Context Protocol](https://modelcontextprotocol.io/)
- [Support Guide](../../../SUPPORT.md)
