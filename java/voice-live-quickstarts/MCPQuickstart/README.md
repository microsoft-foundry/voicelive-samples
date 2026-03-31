# MCP Quickstart

> **For common setup instructions, troubleshooting, and detailed information, see the [Java Samples README](../../README.md)**

This sample demonstrates **MCP (Model Context Protocol) server integration** with Voice Live using the Azure AI Voice Live SDK for Java.

Like the Model Quickstart, this sample connects directly to a model (e.g. `gpt-realtime`) — but additionally configures remote MCP servers as tools, enabling the assistant to call external services (DeepWiki, Azure Docs) during the conversation and prompting the user for approval when required.

## What Makes This Sample Unique

This sample showcases:

- **MCP Server Integration**: Configure remote MCP servers using `MCPServer` in the session tools list
- **Approval Flow**: Interactive console-based approval for `require_approval: "always"` MCP tools
- **MCP Event Handling**: Process MCP tool discovery, execution, and result events via `ServerEventType` values
- **Flexible Authentication**: Supports both API key and Azure credential authentication
- **Audio Processing**: Real-time microphone capture and speaker playback
- **Voice Activity Detection**: Interrupt handling and turn detection

## Prerequisites

- [Java 11](https://www.oracle.com/java/technologies/javase/jdk11-archive-downloads.html) or later
- [Maven 3.6+](https://maven.apache.org/download.cgi)
- [AI Foundry resource](https://learn.microsoft.com/azure/ai-services/multi-service-resource)
- API key or [Azure CLI](https://learn.microsoft.com/cli/azure/install-azure-cli) for authentication
- Audio input/output devices (microphone and speakers)
- See [Java Samples README](../../README.md) for common prerequisites

## Quick Start

1. **Update `application.properties`**:

   Copy `application.properties.sample` to `application.properties` and fill in your values:

   ```properties
   # Required: Your VoiceLive endpoint URL
   azure.voicelive.endpoint=https://your-endpoint.services.ai.azure.com/

   # Required: Your API key (if using API key authentication)
   azure.voicelive.api-key=your-api-key-here

   # Optional: Model name (default: gpt-realtime)
   # azure.voicelive.model=gpt-realtime

   # Optional: Voice name (default: en-US-Ava:DragonHDLatestNeural)
   # azure.voicelive.voice=en-US-Ava:DragonHDLatestNeural
   ```

2. **Build the project**:

   ```bash
   mvn clean install
   ```

3. **Run the sample**:

   ```bash
   # Run with API key (from application.properties)
   mvn exec:java

   # Run with Azure authentication
   mvn exec:java -Dexec.args="--use-token-credential"
   ```

## Command Line Options

```bash
# Run with API key (from application.properties)
mvn exec:java

# Run with Azure authentication
mvn exec:java -Dexec.args="--use-token-credential"

# Run with custom model
mvn exec:java -Dexec.args="--model gpt-realtime"

# Run with custom voice
mvn exec:java -Dexec.args="--voice en-US-Jenny:DragonHDLatestNeural"
```

### Available Options

- `--api-key`: Azure VoiceLive API key (overrides application.properties)
- `--endpoint`: Azure VoiceLive endpoint URL (overrides application.properties)
- `--model`: VoiceLive model to use (default: "gpt-realtime")
- `--voice`: Voice for the assistant (default: "en-US-Ava:DragonHDLatestNeural")
- `--use-token-credential`: Use Azure authentication instead of API key

### Available Models

- `gpt-realtime` - Latest GPT-realtime model (recommended)
- See documentation for all available models

## How It Works

The sample extends the Model Quickstart pattern with MCP:

1. **MCP Server Definitions**: Adds `MCPServer` instances to `VoiceLiveSessionOptions` tools list via `defineMCPServers()`
2. **Session Configuration**: Sends session config with model, voice, VAD, and MCP tools via `session.sendEvent()`
3. **Tool Discovery**: Voice Live connects to each MCP server and discovers available tools (`MCP_LIST_TOOLS_COMPLETED`)
4. **Tool Execution**: When the model decides to call an MCP tool, the service executes the call (`RESPONSE_MCP_CALL_IN_PROGRESS` / `RESPONSE_MCP_CALL_COMPLETED`)
5. **Approval Flow**: For servers with `require_approval: "always"`, a `mcp_approval_request` conversation item is received and the user is prompted in the console
6. **Approval Response**: The approval/denial is sent back via `session.sendEvent()` with `mcp_approval_response` JSON, followed by `response.create`

## Troubleshooting

### Common Issues

**Microphone not found**:

- Ensure your microphone is connected and properly configured
- Check system audio settings and permissions
- Try running the sample with administrator privileges

**Authentication errors**:

- Verify your API key or Azure credentials are correct
- Ensure your endpoint URL is properly formatted
- Check that your Azure subscription is active

**MCP tool discovery failed**:

- Check that MCP server URLs are reachable from your network
- Verify firewall and proxy settings allow outbound HTTPS

**Approval prompt not appearing**:

- Only servers with `require_approval: "always"` trigger the prompt
- The `deepwiki` server is configured with `"never"`, so calls proceed automatically

For more troubleshooting guidance, see the [Java Samples README](../../README.md).

## Additional Resources

- [Azure AI Speech - Voice Live Documentation](https://learn.microsoft.com/azure/ai-services/speech-service/voice-live)
- [VoiceLive SDK Documentation](https://learn.microsoft.com/java/api/overview/azure/ai-voicelive-readme)
- [Model Context Protocol](https://modelcontextprotocol.io/)
- [Support Guide](../../../SUPPORT.md)

## Code Structure

```text
MCPQuickstart/
├── src/main/java/MCPQuickstart.java  # Main application with all logic
├── pom.xml                           # Maven project configuration
├── application.properties            # Your configuration (create from sample)
└── README.md                         # This file
```

## Next Steps

- Explore the [Model Quickstart](../ModelQuickstart/) for the base pattern without MCP
- Explore the [Agents New Quickstart](../AgentsNewQuickstart/) for agent-based conversations
- Customize MCP server definitions for your own remote tools
- Adjust approval policies per server based on trust level

## Contributing

Interested in contributing? Please see our [Contributing Guidelines](../../../SUPPORT.md#contributing).
