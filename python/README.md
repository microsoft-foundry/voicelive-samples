# Python Voice Assistant Samples

[SDK Reference documentation](https://learn.microsoft.com/python/api/overview/azure/ai-voicelive-readme) | [Package (PyPI)](https://pypi.org/project/azure-ai-voicelive/)

This folder contains Python samples demonstrating how to build real-time voice assistants using Azure AI Speech VoiceLive service. Each sample is self-contained for easy understanding and deployment.

## Available Samples

### [Agents New Quickstart](./voice-live-quickstarts/AgentsNewQuickstart/)

Demonstrates the new Voice Live + Foundry Agent v2 workflow, including creating a Voice Live-configured agent and running an agent-connected voice assistant.

**Key Features:**
- Agent creation utility with Voice Live metadata chunking
- New SDK-based agent session configuration (`AgentSessionConfig`)
- Proactive greeting and barge-in handling
- Conversation logging

### [MCP Quickstart](./voice-live-quickstarts/MCPQuickstart/)

Demonstrates MCP (Model Context Protocol) server integration with Voice Live, enabling the assistant to use remote tools (DeepWiki, Azure Docs) during voice conversations.

**Key Features:**
- MCP server definitions using `MCPServer` model objects
- MCP tool discovery, execution, and failure event handling
- Interactive console-based approval flow for sensitive tools
- MCP call result processing with automatic response creation
- Conversation logging to timestamped log files

### [Agent Quickstart](./voice-live-quickstarts/agents-quickstart.py)

Demonstrates connecting to an Azure AI Foundry agent for voice conversations. The agent handles model selection, instructions, and tools, with support for proactive greetings.

**Key Features:**
- Azure AI Foundry agent integration
- Proactive greeting support
- Azure authentication (required)
- Agent-managed tools and instructions

### [Model Quickstart](./voice-live-quickstarts/model-quickstart.py)

Demonstrates direct integration with VoiceLive models for voice conversations without agent overhead.

**Key Features:**
- Direct model access
- Flexible authentication (API key or Azure credentials)
- Custom instructions support
- Model selection options

### [Bring-Your-Own-Model (BYOM) Quickstart](./voice-live-quickstarts/bring-your-own-model-quickstart.py)

Demonstrates direct integration with VoiceLive using bring-your-own-models from Foundry.

**Key Features:**
- Bring-Your-Own-Model Integration: Connects direct to a self hosted model
- Proactive Greeting: Agent initiates the conversation with a welcome message
- Custom Instructions: Define your own system instructions for the AI
- Flexible Authentication: Supports both API key and Azure credential authentication

### [Function Calling Quickstart](./voice-live-quickstarts/function-calling-quickstart.py)

Demonstrates how to implement function calling with VoiceLive models, enabling the AI to execute custom functions during conversations.

**Key Features:**
- Custom function definitions
- Real-time function execution
- Function result handling
- Advanced tool integration
- Proactive greeting support

### [Telemetry Quickstart](./voice-live-quickstarts/TelemetryQuickstart/)

Demonstrates how to enable and customize OpenTelemetry tracing for Voice Live SDK sessions. These are text-mode samples — copy the region-tagged snippets into any existing Voice Live application.

**Key Features:**
- Console span export for local debugging
- Azure Monitor / Application Insights export
- Custom span attributes for session and user correlation
- Content recording with PII warnings

> **Docs**: [Enable telemetry and tracing for Voice Live](https://learn.microsoft.com/azure/ai-services/speech-service/how-to-voice-live-telemetry)

### [RAG-enabled Voice Assistant](./voice-live-voicerag-assistant/README.md)

Demonstrates how to build a real-time voice assistant with Retrieval-Augmented Generation (RAG) capabilities using Azure AI Voice Live API and Azure AI Search.

**Key Features:**
- Real-time speech-to-speech interaction powered by Voice live
- RAG integration with Azure AI Search for document retrieval
- Full-stack architecture (React/TypeScript frontend + FastAPI backend)
- Azure AI Foundry Agent Service integration
- Production-ready `azd` deployment to Azure Container Apps

### [Voice Live Avatar](./voice-live-avatar/README.md)

A Dockerized sample demonstrating Azure Voice Live API with avatar integration, with the Voice Live SDK running entirely on the server side (Python/FastAPI) while the browser handles UI, audio capture/playback, and avatar video rendering.

**Key Features:**
- Avatar-enabled voice conversations with server-side SDK
- Prebuilt, custom, and photo avatar character support
- WebRTC and WebSocket avatar output modes
- Live scene settings adjustment for photo avatars
- Proactive greeting and barge-in support
- Barge-in support for natural conversation interruption
- Docker-based deployment
- Azure Container Apps deployment guide
- Developer mode for debugging

## Prerequisites

All samples require:

- [Python 3.8+](https://www.python.org/downloads/)
- Audio input/output devices (microphone and speakers)
- [Azure subscription](https://azure.microsoft.com/free/) - Create one for free

### Azure Resources

Depending on which sample you want to run:

**For Agent Quickstart and Agents New Quickstart:**
- [Azure AI Foundry project](https://learn.microsoft.com/azure/ai-studio/how-to/create-projects) with a deployed agent
- [Azure CLI](https://learn.microsoft.com/cli/azure/install-azure-cli) for authentication

**For Model Quickstart, BYOM Quickstart, and Function Calling:**
- [AI Foundry resource](https://learn.microsoft.com/en-us/azure/ai-services/multi-service-resource)
- API key or [Azure CLI](https://learn.microsoft.com/cli/azure/install-azure-cli) for authentication

## Getting Started

### Quick Start

1. **Navigate to the quickstarts folder**:
   ```bash
   cd python/voice-live-quickstarts
   ```

2. **Create a virtual environment** (recommended):
   ```bash
   python -m venv .venv
   
   # On Windows
   .venv\Scripts\activate
   
   # On Linux/macOS
   source .venv/bin/activate
   ```

3. **Install dependencies**:
   ```bash
   pip install -r requirements.txt
   ```

4. **Configure environment variables**:
   - Copy `.env_sample` to `.env`
   - Update `.env` with your Azure credentials

5. **Run a sample**:
   ```bash
   # New v2 agent quickstart
   python AgentsNewQuickstart/voice-live-with-agent-v2.py
   # or create an agent configured for Voice Live
   python AgentsNewQuickstart/create_agent_v2_with_voicelive.py
   # or classic agent quickstart
   python agents-quickstart.py
   # or
   python model-quickstart.py
   # or
   python bring-your-own-model-quickstart.py
   # or
   python function-calling-quickstart.py
   ```

### Authentication

**Agent Quickstart and Agents New Quickstart** require Azure authentication:
```bash
az login
python agents-quickstart.py
# or
python AgentsNewQuickstart/voice-live-with-agent-v2.py
```

**Model Quickstart, BYOM Quickstart, and Function Calling** support both methods:
```bash
# With API key (from .env file)
python model-quickstart.py
# or
python bring-your-own-model-quickstart.py

# With Azure credentials
az login
python model-quickstart.py --use-token-credential
# or
python bring-your-own-model-quickstart.py --use-token-credential
```

## Configuration

All samples use a `.env` file for configuration. Copy `.env_sample` to `.env` and update with your values:

### Agent Quickstart Configuration
```plaintext
AZURE_VOICELIVE_ENDPOINT=https://your-endpoint.services.ai.azure.com/
AZURE_VOICELIVE_PROJECT_NAME=your-project-name
AZURE_VOICELIVE_AGENT_ID=asst_your-agent-id
AZURE_VOICELIVE_API_VERSION=2025-10-01
# AZURE_VOICELIVE_API_KEY not needed for agents (Azure auth only)
```

### Model Quickstart Configuration
```plaintext
AZURE_VOICELIVE_ENDPOINT=https://your-endpoint.services.ai.azure.com/
AZURE_VOICELIVE_API_KEY=your-api-key
AZURE_VOICELIVE_API_VERSION=2025-10-01
```

### Function Calling Configuration
```plaintext
AZURE_VOICELIVE_ENDPOINT=https://your-endpoint.services.ai.azure.com/
AZURE_VOICELIVE_API_KEY=your-api-key
AZURE_VOICELIVE_API_VERSION=2025-10-01
```

## Common Features

All samples demonstrate:

- **Real-time Voice**: Bidirectional audio streaming for natural conversations
- **Audio Processing**: Microphone capture and speaker playback using PyAudio
- **Interruption Handling**: Support for natural turn-taking in conversations
- **Resource Management**: Proper cleanup of connections and audio resources
- **Async/Await**: Modern Python async programming patterns

## Available Voices

Popular neural voice options include:

- `en-US-AvaNeural` - Female, conversational
- `en-US-AndrewNeural` - Male, conversational
- `en-US-JennyNeural` - Female, friendly
- `en-US-GuyNeural` - Male, professional
- `en-US-AriaNeural` - Female, cheerful
- `en-US-DavisNeural` - Male, calm

See the [Azure Neural Voice Gallery](https://speech.microsoft.com/portal/voicegallery) for all available voices.

## Architecture

### Agent Quickstart Flow
```
User Voice → Microphone → PyAudio → VoiceLive SDK → Azure AI Foundry Agent
                                                              ↓
User Hears ← Speakers ← PyAudio ← VoiceLive SDK ← Agent Response
```

### Model Quickstart Flow
```
User Voice → Microphone → PyAudio → VoiceLive SDK → Azure AI Model (GPT-4o)
                                                              ↓
User Hears ← Speakers ← PyAudio ← VoiceLive SDK ← Model Response
```

### Function Calling Flow
```
User Voice → Microphone → PyAudio → VoiceLive SDK → Azure AI Model
                                                              ↓
                                                    Function Call Request
                                                              ↓
                                            Execute Python Function
                                                              ↓
                                            Function Result → Model
                                                              ↓
User Hears ← Speakers ← PyAudio ← VoiceLive SDK ← Enhanced Response
```

## Troubleshooting

### Audio Issues

- **No audio input/output**: Verify your microphone and speakers are working and set as default devices
- **PyAudio installation errors**: 
  - On Windows: Install via `pip install pyaudio`
  - On Linux: `sudo apt-get install python3-pyaudio` or `pip install pyaudio`
  - On macOS: `brew install portaudio && pip install pyaudio`
- **Audio device busy**: Close other applications using your audio devices (e.g., Teams, Zoom)
- **Poor audio quality**: Update your audio drivers to the latest version

### Authentication Issues

- **401 Unauthorized**: 
  - For API key: Verify `AZURE_VOICELIVE_API_KEY` in your `.env` file
  - For Azure auth: Run `az login` to authenticate with Azure CLI
- **Agent not found** (Agent sample): Check your agent ID format (should be `asst_xxxxx`) and project name
- **Token credential fails**: Ensure Azure CLI is installed and you're logged in
- **Insufficient permissions** (Agent sample): Verify your Azure account has access to the AI Foundry project

### Connection Issues

- **Endpoint errors**: Verify your endpoint URL format in `.env`: `https://your-endpoint.services.ai.azure.com/`
- **WebSocket timeout**: Check your network connection and firewall settings
- **Certificate errors**: Ensure your system certificates are up to date
- **Model not available** (Model/Function samples): Verify your Speech resource has VoiceLive enabled

### Python Environment Issues

- **Module not found**: Run `pip install -r requirements.txt` to install dependencies
- **Python version**: Verify Python 3.8 or later is installed: `python --version`
- **Virtual environment**: Use a virtual environment to avoid package conflicts
- **Import errors**: Ensure you're in the correct directory and virtual environment is activated

### Common Command Line Options

All samples support these options (use `--help` for full details):

- `--endpoint`: Azure VoiceLive endpoint URL
- `--voice`: Voice for the assistant (default varies by sample)
- `--verbose` or `-v`: Enable detailed logging

**Agent-specific options:**
- `--agent-id`: Azure AI Foundry agent ID
- `--project-name`: Azure AI Foundry project name

**Model/Function-specific options:**
- `--api-key`: Azure VoiceLive API key
- `--model`: VoiceLive model to use
- `--use-token-credential`: Use Azure authentication instead of API key

## Requirements

The samples use the following Python packages (defined in `requirements.txt`):

```
azure-ai-voicelive[aiohttp]
pyaudio
python-dotenv
azure-identity
```

Install all dependencies with:
```bash
pip install -r requirements.txt
```

## Additional Resources

- [Azure AI Speech - Voice Live Documentation](https://learn.microsoft.com/azure/ai-services/speech-service/voice-live)
- [Python SDK Documentation](https://learn.microsoft.com/python/api/overview/azure/ai-voicelive-readme)
- [Support Guide](../SUPPORT.md)

## Contributing

We welcome contributions! Please see the [Support Guide](../SUPPORT.md#contributing) for details on how to contribute.

## License

This project is licensed under the MIT License - see the [LICENSE](../LICENSE) file for details.
