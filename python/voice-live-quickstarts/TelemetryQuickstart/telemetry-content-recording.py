# -------------------------------------------------------------------------
# Copyright (c) Microsoft Corporation. All rights reserved.
# Licensed under the MIT License.
# -------------------------------------------------------------------------

"""
FILE: telemetry-content-recording.py

DESCRIPTION:
    This sample demonstrates how to enable content recording for Voice Live
    OpenTelemetry traces. When enabled, full message payloads (send and
    receive) are captured in span events as gen_ai.event.content attributes.

    WARNING: Content recording may capture personal data. Only enable in
    development or controlled environments.

    The content recording setup code (marked with region tags) can be
    copied into any existing Voice Live application.

USAGE:
    python telemetry-content-recording.py

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

from azure.core.settings import settings

settings.tracing_implementation = "opentelemetry"

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

from azure.ai.voicelive.telemetry import VoiceLiveInstrumentor

os.environ.setdefault(
    "AZURE_EXPERIMENTAL_ENABLE_GENAI_TRACING", "true"
)

# <enable_content_recording>
# Option 1: Enable via environment variable.
# os.environ[
#     "OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT"
# ] = "true"

# Option 2: Enable programmatically.
VoiceLiveInstrumentor().instrument(
    enable_content_recording=True
)
# </enable_content_recording>

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

    with tracer.start_as_current_span(
        "telemetry-content-recording"
    ):
        async with connect(
            endpoint=endpoint,
            credential=credential,
            model=model,
        ) as connection:
            print(f"Connected to VoiceLive at {endpoint}")

            # The full session config payload appears in the
            # span event as gen_ai.event.content.
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

            # The full message content is captured.
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

            # The full event payloads are captured.
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
