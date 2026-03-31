# Python – MCP Quickstart

> **For common setup instructions, troubleshooting, and detailed information, see the [Python Samples README](../../README.md)**

This sample demonstrates **MCP (Model Context Protocol) server integration** with Voice Live using the Azure AI Voice Live SDK for Python.

Like the Model Quickstart, this sample connects directly to a model (e.g. `gpt-realtime`) — but additionally configures remote MCP servers as tools, enabling the assistant to call external services (DeepWiki, Azure Docs) during the conversation. It implements a **voice-based approval flow** where the assistant verbally asks the user for permission before using tools that require consent.

## What Makes This Sample Unique

- **MCP Server Integration**: Configure remote MCP servers as session tools via `MCPServer` model objects
- **Voice-Based Approval**: Instead of blocking on a console prompt, the assistant verbally asks *"Should I go ahead?"* and interprets the user's spoken *yes* or *no*
- **Context-Aware Repeat Approvals**: When the model needs additional searches, the prompt changes to *"I need one more search for complete info. Should I continue?"*
- **MCP Tool Announcements**: For auto-approved tools, the assistant says a brief acknowledgement while the call runs
- **Barge-In Handling**: Interrupting during an MCP call triggers a *"Do you want to keep waiting or skip?"* inquiry
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
   # or with Azure authentication:
   python mcp-quickstart.py --use-token-credential
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
| *"Can you summarize the GitHub repo azure-sdk-for-python?"* | DeepWiki | Auto (`never`) | Assistant announces lookup, calls tools, speaks results |
| *"Search the Azure documentation for Voice Live API"* | Azure Docs | Voice prompt (`always`) | Assistant asks *"Should I go ahead?"*, waits for your *yes* or *no* |

## How It Works

1. **MCP Server Definitions**: `MCPServer` instances added to the session tools list
2. **Session Configuration**: `session.update` with model, voice, VAD, MCP tools, and (for non-realtime models) interim response
3. **Tool Discovery**: Voice Live connects to each MCP server and discovers available tools
4. **Tool Announcements**: Auto-approved tool calls trigger a brief spoken acknowledgement
5. **Voice Approval**: For `require_approval="always"` servers, a system message is injected prompting the model to ask verbally. The user's spoken response is parsed for *yes*/*no* using word-boundary regex
6. **Result Delivery**: After MCP call completion, `response.create` kicks the model to speak the results

## Design Decisions: MCP in Voice UX

### Voice-Based Approval vs Console Prompts

The [SDK sample](https://github.com/Azure/azure-sdk-for-python/blob/main/sdk/voicelive/azure-ai-voicelive/samples/async_mcp_sample.py) uses blocking `input()` for approval — fine for a console demo, but it freezes the audio pipeline. This quickstart injects system messages to make the model ask verbally, then parses the next transcription for `\byes\b` or `\b(no|stop|cancel)\b` using word-boundary regex. Users can barge in with "yes" without waiting for the full prompt to finish.

### Context-Aware Repeat Approvals

MCP servers may require multiple tool calls to gather complete information. Rather than blocking repeated calls, this quickstart tracks the call count per server per user turn:
- **First call**: *"I need your permission to use X from Y. Should I go ahead?"*
- **Subsequent calls**: *"I need one more search for more complete information. Should I continue?"*

The counter resets when the user starts a new topic (speech without pending approval) or when the user denies a request.

### Tool Announcements (Auto-Approved Servers Only)

For servers with `require_approval="never"`, the assistant speaks a brief one-sentence acknowledgement when a tool call starts. This is skipped for approval-required servers since the approval prompt already communicates with the user.

### Barge-In During MCP Calls

If the user speaks while an MCP call is running, a system message asks the model to briefly check: *"Do you want to keep waiting or skip?"* The model handles the conversation naturally.

### Deferred Response Creation

`response.create` calls that collide with an active response are deferred to the next `RESPONSE_DONE` event via a `_needs_response_create` flag, avoiding "active response in progress" errors.

### Interim Response

`LlmInterimResponseConfig` with `TOOL` and `LATENCY` triggers is configured for non-realtime models. Automatically skipped for `gpt-realtime` (not supported on the realtime pipeline).

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
