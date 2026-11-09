# -------------------------------------------------------------------------
# Copyright (c) Microsoft Corporation. All rights reserved.
# Licensed under the MIT License.
# -------------------------------------------------------------------------
"""
Outbound Appointment Reminder — Azure Voice Live + Twilio Media Streams.

This server places (via make_call.py) an *outbound* call to a customer and uses
Azure Voice Live to remind them of an appointment, then records whether they
confirmed, want to reschedule, or cancelled.

Flow:
    make_call.py  --to +1555...  --name "Jamie" --time "Tuesday at 3 PM"
        -> Twilio dials the customer, fetching TwiML from /outbound-twiml
        -> TwiML opens a Media Stream to /media-stream with the appointment
           details passed as <Parameter> values
        -> this server bridges audio to Voice Live and records the outcome

Run:
    python app.py
    # expose it, e.g.:  ngrok http 8000
    # then place a call:  python make_call.py --to +15551234567 --name Jamie --time "Tue 3 PM"
"""
from __future__ import annotations

import base64
import json
import logging
import os
from typing import Any, Dict, Optional, Union

import uvicorn
from dotenv import load_dotenv
from fastapi import FastAPI, Request, WebSocket, WebSocketDisconnect
from fastapi.responses import PlainTextResponse

from azure.core.credentials import AzureKeyCredential
from azure.identity.aio import DefaultAzureCredential
from azure.ai.voicelive.aio import connect, VoiceLiveConnection
from azure.ai.voicelive.models import (
    AudioInputTranscriptionOptions,
    AzureStandardVoice,
    FunctionCallOutputItem,
    FunctionTool,
    InputAudioFormat,
    ItemType,
    Modality,
    OutputAudioFormat,
    RequestSession,
    ServerEventType,
    ServerVad,
    Tool,
    ToolChoiceLiteral,
)

os.chdir(os.path.dirname(os.path.abspath(__file__)))
load_dotenv("./.env", override=True)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s:%(name)s:%(levelname)s:%(message)s",
)
logger = logging.getLogger("outbound-appointment-reminder")

# ---------------------------------------------------------------------------
# Configuration (from environment / .env)
# ---------------------------------------------------------------------------
ENDPOINT = os.environ.get("AZURE_VOICELIVE_ENDPOINT", "")
API_KEY = os.environ.get("AZURE_VOICELIVE_API_KEY", "")
MODEL = os.environ.get("AZURE_VOICELIVE_MODEL", "gpt-realtime")
VOICE = os.environ.get("AZURE_VOICELIVE_VOICE", "en-US-Ava:DragonHDLatestNeural")
USE_TOKEN_CREDENTIAL = os.environ.get("USE_TOKEN_CREDENTIAL", "false").lower() == "true"
PORT = int(os.environ.get("PORT", "8000"))

BUSINESS_NAME = os.environ.get("BUSINESS_NAME", "Contoso Dental")
OUTCOMES_DIR = os.environ.get("OUTCOMES_DIR", "./outcomes")


def build_instructions(customer_name: str, appointment_time: str) -> str:
    """Tailor the assistant's script to a specific appointment."""
    return (
        f"You are a polite assistant calling on behalf of {BUSINESS_NAME}. "
        f"You are calling {customer_name} to remind them about their upcoming "
        f"appointment on {appointment_time}. This is a phone call, so keep every "
        "turn short and conversational.\n\n"
        "Goals, in order:\n"
        "1. Politely identify yourself and confirm you are speaking with "
        f"{customer_name}.\n"
        "2. Remind them of the appointment time and ask if they can still make it.\n"
        "3. Based on their answer, call the `record_outcome` function with status "
        "'confirmed', 'reschedule', or 'cancel'. If they want to reschedule, ask "
        "for their preferred day/time and include it in the notes.\n"
        "4. Thank them and end the call warmly.\n\n"
        "Do not be pushy. If they are busy, offer to call back later and record the "
        "outcome as 'reschedule' with a note."
    )


# ---------------------------------------------------------------------------
# Function tool: record the call outcome
# ---------------------------------------------------------------------------
def build_tools() -> list[Tool]:
    return [
        FunctionTool(
            name="record_outcome",
            description="Record the result of the appointment reminder call.",
            parameters={
                "type": "object",
                "properties": {
                    "status": {
                        "type": "string",
                        "enum": ["confirmed", "reschedule", "cancel"],
                        "description": "The customer's decision about the appointment.",
                    },
                    "notes": {
                        "type": "string",
                        "description": "Any details, e.g. a preferred reschedule time.",
                    },
                },
                "required": ["status"],
            },
        ),
    ]


def record_outcome(args: Dict[str, Any], context: Dict[str, str]) -> Dict[str, Any]:
    """Persist the call outcome as a JSON file."""
    os.makedirs(OUTCOMES_DIR, exist_ok=True)
    from datetime import datetime, timezone

    record = {
        "recorded_at": datetime.now(timezone.utc).isoformat(),
        "customer_name": context.get("customer_name", ""),
        "appointment_time": context.get("appointment_time", ""),
        "status": args.get("status", ""),
        "notes": args.get("notes", ""),
    }
    filename = os.path.join(
        OUTCOMES_DIR, f"outcome_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
    )
    with open(filename, "w", encoding="utf-8") as f:
        json.dump(record, f, indent=2)
    logger.info("Recorded outcome '%s' to %s", record["status"], filename)
    return {"status": "recorded"}


# ---------------------------------------------------------------------------
# Twilio <-> Voice Live bridge for a single outbound call
# ---------------------------------------------------------------------------
class CallBridge:
    """Bridges one outbound Twilio Media Stream to one Voice Live session."""

    def __init__(self, websocket: WebSocket, connection: VoiceLiveConnection):
        self.websocket = websocket
        self.connection = connection
        self.stream_sid: Optional[str] = None
        self.active_response = False
        self._pending_call: Optional[Dict[str, Any]] = None
        # Appointment context, populated from Twilio <Parameter> values.
        self.context: Dict[str, str] = {"customer_name": "there", "appointment_time": "your appointment"}

    async def configure_session(self) -> None:
        voice_config: Union[AzureStandardVoice, str]
        voice_config = AzureStandardVoice(name=VOICE) if "-" in VOICE else VOICE

        session = RequestSession(
            modalities=[Modality.TEXT, Modality.AUDIO],
            instructions=build_instructions(
                self.context["customer_name"], self.context["appointment_time"]
            ),
            voice=voice_config,
            input_audio_format=InputAudioFormat.G711_ULAW,
            output_audio_format=OutputAudioFormat.G711_ULAW,
            turn_detection=ServerVad(
                threshold=0.5, prefix_padding_ms=300, silence_duration_ms=500
            ),
            tools=build_tools(),
            tool_choice=ToolChoiceLiteral.AUTO,
            input_audio_transcription=AudioInputTranscriptionOptions(model="whisper-1"),
        )
        await self.connection.session.update(session=session)
        logger.info(
            "Session configured for %s (%s)",
            self.context["customer_name"],
            self.context["appointment_time"],
        )

    # --- Twilio -> Voice Live -------------------------------------------------
    async def pump_twilio_to_voicelive(self) -> None:
        try:
            while True:
                message = await self.websocket.receive_text()
                data = json.loads(message)
                event = data.get("event")

                if event == "start":
                    start = data["start"]
                    self.stream_sid = start["streamSid"]
                    # Appointment details arrive as custom stream parameters.
                    params = start.get("customParameters", {}) or {}
                    if params.get("customer_name"):
                        self.context["customer_name"] = params["customer_name"]
                    if params.get("appointment_time"):
                        self.context["appointment_time"] = params["appointment_time"]
                    logger.info("Outbound call started (streamSid=%s)", self.stream_sid)
                    # Reconfigure with the now-known appointment details, then greet.
                    await self.configure_session()
                    await self.connection.response.create()

                elif event == "media":
                    await self.connection.input_audio_buffer.append(
                        audio=data["media"]["payload"]
                    )

                elif event == "stop":
                    logger.info("Call stopped by Twilio")
                    break
        except WebSocketDisconnect:
            logger.info("Twilio WebSocket disconnected")

    # --- Voice Live -> Twilio -------------------------------------------------
    async def pump_voicelive_to_twilio(self) -> None:
        async for event in self.connection:
            if event.type == ServerEventType.RESPONSE_CREATED:
                self.active_response = True

            elif event.type == ServerEventType.RESPONSE_AUDIO_DELTA:
                if self.stream_sid is None:
                    continue
                payload = base64.b64encode(event.delta).decode("utf-8")
                await self.websocket.send_json(
                    {
                        "event": "media",
                        "streamSid": self.stream_sid,
                        "media": {"payload": payload},
                    }
                )

            elif event.type == ServerEventType.INPUT_AUDIO_BUFFER_SPEECH_STARTED:
                if self.stream_sid is not None:
                    await self.websocket.send_json(
                        {"event": "clear", "streamSid": self.stream_sid}
                    )
                if self.active_response:
                    try:
                        await self.connection.response.cancel()
                    except Exception as exc:  # noqa: BLE001
                        logger.debug("Cancel ignored: %s", exc)

            elif event.type == ServerEventType.RESPONSE_DONE:
                self.active_response = False
                if self._pending_call and "arguments" in self._pending_call:
                    await self._execute_function_call(self._pending_call)
                    self._pending_call = None

            elif event.type == ServerEventType.CONVERSATION_ITEM_CREATED:
                if event.item.type == ItemType.FUNCTION_CALL:
                    self._pending_call = {
                        "name": event.item.name,
                        "call_id": event.item.call_id,
                        "previous_item_id": event.item.id,
                    }

            elif event.type == ServerEventType.RESPONSE_FUNCTION_CALL_ARGUMENTS_DONE:
                if self._pending_call and event.call_id == self._pending_call["call_id"]:
                    self._pending_call["arguments"] = event.arguments

            elif event.type == ServerEventType.ERROR:
                logger.error("Voice Live error: %s", event.error.message)

    async def _execute_function_call(self, call: Dict[str, Any]) -> None:
        name = call["name"]
        try:
            args = json.loads(call["arguments"]) if call.get("arguments") else {}
        except json.JSONDecodeError:
            args = {}

        if name == "record_outcome":
            result = record_outcome(args, self.context)
        else:
            result = {"error": f"Unknown function {name}"}

        output = FunctionCallOutputItem(call_id=call["call_id"], output=json.dumps(result))
        await self.connection.conversation.item.create(
            previous_item_id=call["previous_item_id"], item=output
        )
        await self.connection.response.create()


# ---------------------------------------------------------------------------
# FastAPI app
# ---------------------------------------------------------------------------
app = FastAPI(title="Voice Live Outbound Appointment Reminder")


def _credential():
    if USE_TOKEN_CREDENTIAL or not API_KEY:
        return DefaultAzureCredential()
    return AzureKeyCredential(API_KEY)


def _xml_escape(value: str) -> str:
    return (
        value.replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
    )


@app.get("/health")
async def health() -> Dict[str, str]:
    return {"status": "ok"}


@app.api_route("/outbound-twiml", methods=["GET", "POST"])
async def outbound_twiml(request: Request) -> PlainTextResponse:
    """TwiML fetched by Twilio when the outbound call connects.

    Appointment details are supplied as query params by make_call.py and passed
    to the media stream as <Parameter> values.
    """
    params = dict(request.query_params)
    customer_name = _xml_escape(params.get("customer_name", "there"))
    appointment_time = _xml_escape(params.get("appointment_time", "your appointment"))
    host = request.headers.get("host")
    twiml = (
        '<?xml version="1.0" encoding="UTF-8"?>'
        "<Response>"
        f'<Connect><Stream url="wss://{host}/media-stream">'
        f'<Parameter name="customer_name" value="{customer_name}" />'
        f'<Parameter name="appointment_time" value="{appointment_time}" />'
        "</Stream></Connect>"
        "</Response>"
    )
    return PlainTextResponse(content=twiml, media_type="text/xml")


@app.websocket("/media-stream")
async def media_stream(websocket: WebSocket) -> None:
    import asyncio

    await websocket.accept()
    logger.info("Twilio connected to /media-stream")

    credential = _credential()
    try:
        async with connect(endpoint=ENDPOINT, credential=credential, model=MODEL) as connection:
            bridge = CallBridge(websocket, connection)
            # Session is configured after the 'start' event delivers appointment
            # details, inside pump_twilio_to_voicelive.
            await asyncio.gather(
                bridge.pump_twilio_to_voicelive(),
                bridge.pump_voicelive_to_twilio(),
            )
    except WebSocketDisconnect:
        logger.info("Call ended")
    except Exception:  # noqa: BLE001
        logger.exception("Bridge error")
    finally:
        if hasattr(credential, "close"):
            await credential.close()


if __name__ == "__main__":
    if not ENDPOINT:
        raise SystemExit("AZURE_VOICELIVE_ENDPOINT is required. Copy .env_sample to .env and fill it in.")
    logger.info("Starting outbound appointment reminder on port %d", PORT)
    uvicorn.run(app, host="0.0.0.0", port=PORT)
