# Real-Time SDK Integration

Render application-supplied text or SSML as live avatar speech and video, keeping the existing conversation pipeline.

## Prepare

### 1. Confirm the resource

Reuse the Microsoft Foundry or Standard S0 Speech resource, region, and backend credential source. If absent, guide resource creation before requesting its region. Check [Avatar region support](https://learn.microsoft.com/azure/ai-services/speech-service/regions?tabs=ttsavatar); audio-only Speech support is not enough.

### 2. Locate the integration points

| Find | Use it for |
|---|---|
| Final-text callback | Supply complete text or SSML to the renderer. |
| Turn queue and interruption state | Serialize speech and coordinate cancellation. |
| Backend and UI components | Issue short-lived credentials, render media, and own cleanup. |

Keep existing STT, LLM, tools, and turn management. Implement missing components; do not create a parallel sample.

### 3. Confirm rendering settings

- **Speech:** input language and compatible neural voice.
- **Avatar:** character, style/type, and required video format.
- **Network:** client access to the chosen TURN service.

Check installed SDK types against the [real-time guide](https://learn.microsoft.com/azure/ai-services/speech-service/text-to-speech-avatar/real-time-synthesis-avatar) and [official browser sample](https://github.com/Azure-Samples/cognitive-services-speech-sdk/tree/master/samples/js/browser/avatar) before using the examples below.

## Implement

### 1. Issue Speech authorization and ICE credentials on the backend

Provide two authenticated, rate-limited backend endpoints:

| Credential | Backend request | Return to the authorized client |
|---|---|---|
| Speech token | `POST /sts/v1.0/issueToken`, empty body, `Ocp-Apim-Subscription-Key` header | Token, matching region/endpoint, and expiry metadata. |
| ICE credentials | Relay request below | Short-lived server URL, username, and credential; use TURN entries only. |

Use the regional Speech token issuer for regional SDK routing; match custom routing to its issuer. Follow the [token contract](https://learn.microsoft.com/azure/ai-services/speech-service/rest-text-to-speech#how-to-get-an-sts-access-token).

**Relay request:**

```http
GET /tts/cognitiveservices/avatar/relay/token/v1 HTTP/1.1
Host: <resource>.cognitiveservices.azure.com
Ocp-Apim-Subscription-Key: <speech-key>
```

**Renewal:** STS tokens currently last 10 minutes. Refresh before expiry using the installed synthesizer's supported API; changing its original `SpeechConfig` may not update the active object. If live refresh is unsupported or uncertain, rebuild between utterances with a fresh token, without replaying completed speech. See [SpeechConfig token configuration](https://learn.microsoft.com/javascript/api/microsoft-cognitiveservices-speech-sdk/speechconfig).

> **Credential boundary:** Speech and ICE credentials are not interchangeable. Return them over HTTPS with `Cache-Control: no-store`; keep them in client memory and out of logs. Never send the backend key to the client.

**Before live startup:** require supported resource/region, valid backend credentials, both credential endpoints, and an implemented renderer.

### 2. Configure the renderer

Create `SpeechConfig` from the backend token, then set voice, avatar, and video options before constructing `AvatarSynthesizer`. For custom routing, first verify the installed SDK's endpoint/token API.

```javascript
// speechToken and speechRegion come from the authenticated backend endpoint.
const speechConfig = SpeechSDK.SpeechConfig.fromAuthorizationToken(speechToken, speechRegion);
speechConfig.speechSynthesisLanguage = "en-US";
speechConfig.speechSynthesisVoiceName = "en-US-Ava:DragonHDLatestNeural";

const videoFormat = new SpeechSDK.AvatarVideoFormat();
videoFormat.width = 1920;
videoFormat.height = 1080;

const avatarConfig = new SpeechSDK.AvatarConfig(
	"lisa",
	"casual-sitting",
	videoFormat
);
avatarConfig.backgroundColor = "#00FF00FF";
```

> **Transparency:** `#RRGGBBAA` is accepted, but Avatar ignores alpha. Use client-side chroma key processing when transparency is required.

### 3. Connect WebRTC and start Avatar

1. Create the peer with backend-issued TURN credentials and attach remote media handlers:

```javascript
const peerConnection = new RTCPeerConnection({
	iceServers: [{
		urls: [iceServerUrl],
		username: iceServerUsername,
		credential: iceServerCredential
	}]
});

peerConnection.ontrack = (event) => {
	if (event.track.kind === "video") {
		videoElement.srcObject = event.streams[0];
	} else if (event.track.kind === "audio") {
		audioElement.srcObject = event.streams[0];
	}
};

peerConnection.addTransceiver("video", { direction: "sendrecv" });
peerConnection.addTransceiver("audio", { direction: "sendrecv" });
```

2. Set media elements to autoplay and video to `playsInline`. If `play()` is rejected, show a user-gesture playback control.
3. Create the synthesizer and start Avatar:

```javascript
const avatarSynthesizer = new SpeechSDK.AvatarSynthesizer(
	speechConfig,
	avatarConfig
);

await avatarSynthesizer.startAvatarAsync(peerConnection);
```

> **SDK signaling:** `sendrecv` follows the Speech SDK sample. Do not substitute Voice Live's SDP protocol or transceiver settings.

**Continue when:** startup completes, video is visible, and audio playback is enabled. Bound the wait; tracks alone are insufficient. Confirm audible speech with the first response, not before text is sent.

### 4. Serialize final responses and reuse the session

Send each final response through the existing turn queue:

```javascript
const result = await avatarSynthesizer.speakTextAsync(responseText);

if (result.reason !== SpeechSDK.ResultReason.SynthesizingAudioCompleted) {
	if (result.reason === SpeechSDK.ResultReason.Canceled) {
		const details = SpeechSDK.CancellationDetails.fromResult(result);
		throw new Error(details.errorDetails || details.reason);
	}
	throw new Error(`Unable to speak. Result ID: ${result.resultId}`);
}
```

| Input or event | Action |
|---|---|
| Plain text / SSML | Call `speakTextAsync` / `speakSsmlAsync`. |
| Overlapping responses | Serialize calls through the turn manager. |
| Cancellation | Route diagnostics to application error state; redact before logging or displaying. |
| Next response | Reuse the healthy synthesizer and peer. |

**Check:** a second sequential response renders synchronized audio/video in the same session.

### 5. Recover between utterances and release owned resources

| Condition | Action |
|---|---|
| 5-minute idle or 30-minute session limit | Replace the session between utterances. |
| Token renewal requires replacement | Obtain fresh credentials and rebuild before expiry. |
| Transient ICE/connection failure | Clean up first, then recover within the main skill's retry budget. |
| Invalid credentials, authorization failure, or configuration change | Pause for developer action; do not retry as a transient error. |

**Teardown:**
1. Call `avatarSynthesizer.close()`, close the peer, and stop remote tracks.
2. Clear media elements, detach handlers, and cancel owned tasks and refresh timers.
3. Discard temporary credentials.

> **Recovery:** serialize reconnect and teardown; never replay completed speech. Cleanup must be safe after partial startup and on repeated calls, leaving no owned resources active.

## Optional capabilities

Configure only what the request needs, using verified SDK properties:

| Requirement | Configure |
|---|---|
| Framing or dimensions | Crop and resolution. |
| Background | Color or public background image; use chroma key for transparency. |
| Photo avatar | Character and `photoAvatarBaseModel`. |

## Verify

- [ ] **Configuration:** resource, region, SDK, voice, avatar, and TURN match the plan; no secrets in logs.
- [ ] **Authorization:** separate Speech/ICE credentials work; renewal or replacement precedes expiry.
- [ ] **Playback:** a response produces audible speech and visible video, not just connected tracks.
- [ ] **Session reuse:** two sequential responses succeed in one session; overlapping calls are serialized.
- [ ] **Recovery:** reconnect between turns without replaying speech or racing cleanup.
- [ ] **Cancellation and cleanup:** cancellation reaches application error state; repeated teardown leaves no owned resources active.

Report verified and remaining checks using the main skill's **Report Results** section.
