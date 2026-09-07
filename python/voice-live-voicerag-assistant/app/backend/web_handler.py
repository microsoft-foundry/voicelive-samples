"""
WebSocket-based Voice Assistant Handler
Designed for cloud/container deployments without PyAudio dependencies.
Handles audio streaming via WebSocket to/from frontend.
"""

import asyncio
import json
import logging
import base64
import os
from typing import Dict, Any, Optional, Callable
from azure.core.credentials import AzureKeyCredential
from azure.ai.voicelive.aio import connect
from azure.ai.voicelive.models import (
    RequestSession,
    ServerEventType,
    AzureStandardVoice,
    Modality,
    InputAudioFormat,
    OutputAudioFormat,
    FunctionCallOutputItem,
    ItemType,
    ToolChoiceLiteral,
    ResponseFunctionCallItem,
    ServerEventConversationItemCreated,
    ServerEventResponseFunctionCallArgumentsDone,
    AudioInputTranscriptionOptions,
    AzureSemanticVad,
    AzureSemanticDetection,
    MessageItem,
    ResponseCreateParams,
)
from fastapi import WebSocket

# Set up logging
logger = logging.getLogger(__name__)


class WebSocketAudioProcessor:
    """
    Handles audio processing for WebSocket-based voice assistant.
    Streams audio to/from frontend via WebSocket instead of using local audio devices.
    """

    def __init__(self):
        self.websocket_callback: Optional[Callable] = None
        self.is_active = False
        self.conversation_started = False

    def set_websocket_callback(self, callback: Callable):
        """Set callback to send audio data via WebSocket."""
        self.websocket_callback = callback
        logger.info("WebSocket callback set for audio streaming")

    async def queue_audio(self, audio_data: bytes):
        """Queue audio data for streaming to frontend."""
        if self.websocket_callback:
            try:
                await self.websocket_callback(audio_data)
            except Exception as e:
                logger.error(f"Error streaming audio via WebSocket: {e}")
        else:
            logger.warning("No WebSocket callback set for audio streaming")

    async def process_input_audio(self, audio_base64: str, connection):
        """Process audio input received from frontend."""
        try:
            await connection.input_audio_buffer.append(audio=audio_base64)
            logger.debug("Audio input processed from frontend")
        except Exception as e:
            logger.error(f"Error processing input audio: {e}")

    async def start(self):
        """Start the audio processor."""
        self.is_active = True
        logger.info("WebSocket audio processor started")

    async def stop(self):
        """Stop the audio processor."""
        self.is_active = False
        logger.info("WebSocket audio processor stopped")

    async def cleanup(self):
        """Clean up resources."""
        await self.stop()
        self.websocket_callback = None
        logger.info("WebSocket audio processor cleaned up")

    async def stop_playback(self):
        """Stop audio playback immediately."""
        if self.websocket_callback:
            try:
                # Send stop signal via WebSocket
                await self.websocket_callback(b'')  # Empty audio = stop signal
            except Exception as e:
                logger.error(f"Error stopping playback: {e}")
        logger.info("Audio playback stopped")

class VoiceAssistantBridge:
    """Bridge between frontend WebSocket and Azure VoiceLive API"""

    def __init__(self):
        self.active_connections: Dict[str, WebSocket] = {}
        self.voice_clients: Dict[str, WebSocketVoiceClient] = {}

    async def connect(self, websocket: WebSocket, client_id: str):
        """Accept a new WebSocket connection"""
        await websocket.accept()
        self.active_connections[client_id] = websocket
        logger.info(f"Client {client_id} connected")

    async def disconnect(self, client_id: str):
        """Handle WebSocket disconnection"""
        if client_id in self.active_connections:
            del self.active_connections[client_id]
        if client_id in self.voice_clients:
            # Cleanup voice client
            voice_client = self.voice_clients[client_id]
            await voice_client.cleanup()
            del self.voice_clients[client_id]
        logger.info(f"Client {client_id} disconnected")

    async def send_message(self, client_id: str, message: dict):
        """Send message to specific client"""
        if client_id in self.active_connections:
            websocket = self.active_connections[client_id]
            try:
                await websocket.send_text(json.dumps(message))
            except Exception as e:
                logger.error(f"Error sending message to {client_id}: {e}")
                await self.disconnect(client_id)

    async def broadcast(self, message: dict):
        """Broadcast message to all connected clients"""
        for client_id in list(self.active_connections.keys()):
            await self.send_message(client_id, message)


class WebSocketVoiceClient:
    """
    WebSocket-based voice client for cloud/container deployments.
    Handles voice conversation via Azure VoiceLive API with WebSocket audio streaming.
    """

    def __init__(
        self,
        client_id: str,
        endpoint: str,
        credential: AzureKeyCredential,
        bridge: VoiceAssistantBridge,
        model: str = None,
        voice: str = None,
        transcribe_model: str = None,
        instructions: str = "",
        tools: list = None,
        websocket_callback: Optional[Callable] = None,
        conversation_started: bool = False,
    ):
        self.client_id = client_id
        self.endpoint = endpoint
        self.credential = credential
        self.model = model or os.getenv("VOICELIVE_MODEL", "gpt-realtime")
        self.voice = voice or os.getenv("VOICELIVE_VOICE", "en-US-Ava:DragonHDLatestNeural")
        self.transcribe_model = transcribe_model or os.getenv("VOICELIVE_TRANSCRIBE_MODEL", "gpt-4o-transcribe")
        self.instructions = instructions
        self.tools = tools or []
        self.websocket_callback = websocket_callback
        self.bridge = bridge
        self.conversation_started = conversation_started

        # Initialize audio processor
        self.audio_processor = WebSocketAudioProcessor()
        if websocket_callback:
            self.audio_processor.set_websocket_callback(websocket_callback)

        # Session state
        self.connection = None
        self.session = None
        self.is_running = False
        self.function_call_in_progress = False
        self.active_call_id = None

        # Available functions - load from YAML configuration
        self.available_functions = {}
        self._register_functions()

        logger.info(f"WebSocket voice client initialized for {client_id}")

    def _register_functions(self):
        """Register available functions from YAML configuration."""
        try:
            from tool_loader import get_tool_loader

            tool_loader = get_tool_loader()
            self.available_functions = tool_loader.get_function_implementations()
            logger.info(
                f"Registered {len(self.available_functions)} functions from YAML config"
            )
        except ImportError:
            logger.warning("Tool loader not found, no functions registered")
        except Exception as e:
            logger.error(f"Error loading functions from config: {e}")
            self.available_functions = {}

    async def run(self):
        """Start the voice client session."""
        try:
            self.is_running = True
            logger.info(f"Connecting to VoiceLive API with model {self.model}")

            async with connect(
                endpoint=self.endpoint,
                credential=self.credential,
                model=self.model,
            ) as connection:
                self.connection = connection

                # Start audio processor
                await self.audio_processor.start()

                # Configure session
                await self._setup_session(connection)

                logger.info("🎤 Voice assistant ready! Start speaking...")

                # Process events
                await self._process_events(connection)

        except Exception as e:
            logger.error(f"Voice client error: {e}")
            raise
        finally:
            await self.cleanup()

    async def _setup_session(self, connection):
        """Setup the voice session with tools."""
        try:
            # Create session configuration
            try:
                # Determine if end_of_utterance_detection is supported
                # It's only supported for cascaded pipelines, not gpt-realtime models
                realtime_models = ["gpt-realtime", "gpt-realtime-mini", "phi4-mm-realtime"]
                supports_eou_detection = self.model not in realtime_models
                
                # Build turn detection configuration
                if supports_eou_detection:
                    turn_detection = AzureSemanticVad(
                        threshold=0.3,
                        prefix_padding_ms=300,
                        speech_duration_ms=80,
                        silence_duration_ms=500,
                        remove_filler_words=True,
                        interrupt_response=True,
                        end_of_utterance_detection=AzureSemanticDetection(
                            threshold_level="default",
                            timeout_ms=1000
                        )
                    )
                else:
                    turn_detection = AzureSemanticVad(
                        threshold=0.3,
                        prefix_padding_ms=300,
                        speech_duration_ms=80,
                        silence_duration_ms=500,
                        remove_filler_words=True,
                        interrupt_response=True,
                    )
                
                session_config = RequestSession(
                    modalities=[Modality.TEXT, Modality.AUDIO],
                    instructions=self.instructions,
                    voice=AzureStandardVoice(name=self.voice, type="azure-standard"),
                    input_audio_format=InputAudioFormat.PCM16,
                    output_audio_format=OutputAudioFormat.PCM16,
                    input_audio_transcription=AudioInputTranscriptionOptions(
                        model=self.transcribe_model
                    ),
                    turn_detection=turn_detection,
                    tools=self.tools,
                    tool_choice=ToolChoiceLiteral.AUTO,
                    temperature=0.6,
                    max_response_output_tokens=4096,
                )
            except Exception as e:
                logger.error(f"Failed to create session configuration: {e}")
                raise

            # Send session configuration
            await connection.session.update(session=session_config)

            # Wait for session to be ready
            try:
                session_updated = await self._wait_for_event(
                    connection, {ServerEventType.SESSION_UPDATED}
                )
                if session_updated is None:
                    raise ValueError("SESSION_UPDATED event not received")
                if (
                    not hasattr(session_updated, "session")
                    or session_updated.session is None
                ):
                    raise ValueError("SESSION_UPDATED event has no session data")

                self.session = session_updated.session
                logger.info(f"Session ready: {self.session.id}")

                # Invoke Proactive greeting
                if not self.conversation_started:
                    self.conversation_started = True
                    logger.info("Sending proactive greeting request")
                    try:
                        await connection.response.create()

                    except Exception:
                        logger.error("Failed to send proactive greeting request")

            except asyncio.TimeoutError:
                logger.error("Timeout waiting for SESSION_UPDATED event")
                raise
            except Exception as e:
                logger.error(f"Error waiting for session update: {e}")
                raise

        except Exception as e:
            logger.error(f"Failed to setup session: {e}")
            raise

    async def _process_events(self, connection):
        """Process incoming events from VoiceLive API."""
        try:
            async for event in connection:
                if not self.is_running:
                    break

                await self._handle_event(event, connection)

        except Exception as e:
            logger.error(f"Error processing events: {e}")
            raise

    async def _handle_event(self, event, connection):
        """Handle individual events from VoiceLive API."""
        try:
            event_type = event.type

            # Audio events
            if event_type == ServerEventType.RESPONSE_AUDIO_DELTA:
                if hasattr(event, "delta") and event.delta:
                    await self.audio_processor.queue_audio(event.delta)

            elif event_type == ServerEventType.RESPONSE_AUDIO_DONE:
                logger.info("🔊 Audio response complete")

            # Speech detection events
            elif event_type == ServerEventType.INPUT_AUDIO_BUFFER_SPEECH_STARTED:
                logger.info("🎤 User started speaking")
                await self._handle_user_interruption()

            elif event_type == ServerEventType.INPUT_AUDIO_BUFFER_SPEECH_STOPPED:
                logger.info("🎤 User stopped speaking")
                await self._handle_user_speech_end()

            # Response events
            elif event_type == ServerEventType.RESPONSE_CREATED:
                logger.info("🤖 Assistant response created")

            elif event_type == ServerEventType.RESPONSE_DONE:
                logger.info("✅ Response complete")

            # Function call events
            elif event_type == ServerEventType.CONVERSATION_ITEM_CREATED:
                await self._handle_conversation_item_created(event, connection)

            # Text transcription events
            elif (
                event_type
                == ServerEventType.CONVERSATION_ITEM_INPUT_AUDIO_TRANSCRIPTION_COMPLETED
            ):
                if hasattr(event, "transcript"):
                    logger.info(f"📝 Transcription: {event.transcript}")

            # Error events
            elif event_type == ServerEventType.ERROR:
                logger.error(f"❌ VoiceLive error: {event}")

        except Exception as e:
            logger.error(f"Error handling event {event_type}: {e}")

    async def _handle_conversation_item_created(self, event, connection):
        """Handle conversation item creation, including function calls."""
        try:
            if not hasattr(event, "item"):
                return

            item = event.item
            logger.info(f"Conversation item created: {item.id}")

            # Check if this is a function call
            if (
                hasattr(item, "type")
                and item.type == ItemType.FUNCTION_CALL
                and hasattr(item, "call_id")
            ):

                await self._handle_function_call_with_improved_pattern(
                    event, connection
                )

        except Exception as e:
            logger.error(f"Error handling conversation item: {e}")

    async def _handle_function_call_with_improved_pattern(
        self, conversation_created_event, connection
    ):
        """Enhanced function call handler with WebSocket events"""
        # Validate the event structure
        if not isinstance(conversation_created_event, type(conversation_created_event)):
            logger.error("Expected ServerEventConversationItemCreated")
            return

        if not hasattr(conversation_created_event.item, "call_id"):
            logger.error("Expected ResponseFunctionCallItem")
            return

        function_call_item = conversation_created_event.item
        function_name = function_call_item.name
        call_id = function_call_item.call_id
        previous_item_id = function_call_item.id

        logger.info(f"Function call detected: {function_name} with call_id: {call_id}")

        # Send function call started event
        await self.bridge.send_message(
            self.client_id,
            {
                "type": "tool_call_started",
                "function_name": function_name,
                "call_id": call_id,
                "timestamp": asyncio.get_event_loop().time(),
            },
        )

        try:
            # Set tracking variables
            self.function_call_in_progress = True
            self.active_call_id = call_id

            # Wait for the function arguments to be complete
            function_done = await self._wait_for_event(
                connection, {ServerEventType.RESPONSE_FUNCTION_CALL_ARGUMENTS_DONE}
            )

            if function_done.call_id != call_id:
                logger.warning(
                    f"Call ID mismatch: expected {call_id}, got {function_done.call_id}"
                )
                return

            arguments = function_done.arguments
            logger.info(f"Function arguments received: {arguments}")

            # Send function arguments received event
            await self.bridge.send_message(
                self.client_id,
                {
                    "type": "tool_call_arguments",
                    "function_name": function_name,
                    "call_id": call_id,
                    "arguments": arguments,
                    "timestamp": asyncio.get_event_loop().time(),
                },
            )

            # Wait for response to be done before proceeding
            await self._wait_for_event(connection, {ServerEventType.RESPONSE_DONE})

            # Execute the function if we have it
            if function_name in self.available_functions:
                logger.info(f"Executing function: {function_name}")

                # Send function executing event
                await self.bridge.send_message(
                    self.client_id,
                    {
                        "type": "tool_call_executing",
                        "function_name": function_name,
                        "call_id": call_id,
                        "timestamp": asyncio.get_event_loop().time(),
                    },
                )

                # Execute the function
                start_time = asyncio.get_event_loop().time()
                result = await self.available_functions[function_name](arguments)
                end_time = asyncio.get_event_loop().time()

                # Send function completed event
                await self.bridge.send_message(
                    self.client_id,
                    {
                        "type": "tool_call_completed",
                        "function_name": function_name,
                        "call_id": call_id,
                        "result": result,
                        "execution_time": end_time - start_time,
                        "timestamp": end_time,
                    },
                )

                # Create function call output item
                from azure.ai.voicelive.models import FunctionCallOutputItem

                function_output = FunctionCallOutputItem(
                    call_id=call_id, output=json.dumps(result)
                )

                # Send the result back to the conversation with proper previous_item_id
                await connection.conversation.item.create(
                    previous_item_id=previous_item_id, item=function_output
                )

                logger.info(f"Function result sent: {result}")

                # Create a new response to process the function result
                await connection.response.create()

            else:
                logger.error(f"Unknown function: {function_name}")

                # Send function error event
                await self.bridge.send_message(
                    self.client_id,
                    {
                        "type": "tool_call_error",
                        "function_name": function_name,
                        "call_id": call_id,
                        "error": f"Unknown function: {function_name}",
                        "timestamp": asyncio.get_event_loop().time(),
                    },
                )

        except asyncio.TimeoutError:
            error_msg = (
                f"Timeout waiting for function call completion for {function_name}"
            )
            logger.error(error_msg)

            # Send timeout event
            await self.bridge.send_message(
                self.client_id,
                {
                    "type": "tool_call_error",
                    "function_name": function_name,
                    "call_id": call_id,
                    "error": error_msg,
                    "timestamp": asyncio.get_event_loop().time(),
                },
            )

        except Exception as e:
            error_msg = f"Error executing function {function_name}: {e}"
            logger.error(error_msg)

            # Send error event
            await self.bridge.send_message(
                self.client_id,
                {
                    "type": "tool_call_error",
                    "function_name": function_name,
                    "call_id": call_id,
                    "error": str(e),
                    "timestamp": asyncio.get_event_loop().time(),
                },
            )

        finally:
            self.function_call_in_progress = False
            self.active_call_id = None

    async def _wait_for_event(
        self, connection, wanted_types: set, timeout_s: float = 10.0
    ):
        """Wait for specific event types."""

        async def _next():
            async for event in connection:
                # Keep essential error logging
                if hasattr(event, "error"):
                    logger.error(f"Event has error: {event.error}")
                if event.type == ServerEventType.ERROR:
                    logger.error(f"VoiceLive API Error event received: {event}")

                if event.type in wanted_types:
                    return event

        try:
            result = await asyncio.wait_for(_next(), timeout=timeout_s)
            return result
        except asyncio.TimeoutError:
            logger.error(
                f"Timeout waiting for event types {wanted_types} after {timeout_s}s"
            )
            raise
        except Exception as e:
            logger.error(f"Error waiting for event: {e}")
            raise

    async def process_audio_input(self, audio_base64: str):
        """Process audio input from frontend."""
        if self.connection:
            await self.audio_processor.process_input_audio(
                audio_base64, self.connection
            )

    async def interrupt_response(self):
        """Interrupt current response and stop playback."""
        if self.connection:
            try:
                # Stop playback on frontend
                await self.bridge.send_message(self.client_id, {
                    "type": "stop_playback",
                    "reason": "manual_interrupt",
                    "timestamp": asyncio.get_event_loop().time()
                })
                
                # Cancel VoiceLive response
                await self.connection.response.cancel()
                
                logger.info("Response and playback interrupted")
            except Exception as e:
                logger.error(f"Error interrupting response: {e}")
    
    async def cleanup(self):
        """Clean up resources."""
        self.is_running = False
        if self.audio_processor:
            await self.audio_processor.cleanup()
        self.connection = None
        logger.info("Voice client cleaned up")

    async def _handle_user_interruption(self):
        """Handle user interrupting the assistant by speaking."""
        try:
            # Stop current audio playback via WebSocket
            await self.bridge.send_message(self.client_id, {
                "type": "stop_playback",
                "reason": "user_interruption",
                "timestamp": asyncio.get_event_loop().time()
            })

        except Exception as e:
            logger.error(f"Error handling user interruption: {e}")

    async def _handle_user_speech_end(self):
        """Handle when user stops speaking."""
        try:
            # Notify frontend that user finished speaking
            await self.bridge.send_message(self.client_id, {
                "type": "user_speech_ended",
                "timestamp": asyncio.get_event_loop().time()
            })
        except Exception as e:
            logger.error(f"Error handling speech end: {e}")
