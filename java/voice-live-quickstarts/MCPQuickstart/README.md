# MCP Quickstart

> **For common setup instructions, troubleshooting, and detailed information, see the [Java Samples README](../../README.md)**

This sample demonstrates **MCP (Model Context Protocol) server integration** with Voice Live using the Azure AI Voice Live SDK for Java.

Like the Model Quickstart, this sample connects directly to a model (e.g. `gpt-realtime`) — but additionally configures remote MCP servers as tools, enabling the assistant to call external services (DeepWiki, Azure Docs) during the conversation. It implements a **voice-based approval flow** where the assistant verbally asks the user for permission before using tools that require consent.

## What Makes This Sample Unique

- **MCP Server Integration**: Configure remote MCP servers using `MCPServer` in the session tools list
- **Voice-Based Approval**: Instead of blocking on `Scanner` input, the assistant verbally asks *"Do you approve?"* and interprets the user's spoken *yes* or *no*
- **Context-Aware Repeat Approvals**: When the model needs additional searches, the prompt changes to *"I need one more search. Should I continue?"*
- **MCP Tool Announcements**: For auto-approved tools, the assistant says a brief acknowledgement while the call runs
- **Barge-In Handling**: Interrupting during an MCP call triggers a *"Do you want to keep waiting or skip?"* inquiry
- **MCP Stall Detection**: If a tool call takes >15 seconds, the assistant proactively tells the user it's still waiting

## Voice UX Considerations for MCP Integration

Integrating MCP servers into a voice assistant introduces unique UX challenges that don't exist in text-based or console-based MCP clients.

MCP servers can be configured with different approval policies:
- **`require_approval: "never"`** — tool calls proceed automatically (e.g., DeepWiki in this sample)
- **`require_approval: "always"`** — every tool call requires explicit user consent before execution (e.g., Azure Docs in this sample)

In a text-based client, approval is typically a simple `y/n` console prompt. In a voice UX, this needs to be handled conversationally — and several additional challenges arise around latency, silence, and repeated calls. This quickstart demonstrates patterns to address them:

### Tool Approval Must Be Voice-Native

Console-based MCP samples typically use blocking `Scanner.nextLine()` for approval — fine for a terminal demo, but it freezes the audio pipeline and breaks the voice experience. In a voice UX, approvals should be handled conversationally:

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

MCP tool calls can take 3–60+ seconds. Without feedback, the user thinks the assistant is broken. This quickstart uses three layers:

1. **Tool announcements** (immediate): For auto-approved servers, the assistant says *"Let me look that up"* when the call starts. Skipped for approval-required servers since the approval prompt already communicates.
2. **Interim response** (server-side, non-realtime models only): `LlmInterimResponseConfig` with `TOOL` and `LATENCY` triggers generates natural filler. Automatically skipped for `gpt-realtime` (not supported on the realtime pipeline). The transcription model is also selected per pipeline: `azure-speech` for non-realtime, `whisper-1` for realtime.
3. **Stall detection** (client-side, repeating 15s timer): Notifies the user every 15 seconds while an MCP call is running. After 30 seconds, offers the user a choice to keep waiting or move on.

### Barge-In During MCP Calls

Users will naturally try to interrupt or ask *"Are you still there?"* during long tool calls. Rather than ignoring this, the quickstart injects a system message asking the model to check: *"Do you want to keep waiting or skip?"* The model handles the conversation naturally from there.

### Response Collision Handling

MCP flows generate rapid event sequences where `response.create` calls can collide with active responses. This quickstart defers collisions to the next `RESPONSE_DONE` event via a flag, ensuring tool results and approval prompts are never silently dropped.

## Prerequisites

- [Java 11](https://www.oracle.com/java/technologies/javase/jdk11-archive-downloads.html) or later
- [Maven 3.6+](https://maven.apache.org/download.cgi)
- [AI Foundry resource](https://learn.microsoft.com/azure/ai-services/multi-service-resource)
- API key or [Azure CLI](https://learn.microsoft.com/cli/azure/install-azure-cli) for authentication
- Audio input/output devices (microphone and speakers)
- See [Java Samples README](../../README.md) for common prerequisites

## Quick Start

1. **Configure credentials** via environment variables or `application.properties`:

   ```properties
   azure.voicelive.endpoint=https://your-endpoint.services.ai.azure.com/
   azure.voicelive.api-key=your-api-key-here
   ```

2. **Build and run**:

   ```bash
   mvn clean install
   mvn exec:java

   # Or with Azure authentication
   mvn exec:java -Dexec.args="--use-token-credential"
   ```

## Command Line Options

- `--api-key`: Azure VoiceLive API key (overrides application.properties)
- `--endpoint`: Azure VoiceLive endpoint URL (overrides application.properties)
- `--model`: VoiceLive model to use (default: `gpt-realtime`)
- `--voice`: Voice for the assistant (default: `en-US-Ava:DragonHDLatestNeural`)
- `--use-token-credential`: Use Azure authentication instead of API key

## Sample Trigger Phrases

| Say this | MCP Server | Approval | What happens |
|---|---|---|---|
| *"What is the GitHub repo fastapi about?"* | DeepWiki | Auto (`never`) | Assistant announces lookup, calls tools, speaks results |
| *"Search the Azure documentation for Voice Live API"* | Azure Docs | Voice prompt (`always`) | Assistant asks *"Do you approve?"*, waits for your *yes* or *no* |

## Troubleshooting

| Symptom | Resolution |
|---|---|
| `❌ No compatible microphone found` | Verify microphone is connected and available to Java audio. |
| Missing endpoint/authentication error | Set environment variables or update `application.properties`. |
| MCP tool discovery failed | Check that MCP server URLs are reachable from your network. |
| Repeated approval prompts | Expected — the model may need multiple searches. Say *"no"* or *"stop"* to deny. |
| Session hit maximum duration | VoiceLive sessions have a 30-minute limit. Restart the sample. |
| Maven build failures | Ensure Java 11+ and Maven 3.6+ are installed. |

For more troubleshooting guidance, see the [Java Samples README](../../README.md).

## Additional Resources

- [Azure AI Speech - Voice Live Documentation](https://learn.microsoft.com/azure/ai-services/speech-service/voice-live)
- [VoiceLive SDK Documentation](https://learn.microsoft.com/java/api/overview/azure/ai-voicelive-readme)
- [Model Context Protocol](https://modelcontextprotocol.io/)
- [Support Guide](../../../SUPPORT.md)
