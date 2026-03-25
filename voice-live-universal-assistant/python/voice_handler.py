"""
Voice Live Handler — bridges browser WebSocket ↔ Azure Voice Live SDK.
Supports Agent mode (Foundry Agent Service) and Model mode (direct gpt-realtime).
"""

import asyncio
import base64
import json
import logging
import os
from dataclasses import dataclass, field
from typing import Any, Callable, Coroutine, List, Optional, Union

from azure.ai.voicelive.aio import connect, AgentSessionConfig
from azure.ai.voicelive.models import (
    AssistantMessageItem,
    AudioEchoCancellation,
    AudioInputTranscriptionOptions,
    AudioNoiseReduction,
    AzureSemanticVad,
    AzureSemanticVadEn,
    AzureSemanticVadMultilingual,
    AzureStandardVoice,
    InputAudioFormat,
    InputTextContentPart,
    InterimResponseTrigger,
    LlmInterimResponseConfig,
    MessageItem,
    Modality,
    OpenAIVoice,
    OutputAudioFormat,
    OutputTextContentPart,
    RequestSession,
    ResponseCreateParams,
    ServerEventType,
    ServerVad,
    StaticInterimResponseConfig,
)

logger = logging.getLogger(__name__)

# Type alias for the callback that sends JSON messages back to the browser
SendMessageFn = Callable[[dict], Coroutine[Any, Any, None]]


# ---------------------------------------------------------------------------
# Session configuration — @dataclass following SDK sample conventions
# ---------------------------------------------------------------------------

# VAD type string → SDK class mapping
VAD_TYPES = {
    "azure_semantic": AzureSemanticVad,
    "azure_semantic_en": AzureSemanticVadEn,
    "azure_semantic_multilingual": AzureSemanticVadMultilingual,
    "server": ServerVad,
}


@dataclass
class SessionConfig:
    """Application-level session configuration.

    Mirrors the settings from the frontend UI and provides typed builder
    methods that return the appropriate SDK objects.  This follows the
    pattern used in the official Voice Live SDK samples.
    """

    # Connection / mode
    mode: str = "model"
    model: str = "gpt-realtime"
    voice: str = "en-US-Ava:DragonHDLatestNeural"
    voice_type: str = "azure-standard"
    instructions: str = ""
    temperature: float = 0.7

    # Audio processing
    vad_type: str = "azure_semantic"
    noise_reduction: bool = True
    echo_cancellation: bool = True

    # Speech input
    transcribe_model: str = "gpt-4o-transcribe"
    input_language: str = ""

    # Agent mode
    agent_name: Optional[str] = None
    project_name: Optional[str] = None
    agent_version: Optional[str] = None
    conversation_id: Optional[str] = None
    foundry_resource_override: Optional[str] = None
    auth_identity_client_id: Optional[str] = None
    byom_profile: Optional[str] = None

    # Proactive engagement
    proactive_greeting: bool = True
    greeting_type: str = "llm"
    greeting_text: str = ""

    # Interim response
    interim_response: bool = False
    interim_response_type: str = "llm"
    interim_trigger_tool: bool = True
    interim_trigger_latency: bool = True
    interim_latency_ms: int = 100
    interim_instructions: str = ""
    interim_static_texts: str = ""

    # -- SDK object builders ------------------------------------------------

    def get_voice(self) -> Union[AzureStandardVoice, OpenAIVoice]:
        """Return the SDK voice object for this configuration."""
        if self.voice_type == "openai":
            return OpenAIVoice(name=self.voice)
        return AzureStandardVoice(name=self.voice)

    def get_turn_detection(self) -> Union[AzureSemanticVad, AzureSemanticVadEn, AzureSemanticVadMultilingual, ServerVad]:
        """Return the SDK VAD object matching the configured type."""
        vad_cls = VAD_TYPES.get(self.vad_type, AzureSemanticVad)
        return vad_cls()

    def get_transcription_options(self) -> AudioInputTranscriptionOptions:
        """Return the SDK transcription config for the selected model."""
        if self.input_language:
            return AudioInputTranscriptionOptions(
                model=self.transcribe_model,
                language=self.input_language,
            )
        return AudioInputTranscriptionOptions(model=self.transcribe_model)

    def get_interim_response_config(self) -> Optional[Union[LlmInterimResponseConfig, StaticInterimResponseConfig]]:
        """Return the SDK interim response config, or None if disabled."""
        if not self.interim_response:
            return None

        triggers: List[InterimResponseTrigger] = []
        if self.interim_trigger_tool:
            triggers.append(InterimResponseTrigger.TOOL)
        if self.interim_trigger_latency:
            triggers.append(InterimResponseTrigger.LATENCY)

        if not triggers:
            return None

        latency_ms = self.interim_latency_ms if self.interim_trigger_latency else None

        if self.interim_response_type == "static":
            texts = [t.strip() for t in self.interim_static_texts.split("\n") if t.strip()]
            return StaticInterimResponseConfig(
                triggers=triggers,
                latency_threshold_ms=latency_ms,
                texts=texts or ["One moment please..."],
            )

        instructions = (
            self.interim_instructions
            or "Create friendly interim responses indicating wait time due to ongoing processing, if any. Do not include in all responses!"
        )
        return LlmInterimResponseConfig(
            triggers=triggers,
            latency_threshold_ms=latency_ms,
            instructions=instructions,
        )

    def get_agent_session_config(self) -> AgentSessionConfig:
        """Return the SDK agent session config dict."""
        return {
            "agent_name": self.agent_name or "",
            "project_name": self.project_name or "",
            "agent_version": self.agent_version if self.agent_version else None,
            "conversation_id": self.conversation_id if self.conversation_id else None,
            "foundry_resource_override": self.foundry_resource_override if self.foundry_resource_override else None,
            "authentication_identity_client_id": (
                self.auth_identity_client_id
                if self.auth_identity_client_id and self.foundry_resource_override
                else None
            ),
        }

    def build_model_session(self) -> RequestSession:
        """Build a complete RequestSession for model mode.

        Follows the SDK sample pattern: create typed objects first,
        then pass them to RequestSession as named parameters.
        """
        sdk_voice = self.get_voice()
        sdk_turn_detection = self.get_turn_detection()
        sdk_transcription = self.get_transcription_options()
        sdk_interim_response = self.get_interim_response_config()

        kwargs: dict = {
            "modalities": [Modality.TEXT, Modality.AUDIO],
            "input_audio_format": InputAudioFormat.PCM16,
            "output_audio_format": OutputAudioFormat.PCM16,
            "voice": sdk_voice,
            "turn_detection": sdk_turn_detection,
            "input_audio_transcription": sdk_transcription,
            "temperature": self.temperature,
        }

        if self.instructions:
            kwargs["instructions"] = self.instructions
        if self.echo_cancellation:
            kwargs["input_audio_echo_cancellation"] = AudioEchoCancellation()
        if self.noise_reduction:
            kwargs["input_audio_noise_reduction"] = AudioNoiseReduction(type="azure_deep_noise_suppression")

        if sdk_interim_response is not None:
            kwargs["interim_response"] = sdk_interim_response

        return RequestSession(**kwargs)

    def build_agent_session(self) -> RequestSession:
        """Build a RequestSession for agent mode.

        In agent mode, tools/model are defined by the agent config on the
        server. Voice and audio processing settings are client-configurable.
        """
        kwargs: dict = {
            "modalities": [Modality.TEXT, Modality.AUDIO],
            "input_audio_format": InputAudioFormat.PCM16,
            "output_audio_format": OutputAudioFormat.PCM16,
            "voice": self.get_voice(),
            "turn_detection": self.get_turn_detection(),
        }

        if self.echo_cancellation:
            kwargs["input_audio_echo_cancellation"] = AudioEchoCancellation()
        if self.noise_reduction:
            kwargs["input_audio_noise_reduction"] = AudioNoiseReduction(type="azure_deep_noise_suppression")

        sdk_interim_response = self.get_interim_response_config()
        if sdk_interim_response is not None:
            kwargs["interim_response"] = sdk_interim_response

        return RequestSession(**kwargs)


class VoiceLiveHandler:
    """Manages a single VoiceLive session for one WebSocket client."""

    def __init__(
        self,
        client_id: str,
        endpoint: str,
        credential: Any,
        send_message: SendMessageFn,
        config: SessionConfig,
    ):
        self.client_id = client_id
        self.endpoint = endpoint
        self.credential = credential
        self.send = send_message
        self.config = config

        # Greeting state
        self.greeting_sent = False

        self.connection = None
        self.is_running = False
        self._event_task: Optional[asyncio.Task] = None
        self._assistant_transcript = ""

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    async def start(self) -> None:
        """Open VoiceLive connection and begin processing events."""
        self.is_running = True
        self._event_task = asyncio.create_task(self._run())

    async def send_audio(self, audio_base64: str) -> None:
        """Forward base64 PCM16 audio from the browser to VoiceLive."""
        if self.connection:
            try:
                await self.connection.input_audio_buffer.append(audio=audio_base64)
            except Exception as e:
                logger.error(f"[{self.client_id}] Error forwarding audio: {e}")

    async def interrupt(self) -> None:
        """Cancel the current response (user barge-in)."""
        if self.connection:
            try:
                await self.connection.response.cancel()
            except Exception as e:
                logger.debug(f"[{self.client_id}] No response to cancel: {e}")

    async def send_text(self, text: str) -> None:
        """Send a text message via Voice Live (conversation.item.create + response.create)."""
        if self.connection and text.strip():
            try:
                await self.connection.conversation.item.create(
                    item=MessageItem(
                        role="user",
                        content=[InputTextContentPart(text=text.strip())],
                    )
                )
                await self.connection.response.create()
            except Exception as e:
                logger.error(f"[{self.client_id}] Error sending text: {e}")

    async def stop(self) -> None:
        """Gracefully shut down the handler."""
        self.is_running = False
        if self._event_task and not self._event_task.done():
            self._event_task.cancel()
            try:
                await self._event_task
            except (asyncio.CancelledError, Exception):
                pass
        self.connection = None
        logger.info(f"[{self.client_id}] Handler stopped")

    # ------------------------------------------------------------------
    # Connection + session setup
    # ------------------------------------------------------------------

    async def _run(self) -> None:
        try:
            logger.info(
                f"[{self.client_id}] Connecting in {self.config.mode} mode "
                f"(model={self.config.model}, voice={self.config.voice})"
            )

            if self.config.mode == "agent":
                agent_config = self.config.get_agent_session_config()
                async with connect(
                    endpoint=self.endpoint,
                    credential=self.credential,
                    agent_config=agent_config,
                    api_version="2026-01-01-preview",
                ) as connection:
                    self.connection = connection
                    await self._configure_session(connection)
                    await self._process_events(connection)
            else:
                async with connect(
                    endpoint=self.endpoint,
                    credential=self.credential,
                    model=self.config.model,
                    api_version="2026-01-01-preview",
                    query={"profile": self.config.byom_profile} if self.config.byom_profile else None,
                ) as connection:
                    self.connection = connection
                    await self._configure_session(connection)
                    await self._process_events(connection)

        except asyncio.CancelledError:
            logger.info(f"[{self.client_id}] Event loop cancelled")
        except Exception as e:
            logger.error(f"[{self.client_id}] VoiceLive error: {e}")
            await self.send({"type": "error", "message": str(e)})
        finally:
            self.is_running = False
            self.connection = None

    async def _configure_session(self, connection) -> None:
        """Send session config and wait for SESSION_UPDATED."""
        if self.config.mode == "model":
            session_config = self.config.build_model_session()
        else:
            session_config = self.config.build_agent_session()

        await connection.session.update(session=session_config)
        try:
            config_dict = session_config.as_dict() if hasattr(session_config, "as_dict") else str(session_config)
            logger.info(
                f"[{self.client_id}] Session config SENT ({self.config.mode} mode):\n"
                f"{json.dumps(config_dict, indent=2, default=str)}"
            )
        except Exception:
            logger.info(f"[{self.client_id}] Session config sent ({self.config.mode} mode)")

    # ------------------------------------------------------------------
    # Proactive greeting helpers
    # ------------------------------------------------------------------

    async def _send_pre_generated_greeting(self, connection) -> None:
        """Send a pre-generated greeting — deterministic, developer-controlled text."""
        text = self.config.greeting_text or "Welcome! I'm here to help you get started."
        try:
            await connection.response.create(
                response=ResponseCreateParams(
                    pre_generated_assistant_message=AssistantMessageItem(
                        content=[OutputTextContentPart(text=text)]
                    )
                )
            )
            logger.info(f"[{self.client_id}] Pre-generated greeting sent")
        except Exception as e:
            logger.warning(f"[{self.client_id}] Pre-generated greeting failed: {e}")

    async def _send_llm_generated_greeting(self, connection) -> None:
        """Instruct the LLM to generate a greeting — dynamic, adaptive."""
        instruction = (
            self.config.greeting_text
            or "Greet the user warmly and briefly explain how you can help. Start the conversation in English."
        )
        try:
            await connection.conversation.item.create(
                item=MessageItem(
                    role="system",
                    content=[InputTextContentPart(text=instruction)],
                )
            )
            await connection.response.create()
            logger.info(f"[{self.client_id}] LLM-generated greeting triggered")
        except Exception as e:
            logger.warning(f"[{self.client_id}] LLM-generated greeting failed: {e}")

    # ------------------------------------------------------------------
    # Event loop
    # ------------------------------------------------------------------

    async def _process_events(self, connection) -> None:
        async for event in connection:
            if not self.is_running:
                break
            try:
                await self._handle_event(event, connection)
            except Exception as e:
                logger.error(f"[{self.client_id}] Event handling error: {e}")

    async def _handle_event(self, event, connection) -> None:  # noqa: C901
        t = event.type

        # -- Session created (carries service session ID) ------------------
        if t == ServerEventType.SESSION_CREATED:
            session_obj = getattr(event, "session", None)
            self._service_session_id = getattr(session_obj, "id", "") if session_obj else ""
            safe_sid = self._service_session_id.replace("\n", "").replace("\r", "")
            logger.info(f"[{self.client_id}] SESSION_CREATED — session_id: {safe_sid}")

        # -- Session ready ------------------------------------------------
        elif t == ServerEventType.SESSION_UPDATED:
            session_obj = getattr(event, "session", None)
            # Pick up session ID if not captured from SESSION_CREATED
            if not getattr(self, "_service_session_id", ""):
                self._service_session_id = getattr(session_obj, "id", "") if session_obj else ""

            if session_obj:
                try:
                    session_dict = session_obj.as_dict() if hasattr(session_obj, "as_dict") else str(session_obj)
                    logger.info(
                        f"[{self.client_id}] SESSION_UPDATED — server-confirmed config:\n"
                        f"{json.dumps(session_dict, indent=2, default=str)}"
                    )
                except Exception:
                    logger.info(f"[{self.client_id}] SESSION_UPDATED (could not serialize session)")
            else:
                logger.info(f"[{self.client_id}] SESSION_UPDATED (no session payload)")

            await self.send({
                "type": "session_started",
                "session_id": getattr(self, "_service_session_id", "") or self.client_id,
                "config": {
                    "mode": self.config.mode,
                    "model": self.config.model,
                    "voice": self.config.voice,
                },
            })
            await self.send({"type": "status", "state": "listening"})
            # Proactive greeting — trigger once per session
            if self.config.proactive_greeting and not self.greeting_sent:
                self.greeting_sent = True
                if self.config.greeting_type == "pregenerated":
                    await self._send_pre_generated_greeting(connection)
                else:
                    await self._send_llm_generated_greeting(connection)

        # -- User starts speaking (barge-in) ------------------------------
        elif t == ServerEventType.INPUT_AUDIO_BUFFER_SPEECH_STARTED:
            await self.send({"type": "status", "state": "listening"})
            await self.send({"type": "stop_playback"})
            try:
                await connection.response.cancel()
            except Exception:
                pass

        # -- User stops speaking ------------------------------------------
        elif t == ServerEventType.INPUT_AUDIO_BUFFER_SPEECH_STOPPED:
            await self.send({"type": "status", "state": "thinking"})

        # -- Response lifecycle -------------------------------------------
        elif t == ServerEventType.RESPONSE_CREATED:
            await self.send({"type": "status", "state": "speaking"})

        elif t == ServerEventType.RESPONSE_AUDIO_DELTA:
            if hasattr(event, "delta") and event.delta:
                audio_b64 = base64.b64encode(event.delta).decode("utf-8")
                await self.send({
                    "type": "audio_data",
                    "data": audio_b64,
                    "format": "pcm16",
                    "sampleRate": 24000,
                    "channels": 1,
                })

        elif t == ServerEventType.RESPONSE_AUDIO_DONE:
            logger.debug(f"[{self.client_id}] Audio response complete")

        elif t == ServerEventType.RESPONSE_DONE:
            # Flush accumulated assistant transcript as final
            if self._assistant_transcript:
                await self.send({
                    "type": "transcript",
                    "role": "assistant",
                    "text": self._assistant_transcript,
                    "isFinal": True,
                })
                self._assistant_transcript = ""
            await self.send({"type": "status", "state": "listening"})

        # -- Transcription ------------------------------------------------
        elif t == ServerEventType.CONVERSATION_ITEM_INPUT_AUDIO_TRANSCRIPTION_COMPLETED:
            transcript = getattr(event, "transcript", "")
            if transcript:
                await self.send({
                    "type": "transcript",
                    "role": "user",
                    "text": transcript,
                    "isFinal": True,
                })

        elif t == ServerEventType.RESPONSE_AUDIO_TRANSCRIPT_DELTA:
            delta_text = getattr(event, "delta", "")
            if delta_text:
                self._assistant_transcript += delta_text
                await self.send({
                    "type": "transcript",
                    "role": "assistant",
                    "text": self._assistant_transcript,
                    "isFinal": False,
                })

        # -- Errors -------------------------------------------------------
        elif t == ServerEventType.ERROR:
            error_msg = getattr(event, "error", None)
            message = ""
            code = ""
            if error_msg:
                message = getattr(error_msg, "message", str(error_msg))
                code = getattr(error_msg, "code", "")
            else:
                message = str(event)

            # Benign cancellation errors — don't surface to client
            if code == "response_cancel_not_active" or "no active response" in message.lower():
                logger.debug(f"[{self.client_id}] Benign cancel error: {message}")
                return

            logger.error(f"[{self.client_id}] VoiceLive error event: {message}")
            await self.send({"type": "error", "message": message})
