# Java Voice Assistant Samples

[Reference documentation](/java/api/overview/azure/ai-voicelive-readme) | [Package (Maven)](https://central.sonatype.com/artifact/com.azure/azure-ai-voicelive/overview)

This folder contains Java samples demonstrating how to build real-time voice assistants using Azure AI Speech VoiceLive service. Each sample is self-contained for easy understanding and deployment.

## Available Samples

### [Agents New Quickstart](./voice-live-quickstarts/AgentsNewQuickstart/)

Demonstrates the new Voice Live + Foundry Agent flow, including creating an agent configured for Voice Live and running a v2 agent-connected voice assistant sample.

**Key Features:**

- Agent creation utility with Voice Live metadata chunking
- New SDK-based agent session configuration
- Proactive greeting and barge-in handling
- Conversation logging

### [MCP Quickstart](./voice-live-quickstarts/MCPQuickstart/)

Demonstrates MCP (Model Context Protocol) server integration with VoiceLive, enabling the assistant to use remote tools (DeepWiki, Azure Docs) during voice conversations.

**Key Features:**

- MCP server definitions using `MCPServer`
- MCP tool discovery, execution, and failure event handling
- Interactive console-based approval flow for sensitive tools
- Flexible authentication (API key or Azure credentials)

### [Model Quickstart](./voice-live-quickstarts/ModelQuickstart/)

Demonstrates direct integration with VoiceLive models for voice conversations without agent overhead.

**Key Features:**

- Direct model access
- Flexible authentication (API key or Azure credentials)
- Custom instructions support
- Model selection options
- Real-time audio capture and playback
- Voice Activity Detection with interruption handling

## Prerequisites

All samples require:

- [Java 11](https://www.oracle.com/java/technologies/javase/jdk11-archive-downloads.html) or later
- [Maven 3.6+](https://maven.apache.org/download.cgi)
- Audio input/output devices (microphone and speakers)
- [Azure subscription](https://azure.microsoft.com/free/) - Create one for free

### Azure Resources

Depending on which sample you want to run:

**For Model Quickstart:**

- [AI Foundry resource](https://learn.microsoft.com/azure/ai-services/multi-service-resource)
- API key or [Azure CLI](https://learn.microsoft.com/cli/azure/install-azure-cli) for authentication

## Getting Started

### Quick Start

1. **Choose a sample**: Navigate to a folder under `voice-live-quickstarts` (for example, `ModelQuickstart` or `AgentsNewQuickstart`)
2. **Install prerequisites**: Ensure Java 11+ and Maven 3.6+ are installed
3. **Set up Azure resources**: Create required Azure resources based on the sample
4. **Configure settings**: Copy `application.properties.sample` to `application.properties` and update with your Azure credentials
5. **Build and run**:

   ```bash
   cd voice-live-quickstarts/ModelQuickstart
   mvn clean install
   mvn exec:java
   ```

### Authentication

**Model Quickstart** supports both authentication methods:

```bash
# With API key (from application.properties or --api-key)
mvn exec:java

# With Azure credentials
az login
mvn exec:java -Dexec.args="--use-token-credential"
```

## Configuration

Each sample includes an `application.properties.sample` file that you need to copy to `application.properties` and configure:

### Model Quickstart Configuration

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

## Available Voices

VoiceLive supports multiple neural voices:

- `en-US-Ava:DragonHDLatestNeural` (default)
- `en-US-Jenny:DragonHDLatestNeural`
- `en-US-Guy:DragonHDLatestNeural`
- `en-US-Emma:DragonHDLatestNeural`
- `en-US-Andrew:DragonHDLatestNeural`

See [Azure Text-to-Speech voice list](https://learn.microsoft.com/azure/ai-services/speech-service/language-support?tabs=tts) for all available voices.

## Common Issues and Troubleshooting

### Microphone Issues

**Problem**: Microphone not detected or no audio input

**Solutions**:

- Verify microphone is connected and set as default input device
- Check system audio settings and permissions
- Ensure no other application is exclusively using the microphone
- Try running with administrator/elevated privileges

### Authentication Issues

**Problem**: 401 Unauthorized or authentication failures

**Solutions**:

- Verify your API key is correct in `application.properties`
- Ensure endpoint URL is properly formatted (starts with `https://` and ends with `/`)
- Check that your Azure subscription is active
- For Azure credential auth, ensure you've run `az login` and have the correct permissions

### Audio Quality Issues

**Problem**: Poor audio quality, echoes, or background noise

**Solutions**:

- Use a quality microphone with noise cancellation
- Enable audio processing features in the configuration
- Check for proper microphone positioning and environment
- Ensure sample rate is 24kHz as required by VoiceLive

### Connection Issues

**Problem**: Cannot connect to VoiceLive service

**Solutions**:

- Verify network connectivity
- Check firewall and proxy settings
- Ensure the endpoint URL is accessible from your network
- Verify your Azure resource is in a supported region

### Maven Build Issues

**Problem**: Build failures or dependency resolution errors

**Solutions**:

- Ensure you're using Java 11 or later: `java -version`
- Ensure Maven 3.6+ is installed: `mvn -version`
- Clear Maven cache: `mvn clean` or delete `~/.m2/repository`
- Check internet connectivity for dependency downloads

## Additional Samples

Java quickstart content also includes:

- **Agents New Quickstart**: `voice-live-quickstarts/AgentsNewQuickstart`
- **Model Quickstart**: `voice-live-quickstarts/ModelQuickstart`

## Additional Resources

- [Azure AI Speech - Voice Live Documentation](https://learn.microsoft.com/azure/ai-services/speech-service/voice-live)
- [VoiceLive SDK Documentation](https://learn.microsoft.com/java/api/overview/azure/ai-voicelive-readme)
- [Azure AI Services Documentation](https://learn.microsoft.com/azure/ai-services/)
- [Maven Documentation](https://maven.apache.org/guides/)
- [Support Guide](../SUPPORT.md)

## Other Language Samples

Explore samples in other languages:

- [C# Samples](../csharp/README.md) - .NET implementation
- [Python Samples](../python/README.md) - Python implementation

## Contributing

Interested in contributing Java samples? Please see our [Contributing Guidelines](../SUPPORT.md#contributing).

## Support

For issues, questions, or contributions, please see our [Support Guide](../SUPPORT.md).
