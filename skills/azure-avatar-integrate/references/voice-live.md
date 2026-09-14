# Voice Live Integration

Build a conversational avatar that listens through the microphone and responds with synchronized speech and video.

## Prepare

Resolve access prerequisites before live startup, not before safe local implementation. Use placeholders for missing values, reuse known answers, and ask only when the next useful action is blocked. Perform external setup only within approved scope.

### 1. Get the resource

Reuse the supplied `endpoint` and `region`. If either is missing, scaffold named configuration placeholders and explain where the developer can find the value. Ask only when a concrete compatibility check or live connection cannot proceed without it. Do not create or discover Azure resources yourself.

### 2. Select the target

Collect only the chosen mode's fields:

| Mode | Connection fields |
|---|---|
| Model | `model` |
| Agent | `project_id`, `agent_id` |

Use actual project and agent IDs, not display names. Check both [model availability](https://learn.microsoft.com/azure/ai-services/speech-service/voice-live#supported-models-and-regions) and [Avatar region support](https://learn.microsoft.com/azure/ai-services/speech-service/regions?tabs=ttsavatar): unsupported blocks connection; unknown stays unverified.

Use the developer's model when specified. Otherwise recommend a currently supported starting model while keeping it configurable; do not block scaffolding on the choice or silently use the recommendation for a live call. After a model change, recheck only affected compatibility, cost, and configuration; do not restart onboarding or reconfirm unchanged choices.

### 3. Configure authentication

Keep approved authentication; otherwise prefer Entra ID.

| Method | Setup |
|---|---|
| Entra ID | Identify the application identity; guide role assignments without modifying IAM. Do not load an API key. |
| API key | For approved key authentication, use the application's backend secret provider or environment. |

Follow the [main skill's configuration rules](../SKILL.md#3-implement). Configure only the selected mode's target and authentication. For API-key authentication, name the backend environment variable and continue with a placeholder; do not ask whether the key is ready. A blank model is missing live configuration, not permission to silently use a sample default.

> **Secret boundary:** the developer supplies secrets locally. Never read secret values, print the environment, or expose secrets in chat, command arguments, frontend code, or logs. Local validity does not prove service access.

### 4. Choose the connection

- **Client SDK:** only when the runtime and Entra sign-in are supported and direct access fits the approved plan.
- **Backend relay:** otherwise connect from the backend, reusing the application transport.

> **Before connecting:** obtain approval for region, target, or auth changes. Missing access need not block local coding; implement missing components before live connection.

## Implement

Use the connection chosen in Prepare. Implement the steps below before live startup; apply the main skill's timeout, retry, and approval rules throughout.

### 1. Build the client/backend relay

**Direct client SDK:** skip this step. **Backend connection:** reuse the application's authenticated transport to carry:

- **Client input:** start/stop, microphone chunks, SDP offer, and interruption with the active response ID.
- **Service output:** session readiness, ICE servers, SDP answer, transcripts, response/playback state, and redacted errors.
- **Session lifecycle:** bind each service session to one authenticated client; release it on client disconnect.

These are application responsibilities, not prescribed event names. Map them to the existing protocol.

> **Relay boundary:** check ownership on every message, validate shape/size, and reject unknown or post-stop traffic. Restrict WebSocket origins, audio/message sizes, queue lengths, concurrent sessions, and idle lifetime. Never accept service API keys or backend bearer tokens in client messages.

### 2. Connect to Voice Live

Use a supported SDK and the approved endpoint and model/agent target. Register event handlers once before connecting.

| Connection | Authentication |
|---|---|
| Backend + Entra | Use `DefaultAzureCredential`; prefer managed identity when hosted in Azure. Have the developer configure the required roles (`Cognitive Services User`, `Foundry User`) for the selected target. |
| Backend + API key | Use the application's approved backend secret provider or environment. Keep the key outside source control and the client. |
| Direct client SDK | Use its supported Entra sign-in flow. `DefaultAzureCredential` is not browser sign-in. |

**Raw WebSocket fallback — backend only, when no suitable SDK exists:**

```text
wss://<resource>.services.ai.azure.com/voice-live/realtime?api-version=2026-04-10&model=<model>
wss://<resource>.services.ai.azure.com/voice-live/realtime?api-version=2026-04-10&project_id=<project-id>&agent_id=<agent-id>
```

Confirm the API version and endpoint against [current Voice Live guidance](https://learn.microsoft.com/azure/ai-services/speech-service/voice-live-how-to). Older resources may use `<resource>.cognitiveservices.azure.com`. URL-encode target values; with an SDK, use its target types instead of constructing query parameters.

For the [raw WebSocket handshake](https://learn.microsoft.com/azure/ai-services/speech-service/voice-live-how-to#credentials), send either an `api-key` header or `Authorization: Bearer <token>`. For Entra, request scope `https://ai.azure.com/.default` (legacy: `https://cognitiveservices.azure.com/.default`); retain the approved scope rather than retrying another automatically.

> **Before live startup:** require supported resource/region, correct target IDs, ready credentials, and implemented application components. Never put keys/tokens in URLs or send a backend identity's bearer token to the client.

### 3. Configure the session

Use defaults without questions about unspecified appearance or voice. Change voice only for requested language/preferences or a diagnosed mismatch.

Send `session.update`, or its SDK equivalent:

```json
{
	"type": "session.update",
	"session": {
		"modalities": ["text", "audio"],
		"input_audio_format": "pcm16",
		"output_audio_format": "pcm16",
		"turn_detection": { "type": "azure_semantic_vad", "interrupt_response": true },
		"input_audio_noise_reduction": { "type": "azure_deep_noise_suppression" },
		"input_audio_echo_cancellation": { "type": "server_echo_cancellation" },
		"voice": { "name": "en-US-AvaNeural", "type": "azure-standard" },
		"avatar": {
			"character": "lisa",
			"style": "casual-sitting",
			"customized": false,
			"video": { "codec": "h264", "resolution": { "width": 1920, "height": 1080 } }
		}
	}
}
```

- **Model mode:** add instructions/tools only as needed. If user transcripts are required, configure a [compatible input transcription model](https://learn.microsoft.com/azure/ai-services/speech-service/voice-live-how-to#audio-input-transcription); audio input alone does not guarantee transcription events.
- **Agent mode:** do not send `instructions` or override agent-managed settings; verify its transcription behavior.
- **Avatar size:** keep `1920 x 1080` for this default. For other avatars, verify native aspect ratio before session configuration and SDP signaling.

**Continue when:** `session.updated` arrives. Save the effective session and `session.avatar.ice_servers`; duplicate updates must not create another peer.

### 4. Connect the avatar stream

**SDK-managed media:** if the selected SDK manages avatar WebRTC/SDP, use its documented connect, attach, and readiness flow; do not create a second peer or repeat signaling.

**Application-managed media:** check ICE/SDP handling against the [official Avatar sample](https://github.com/microsoft-foundry/voicelive-samples/blob/main/javascript/voice-live-avatar/src/app/chat-interface.tsx), then implement in the rendering client:

1. Create `RTCPeerConnection` with the returned ICE servers; attach track handlers and receive-only audio/video transceivers.
2. Create and set the local offer; wait for ICE gathering within a bounded timeout:

	| Result | Action |
	|---|---|
	| Gathering complete | Continue. |
	| Timeout; current `localDescription.sdp` has candidates | Continue with current SDP. |
	| Timeout; no candidates | Fail before signaling; see [network checks](./troubleshooting.md#connection). |

	Clear the wait timer and listeners on completion, timeout, or stop.

3. Base64-encode the latest `localDescription` JSON (`type` and `sdp`). Send once through the service connection; never after stop or again on late events:

```json
{ "type": "session.avatar.connect", "client_sdp": "<base64-json-local-description>" }
```

4. Receive the answer, decode `server_sdp`, and set the remote description once:

```json
{ "type": "session.avatar.connecting", "server_sdp": "<base64-json-remote-description>" }
```

5. Bind remote tracks to playback elements. Require ICE `connected`/`completed`, both audio/video tracks, and permitted playback within bounded timeouts.

> **Playback:** use WebRTC as the only response audio path; do not also play audio deltas or relay a second audio stream. An SDP answer or received tracks alone do not prove playback readiness.

**Continue when:** the audio path is ready, playback is permitted, and avatar video is visible. Handle autoplay rejection with a user Start/Play action before microphone capture; do not wait for generated reply audio before the user has spoken.

### 5. Handle speech and interruption

**Capture:** request microphone permission and convert input to mono PCM16 at 24 kHz, using verified SDK conversion where available. For raw WebSocket, send bounded chunks:

```json
{ "type": "input_audio_buffer.append", "audio": "<base64-pcm16-24khz-mono>" }
```

**Interrupt:** cancel the active response, include its `response_id` when available, clear stale playback, and return to listening:

```json
{ "type": "response.cancel", "response_id": "<active-response-id>" }
```

**Update the UI:** map the selected SDK/version's events to these actions:

| Event meaning | Application action |
|---|---|
| User speech starts/stops | Update listening state and trigger interruption when needed. |
| User transcription | Update the transcript; do not append the same final text twice. |
| Response text, transcript, or completion | Update only the active response; completion does not end the session. |

Dispatch events once. Keep the healthy session open so the next microphone turn works after completion or interruption.

### 6. Recover or stop

Preserve the first redacted Voice Live `error`; later WebSocket 1006 or `no close frame received or sent` messages are secondary evidence.

- **Transient WebSocket/SDP/ICE failure:** clean up the failed connection, then reconnect within the main skill's retry budget (`RECONNECTING`).
- **Non-retryable error, exhausted budget, or user stop:** end the session (`TERMINAL`); do not reconnect.

For every teardown, including partial startup:

1. Stop microphone capture, playback, and media tracks.
2. Close the peer and service/relay connections; clear media elements and buffers.
3. Remove event handlers and cancel owned tasks.

> **Lifecycle:** serialize reconnect and cleanup. Repeated cleanup must be safe and leave no owned resources active. Never replay completed responses or silently discard application-owned context.

## Optional: Configure Language and Voice

Use this section for a requested language, runtime language switch, multilingual support, or diagnosed language/voice mismatch. Otherwise keep English and the verified default voice.

> **Language is not voice:** changing the model's response language does not automatically change the TTS voice.

Set the requested response language through supported model instructions or the agent's approved configuration, separately from voice selection. For agent-owned settings, guide the developer to update the agent; do not send unsupported session `instructions` or override its configuration.

### 1. Select a compatible voice

1. Identify the target locale from the requirement or observed response language.
2. Check current Microsoft voice documentation for support across the locale, region, Voice Live, and Avatar.
3. Prefer an exact locale match, then verified language compatibility, then requested gender/style. Without a voice preference, choose a compatible Neural Voice without another question.

Do not maintain a static voice list, infer support from `Multilingual` in a name, or silently fall back to English.

### 2. Apply the voice

Check the installed SDK, API version, and effective session before choosing how to apply it:

| Session state | Action |
|---|---|
| Not started | Set the selected voice in the initial session configuration. |
| Idle; safe dynamic updates supported | Update the voice using the verified SDK/API flow and confirm the effective setting. |
| Idle; dynamic updates unsupported or uncertain | Clean up and rebuild with the selected voice, preserving application-owned context. |
| Response active | Wait for the turn to finish, then follow the appropriate idle-session action. |

> **Safe switching:** never change voice mid-response or replay completed responses after rebuilding.

### 3. Report the voice change

After completing the Verify checklist below, report the **locale and voice**, **selection reason**, **verified compatibility or remaining uncertainty**, and **whether a session rebuild was needed**.

## Verify

Run local checks first; obtain separate approval for real checks under the [live completion gate](../SKILL.md#live-completion-gate).

- [ ] **Configuration:** endpoint, target IDs/model, auth, mode, transport, and renderer match the plan; no secrets in logs.
- [ ] **Local ICE regression (application-managed):** test all step 4 ICE branches, latest full payload, single-send behavior, and stop/late-event cleanup.
- [ ] **Real media readiness:** confirm session update, offer sent, answer applied, connected ICE, both tracks, and actual playback. Use equivalent SDK evidence; playback readiness precedes microphone capture.
- [ ] **Real conversation:** microphone input produces response state and synchronized avatar speech/video—not just a socket or text-only test. Verify user transcripts when required by the plan.
- [ ] **Interruption and reuse:** stale speech stops; the next turn works in the same session, with WebRTC-only response audio.
- [ ] **Relay security:** reject unauthorized, cross-session, oversized, unknown, and post-stop messages; release the session on client disconnect.
- [ ] **Recovery and cleanup:** observed failures preserve the first error and follow retry/stop limits; repeated cleanup leaves no active resources. Verify test-owned servers and browser media are stopped under the main skill's cleanup rule.
- [ ] **Language and voice:** test the primary language; add target-language checks only for requested languages, switching, multilingual use, or diagnosed mismatches—not a general language matrix.

Skip relay checks for direct clients. Record sound, lip sync, interruption, next-turn reuse, and browser cleanup separately as directly observed, explicitly user-confirmed, or unverified; mocked checks and visible video alone do not prove them. Use [troubleshooting](./troubleshooting.md) for failures and separate diagnostic-capability regression. Report verified and remaining checks under the live completion gate above.
