# -------------------------------------------------------------------------
# Copyright (c) Microsoft Corporation. All rights reserved.
# Licensed under the MIT License.
# -------------------------------------------------------------------------
"""
Inbound AI Receptionist — Azure Voice Live + Twilio Media Streams.

A caller dials your Twilio number. Twilio opens a Media Stream WebSocket to this
server, which bridges the call audio to the Azure Voice Live API. Voice Live acts
as a receptionist: it greets the caller, answers questions, can take a message,
and can transfer the call to a human.

Run:
    python app.py
    # then expose it, e.g.:  ngrok http 8000
    # point your Twilio number's Voice webhook at  https://<public-host>/incoming-call
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
logger = logging.getLogger("inbound-receptionist")

# ---------------------------------------------------------------------------
# Configuration (from environment / .env)
# ---------------------------------------------------------------------------
ENDPOINT = os.environ.get("AZURE_VOICELIVE_ENDPOINT", "")
API_KEY = os.environ.get("AZURE_VOICELIVE_API_KEY", "")
MODEL = os.environ.get("AZURE_VOICELIVE_MODEL", "gpt-realtime")
VOICE = os.environ.get("AZURE_VOICELIVE_VOICE", "en-US-Ava:DragonHDLatestNeural")
USE_TOKEN_CREDENTIAL = os.environ.get("USE_TOKEN_CREDENTIAL", "false").lower() == "true"
PORT = int(os.environ.get("PORT", "8000"))

# Business details used to tailor the receptionist's behavior.
BUSINESS_NAME = os.environ.get("BUSINESS_NAME", "Contoso Dental")
TRANSFER_PHONE_NUMBER = os.environ.get("TRANSFER_PHONE_NUMBER", "")

# Twilio credentials are only needed for the "transfer to human" feature.
TWILIO_ACCOUNT_SID = os.environ.get("TWILIO_ACCOUNT_SID", "")
TWILIO_AUTH_TOKEN = os.environ.get("TWILIO_AUTH_TOKEN", "")

INSTRUCTIONS = os.environ.get(
    "RECEPTIONIST_INSTRUCTIONS",
    f"You are a friendly, professional AI receptionist for {BUSINESS_NAME}. "
    "Greet the caller warmly and ask how you can help. Answer questions about the "
    "business using the facts below. Keep responses short and natural — this is a "
    "phone call, so speak conversationally and avoid long monologues.\n\n"
    "Business facts:\n"
    "- Hours: Monday to Friday, 8am to 5pm. Closed weekends.\n"
    "- Location: 123 Main Street, Redmond, WA.\n"
    "- Services: general checkups, cleanings, fillings, and emergency dental care.\n"
    "- New patients are welcome.\n\n"
    "If the caller wants to leave a message, call the `take_message` function with "
    "their name, phone number, and message. If the caller asks to speak to a person "
    "or has an urgent issue you cannot resolve, call the `transfer_to_human` "
    "function. Always confirm details back to the caller before taking an action.",
)

MESSAGES_DIR = os.environ.get("MESSAGES_DIR", "./messages")


# ---------------------------------------------------------------------------
# Function tools the receptionist can call
# ---------------------------------------------------------------------------
def build_tools() -> list[Tool]:
    return [
        FunctionTool(
            name="take_message",
            description="Record a message from the caller for staff to follow up on.",
            parameters={
                "type": "object",
                "properties": {
                    "caller_name": {"type": "string", "description": "The caller's full name."},
                    "phone_number": {"type": "string", "description": "A callback phone number."},
                    "message": {"type": "string", "description": "The message to pass on to staff."},
                },
                "required": ["caller_name", "message"],
            },
        ),
        FunctionTool(
            name="transfer_to_human",
            description="Transfer the current call to a human staff member.",
            parameters={
                "type": "object",
                "properties": {
                    "reason": {"type": "string", "description": "Why the caller needs a human."},
                },
                "required": [],
            },
        ),
    ]


def take_message(args: Dict[str, Any]) -> Dict[str, Any]:
    """Persist a caller message as a JSON file."""
    os.makedirs(MESSAGES_DIR, exist_ok=True)
    from datetime import datetime, timezone

    record = {
        "received_at": datetime.now(timezone.utc).isoformat(),
        "caller_name": args.get("caller_name", "Unknown"),
        "phone_number": args.get("phone_number", ""),
        "message": args.get("message", ""),
    }
    filename = os.path.join(
        MESSAGES_DIR, f"message_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
    )
    with open(filename, "w", encoding="utf-8") as f:
        json.dump(record, f, indent=2)
    logger.info("Saved message to %s", filename)
    return {"status": "saved", "confirmation": "Your message has been recorded."}


# ---------------------------------------------------------------------------
# Twilio <-> Voice Live bridge for a single call
# ---------------------------------------------------------------------------
class CallBridge:
    """Bridges one Twilio Media Stream to one Voice Live session."""

    def __init__(self, websocket: WebSocket, connection: VoiceLiveConnection):
        self.websocket = websocket
        self.connection = connection
        self.stream_sid: Optional[str] = None
        self.call_sid: Optional[str] = None
        self.active_response = False
        self._pending_call: Optional[Dict[str, Any]] = None

    async def configure_session(self) -> None:
        """Configure Voice Live for a G.711 μ-law telephone call."""
        voice_config: Union[AzureStandardVoice, str]
        voice_config = AzureStandardVoice(name=VOICE) if "-" in VOICE else VOICE

        session = RequestSession(
            modalities=[Modality.TEXT, Modality.AUDIO],
            instructions=INSTRUCTIONS,
            voice=voice_config,
            # Telephony audio: G.711 μ-law, 8kHz — matches Twilio Media Streams.
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
        logger.info("Voice Live session configured for telephony")

    # --- Twilio -> Voice Live -------------------------------------------------
    async def pump_twilio_to_voicelive(self) -> None:
        """Read Twilio media frames and forward audio to Voice Live."""
        try:
            while True:
                message = await self.websocket.receive_text()
                data = json.loads(message)
                event = data.get("event")

                if event == "start":
                    start = data["start"]
                    self.stream_sid = start["streamSid"]
                    self.call_sid = start.get("callSid")
                    logger.info("Call started (streamSid=%s callSid=%s)", self.stream_sid, self.call_sid)
                    # Greet the caller proactively.
                    await self.connection.response.create()

                elif event == "media":
                    # Twilio payload is base64 μ-law — forward as-is (no transcoding).
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
        """Read Voice Live events and stream audio back to the caller."""
        async for event in self.connection:
            if event.type == ServerEventType.RESPONSE_CREATED:
                self.active_response = True

            elif event.type == ServerEventType.RESPONSE_AUDIO_DELTA:
                if self.stream_sid is None:
                    continue
                # event.delta is raw μ-law bytes — base64-encode for Twilio.
                payload = base64.b64encode(event.delta).decode("utf-8")
                await self.websocket.send_json(
                    {
                        "event": "media",
                        "streamSid": self.stream_sid,
                        "media": {"payload": payload},
                    }
                )

            elif event.type == ServerEventType.INPUT_AUDIO_BUFFER_SPEECH_STARTED:
                # Barge-in: caller interrupted — flush Twilio's buffered audio
                # and cancel the in-progress Voice Live response.
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

        if name == "take_message":
            result = take_message(args)
        elif name == "transfer_to_human":
            result = self._transfer_to_human(args)
        else:
            result = {"error": f"Unknown function {name}"}

        output = FunctionCallOutputItem(call_id=call["call_id"], output=json.dumps(result))
        await self.connection.conversation.item.create(
            previous_item_id=call["previous_item_id"], item=output
        )
        await self.connection.response.create()

    def _transfer_to_human(self, args: Dict[str, Any]) -> Dict[str, Any]:
        """Redirect the live Twilio call to a human via the Twilio REST API."""
        if not (TRANSFER_PHONE_NUMBER and TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN):
            return {
                "status": "unavailable",
                "message": "Transfer is not configured. Offer to take a message instead.",
            }
        if not self.call_sid:
            return {"status": "error", "message": "No active call to transfer."}
        try:
            from twilio.rest import Client
            from twilio.twiml.voice_response import VoiceResponse, Dial

            response = VoiceResponse()
            response.say("Please hold while I connect you.")
            dial = Dial()
            dial.number(TRANSFER_PHONE_NUMBER)
            response.append(dial)

            client = Client(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN)
            client.calls(self.call_sid).update(twiml=str(response))
            logger.info("Transferred call %s to %s", self.call_sid, TRANSFER_PHONE_NUMBER)
            return {"status": "transferring", "message": "Connecting the caller now."}
        except Exception as exc:  # noqa: BLE001
            logger.exception("Transfer failed")
            return {"status": "error", "message": str(exc)}


# ---------------------------------------------------------------------------
# FastAPI app
# ---------------------------------------------------------------------------
app = FastAPI(title="Voice Live Inbound Receptionist")


def _credential():
    if USE_TOKEN_CREDENTIAL or not API_KEY:
        return DefaultAzureCredential()
    return AzureKeyCredential(API_KEY)


@app.get("/health")
async def health() -> Dict[str, str]:
    return {"status": "ok"}


@app.api_route("/incoming-call", methods=["GET", "POST"])
async def incoming_call(request: Request) -> PlainTextResponse:
    """Return TwiML that connects the inbound call to our media stream."""
    host = request.headers.get("host")
    twiml = (
        '<?xml version="1.0" encoding="UTF-8"?>'
        "<Response>"
        f'<Connect><Stream url="wss://{host}/media-stream" /></Connect>'
        "</Response>"
    )
    return PlainTextResponse(content=twiml, media_type="text/xml")


@app.websocket("/media-stream")
async def media_stream(websocket: WebSocket) -> None:
    """Twilio Media Stream endpoint — bridges the call to Voice Live."""
    import asyncio

    await websocket.accept()
    logger.info("Twilio connected to /media-stream")

    credential = _credential()
    try:
        async with connect(endpoint=ENDPOINT, credential=credential, model=MODEL) as connection:
            bridge = CallBridge(websocket, connection)
            await bridge.configure_session()
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
    logger.info("Starting inbound receptionist on port %d", PORT)
    uvicorn.run(app, host="0.0.0.0", port=PORT)
