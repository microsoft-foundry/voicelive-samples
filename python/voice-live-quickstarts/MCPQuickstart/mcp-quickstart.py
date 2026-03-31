# -------------------------------------------------------------------------
# Copyright (c) Microsoft Corporation. All rights reserved.
# Licensed under the MIT License.
# -------------------------------------------------------------------------

"""
FILE: mcp-quickstart.py

DESCRIPTION:
    This sample demonstrates how to use the Azure AI Voice Live SDK with MCP
    (Model Context Protocol) server integration. It shows how to define MCP
    servers, handle MCP tool call events, and implement an approval flow for
    tool calls that require user consent.

USAGE:
    python mcp-quickstart.py --use-token-credential

    Set the environment variables with your own values before running the sample:
    1) AZURE_VOICELIVE_ENDPOINT - The Azure VoiceLive endpoint
    2) AZURE_VOICELIVE_API_KEY  - The Azure VoiceLive API key (if not using token credential)

REQUIREMENTS:
    - azure-ai-voicelive
    - python-dotenv
    - pyaudio (for audio capture and playback)
    - azure-identity (for token credential authentication)
"""

from __future__ import annotations
import os
import sys
import argparse
import asyncio
import base64
from datetime import datetime
import logging
import queue
import re
import signal
from typing import Union, Optional, TYPE_CHECKING, cast

from azure.core.credentials import AzureKeyCredential
from azure.core.credentials_async import AsyncTokenCredential
from azure.identity.aio import AzureCliCredential

from azure.ai.voicelive.aio import connect
from azure.ai.voicelive.models import (
    AudioEchoCancellation,
    AudioInputTranscriptionOptions,
    AudioNoiseReduction,
    AzureStandardVoice,
    InputAudioFormat,
    InputTextContentPart,
    InterimResponseTrigger,
    ItemType,
    LlmInterimResponseConfig,
    MCPApprovalResponseRequestItem,
    MCPServer,
    MessageItem,
    Modality,
    OutputAudioFormat,
    RequestSession,
    ResponseMCPApprovalRequestItem,
    ResponseMCPCallItem,
    ServerEventConversationItemCreated,
    ServerEventResponseMcpCallCompleted,
    ServerEventType,
    ServerVad,
    Tool,
    ToolChoiceLiteral,
)
from dotenv import load_dotenv
import pyaudio

if TYPE_CHECKING:
    from azure.ai.voicelive.aio import VoiceLiveConnection

# Change to the directory where this script is located
os.chdir(os.path.dirname(os.path.abspath(__file__)))

# Environment variable loading
load_dotenv('../.env', override=True)

# Set up logging
if not os.path.exists('logs'):
    os.makedirs('logs')

timestamp = datetime.now().strftime("%Y-%m-%d_%H-%M-%S")

logging.basicConfig(
    filename=f'logs/{timestamp}_voicelive.log',
    filemode="w",
    format='%(asctime)s:%(name)s:%(levelname)s:%(message)s',
    level=logging.INFO
)
logger = logging.getLogger(__name__)


class AudioProcessor:
    """
    Handles real-time audio capture and playback for the voice assistant.

    Threading Architecture:
    - Main thread: Event loop and UI
    - Capture thread: PyAudio input stream reading
    - Send thread: Async audio data transmission to VoiceLive
    - Playback thread: PyAudio output stream writing
    """

    loop: asyncio.AbstractEventLoop

    class AudioPlaybackPacket:
        """Represents a packet that can be sent to the audio playback queue."""
        def __init__(self, seq_num: int, data: Optional[bytes]):
            self.seq_num = seq_num
            self.data = data

    def __init__(self, connection):
        self.connection = connection
        self.audio = pyaudio.PyAudio()

        # Audio configuration - PCM16, 24kHz, mono
        self.format = pyaudio.paInt16
        self.channels = 1
        self.rate = 24000
        self.chunk_size = 1200  # 50ms

        # Capture and playback state
        self.input_stream = None

        self.playback_queue: queue.Queue[AudioProcessor.AudioPlaybackPacket] = queue.Queue()
        self.playback_base = 0
        self.next_seq_num = 0
        self.output_stream: Optional[pyaudio.Stream] = None

        logger.info("AudioProcessor initialized with 24kHz PCM16 mono audio")

    def start_capture(self):
        """Start capturing audio from microphone."""
        def _capture_callback(in_data, _frame_count, _time_info, _status_flags):
            audio_base64 = base64.b64encode(in_data).decode("utf-8")
            asyncio.run_coroutine_threadsafe(
                self.connection.input_audio_buffer.append(audio=audio_base64), self.loop
            )
            return (None, pyaudio.paContinue)

        if self.input_stream:
            return

        self.loop = asyncio.get_event_loop()

        try:
            self.input_stream = self.audio.open(
                format=self.format,
                channels=self.channels,
                rate=self.rate,
                input=True,
                frames_per_buffer=self.chunk_size,
                stream_callback=_capture_callback,
            )
            logger.info("Started audio capture")
        except Exception:
            logger.exception("Failed to start audio capture")
            raise

    def start_playback(self):
        """Initialize audio playback system."""
        if self.output_stream:
            return

        remaining = bytes()

        def _playback_callback(_in_data, frame_count, _time_info, _status_flags):
            nonlocal remaining
            frame_count *= pyaudio.get_sample_size(pyaudio.paInt16)

            out = remaining[:frame_count]
            remaining_local = remaining[frame_count:]

            while len(out) < frame_count:
                try:
                    packet = self.playback_queue.get_nowait()
                except queue.Empty:
                    out = out + bytes(frame_count - len(out))
                    continue

                if not packet or not packet.data:
                    break

                if packet.seq_num < self.playback_base:
                    continue

                num_to_take = frame_count - len(out)
                out = out + packet.data[:num_to_take]
                remaining_local = packet.data[num_to_take:]

            remaining = remaining_local

            if len(out) >= frame_count:
                return (out, pyaudio.paContinue)
            else:
                return (out, pyaudio.paComplete)

        try:
            self.output_stream = self.audio.open(
                format=self.format,
                channels=self.channels,
                rate=self.rate,
                output=True,
                frames_per_buffer=self.chunk_size,
                stream_callback=_playback_callback
            )
            logger.info("Audio playback system ready")
        except Exception:
            logger.exception("Failed to initialize audio playback")
            raise

    def _get_and_increase_seq_num(self):
        seq = self.next_seq_num
        self.next_seq_num += 1
        return seq

    def queue_audio(self, audio_data: Optional[bytes]) -> None:
        """Queue audio data for playback."""
        self.playback_queue.put(
            AudioProcessor.AudioPlaybackPacket(
                seq_num=self._get_and_increase_seq_num(),
                data=audio_data))

    def skip_pending_audio(self):
        """Skip current audio in playback queue."""
        self.playback_base = self._get_and_increase_seq_num()

    def shutdown(self):
        """Clean up audio resources."""
        if self.input_stream:
            self.input_stream.stop_stream()
            self.input_stream.close()
            self.input_stream = None
        logger.info("Stopped audio capture")

        if self.output_stream:
            self.skip_pending_audio()
            self.queue_audio(None)
            self.output_stream.stop_stream()
            self.output_stream.close()
            self.output_stream = None
        logger.info("Stopped audio playback")

        if self.audio:
            self.audio.terminate()
        logger.info("Audio processor cleaned up")


class MCPVoiceAssistant:
    """Voice assistant with MCP server integration."""

    def __init__(
        self,
        endpoint: str,
        credential: Union[AzureKeyCredential, AsyncTokenCredential],
        model: str,
        voice: str,
        instructions: str,
    ):
        self.endpoint = endpoint
        self.credential = credential
        self.model = model
        self.voice = voice
        self.instructions = instructions
        self.connection: Optional["VoiceLiveConnection"] = None
        self.audio_processor: Optional[AudioProcessor] = None
        self.session_ready = False
        self._active_response = False
        self._response_api_done = False
        self._pending_approval: Optional[dict] = None  # Currently active approval request
        self._approval_queue: list[dict] = []  # Queued approvals waiting to be asked
        self._awaiting_approval_voice = False  # True only after the model has spoken the approval prompt
        self._approval_prompt_needed = False  # True when we need to inject the prompt at next RESPONSE_DONE
        self._mcp_call_in_progress = 0  # Count of active MCP tool calls
        self._handled_mcp_completions: set = set()  # Deduplicate MCP completion events
        self._needs_response_create = False  # Retry response.create at next RESPONSE_DONE
        self._approval_tools_completed_this_turn: set = set()  # Approval-required tools completed this turn
        self._mcp_item_to_server: dict = {}  # Map MCP item IDs to server_label/function_name
        self._approval_servers: set = set()  # Server labels that require approval

    async def start(self):
        """Start the voice assistant session with MCP support."""
        try:
            logger.info("Connecting to VoiceLive API with model %s", self.model)

            # <define_mcp_servers>
            # Define MCP servers that Voice Live can use during the session.
            # Each server is an MCPServer instance added to the tools list.
            mcp_tools: list[Tool] = [
                MCPServer(
                    server_label="deepwiki",
                    server_url="https://mcp.deepwiki.com/mcp",
                    allowed_tools=["read_wiki_structure", "ask_question"],
                    require_approval="never",
                ),
                MCPServer(
                    server_label="azure_doc",
                    server_url="https://learn.microsoft.com/api/mcp",
                    require_approval="always",
                ),
            ]
            # </define_mcp_servers>

            # Track which servers require approval for per-turn loop prevention.
            # Servers with require_approval="always" are guarded to avoid
            # repeated approval prompts in voice UX — a design decision to keep
            # the voice conversation flow smooth. Servers with "never" are allowed
            # to make multiple calls (e.g. DeepWiki's read_wiki_structure →
            # ask_question pattern) since they don't interrupt the user.
            self._approval_servers = {
                s.server_label for s in mcp_tools
                if isinstance(s, MCPServer) and s.require_approval == "always"
            }

            # Connect with api_version="2026-01-01-preview" for MCP support
            async with connect(
                endpoint=self.endpoint,
                credential=self.credential,
                model=self.model,
                api_version="2026-01-01-preview",
            ) as connection:
                self.connection = connection

                # Initialize audio processor
                ap = AudioProcessor(connection)
                self.audio_processor = ap

                # Configure session with MCP tools
                await self._setup_session(mcp_tools)

                # Start audio systems
                ap.start_playback()

                logger.info("Voice assistant with MCP ready! Start speaking...")
                print("\n" + "=" * 70)
                print("🎤 VOICE ASSISTANT WITH MCP READY")
                print("Try saying:")
                print("  • 'Can you summarize the GitHub repo azure-sdk-for-python?'")
                print("  • 'Search the Azure documentation for Voice Live API.'")
                print("You may need to approve some MCP tool calls in the console.")
                print("Press Ctrl+C to exit")
                print("=" * 70 + "\n")

                # Process events
                await self._process_events()
        finally:
            if self.audio_processor:
                self.audio_processor.shutdown()

    # <configure_session>
    async def _setup_session(self, mcp_tools: list[Tool]):
        """Configure the VoiceLive session with MCP tools."""
        logger.info("Setting up voice conversation session with MCP tools...")

        # Create voice configuration
        voice_config: Union[AzureStandardVoice, str]
        if "-" in self.voice or ":" in self.voice:
            voice_config = AzureStandardVoice(name=self.voice)
        else:
            voice_config = self.voice

        # Create turn detection configuration
        turn_detection_config = ServerVad(
            threshold=0.5,
            prefix_padding_ms=300,
            silence_duration_ms=500)

        # Create session configuration with MCP tools in the tools list
        session_config = RequestSession(
            modalities=[Modality.TEXT, Modality.AUDIO],
            instructions=self.instructions,
            voice=voice_config,
            input_audio_format=InputAudioFormat.PCM16,
            output_audio_format=OutputAudioFormat.PCM16,
            turn_detection=turn_detection_config,
            input_audio_echo_cancellation=AudioEchoCancellation(),
            input_audio_noise_reduction=AudioNoiseReduction(type="azure_deep_noise_suppression"),
            tools=mcp_tools,
            tool_choice=ToolChoiceLiteral.AUTO,
            input_audio_transcription=AudioInputTranscriptionOptions(model="whisper-1"),
        )

        # Interim response bridges latency during MCP tool calls, but is only
        # supported on non-realtime model pipelines (e.g. gpt-4o-mini).
        if "realtime" not in self.model.lower():
            session_config.interim_response = LlmInterimResponseConfig(
                triggers=[InterimResponseTrigger.TOOL, InterimResponseTrigger.LATENCY],
                latency_threshold_ms=100,
                instructions="Create friendly interim responses indicating wait time due to "
                             "ongoing processing, if any. Do not include in all responses! "
                             "Do not say you don't have real-time access to information when "
                             "calling tools!",
            )
            logger.info("Interim response enabled for model %s", self.model)
        else:
            logger.info("Interim response skipped — not supported on realtime pipeline (%s)", self.model)

        conn = self.connection
        assert conn is not None
        await conn.session.update(session=session_config)
        logger.info("Session configuration with MCP tools sent")
    # </configure_session>

    async def _process_events(self):
        """Process events from the VoiceLive connection."""
        conn = self.connection
        assert conn is not None
        async for event in conn:
            try:
                await self._handle_event(event)
            except Exception:
                logger.exception("Error handling event %s (non-fatal)", getattr(event, 'type', '?'))

    # <handle_mcp_events>
    async def _handle_event(self, event):
        """Handle different types of events from VoiceLive, including MCP events."""
        ap = self.audio_processor
        conn = self.connection
        assert ap is not None
        assert conn is not None

        if event.type == ServerEventType.SESSION_UPDATED:
            logger.info("Session ready: %s", event.session.id)
            self.session_ready = True
            ap.start_capture()

        elif event.type == ServerEventType.INPUT_AUDIO_BUFFER_SPEECH_STARTED:
            logger.info("User started speaking - stopping playback")
            print("🎤 Listening...")
            ap.skip_pending_audio()
            self._approval_tools_completed_this_turn.clear()

            # If the model was still speaking the approval prompt (not yet
            # awaiting voice), the user barged in before hearing the question.
            # Re-queue the approval so it gets asked again after this turn.
            if self._pending_approval is not None and not self._awaiting_approval_voice:
                logger.info("Barge-in during approval prompt — re-queuing")
                self._approval_queue.insert(0, self._pending_approval)
                self._pending_approval = None
                self._approval_prompt_needed = False

            if self._active_response and not self._response_api_done:
                try:
                    await conn.response.cancel()
                except Exception as e:
                    if "no active response" not in str(e).lower():
                        logger.warning("Cancel failed: %s", e)

            # If an MCP call is running, ask the user if they want to wait or skip
            if self._mcp_call_in_progress > 0 and self._pending_approval is None:
                logger.info("User spoke during MCP call — will ask if they want to skip")
                try:
                    await conn.conversation.item.create(
                        item=MessageItem(
                            role="system",
                            content=[InputTextContentPart(
                                text="A tool call is still running. The user just interrupted. "
                                     "Briefly ask them: do you want to keep waiting for the result, "
                                     "or skip it and move on? Keep it short."
                            )],
                        )
                    )
                except Exception as e:
                    logger.warning("Failed to inject MCP skip inquiry: %s", e)

        elif event.type == ServerEventType.INPUT_AUDIO_BUFFER_SPEECH_STOPPED:
            logger.info("User stopped speaking")
            print("🤔 Processing...")

        elif event.type == ServerEventType.RESPONSE_CREATED:
            logger.info("Assistant response created")
            self._active_response = True
            self._response_api_done = False

        elif event.type == ServerEventType.RESPONSE_AUDIO_DELTA:
            ap.queue_audio(event.delta)

        elif event.type == ServerEventType.RESPONSE_AUDIO_DONE:
            logger.info("Assistant finished speaking")
            print("🎤 Ready for next input...")

        elif event.type == ServerEventType.RESPONSE_DONE:
            logger.info("Response complete")
            self._active_response = False
            self._response_api_done = True

            # If an approval prompt needs to be injected, do it now that no response is active
            if self._approval_prompt_needed and self._pending_approval is not None:
                self._approval_prompt_needed = False
                await self._send_approval_voice_prompt(self._pending_approval, conn)
            # If an approval prompt was just spoken, the next user utterance is the answer
            elif self._pending_approval is not None:
                self._awaiting_approval_voice = True
            # If a response.create was deferred due to collision, retry now
            elif self._needs_response_create:
                self._needs_response_create = False
                try:
                    await conn.response.create()
                except Exception:
                    pass  # Best-effort retry

        # <voice_approval_transcription>
        elif event.type == ServerEventType.CONVERSATION_ITEM_INPUT_AUDIO_TRANSCRIPTION_COMPLETED:
            transcript = event.transcript if hasattr(event, 'transcript') else event.get("transcript", "")
            logger.info("User said: %s", transcript)
            print(f"👤 You said:\t{transcript}")

            # Only interpret as an approval answer if the model has finished
            # speaking the approval prompt and we are actively waiting
            if self._pending_approval is not None and self._awaiting_approval_voice:
                await self._resolve_voice_approval(transcript, conn)
        # </voice_approval_transcription>

        elif event.type == ServerEventType.ERROR:
            msg = event.error.message
            if "Cancellation failed: no active response" not in msg:
                # Interim response errors are non-fatal — log but don't alarm the user
                if "interim response" in msg.lower():
                    logger.warning("Interim response not supported with this model pipeline (non-fatal)")
                elif "active response in progress" in msg.lower():
                    logger.debug("Response collision (expected during MCP flow): %s", msg)
                else:
                    logger.error("VoiceLive error: %s", msg)
                    print(f"Error: {msg}")

        # MCP-specific events
        elif event.type == ServerEventType.MCP_LIST_TOOLS_IN_PROGRESS:
            logger.info("MCP list tools in progress for %s", event.item_id)

        elif event.type == ServerEventType.MCP_LIST_TOOLS_COMPLETED:
            logger.info("MCP list tools completed for %s", event.item_id)
            print("🔧 MCP tools discovered successfully")

        elif event.type == ServerEventType.MCP_LIST_TOOLS_FAILED:
            logger.error("MCP list tools failed for %s", event.item_id)
            print("❌ MCP tool discovery failed")

        elif event.type == ServerEventType.RESPONSE_MCP_CALL_IN_PROGRESS:
            logger.info("MCP call in progress for %s", event.item_id)
            print("⏳ MCP tool call in progress...")
            self._mcp_call_in_progress += 1

        elif event.type == ServerEventType.RESPONSE_MCP_CALL_COMPLETED:
            item_id = event.item_id
            self._mcp_call_in_progress = max(0, self._mcp_call_in_progress - 1)
            if item_id in self._handled_mcp_completions:
                logger.debug("Ignoring duplicate MCP completion for %s", item_id)
            else:
                self._handled_mcp_completions.add(item_id)
                logger.info("MCP call completed for %s", item_id)
                await self._handle_mcp_call_completed(event, conn)

        elif event.type == ServerEventType.RESPONSE_MCP_CALL_FAILED:
            logger.error("MCP call failed for %s", event.item_id)
            print("❌ MCP tool call failed")
            self._mcp_call_in_progress = max(0, self._mcp_call_in_progress - 1)
            # Kick the model to respond — it should inform the user the tool call failed
            try:
                await conn.response.create()
            except Exception as e:
                if "active response" not in str(e).lower():
                    logger.warning("Failed to create response after MCP failure: %s", e)

        elif event.type == ServerEventType.CONVERSATION_ITEM_CREATED:
            logger.info("Conversation item created: id=%s, type=%s", event.item.id, event.item.type)
            if event.item.type == ItemType.MCP_LIST_TOOLS:
                logger.info("MCP list tools item: server_label=%s", event.item.server_label)
            elif event.item.type == ItemType.MCP_CALL:
                await self._handle_mcp_call_arguments(event, conn)
            elif event.item.type == ItemType.MCP_APPROVAL_REQUEST:
                await self._handle_mcp_approval_request(event, conn)
        else:
            logger.debug("Unhandled event type: %s", event.type)
    # </handle_mcp_events>

    # <handle_approval>
    async def _handle_mcp_approval_request(self, conversation_created_event, connection):
        """Handle MCP approval request by asking the user via voice."""
        if not isinstance(conversation_created_event, ServerEventConversationItemCreated):
            logger.error("Expected ServerEventConversationItemCreated")
            return
        if not isinstance(conversation_created_event.item, ResponseMCPApprovalRequestItem):
            logger.error("Expected ResponseMCPApprovalRequestItem")
            return

        mcp_approval_item = conversation_created_event.item
        approval_id = mcp_approval_item.id
        server_label = mcp_approval_item.server_label
        function_name = mcp_approval_item.name

        if not approval_id:
            logger.error("MCP approval item missing ID")
            return

        # If another approval is already pending, queue this one
        if self._pending_approval is not None:
            logger.info("Queuing approval for %s — another is already pending", function_name)
            self._approval_queue.append({
                "approval_id": approval_id,
                "server_label": server_label,
                "function_name": function_name,
            })
            return

        logger.info("MCP approval request: server=%s tool=%s", server_label, function_name)
        print(f"\n🔐 MCP Approval Request (voice-based):")
        print(f"   Server: {server_label}  Tool: {function_name}")

        # Store the pending approval. If no response is currently active,
        # send the voice prompt immediately. Otherwise, defer it to
        # RESPONSE_DONE to avoid colliding with an active response.
        self._pending_approval = {
            "approval_id": approval_id,
            "server_label": server_label,
            "function_name": function_name,
        }
        self._awaiting_approval_voice = False

        if not self._active_response:
            await self._send_approval_voice_prompt(self._pending_approval, connection)
        else:
            self._approval_prompt_needed = True

    async def _send_approval_voice_prompt(self, pending: dict, connection):
        """Inject a system message asking the model to verbally request permission."""
        prompt = (
            f'I need your permission to use the "{pending["function_name"]}" tool '
            f'from the "{pending["server_label"]}" service. '
            f"Should I go ahead? Just say yes or no."
        )
        try:
            await connection.conversation.item.create(
                item=MessageItem(
                    role="system",
                    content=[InputTextContentPart(text=prompt)],
                )
            )
            await connection.response.create()
        except Exception as e:
            logger.warning("Failed to send approval voice prompt: %s", e)

    async def _resolve_voice_approval(self, transcript: str, connection):
        """Interpret the user's spoken response as approval or denial."""
        pending = self._pending_approval
        if pending is None:
            return

        text = transcript.strip().lower()

        # Match "yes" or "no" as whole words (word boundaries prevent false
        # positives from words like "yesterday" or "nobody")
        approved = bool(re.search(r'\byes\b', text))
        denied = bool(re.search(r'\bno\b', text))

        if not approved and not denied:
            # Ambiguous — ask again via the deferred prompt mechanism
            logger.info("Ambiguous approval response: %s", transcript)
            self._awaiting_approval_voice = False
            self._approval_prompt_needed = True
            return

        if approved and denied:
            # Conflicting signals — treat as denial for safety
            approved = False

        # Clear the pending state before sending the response
        self._pending_approval = None
        self._awaiting_approval_voice = False

        approval_response_item = MCPApprovalResponseRequestItem(
            approval_request_id=pending["approval_id"], approve=approved
        )
        try:
            await connection.conversation.item.create(item=approval_response_item)
        except Exception as e:
            logger.error("Failed to send approval response: %s", e)
            return
        logger.info("Voice approval resolved: %s for %s", approved, pending["function_name"])
        print(f"   Voice approval: {'Approved ✅' if approved else 'Denied ❌'}")

        # Process next queued approval, if any
        await self._process_next_approval(connection)

    async def _process_next_approval(self, connection):
        """Pop the next queued approval and ask via voice."""
        if not self._approval_queue:
            return
        next_approval = self._approval_queue.pop(0)
        self._pending_approval = next_approval
        self._awaiting_approval_voice = False

        # Send immediately if no response is active, otherwise defer
        if not self._active_response:
            await self._send_approval_voice_prompt(next_approval, connection)
        else:
            self._approval_prompt_needed = True
    # </handle_approval>

    async def _handle_mcp_call_completed(self, mcp_call_completed_event, connection):
        """Handle MCP call completed events."""
        if not isinstance(mcp_call_completed_event, ServerEventResponseMcpCallCompleted):
            logger.error("Expected ServerEventResponseMcpCallCompleted")
            return

        logger.info("MCP call completed for %s", mcp_call_completed_event.item_id)
        print("✅ MCP tool call completed successfully")

        item_id = mcp_call_completed_event.item_id

        # Track which tool completed to avoid repeated approval prompts
        # for the same tool in voice UX. Only guard approval-required servers —
        # servers with require_approval="never" are free to make multiple calls.
        tool_key = self._mcp_item_to_server.pop(item_id, "")
        server_label = tool_key.split("/")[0] if "/" in tool_key else ""

        if server_label in self._approval_servers:
            if tool_key in self._approval_tools_completed_this_turn:
                logger.info("Skipping response.create — %s already completed this turn", tool_key)
                return
            self._approval_tools_completed_this_turn.add(tool_key)

        # Kick the model to incorporate and speak the MCP output.
        # If a response is already active, defer to RESPONSE_DONE.
        try:
            await connection.response.create()
        except Exception as e:
            if "active response" in str(e).lower():
                self._needs_response_create = True
            else:
                logger.warning("Failed to create response after MCP call: %s", e)

    async def _handle_mcp_call_arguments(self, conversation_created_event, connection):
        """Log MCP call details and announce the tool call to the user via voice."""
        if not isinstance(conversation_created_event, ServerEventConversationItemCreated):
            logger.error("Expected ServerEventConversationItemCreated")
            return
        if not isinstance(conversation_created_event.item, ResponseMCPCallItem):
            logger.error("Expected ResponseMCPCallItem")
            return

        mcp_call_item = conversation_created_event.item
        server_label = mcp_call_item.server_label
        function_name = mcp_call_item.name

        logger.info("MCP Call triggered: server_label=%s, function_name=%s", server_label, function_name)
        print(f"🔧 MCP tool call: {server_label}/{function_name}")
        self._mcp_item_to_server[mcp_call_item.id] = f"{server_label}/{function_name}"

        # Announce the tool call to the user so they know something is
        # happening while the MCP call runs. Skip if an approval prompt
        # is pending (that flow handles its own voice messaging).
        if self._pending_approval is None:
            try:
                await connection.conversation.item.create(
                    item=MessageItem(
                        role="system",
                        content=[InputTextContentPart(
                            text=f'I\'m now looking up information using the "{server_label}" service. '
                                 f"Let the user know briefly that you're working on it."
                        )],
                    )
                )
                await connection.response.create()
            except Exception as e:
                if "active response" not in str(e).lower():
                    logger.warning("Failed to create tool announcement: %s", e)


def parse_arguments():
    """Parse command line arguments."""
    parser = argparse.ArgumentParser(
        description="Voice Assistant with MCP using Azure VoiceLive SDK",
    )

    parser.add_argument(
        "--api-key",
        help="Azure VoiceLive API key (or set AZURE_VOICELIVE_API_KEY env var)",
        type=str,
        default=os.environ.get("AZURE_VOICELIVE_API_KEY"),
    )
    parser.add_argument(
        "--endpoint",
        help="Azure VoiceLive endpoint (default: from AZURE_VOICELIVE_ENDPOINT env var)",
        type=str,
        default=os.environ.get("AZURE_VOICELIVE_ENDPOINT", "https://your-resource-name.services.ai.azure.com/"),
    )
    parser.add_argument(
        "--model",
        help="VoiceLive model to use (default: gpt-realtime)",
        type=str,
        default=os.environ.get("AZURE_VOICELIVE_MODEL", "gpt-realtime"),
    )
    parser.add_argument(
        "--voice",
        help="Voice to use for the assistant (default: en-US-Ava:DragonHDLatestNeural)",
        type=str,
        default=os.environ.get("AZURE_VOICELIVE_VOICE", "en-US-Ava:DragonHDLatestNeural"),
    )
    parser.add_argument(
        "--instructions",
        help="System instructions for the AI assistant",
        type=str,
        default=os.environ.get(
            "AZURE_VOICELIVE_INSTRUCTIONS",
            "You are a helpful AI assistant with access to MCP tools. "
            "Always respond in English. "
            "When a user asks a question, use the appropriate tool once to find information, "
            "then summarize the results conversationally. IMPORTANT: Never call the same tool "
            "more than once per user question. After receiving a tool result, always respond "
            "to the user with what you found — do not search again.",
        ),
    )
    parser.add_argument(
        "--use-token-credential", help="Use Azure token credential instead of API key", action="store_true", default=False
    )
    parser.add_argument("--verbose", help="Enable verbose logging", action="store_true")

    return parser.parse_args()


def main():
    """Main function."""
    args = parse_arguments()

    if args.verbose:
        logging.getLogger().setLevel(logging.DEBUG)

    if not args.api_key and not args.use_token_credential:
        print("❌ Error: No authentication provided")
        print("Please provide an API key using --api-key or set AZURE_VOICELIVE_API_KEY environment variable,")
        print("or use --use-token-credential for Azure authentication.")
        sys.exit(1)

    credential: Union[AzureKeyCredential, AsyncTokenCredential]
    if args.use_token_credential:
        credential = AzureCliCredential()
        logger.info("Using Azure token credential")
    else:
        credential = AzureKeyCredential(args.api_key)
        logger.info("Using API key credential")

    assistant = MCPVoiceAssistant(
        endpoint=args.endpoint,
        credential=credential,
        model=args.model,
        voice=args.voice,
        instructions=args.instructions,
    )

    def signal_handler(_sig, _frame):
        logger.info("Received shutdown signal")
        raise KeyboardInterrupt()

    signal.signal(signal.SIGINT, signal_handler)
    signal.signal(signal.SIGTERM, signal_handler)

    try:
        asyncio.run(assistant.start())
    except KeyboardInterrupt:
        print("\n👋 Voice assistant with MCP shut down. Goodbye!")
    except Exception as e:
        print("Fatal Error: ", e)


if __name__ == "__main__":
    # Check audio system
    try:
        p = pyaudio.PyAudio()
        input_devices = [
            i for i in range(p.get_device_count())
            if cast(Union[int, float], p.get_device_info_by_index(i).get("maxInputChannels", 0) or 0) > 0
        ]
        output_devices = [
            i for i in range(p.get_device_count())
            if cast(Union[int, float], p.get_device_info_by_index(i).get("maxOutputChannels", 0) or 0) > 0
        ]
        p.terminate()

        if not input_devices:
            print("❌ No audio input devices found. Please check your microphone.")
            sys.exit(1)
        if not output_devices:
            print("❌ No audio output devices found. Please check your speakers.")
            sys.exit(1)
    except Exception as e:
        print(f"❌ Audio system check failed: {e}")
        sys.exit(1)

    print("🎙️  Voice Assistant with MCP - Azure VoiceLive SDK")
    print("=" * 65)

    main()
