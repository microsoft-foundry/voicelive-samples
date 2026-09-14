# Troubleshooting

Use the reported symptom and first service error to give a targeted recommendation when the evidence is sufficient. Otherwise, state the uncertainty and ask only for the next check that best distinguishes likely causes. Keep the existing integration path; do not restart onboarding, request a full diagnostic dump, or require reproduction by default.

Follow the [main skill](../SKILL.md) for approval, safe evidence handling, validation, retries, cleanup, and reporting.

## Connection

| Problem | Possible solution |
|---|---|
| 401 or 403 | Check the credential source, endpoint, region, tier, and permissions; do not switch authentication to bypass the failure. |
| Session setup fails | Use the first service error to check resource support, target, or SDK/API compatibility. Verify Voice Live avatar region support separately from batch. |
| Voice Live works on the server but not in the browser | Replace unsupported server WebSocket/auth patterns with the supported browser WebRTC flow; keep long-lived credentials on the backend. |
| Voice Live ICE timeout before `session.avatar.connect` | Check local SDP candidates without logging SDP. Candidates present: use [ICE fallback](./voice-live.md#4-connect-the-avatar-stream). None: check VPN, firewall, proxy, and STUN/TURN access. |
| Video resolution returns `invalid_argument` | Match the model's native aspect ratio (`1920 x 1080` for default `lisa` / `casual-sitting`). A later WebSocket 1006 may be secondary, not the root cause. |

See [Voice Live](./voice-live.md#prepare) or [Real-time Speech SDK](./realtime-sdk.md#prepare) for path-specific setup.

## Conversation and Playback

| Problem | Possible solution |
|---|---|
| No reply to microphone input | Locate the break in microphone capture, turn detection, model/agent response, or speech synthesis. Use transcripts only when transcription is enabled. |
| Mouth movement but no sound | Check the remote audio track and browser playback, including mute and autoplay; compare response locale with the voice. Mouth movement alone does not prove audible output. |
| Missing or frozen video | Check SDP/ICE, video track delivery, and the playback element. |
| Stuttering or interrupted playback | Compare an official or minimal sample on the same region, network, browser, and machine. Use browser WebRTC diagnostics (`chrome://webrtc-internals` or `edge://webrtc-internals`) to separate network delivery, decode, and rendering problems. |
| Speech fails after a language switch | Response language does not automatically change the voice. Check voice/locale support; use a supported between-turn update or rebuild without replaying completed responses. |
| Reconnects after each reply or duplicate speech | Check whether reply completion closes the session or reconnect replays completed work. Reuse healthy sessions and serialize synthesis; see [Real-time Speech SDK](./realtime-sdk.md#implement). |

See [Voice Live](./voice-live.md#implement) for input, response, and media integration details.

## Batch Output

| Problem | Possible solution |
|---|---|
| File will not play | Check codec/container compatibility; prefer H.264 for wider player support. |
| Transparency fails | Check the WebM/VP9 and transparent-background settings together. |
| Retries create duplicate jobs | Preserve the logical request and synthesis ID across retries. |
| Polling never ends | Check terminal-state handling and the polling timeout. |
| Output URL expires | Copy generated output into app-owned storage before expiry. |

See [Batch Synthesis](./batch-synthesis.md#implement) for job and output handling.
