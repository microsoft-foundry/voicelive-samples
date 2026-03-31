# JavaScript/TypeScript Voice Assistant Samples

[Reference documentation](https://learn.microsoft.com/javascript/api/overview/azure/ai-voicelive-readme) | [Package (npm)](https://www.npmjs.com/package/@azure/ai-voicelive)

This folder contains JavaScript samples demonstrating how to build real-time voice assistants using Azure AI Speech VoiceLive service. Each sample is self-contained for easy understanding and deployment.

## Available Samples

### [Agents New Quickstart](./voice-live-quickstarts/AgentsNewQuickstart/)

A Node.js quickstart demonstrating the Voice Live + Foundry Agent v2 flow, including agent creation and voice assistant runtime samples.

**Key Features:**
- Agent creation utility with Voice Live metadata
- Voice Live session targetting Foundry agents
- Proactive greeting (LLM-generated or pre-defined)
- Explicit microphone device selection
- Barge-in handling and conversation logging

### [MCP Quickstart](./voice-live-quickstarts/MCPQuickstart/)

A Node.js quickstart demonstrating MCP (Model Context Protocol) server integration with Voice Live, enabling the assistant to use remote tools (DeepWiki, Azure Docs) during voice conversations.

**Key Features:**
- MCP server definitions with configurable approval policies
- MCP tool discovery, execution, and failure event handling
- Interactive console-based approval flow for sensitive tools
- Barge-in handling and conversation logging

### [Model Quickstart](./voice-live-quickstarts/ModelQuickstart/)

A Node.js quickstart demonstrating direct Voice Live model integration without Foundry agent orchestration.

**Key Features:**
- Direct model-mode session (`gpt-realtime` by default)
- Custom instructions and voice configuration
- API key or Azure credential authentication
- Proactive greeting (LLM-generated or pre-defined)
- Explicit microphone device selection
- Barge-in handling and conversation logging

### [Helper Scripts](./voice-live-quickstarts/helper-scripts/)

Shared PowerShell scripts for setting up and verifying Windows development prerequisites (Node.js, SoX, VS Build Tools).

### [Basic Web Voice Assistant](./basic-web-voice-assistant/)

A browser-based voice assistant demonstrating Azure Voice Live SDK integration in a web application using TypeScript and the Web Audio API.

**Key Features:**
- Client/Session architecture with type-safe handler-based events
- Real-time bi-directional audio streaming (PCM16)
- Live transcription and streaming text responses
- Barge-in support for natural conversation interruption
- Audio level visualization
- Support for OpenAI and Azure Neural voices

### [Voice Live Avatar](./voice-live-avatar/)

A Dockerized sample demonstrating Azure Voice Live API with avatar integration, enabling visual avatar representation during voice conversations.

**Key Features:**
- Avatar-enabled voice conversations
- Prebuilt, custom, and photo avatar character support
- WebRTC and WebSocket avatar output modes
- Live scene settings adjustment for photo avatars
- Proactive greeting support
- Barge-in support for natural conversation interruption
- Docker-based deployment
- Azure Container Apps deployment guide
- Developer mode for debugging

> Also available in [Python](../python/voice-live-avatar/README.md) with a server-side SDK architecture (FastAPI backend).

### [Voice Live Car Demo](./voice-live-car-demo/)

A React + Vite demo showcasing a Voice-Enabled Car Assistant powered by Azure OpenAI Realtime API.

**Live Demo:** [https://novaaidesigner.github.io/azure-voice-live-for-car/](https://novaaidesigner.github.io/azure-voice-live-for-car/)

**Key Features:**
- Vehicle Control (lights, windows, temp)
- Status Monitoring (speed, battery)
- Media & Navigation simulation
- Real-time EV driving cycle simulation
- Latency and token usage benchmarking

### [Voice Live Interpreter Demo](./voice-live-interpreter-demo/)

A minimal Vite + React + TypeScript demo that uses **Azure Voice Live** for real-time speech translation.

**Live Demo:** [https://novaaidesigner.github.io/azure-voice-live-interpreter/](https://novaaidesigner.github.io/azure-voice-live-interpreter/)

**Key Features:**
- Configurable `endpoint`, `apiKey`, `model` (defaults to `gpt-5`), and `target language`.
- “同声传译专家” system prompt (sentence-by-sentence, context-aware translation).
- Session window logs: ASR, translations, and event logs.
- Benchmarks per turn: latency + token usage (also keeps totals).
- One-click export to the **Azure Voice Live Calculator** via URL params.

### [Voice Live Trader Demo](./voice-live-trader-demo/)

A Web App based on Azure Speech Voice Live for real-time trading simulation.

**Live Demo:** [https://novaaidesigner.github.io/voice-live-trader/](https://novaaidesigner.github.io/voice-live-trader/)

**Key Features:**
- Real-time trading assistant
- Simulated matching engine (client-side)
- Usage statistics (tokens/audio/network)
- Multi-turn conversation support

## Prerequisites

All samples require:

- [Azure subscription](https://azure.microsoft.com/free/) - Create one for free
- [AI Foundry resource](https://learn.microsoft.com/azure/ai-services/multi-service-resource) with Voice Live enabled
- Modern browser (Chrome 66+, Firefox 60+, Safari 11.1+, Edge 79+)

**Sample-specific requirements:**

| Sample | Requirements |
|--------|--------------|
| Agents New Quickstart | [Node.js 18+](https://nodejs.org/) with npm |
| MCP Quickstart | [Node.js 18+](https://nodejs.org/) with npm |
| Model Quickstart | [Node.js 18+](https://nodejs.org/) with npm |
| Basic Web Voice Assistant | [Node.js 18+](https://nodejs.org/) with npm |
| Voice Live Avatar | [Docker](https://www.docker.com/get-started) |
| Voice Live Car Demo | [Node.js 18+](https://nodejs.org/) with npm |
| Voice Live Interpreter Demo | [Node.js 18+](https://nodejs.org/) with npm |
| Voice Live Trader Demo | [Node.js 18+](https://nodejs.org/) with npm |

## Getting Started

See individual sample READMEs for detailed setup instructions.

## Resources

- [Azure AI Speech - Voice Live Documentation](https://learn.microsoft.com/azure/ai-services/speech-service/voice-live)
- [Support Guide](../SUPPORT.md)
## See Also

- [C# Samples](../csharp/README.md) - .NET implementation
- [Python Samples](../python/README.md) - Python implementation
- [Java Samples](../java/README.md) - Java implementation
