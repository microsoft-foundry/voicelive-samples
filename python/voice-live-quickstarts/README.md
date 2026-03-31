# Python Quickstart Samples

This folder contains Python quickstart samples demonstrating different ways to use Azure AI Speech Service VoiceLive:

- [Agents New Quickstart](./AgentsNewQuickstart/) - New Voice Live + Foundry Agent v2 flow with agent creation helper scripts
- [MCP Quickstart](./MCPQuickstart/) - MCP server integration with remote tool calling and approval flow
- [Model Quickstart](#model-quickstart) - Direct VoiceLive model integration with custom instructions
- [Bring-Your-Own-Model Quickstart (BYOM)](#byom-quickstart) - Demonstrates direct integration with VoiceLive using bring-your-own-models from Foundry.
- [Agent Quickstart](#agent-quickstart) - Integration with Azure AI Foundry agents
- [Function Calling Quickstart](#function-calling-quickstart) - Custom function execution during conversations

## Model Quickstart

> **For common setup instructions, troubleshooting, and detailed information, see the [Python Samples README](../README.md)**

This sample demonstrates how to build a real-time voice assistant using direct VoiceLive model integration. It provides a straightforward approach without agent overhead, ideal for scenarios where you want full control over model selection and instructions.

### What Makes This Sample Unique

This sample showcases:

- **Direct Model Access**: Connects directly to VoiceLive models (e.g., gpt-realtime)
- **Custom Instructions**: Define your own system instructions for the AI
- **Flexible Authentication**: Supports both API key and Azure credential authentication
- **Model Selection**: Choose from available VoiceLive models

### Prerequisites

- [AI Foundry resource](https://learn.microsoft.com/en-us/azure/ai-services/multi-service-resource)
- API key or [Azure CLI](https://learn.microsoft.com/cli/azure/install-azure-cli) for authentication
- See [Python Samples README](../README.md) for common prerequisites

### Quick Start

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

3. **Update `.env` file**:
   ```plaintext
   AZURE_VOICELIVE_ENDPOINT=https://your-endpoint.services.ai.azure.com/
   AZURE_VOICELIVE_API_KEY=your-api-key
   AZURE_VOICELIVE_API_VERSION=2025-10-01
   ```

4. **Run the sample**:
   ```bash
   python model-quickstart.py
   ```

### Command Line Options

```bash
# Run with API key (from .env)
python model-quickstart.py

# Run with Azure authentication
python model-quickstart.py --use-token-credential

# Run with custom model and instructions
python model-quickstart.py --model gpt-realtime --instructions "You are a helpful assistant"

# Run with custom voice and verbose logging
python model-quickstart.py --voice en-US-JennyNeural -v
```

#### Available Options

- `--api-key`: Azure VoiceLive API key
- `--endpoint`: Azure VoiceLive endpoint URL
- `--model`: VoiceLive model to use (default: gpt-realtime)
- `--voice`: Voice for the assistant
- `--instructions`: Custom system instructions for the AI
- `--use-token-credential`: Use Azure authentication instead of API key
- `-v, --verbose`: Enable detailed logging

#### Available Models

- `gpt-realtime` - Latest GPT-4o realtime model (recommended)
- `gpt-4.1` - GPT-4.1 LLM model

See [Python Samples README](../README.md) for available voices, troubleshooting, and additional resources.

### How It Works

The sample:

1. Authenticates using API key or Azure credentials
2. Connects directly to the VoiceLive model endpoint
3. Configures model with custom instructions (if provided)
4. Captures audio from your microphone
5. Streams audio to the model in real-time
6. Plays back model responses through speakers
7. Handles interruptions and turn-taking naturally

## Bring-Your-Own-Model Quickstart

> **For common setup instructions, troubleshooting, and detailed information, see the [Python Samples README](../README.md)**

This sample demonstrates how to build a real-time voice assistant using direct VoiceLive model integration with bring-your-own-model. It provides a straightforward approach without agent overhead, ideal for scenarios where you want full control over model selection and instructions but with your own model hosted in Foundry.

### What Makes This Sample Unique

This sample showcases:

- **Bring-Your-Own-Model Integration**: Connects direct to a self hosted model
- **Proactive Greeting**: Agent initiates the conversation with a welcome message
- **Custom Instructions**: Define your own system instructions for the AI
- **Flexible Authentication**: Supports both API key and Azure credential authentication

### Prerequisites

- [Azure AI Foundry project](https://learn.microsoft.com/azure/ai-studio/how-to/create-projects) with a deployed model
- [Azure CLI](https://learn.microsoft.com/cli/azure/install-azure-cli) for authentication
- See [Python Samples README](../README.md) for common prerequisites

### Quick Start

1. **Authenticate with Azure**:
   ```bash
   az login
   ```

2. **Create and activate virtual environment**:
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

4. **Update `.env` file**:
   ```plaintext
   AZURE_VOICELIVE_ENDPOINT=https://your-endpoint.services.ai.azure.com/
   AZURE_VOICELIVE_MODEL=<your-model-name>
   AZURE_VOICELIVE_BYOM_MODE=byom-azure-openai-chat-completion
   AZURE_VOICELIVE_API_VERSION=2025-10-01
   ```

5. **Run the sample**:
   ```bash
   python bring-your-own-model-quickstart.py
   ```

### Command Line Options

```bash
# Run with settings from .env
python bring-your-own-model-quickstart.py

# Run with command line parameters
python bring-your-own-model-quickstart.py --model youe-model-name --byom byom-mode

# Run with custom voice and verbose logging
python bring-your-own-model-quickstart.py --voice en-US-JennyNeural -v
```

#### Available Options

- `--endpoint`: Azure VoiceLive endpoint URL
- `--model`: VoiceLive model to use (default: gpt-realtime)
- `--byom`: BYOM integration mode (default: "byom-azure-openai-chat-completion"; use "byom-azure-openai-realtime" for multimodal models)
- `--voice`: Voice for the assistant
- `-v, --verbose`: Enable detailed logging

See [Python Samples README](../README.md) for available voices, troubleshooting, and additional resources.

### How It Works

The sample:

1. Authenticates using Azure credentials (`DefaultAzureCredential`)
2. Connects to your deployed Azure AI Foundry agent
3. Agent sends a proactive greeting to start the conversation
4. Captures audio from your microphone
5. Streams audio to the agent in real-time
6. Plays back agent responses through speakers
7. Handles interruptions and turn-taking naturally







## Agent Quickstart

> **For common setup instructions, troubleshooting, and detailed information, see the [Python Samples README](../README.md)**

This sample demonstrates how to build a real-time voice assistant that connects to an **Azure AI Foundry agent**. The agent manages model selection, instructions, and tools, enabling sophisticated conversational AI scenarios.

### What Makes This Sample Unique

This sample showcases:

- **Agent Integration**: Routes voice requests to a deployed Azure AI Foundry agent
- **Proactive Greeting**: Agent initiates the conversation with a welcome message
- **Agent Tools**: Leverages tools and functions configured in your agent
- **Azure Authentication Only**: Uses Azure credentials (API key auth not supported for agents)

### Prerequisites

- [Azure AI Foundry project](https://learn.microsoft.com/azure/ai-studio/how-to/create-projects) with a deployed agent
- [Azure CLI](https://learn.microsoft.com/cli/azure/install-azure-cli) for authentication
- See [Python Samples README](../README.md) for common prerequisites

### Quick Start

1. **Authenticate with Azure**:
   ```bash
   az login
   ```

2. **Create and activate virtual environment**:
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

4. **Update `.env` file**:
   ```plaintext
   AZURE_VOICELIVE_ENDPOINT=https://your-endpoint.services.ai.azure.com/
   AZURE_VOICELIVE_PROJECT_NAME=your-project-name
   AZURE_VOICELIVE_AGENT_ID=asst_your-agent-id
   AZURE_VOICELIVE_API_VERSION=2025-10-01
   ```

5. **Run the sample**:
   ```bash
   python agents-quickstart.py
   ```

### Command Line Options

```bash
# Run with settings from .env
python agents-quickstart.py

# Run with command line parameters
python agents-quickstart.py --agent-id asst_ABC123 --project-name my-project

# Run with custom voice and verbose logging
python agents-quickstart.py --voice en-US-JennyNeural -v
```

#### Available Options

- `--endpoint`: Azure VoiceLive endpoint URL
- `--agent-id`: Azure AI Foundry agent ID (format: asst_xxxxx)
- `--project-name`: Azure AI Foundry project name
- `--voice`: Voice for the assistant
- `-v, --verbose`: Enable detailed logging

See [Python Samples README](../README.md) for available voices, troubleshooting, and additional resources.

### How It Works

The sample:

1. Authenticates using Azure credentials (`DefaultAzureCredential`)
2. Connects to your deployed Azure AI Foundry agent
3. Agent sends a proactive greeting to start the conversation
4. Captures audio from your microphone
5. Streams audio to the agent in real-time
6. Plays back agent responses through speakers
7. Handles interruptions and turn-taking naturally

## Function Calling Quickstart

> **For common setup instructions, troubleshooting, and detailed information, see the [Python Samples README](../README.md)**

This sample demonstrates how to implement function calling with VoiceLive models, enabling the AI to execute custom Python functions during conversations. This is ideal for scenarios where the AI needs to perform actions, retrieve data, or integrate with external systems.

### What Makes This Sample Unique

This sample showcases:

- **Custom Function Definitions**: Define Python functions that the AI can call
- **Real-time Function Execution**: Execute functions during conversation
- **Function Result Handling**: Return results to the AI for natural responses
- **Advanced Tool Integration**: Demonstrate tool/function calling patterns
- **Flexible Authentication**: Supports both API key and Azure credential authentication

### Prerequisites

- [AI Foundry resource](https://learn.microsoft.com/en-us/azure/ai-services/multi-service-resource)
- API key or [Azure CLI](https://learn.microsoft.com/cli/azure/install-azure-cli) for authentication
- See [Python Samples README](../README.md) for common prerequisites

### Quick Start

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

3. **Update `.env` file**:
   ```plaintext
   AZURE_VOICELIVE_ENDPOINT=https://your-endpoint.services.ai.azure.com/
   AZURE_VOICELIVE_API_KEY=your-api-key
   AZURE_VOICELIVE_API_VERSION=2025-10-01
   ```

4. **Run the sample**:
   ```bash
   python function-calling-quickstart.py
   ```

### Command Line Options

```bash
# Run with API key (from .env)
python function-calling-quickstart.py

# Run with Azure authentication
python function-calling-quickstart.py --use-token-credential

# Run with custom voice and verbose logging
python function-calling-quickstart.py --voice en-US-JennyNeural -v
```

#### Available Options

- `--api-key`: Azure VoiceLive API key
- `--endpoint`: Azure VoiceLive endpoint URL
- `--model`: VoiceLive model to use (default: gpt-realtime)
- `--voice`: Voice for the assistant
- `--use-token-credential`: Use Azure authentication instead of API key
- `-v, --verbose`: Enable detailed logging

See [Python Samples README](../README.md) for available voices, troubleshooting, and additional resources.

### How It Works

The sample demonstrates:

1. **Function Definition**: Defines custom Python functions with type hints and descriptions
2. **Tool Registration**: Registers functions as tools that the AI can call
3. **Conversation Flow**: 
   - User speaks a request that requires function execution
   - AI recognizes the need and calls the appropriate function
   - Function executes and returns results
   - AI incorporates results into a natural response
4. **Real-time Processing**: All happens during the live conversation

#### Example Functions

The sample includes example functions such as:
- **get_weather**: Retrieves weather information for a location
- **get_time**: Returns current time in different time zones
- **calculate**: Performs mathematical calculations

### Function Calling Pattern

```python
# 1. Define your function
def get_weather(location: str) -> dict:
    """Get weather for a location"""
    # Your implementation
    return {"temperature": 72, "condition": "sunny"}

# 2. Register as a tool
tools = [
    FunctionTool(
        name="get_weather",
        description="Get current weather",
        parameters={...},
        function=get_weather
    )
]

# 3. AI calls function during conversation
# 4. Function executes and returns results
# 5. AI uses results in response
```

## Additional Resources

- [Voice Live Documentation](https://learn.microsoft.com/azure/ai-services/speech-service/voice-live)
- [Function Calling Guide](https://learn.microsoft.com/azure/ai-services/openai/how-to/function-calling)
- [Python SDK Documentation](https://learn.microsoft.com/en-us/python/api/overview/azure/ai-voicelive-readme)
- [Support Guide](../../SUPPORT.md)
