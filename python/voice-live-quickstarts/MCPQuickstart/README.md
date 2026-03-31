# Python – MCP Quickstart

> **For common setup instructions, troubleshooting, and detailed information, see the [Python Samples README](../../README.md)**

This sample demonstrates **MCP (Model Context Protocol) server integration** with Voice Live using the Azure AI Voice Live SDK for Python.

Like the Model Quickstart, this sample connects directly to a model (e.g. `gpt-realtime`) — but additionally configures remote MCP servers as tools, enabling the assistant to call external services (DeepWiki, Azure Docs) during the conversation and prompting the user for approval when required.

## What Makes This Sample Unique

This sample showcases:

- **MCP Server Integration**: Configure remote MCP servers as session tools via `MCPServer` model objects
- **Approval Flow**: Interactive console-based approval for `require_approval="always"` MCP tools
- **MCP Event Handling**: Process MCP tool discovery, execution, and result events
- **Flexible Authentication**: Supports both API key and Azure CLI credential authentication

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

## Command Line Options

```bash
# Run with API key (from .env)
python mcp-quickstart.py

# Run with Azure authentication
python mcp-quickstart.py --use-token-credential

# Run with custom model and verbose logging
python mcp-quickstart.py --model gpt-realtime --verbose
```

### Available Options

- `--api-key`: Azure VoiceLive API key
- `--endpoint`: Azure VoiceLive endpoint URL
- `--model`: VoiceLive model to use (default: `gpt-realtime`)
- `--voice`: Voice for the assistant (default: `en-US-Ava:DragonHDLatestNeural`)
- `--instructions`: Custom system instructions for the AI
- `--use-token-credential`: Use Azure authentication instead of API key
- `--verbose`: Enable detailed logging

## How It Works

The sample extends the Model Quickstart pattern with MCP:

1. **MCP Server Definitions**: Adds `MCPServer` instances to the session tools list alongside standard session configuration
2. **Session Configuration**: Sends `session.update` with model, voice, VAD, and MCP tools
3. **Tool Discovery**: Voice Live connects to each MCP server and discovers available tools
4. **Tool Execution**: When the model decides to call an MCP tool, the service executes the call
5. **Approval Flow**: For servers with `require_approval="always"`, the user is prompted in the console
6. **Result Processing**: MCP call output is captured and a new response is created for the model to incorporate

See [Python Samples README](../../README.md) for available voices, troubleshooting, and additional resources.

## Additional Resources

- [Voice Live Documentation](https://learn.microsoft.com/azure/ai-services/speech-service/voice-live)
- [Python SDK Documentation](https://learn.microsoft.com/python/api/overview/azure/ai-voicelive-readme)
- [Model Context Protocol](https://modelcontextprotocol.io/)
- [Support Guide](../../../SUPPORT.md)
