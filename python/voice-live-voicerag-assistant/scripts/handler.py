import os
import sys
import asyncio
import json
import datetime
import logging
import base64
import signal
import threading
import queue
from typing import (
    Union,
    Optional,
    Dict,
    Any,
    Mapping,
    Callable,
    TYPE_CHECKING,
    List,
    cast,
)
from concurrent.futures import ThreadPoolExecutor

# Audio processing imports
try:
    import pyaudio
except ImportError:
    print("This sample requires pyaudio. Install with: pip install pyaudio")
    sys.exit(1)

# Environment variable loading
try:
    from dotenv import load_dotenv

    load_dotenv()
except ImportError:
    print("Note: python-dotenv not installed. Using existing environment variables.")

# Azure VoiceLive SDK imports
from azure.core.credentials import AzureKeyCredential, TokenCredential
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
    ServerEventConversationItemCreated,
    MessageItem,
    ResponseCreateParams,
)


# Set up logging
logging.basicConfig(
    level=logging.INFO, format="%(asctime)s - %(name)s - %(levelname)s - %(message)s"
)
logger = logging.getLogger(__name__)


async def _wait_for_event(conn, wanted_types: set, timeout_s: float = 10.0):
    """Wait until we receive any event whose type is in wanted_types."""

    async def _next():
        while True:
            evt = await conn.recv()
            if evt.type in wanted_types:
                return evt

    return await asyncio.wait_for(_next(), timeout=timeout_s)


async def _wait_for_match(
    conn,
    predicate: Callable[[Any], bool],
    timeout_s: float = 10.0,
):
    """Wait until we receive an event that satisfies the given predicate."""

    async def _next():
        while True:
            evt = await conn.recv()
            if predicate(evt):
                return evt

    return await asyncio.wait_for(_next(), timeout=timeout_s)


class AudioProcessor:
    """
    Handles real-time audio capture and playback for the voice assistant.

    Responsibilities:
    - Captures audio input from the microphone using PyAudio.
    - Plays back audio output using PyAudio.
    - Manages threading for audio capture, sending, and playback.
    - Uses queues to buffer audio data between threads.
    """

    def __init__(self, connection):
        self.connection = connection
        self.audio = pyaudio.PyAudio()

        # Audio configuration - PCM16, 24kHz, mono as specified
        self.format = pyaudio.paInt16
        self.channels = 1
        self.rate = 24000
        self.chunk_size = 1024

        # Capture and playback state
        self.is_capturing = False
        self.is_playing = False
        self.input_stream = None
        self.output_stream = None

        # Audio queues and threading
        self.audio_queue: "queue.Queue[bytes]" = queue.Queue()
        self.audio_send_queue: "queue.Queue[str]" = (
            queue.Queue()
        )  # base64 audio to send
        self.executor = ThreadPoolExecutor(max_workers=3)
        self.capture_thread: Optional[threading.Thread] = None
        self.playback_thread: Optional[threading.Thread] = None
        self.send_thread: Optional[threading.Thread] = None
        self.loop: Optional[asyncio.AbstractEventLoop] = None  # Store the event loop

        logger.info("AudioProcessor initialized with 24kHz PCM16 mono audio")

    async def start_capture(self):
        """Start capturing audio from microphone."""
        if self.is_capturing:
            return

        # Store the current event loop for use in threads
        self.loop = asyncio.get_event_loop()

        self.is_capturing = True

        try:
            self.input_stream = self.audio.open(
                format=self.format,
                channels=self.channels,
                rate=self.rate,
                input=True,
                frames_per_buffer=self.chunk_size,
                stream_callback=None,
            )

            self.input_stream.start_stream()

            # Start capture thread
            self.capture_thread = threading.Thread(target=self._capture_audio_thread)
            self.capture_thread.daemon = True
            self.capture_thread.start()

            # Start audio send thread
            self.send_thread = threading.Thread(target=self._send_audio_thread)
            self.send_thread.daemon = True
            self.send_thread.start()

            logger.info("Started audio capture")

        except Exception as e:
            logger.error(f"Failed to start audio capture: {e}")
            self.is_capturing = False
            raise

    def _capture_audio_thread(self):
        """Audio capture thread - runs in background."""
        while self.is_capturing and self.input_stream:
            try:
                # Read audio data
                audio_data = self.input_stream.read(
                    self.chunk_size, exception_on_overflow=False
                )

                if audio_data and self.is_capturing:
                    # Convert to base64 and queue for sending
                    audio_base64 = base64.b64encode(audio_data).decode("utf-8")
                    self.audio_send_queue.put(audio_base64)

            except Exception as e:
                if self.is_capturing:
                    logger.error(f"Error in audio capture: {e}")
                break

    def _send_audio_thread(self):
        """Audio send thread - handles async operations from sync thread."""
        while self.is_capturing:
            try:
                # Get audio data from queue (blocking with timeout)
                audio_base64 = self.audio_send_queue.get(timeout=0.1)

                if audio_base64 and self.is_capturing and self.loop:
                    # Schedule the async send operation in the main event loop
                    future = asyncio.run_coroutine_threadsafe(
                        self.connection.input_audio_buffer.append(audio=audio_base64),
                        self.loop,
                    )
                    # Don't wait for completion to avoid blocking

            except queue.Empty:
                continue
            except Exception as e:
                if self.is_capturing:
                    logger.error(f"Error sending audio: {e}")
                break

    async def stop_capture(self):
        """Stop capturing audio."""
        if not self.is_capturing:
            return

        self.is_capturing = False

        if self.input_stream:
            self.input_stream.stop_stream()
            self.input_stream.close()
            self.input_stream = None

        if self.capture_thread:
            self.capture_thread.join(timeout=1.0)

        if self.send_thread:
            self.send_thread.join(timeout=1.0)

        # Clear the send queue
        while not self.audio_send_queue.empty():
            try:
                self.audio_send_queue.get_nowait()
            except queue.Empty:
                break

        logger.info("Stopped audio capture")

    async def start_playback(self):
        """Initialize audio playback system."""
        if self.is_playing:
            return

        self.is_playing = True

        try:
            self.output_stream = self.audio.open(
                format=self.format,
                channels=self.channels,
                rate=self.rate,
                output=True,
                frames_per_buffer=self.chunk_size,
            )

            # Start playback thread
            self.playback_thread = threading.Thread(target=self._playback_audio_thread)
            self.playback_thread.daemon = True
            self.playback_thread.start()

            logger.info("Audio playback system ready")

        except Exception as e:
            logger.error(f"Failed to initialize audio playback: {e}")
            self.is_playing = False
            raise

    def _playback_audio_thread(self):
        """Audio playback thread - runs in background."""
        while self.is_playing:
            try:
                # Get audio data from queue (blocking with timeout)
                audio_data = self.audio_queue.get(timeout=0.1)

                if audio_data and self.output_stream and self.is_playing:
                    self.output_stream.write(audio_data)

            except queue.Empty:
                continue
            except Exception as e:
                if self.is_playing:
                    logger.error(f"Error in audio playback: {e}")
                break

    async def queue_audio(self, audio_data: bytes):
        """Queue audio data for playback."""
        if self.is_playing:
            self.audio_queue.put(audio_data)

    async def stop_playback(self):
        """Stop audio playback and clear queue."""
        if not self.is_playing:
            return

        self.is_playing = False

        # Clear the queue
        while not self.audio_queue.empty():
            try:
                self.audio_queue.get_nowait()
            except queue.Empty:
                break

        if self.output_stream:
            self.output_stream.stop_stream()
            self.output_stream.close()
            self.output_stream = None

        if self.playback_thread:
            self.playback_thread.join(timeout=1.0)

        logger.info("Stopped audio playback")

    async def cleanup(self):
        """Clean up audio resources."""
        await self.stop_capture()
        await self.stop_playback()

        if self.audio:
            self.audio.terminate()

        self.executor.shutdown(wait=True)
        logger.info("Audio processor cleaned up")

        if self.connection:
            try:
                await self.connection.close()
            except Exception as e:
                pass


class AsyncFunctionCallingClient:
    """Async client for Azure Voice Live API with function calling capabilities and audio input."""

    def __init__(
        self,
        endpoint: str,
        credential: Union[AzureKeyCredential, TokenCredential],
        model: str,
        voice: str,
        instructions: str,
        tools: List[dict],
    ):
        self.endpoint = endpoint
        self.credential = credential
        self.model = model
        self.voice = voice
        self.instructions = instructions
        self.session_id: Optional[str] = None
        self.function_call_in_progress: bool = False
        self.active_call_id: Optional[str] = None
        self.audio_processor: Optional[AudioProcessor] = None
        self.session_ready: bool = False
        self.tools = tools if tools is not None else {}

        # Define available functions
        self.available_functions = self._build_function_map()

    def _build_function_map(self) -> Dict[str, Callable]:
        """Build a mapping of function names to their implementations based on defined tools."""
        function_map = {}

        # Import your actual tool functions
        try:
            from functions.implementations import (
                get_user_information,
                get_product_information,
            )

            # Map function names to implementations
            available_implementations = {
                "get_user_information": get_user_information,
                "get_product_information": get_product_information,
            }

            # Only include functions that are defined in tools
            if self.tools:
                for tool in self.tools:
                    function_name = tool.get("name", None)
                    if function_name and function_name in available_implementations:
                        function_map[function_name] = available_implementations[
                            function_name
                        ]
                        logger.info(f"Registered function: {function_name}")
                    else:
                        logger.warning(
                            f"Function {function_name} defined in tools but implementation not found"
                        )

        except ImportError as e:
            logger.error(f"Failed to import functions module: {e}")

        return function_map

    async def run(self):
        """Run the async function calling client with audio input."""
        try:
            logger.info(f"Connecting to VoiceLive API with model {self.model}")

            # Connect to VoiceLive WebSocket API asynchronously
            async with connect(
                endpoint=self.endpoint,
                credential=self.credential,
                model=self.model,
                connection_options={
                    "max_msg_size": 10 * 1024 * 1024,
                    "heartbeat": 20,
                    "timeout": 20,
                },
            ) as connection:
                # Initialize audio processor
                self.audio_processor = AudioProcessor(connection)

                # Configure session with function tools
                await self._setup_session(connection)

                # Start audio playback system
                await self.audio_processor.start_playback()

                logger.info(
                    "Voice assistant with function calling ready! Start speaking..."
                )
                print("\n" + "=" * 70)
                print("🎤 VOICE ASSISTANT WITH FUNCTION CALLING READY")
                print("Try saying:")
                print("•  What is the due date of my bill?")
                print("•  What are the benefits of my card?")
                print("Press Ctrl+C to exit")
                print("=" * 70 + "\n")

                # Process events asynchronously
                await self._process_events(connection)

        except KeyboardInterrupt:
            logger.info("Received interrupt signal, shutting down...")
        except Exception as e:
            logger.error(f"Connection error: {e}")
            raise
        finally:
            # Cleanup audio processor
            if self.audio_processor:
                await self.audio_processor.cleanup()

    async def _setup_session(self, connection):
        """Configure the VoiceLive session with function tools asynchronously."""
        logger.info("Setting up voice conversation session with function tools...")

        # Create voice configuration
        voice_config = AzureStandardVoice(name=self.voice, type="azure-standard")

        # Create turn detection configuration
        turn_detection_config = AzureSemanticVad(
            threshold=0.5, prefix_padding_ms=300, silence_duration_ms=500
        )  # ServerVad(threshold=0.5, prefix_padding_ms=300, silence_duration_ms=500)

        # Create session configuration with function tools
        session_config = RequestSession(
            modalities=[Modality.TEXT, Modality.AUDIO],
            instructions=self.instructions,
            voice=voice_config,
            input_audio_format=InputAudioFormat.PCM16,
            output_audio_format=OutputAudioFormat.PCM16,
            turn_detection=turn_detection_config,
            tools=self.tools,
            tool_choice=ToolChoiceLiteral.AUTO,
            input_audio_transcription=AudioInputTranscriptionOptions(model="gpt-4o-transcribe"),
        )

        # Send session configuration asynchronously
        await connection.session.update(session=session_config)
        logger.info("Session configuration with function tools sent")

    async def _process_events(self, connection):
        """Process events from the VoiceLive connection asynchronously."""
        try:
            async for event in connection:
                await self._handle_event(event, connection)
        except KeyboardInterrupt:
            logger.info("Event processing interrupted")
        except Exception as e:
            logger.error(f"Error processing events: {e}")
            raise

    async def _handle_event(self, event, connection):
        """Handle different types of events from VoiceLive asynchronously."""
        ap = self.audio_processor
        assert ap is not None, "AudioProcessor must be initialized"

        if event.type == ServerEventType.SESSION_UPDATED:
            self.session_id = event.session.id
            logger.info(f"Session ready: {self.session_id}")
            self.session_ready = True

            # Start audio capture once session is ready
            await ap.start_capture()
            print("🎤 Ready for voice input! Try asking about your credit card...")

        elif event.type == ServerEventType.INPUT_AUDIO_BUFFER_SPEECH_STARTED:
            logger.info("🎤 User started speaking - stopping playback")
            print("🎤 Listening...")

            # Stop current assistant audio playback (interruption handling)
            await ap.stop_playback()

        elif event.type == ServerEventType.INPUT_AUDIO_BUFFER_SPEECH_STOPPED:
            logger.info("🎤 User stopped speaking")
            print("🤔 Processing...")

            # Restart playback system for response
            await ap.start_playback()

        elif event.type == ServerEventType.RESPONSE_CREATED:
            logger.info("🤖 Assistant response created")

        elif event.type == ServerEventType.RESPONSE_TEXT_DELTA:
            logger.info(f"Text response: {event.delta}")

        elif event.type == ServerEventType.RESPONSE_AUDIO_DELTA:
            # Stream audio response to speakers
            logger.debug("Received audio delta")
            await ap.queue_audio(event.delta)

        elif event.type == ServerEventType.RESPONSE_AUDIO_DONE:
            logger.info("🤖 Assistant finished speaking")
            print("🎤 Ready for next input...")

        elif event.type == ServerEventType.RESPONSE_DONE:
            logger.info("✅ Response complete")
            self.function_call_in_progress = False
            self.active_call_id = None

        elif event.type == ServerEventType.ERROR:
            logger.error(f"❌ VoiceLive error: {event.error.message}")
            print(f"Error: {event.error.message}")

        elif event.type == ServerEventType.CONVERSATION_ITEM_CREATED:
            logger.info(f"Conversation item created: {event.item.id}")

            # Check if it's a function call item using the improved pattern from the test
            if event.item.type == ItemType.FUNCTION_CALL:
                print(f"🔧 Calling function: {event.item.name}")
                await self._handle_function_call_with_improved_pattern(
                    event, connection
                )

    async def _handle_function_call_with_improved_pattern(
        self, conversation_created_event, connection
    ):
        """Handle function call using the improved pattern from the test."""
        # Validate the event structure
        if not isinstance(
            conversation_created_event, ServerEventConversationItemCreated
        ):
            logger.error("Expected ServerEventConversationItemCreated")
            return

        if not isinstance(conversation_created_event.item, ResponseFunctionCallItem):
            logger.error("Expected ResponseFunctionCallItem")
            return

        function_call_item = conversation_created_event.item
        function_name = function_call_item.name
        call_id = function_call_item.call_id
        previous_item_id = function_call_item.id

        logger.info(f"Function call detected: {function_name} with call_id: {call_id}")

        try:
            # Set tracking variables
            self.function_call_in_progress = True
            self.active_call_id = call_id

            # Wait for the function arguments to be complete
            function_done = await _wait_for_event(
                connection, {ServerEventType.RESPONSE_FUNCTION_CALL_ARGUMENTS_DONE}
            )

            if not isinstance(
                function_done, ServerEventResponseFunctionCallArgumentsDone
            ):
                logger.error("Expected ServerEventResponseFunctionCallArgumentsDone")
                return

            if function_done.call_id != call_id:
                logger.warning(
                    f"Call ID mismatch: expected {call_id}, got {function_done.call_id}"
                )
                return

            arguments = function_done.arguments
            logger.info(f"Function arguments received: {arguments}")

            # Wait for response to be done before proceeding
            await _wait_for_event(connection, {ServerEventType.RESPONSE_DONE})

            # Execute the function if we have it
            if function_name in self.available_functions:
                logger.info(f"Executing function: {function_name}")
                result = await self.available_functions[function_name](arguments)

                # Create function call output item
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

        except asyncio.TimeoutError:
            logger.error(
                f"Timeout waiting for function call completion for {function_name}"
            )
        except Exception as e:
            logger.error(f"Error executing function {function_name}: {e}")
        finally:
            self.function_call_in_progress = False
            self.active_call_id = None
