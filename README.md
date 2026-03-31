# Azure AI Speech Service - Voice Live Samples

This repository contains sample code and resources for working with Azure AI Speech Service Voice Live.

## Overview

Voice Live enables real-time voice interactions using Azure AI Speech Service. These samples demonstrate how to integrate Voice Live into your applications for various scenarios including conversational AI, voice assistants, and interactive voice experiences.

## Features

- Real-time voice interaction samples
- Integration examples with Azure AI Speech Service
- Best practices for Voice Live implementation
- Sample code for common use cases

## Getting Started

### Prerequisites

- [Azure subscription](https://azure.microsoft.com/free/) - Create one for free
- [AI Foundry resource](https://learn.microsoft.com/en-us/azure/ai-services/multi-service-resource)
- Basic knowledge of your preferred programming language

### Installation

1. Clone this repository:
   ```bash
   git clone https://github.com/azure-ai-foundry/voicelive-samples.git
   cd voicelive-samples
   ```

2. Follow the instructions in individual sample directories for specific setup requirements.

### Quickstart

1. **Choose your language**: Select from [C#](./csharp/README.md), [Python](./python/README.md), or other available languages
2. **Follow language-specific setup**: Each language folder has detailed setup instructions
3. **Configure credentials**: Set up your Azure resources and authentication
4. **Run a sample**: Start with a quickstart sample to see Voice Live in action

For detailed quickstart guides, see the README in your chosen language folder.

## Samples by Language

This repository contains samples in multiple programming languages. Choose your preferred language to get started:

### [C# Samples](./csharp/README.md)
Complete C# samples demonstrating:
- **Agent Quickstart**: Connect to Azure AI Foundry agents with proactive greetings
- **Agents New Quickstart**: Create and run Voice Live-enabled Foundry Agents (new SDK patterns)
- **MCP Quickstart**: MCP server integration with remote tool calling and approval flow
- **Model Quickstart**: Direct VoiceLive model integration
- **Bring-Your-Own-Model (BYOM) Quickstart**: Use your own models hosted in Foundry with proactive greetings
- **Customer Service Bot**: Advanced function calling for customer service scenarios and proactive greetings
- Built with .NET 9.0 and self-contained code

### [Python Samples](./python/)
Python samples showcasing:
- **Agent Quickstart**: Azure AI Foundry agent integration with proactive greetings
- **Agents New Quickstart**: Voice Live + Foundry Agent v2 samples and agent-creation utility
- **MCP Quickstart**: MCP server integration with remote tool calling and approval flow
- **Model Quickstart**: Direct model access with flexible authentication
- **Bring-Your-Own-Model (BYOM) Quickstart**: Use your own models hosted in Foundry with proactive greetings
- **Function Calling**: Advanced tool integration with custom functions and proactive greetings
- **RAG-enabled Voice Assistant**: Full-stack voice assistant with Azure AI Search integration and `azd` deployment
- **Voice Live Avatar**: Avatar-enabled voice conversations with server-side SDK and Docker deployment
- Built with Python 3.8+ and async/await patterns

### [JavaScript Samples](./javascript/)
JavaScript/TypeScript samples showcasing:
- **Agents New Quickstart**: Node.js Voice Live + Foundry Agent v2 sample and agent-creation utility
- **MCP Quickstart**: MCP server integration with remote tool calling and approval flow
- **Model Quickstart**: Direct Voice Live model integration with proactive greetings
- **Basic Web Voice Assistant**: Browser-based voice assistant with real-time streaming and barge-in support
- **Voice Live Avatar**: Avatar-enabled voice conversations with Docker deployment
- **Voice Live Car Demo**: Voice-Enabled Car Assistant powered by multiple architectures
- **Voice Live Interpreter**: Real-time speech translation, speech in and speech out
- **Voice Live Trader**: Real-time trading assistant for stock fund crypto FX trading app
- Built with TypeScript and Web Audio API

### [Java Samples](./java/)
Java samples  showcasing:
- **Agents New Quickstart**: Voice Live + Foundry Agent v2 sample and agent-creation utility
- **MCP Quickstart**: MCP server integration with remote tool calling and approval flow
- **Model Quickstart**: Direct model access with flexible authentication
- Built with Java 11+ and Maven

### [Voice Live Universal Assistant](./voice-live-universal-assistant/)
Full-stack web application with a **shared React+Vite+TypeScript frontend** and per-language backend implementations:
- **Shared frontend**: Fluent-aligned design system (light/dark/system themes), voice orb visualization, CC transcript, voice type selection (OpenAI + Azure Standard)
- **Python backend**: FastAPI + WebSocket proxy with Agent and Model mode support
- **Java backend**: Spring Boot + WebSocket proxy with Agent and Model mode support
- **JavaScript, C# backends**: Planned
- **Backend selection**: Set `BACKEND_LANGUAGE` at deploy time (`python`, `java`, `javascript`, `csharp`) — frontend is shared and language-agnostic
- **Connection modes**: Model mode (default — works with just a Foundry endpoint) or Agent mode (auto-set when deploying with `CREATE_AGENT=true`)
- **Azure deployment**: Full `azd up` infrastructure with Bicep IaC — Container Apps, ACR, RBAC, optional AI Foundry provisioning, and optional Foundry Agent creation with GPT-4.1-mini
- 91 unit tests + E2E audio test

Each language folder contains detailed setup instructions, configuration examples, and troubleshooting guides specific to that language and platform.

## Documentation

- [Azure AI Speech Service - Voice Live Documentation](https://learn.microsoft.com/azure/ai-services/speech-service/voice-live)

## Contributing

We welcome contributions! Please see our [Contributing Guidelines](SUPPORT.md#contributing) for details.

Please note that this project follows the [Microsoft Open Source Code of Conduct](CODE_OF_CONDUCT.md).

## Resources

- [Support](SUPPORT.md) - Get help and file issues
- [Security](SECURITY.md) - Security policy and reporting vulnerabilities

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

Copyright (c) Microsoft Corporation. All rights reserved.

## Trademarks

This project may contain trademarks or logos for projects, products, or services. Authorized use of Microsoft trademarks or logos is subject to and must follow [Microsoft's Trademark & Brand Guidelines](https://www.microsoft.com/legal/intellectualproperty/trademarks/usage/general). Use of Microsoft trademarks or logos in modified versions of this project must not cause confusion or imply Microsoft sponsorship. Any use of third-party trademarks or logos are subject to those third-party's policies.
