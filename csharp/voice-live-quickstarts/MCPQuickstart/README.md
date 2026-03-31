# MCP Quickstart

> **For common setup instructions, troubleshooting, and detailed information, see the [C# Samples README](../../README.md)**

This sample demonstrates **MCP (Model Context Protocol) server integration** with Voice Live using the Azure AI Voice Live SDK for C#.

Like the Model Quickstart, this sample connects directly to a model (e.g. `gpt-realtime`) — but additionally configures remote MCP servers as tools, enabling the assistant to call external services (DeepWiki, Azure Docs) during the conversation and prompting the user for approval when required.

## What Makes This Sample Unique

This sample showcases:

- **MCP Server Integration**: Configure remote MCP servers using `VoiceLiveMcpServerDefinition` in the session tools list
- **Approval Flow**: Interactive console-based approval for `RequireApproval = "always"` MCP tools
- **MCP Event Handling**: Process MCP tool discovery, execution, and result events via `SessionUpdate` pattern matching
- **Flexible Authentication**: Supports both API key and Azure credential authentication

## Prerequisites

- [AI Foundry resource](https://learn.microsoft.com/en-us/azure/ai-services/multi-service-resource)
- API key or [Azure CLI](https://learn.microsoft.com/cli/azure/install-azure-cli) for authentication
- See [C# Samples README](../../README.md) for common prerequisites

## Quick Start

1. **Update `appsettings.json`**:
   ```json
   {
     "VoiceLive": {
       "ApiKey": "your-voicelive-api-key",
       "Endpoint": "https://your-endpoint.services.ai.azure.com/",
       "Model": "gpt-realtime",
       "Voice": "en-US-Ava:DragonHDLatestNeural"
     }
   }
   ```

2. **Run the sample**:
   ```powershell
   dotnet build
   dotnet run
   ```

## Command Line Options

```powershell
# Run with API key (from appsettings.json)
dotnet run

# Run with Azure authentication
dotnet run -- --use-token-credential
```

### Available Options

- `--use-token-credential`: Use Azure authentication instead of API key

Configuration is managed via `appsettings.json` or environment variables (`AZURE_VOICELIVE_API_KEY`, `AZURE_VOICELIVE_ENDPOINT`, `AZURE_VOICELIVE_MODEL`, `AZURE_VOICELIVE_VOICE`).

### Available Models

- `gpt-realtime` - Latest GPT-realtime model (recommended)
- See documentation for all available models

## How It Works

The sample extends the Model Quickstart pattern with MCP:

1. **MCP Server Definitions**: Adds `VoiceLiveMcpServerDefinition` instances to `VoiceLiveSessionOptions.Tools`
2. **Session Configuration**: Sends session config with model, voice, VAD, and MCP tools via `ConfigureSessionAsync`
3. **Tool Discovery**: Voice Live connects to each MCP server and discovers available tools (`SessionUpdateMcpListToolsCompleted`)
4. **Tool Execution**: When the model decides to call an MCP tool, the service executes the call (`SessionUpdateResponseMcpCallInProgress` / `SessionUpdateResponseMcpCallCompleted`)
5. **Approval Flow**: For servers with `RequireApproval = "always"`, a `SessionResponseMcpApprovalRequestItem` is received and the user is prompted in the console
6. **Approval Response**: The approval/denial is sent back via `SendCommandAsync` with raw JSON

See [C# Samples README](../../README.md) for available voices, troubleshooting, and additional resources.

## Additional Resources

- [Voice Live Documentation](https://learn.microsoft.com/azure/ai-services/speech-service/voice-live)
- [.NET SDK Documentation](https://learn.microsoft.com/dotnet/api/overview/azure/ai.voicelive-readme)
- [Model Context Protocol](https://modelcontextprotocol.io/)
- [Support Guide](../../../SUPPORT.md)
