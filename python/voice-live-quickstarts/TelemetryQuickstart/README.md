# Telemetry Quickstart - Python

These samples demonstrate how to enable and customize OpenTelemetry tracing for the Azure AI Voice Live SDK.

> **Text-mode samples**: These samples use text mode (`Modality.TEXT`) so they run without a microphone. The telemetry setup code is isolated inside region tags (e.g., `# <enable_console_tracing>` / `# </enable_console_tracing>`) and can be copied into any existing Voice Live application — including audio-mode quickstarts and demos in this repo.

## Documentation

- [Enable telemetry and tracing for Voice Live](https://learn.microsoft.com/azure/ai-services/speech-service/how-to-voice-live-telemetry) — full how-to guide on Microsoft Learn

## Samples

| File | Region tag(s) | Description |
|---|---|---|
| `telemetry-console.py` | `enable_console_tracing` | Export Voice Live traces to the console |
| `telemetry-azure-monitor.py` | `enable_azure_monitor_tracing` | Export traces to Azure Monitor / Application Insights |
| `telemetry-custom-attributes.py` | `custom_span_processor`, `add_custom_processor` | Add custom span attributes for correlation |
| `telemetry-content-recording.py` | `enable_content_recording` | Enable full message payload recording in traces |

### Adding telemetry to other samples

Copy the code between the region tags into your own sample. For example, to add console tracing to any Voice Live app, copy the code inside `# <enable_console_tracing>` / `# </enable_console_tracing>` from `telemetry-console.py` and place it before your `connect()` call.

## Prerequisites

- Python 3.9 or later
- An Azure AI Services or Speech resource
- Complete one of the Voice Live quickstarts first:
  - [Voice Live with Foundry models](https://learn.microsoft.com/azure/ai-services/speech-service/voice-live-quickstart)
  - [Voice Live with Foundry agents](https://learn.microsoft.com/azure/ai-services/speech-service/voice-live-agents-quickstart)

## Setup

1. Install dependencies:

   ```bash
   pip install -r requirements.txt
   ```

2. Set environment variables:

   ```bash
   export AZURE_VOICELIVE_ENDPOINT="https://<your-resource>.services.ai.azure.com"
   export AZURE_VOICELIVE_API_KEY="<your-api-key>"
   ```

   For the Azure Monitor sample, also set:

   ```bash
   export APPLICATIONINSIGHTS_CONNECTION_STRING="<your-connection-string>"
   ```

3. Run any sample:

   ```bash
   python telemetry-console.py
   ```
