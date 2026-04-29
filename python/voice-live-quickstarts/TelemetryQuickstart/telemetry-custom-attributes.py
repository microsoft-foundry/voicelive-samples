# -------------------------------------------------------------------------
# Copyright (c) Microsoft Corporation. All rights reserved.
# Licensed under the MIT License.
# -------------------------------------------------------------------------

"""
FILE: telemetry-custom-attributes.py

DESCRIPTION:
    This sample demonstrates how to add custom attributes to Voice Live
    OpenTelemetry spans using a custom SpanProcessor. This is useful for
    correlating Voice Live traces with application-specific context such
    as session IDs, user IDs, or request identifiers.

    The custom SpanProcessor code (marked with region tags) can be copied
    into any existing Voice Live application.

USAGE:
    python telemetry-custom-attributes.py

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
from typing import cast

from azure.core.settings import settings

settings.tracing_implementation = "opentelemetry"

from opentelemetry import trace
from opentelemetry.sdk.trace import (
    TracerProvider,
    SpanProcessor,
    ReadableSpan,
    Span,
)
from opentelemetry.sdk.trace.export import (
    SimpleSpanProcessor,
    ConsoleSpanExporter,
)

from azure.ai.voicelive.telemetry import VoiceLiveInstrumentor

# <custom_span_processor>
class CustomAttributeSpanProcessor(SpanProcessor):
    """Add application-specific attributes to every span."""

    def on_start(self, span: Span, parent_context=None):
        # Add a session identifier to all spans.
        span.set_attribute(
            "app.session_id", "my-session-123"
        )

        # Tag send spans with extra context.
        if span.name and span.name.startswith("send"):
            span.set_attribute(
                "app.send.context", "user-interaction"
            )

        # Tag receive spans with a priority level.
        if span.name and span.name.startswith("recv"):
            span.set_attribute(
                "app.recv.priority", "normal"
            )

    def on_end(self, span: ReadableSpan):
        pass
# </custom_span_processor>


# Set up tracing with the custom processor.
tracer_provider = TracerProvider()
tracer_provider.add_span_processor(
    SimpleSpanProcessor(ConsoleSpanExporter())
)
trace.set_tracer_provider(tracer_provider)

os.environ.setdefault(
    "AZURE_EXPERIMENTAL_ENABLE_GENAI_TRACING", "true"
)
VoiceLiveInstrumentor().instrument()

# <add_custom_processor>
# Register the custom processor with the global provider.
provider = cast(TracerProvider, trace.get_tracer_provider())
provider.add_span_processor(CustomAttributeSpanProcessor())
# </add_custom_processor>

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
        "telemetry-custom-attributes"
    ):
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
