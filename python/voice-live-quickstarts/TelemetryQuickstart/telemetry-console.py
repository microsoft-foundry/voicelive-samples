# -------------------------------------------------------------------------
# Copyright (c) Microsoft Corporation. All rights reserved.
# Licensed under the MIT License.
# -------------------------------------------------------------------------

"""
FILE: telemetry-console.py

DESCRIPTION:
    This sample demonstrates how to enable OpenTelemetry tracing for the
    Azure AI Voice Live SDK with console output. All connection, send, and
    receive operations produce OpenTelemetry spans printed to stdout.

    The telemetry setup code (marked with region tags) can be copied into
    any existing Voice Live application, such as the model quickstart or
    agent quickstart, to add tracing without changing application logic.

USAGE:
    python telemetry-console.py

    Set the environment variables with your own values before running:
    1) AZURE_VOICELIVE_ENDPOINT - The Azure VoiceLive endpoint
    2) AZURE_VOICELIVE_API_KEY  - The Azure VoiceLive API key

REQUIREMENTS:
    - azure-ai-voicelive
    - opentelemetry-sdk
    - azure-core-tracing-opentelemetry
"""

import asyncio
import os

# <enable_console_tracing>
from azure.core.settings import settings

# Step 1: Tell azure-core to use OpenTelemetry for tracing.
settings.tracing_implementation = "opentelemetry"

# Step 2: Configure a TracerProvider with a console exporter.
from opentelemetry import trace
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import (
    SimpleSpanProcessor,
    ConsoleSpanExporter,
)

tracer_provider = TracerProvider()
tracer_provider.add_span_processor(
    SimpleSpanProcessor(ConsoleSpanExporter())
)
trace.set_tracer_provider(tracer_provider)

# Step 3: Enable the VoiceLive instrumentor.
from azure.ai.voicelive.telemetry import VoiceLiveInstrumentor

os.environ.setdefault(
    "AZURE_EXPERIMENTAL_ENABLE_GENAI_TRACING", "true"
)
VoiceLiveInstrumentor().instrument()
# </enable_console_tracing>

from azure.core.credentials import AzureKeyCredential
from azure.ai.voicelive.aio import connect
from azure.ai.voicelive.models import (
    InputTextContentPart,
    Modality,
    OutputAudioFormat,
    RequestSession,
    ServerEventType,
    ServerVad,
    UserMessageItem,
)

tracer = trace.get_tracer(__name__)


async def main() -> None:
    endpoint = os.environ["AZURE_VOICELIVE_ENDPOINT"]
    api_key = os.environ["AZURE_VOICELIVE_API_KEY"]
    model = os.environ.get(
        "AZURE_VOICELIVE_MODEL", "gpt-realtime"
    )

    credential = AzureKeyCredential(api_key)

    with tracer.start_as_current_span("telemetry-console"):
        async with connect(
            endpoint=endpoint,
            credential=credential,
            model=model,
        ) as connection:
            print(f"Connected to VoiceLive at {endpoint}")

            session_config = RequestSession(
                modalities=[Modality.TEXT],
                instructions=(
                    "You are a helpful assistant. "
                    "Say hello briefly."
                ),
                turn_detection=ServerVad(
                    threshold=0.5,
                    prefix_padding_ms=300,
                    silence_duration_ms=500,
                ),
                output_audio_format=OutputAudioFormat.PCM16,
            )
            await connection.session.update(
                session=session_config
            )
            print("Session configured.")

            await connection.conversation.item.create(
                item=UserMessageItem(
                    content=[
                        InputTextContentPart(
                            text="Hello, tell me a joke"
                        )
                    ]
                )
            )
            await connection.response.create()
            print("User message sent.")

            async for event in connection:
                event_type = getattr(event, "type", None)
                print(f"Received event: {event_type}")

                if event_type == ServerEventType.RESPONSE_DONE:
                    print("Response complete.")
                    break

        print("Connection closed.")

    tracer_provider.force_flush()
    tracer_provider.shutdown()


if __name__ == "__main__":
    asyncio.run(main())
