# Live Reference AEC

A browser sample showing how to send **both the microphone audio and your app's speaker playback** to Azure Voice Live as a single stereo stream, so the service can cancel echo using the same signal your app plays out to the speaker. This feature is called Live Reference AEC.

Available at REST api-version `2026-07-15` and later.

## Why use a client-side reference

By default, Voice Live uses its own generated TTS output as the echo reference (server loopback). That works when the only sound on the device is Voice Live's TTS, but the server's copy is not always what the speaker actually plays. The client may change volume, apply equalization, mix in other sounds, or buffer audio differently, and network jitter shifts the reference out of sync with the mic. When the reference no longer matches the real speaker output, echo cancellation degrades.

Client-side reference fixes this by having the client capture and send the real speaker output alongside the mic:

- **True source of truth**: the reference is the signal your app sends to the speaker, after all client-side mixing, effects, and buffering. It is captured in the browser before OS volume and device processing, so it reflects your app's output rather than the final acoustic signal.
- **Packet-synchronized**: mic and reference travel in the same packet, so network conditions cannot misalign them.
- **Minimal protocol change**: activate by adding two fields to your session config (`reference_source: "client"`, `channels: 2`). The client work is capturing and interleaving the reference audio.
- **No billing change**: billing is based on mic audio content. The reference channel is stripped on arrival and used only for alignment.

## How it works

The client sends interleaved stereo PCM16 where channel 0 is the mic and channel 1 is a tap of the speaker playback:

```
[ mic0, ref0, mic1, ref1, mic2, ref2, ... ]
```

In the browser this is done entirely with the Web Audio API, so the playback never has to leave the page or be recorded from a second microphone. All assistant audio is routed through a shared playback bus that feeds both the speakers and the reference channel of an `AudioWorklet` interleaver:

```
 mic         --> interleaver input 0 (mic)
 playbackBus --> speakers (AudioContext.destination)
 playbackBus --> interleaver input 1 (reference)
 interleaver --> stereo PCM16 --> session.sendAudio()
```

| File | Purpose |
| ---- | ------- |
| `public/stereo-interleaver.js` | `AudioWorklet` that interleaves mic + reference into stereo PCM16. |
| `src/echoCancellationAudio.ts` | Builds the audio graph: mic capture (browser EC off), playback bus, interleaver, and TTS scheduling through the bus. |
| `src/voiceAssistant.ts` | Voice Live SDK session wired with `inputAudioEchoCancellation` and stereo streaming. |
| `src/main.ts` | Minimal UI wiring. |

## Quick Start

### Prerequisites

- **Node.js 22 or later** with npm
- **Azure AI Foundry** resource with Voice Live enabled, using api-version `2026-07-15` or later
- `@azure/ai-voicelive` `1.1.0` or later (adds the Live Reference AEC fields; installed by `npm install`)
- Modern browser (Chrome 80+, Edge 80+, Firefox 76+, Safari 14.1+)


### 1. Install dependencies

```bash
cd javascript/live-reference-aec
npm install
```

### 2. Start the dev server

```bash
npm run dev
```

Opens at **http://localhost:3000**.

### 3. Configure and run

1. Enter your **Voice Live endpoint** and **API key** (Azure AI Foundry portal > your resource > **Keys and Endpoint**).
2. Optionally adjust **model**, **voice**, and **instructions**.
3. Click **Start** and allow microphone access.
4. Speak. Play the assistant's replies through your speakers (not headphones) to hear echo cancellation in action.

> **Tip:** To see the benefit, use speakers rather than headphones so the assistant's voice re-enters the microphone. With the client reference active, that echo is cancelled and the assistant does not talk over itself.

> **Security:** This sample takes an API key in the browser to stay self-contained. A key in client code is visible to anyone who loads the page. In production, do not ship the key to the browser: authenticate with Microsoft Entra ID, or have a backend mint short-lived tokens that the client uses instead.

## Session configuration

The only feature-specific configuration is the echo cancellation block, sent with the session update before any audio is streamed. The sample then waits for the server's `session.updated` acknowledgement before it starts streaming, so audio is never sent under a stale configuration; a rejected configuration surfaces as an error instead. On the wire:

```json
{
  "type": "session.update",
  "session": {
    "modalities": ["text", "audio"],
    "input_audio_format": "pcm16",
    "input_audio_sampling_rate": 24000,
    "input_audio_echo_cancellation": {
      "type": "server_echo_cancellation",
      "reference_source": "client",
      "channels": 2
    },
    "turn_detection": { "type": "server_vad" }
  }
}
```

In this sample the same configuration is expressed in the SDK's camelCase form (`inputAudioEchoCancellation`, `referenceSource`, `inputAudioSamplingRate`), typed by `@azure/ai-voicelive` `1.1.0+` and serialized to the wire shape shown above.

### Field reference

| Field | Value | Notes |
| ----- | ----- | ----- |
| `type` | `"server_echo_cancellation"` | Required. Currently the only supported EC type. |
| `reference_source` | `"client"` | EC uses the client-supplied reference on channel 1. Set to `"server"` (default) for internal TTS loopback. |
| `channels` | `2` | Stereo input: ch0 = mic, ch1 = reference. Default is `1` (mono). |
| `input_audio_format` | `"pcm16"` | Required when using a client reference. Only PCM16 is supported for this feature. |
| `input_audio_sampling_rate` | `24000` | Sample rate of your stream in Hz. PCM16 supports `8000`, `16000`, or `24000`. Must match your actual capture rate. Defaults to 24000 if omitted. |

### Validation rules

| Condition | Error code | Meaning |
| --------- | ---------- | ------- |
| `reference_source: "client"` without stereo (`channels: 1`) | `invalid_ec_reference_channels` | Client reference requires stereo input. |
| Stereo (`channels: 2`) without client reference | `invalid_ec_channels_requires_client` | Stereo input is only valid with a client reference. |
| Stereo with a non-PCM16 format | `invalid_ec_channels_format` | Only PCM16 is supported with a client reference. |
| Changing `channels` mid-session | `change_in_ec_channels_not_allowed` | Channel config is immutable after the session starts. |

## Common pitfalls

The server does not validate the quality of the reference channel. It trusts that the client sends the correct speaker output.

| Issue | Result | How to avoid |
| ----- | ------ | ------------ |
| Reference is all silence / zeros | Nothing to cancel against; worse than server loopback | Ensure all TTS routes through the playback bus (`playbackBus`), not directly to `destination` or an `<audio>` element. |
| Channels swapped (ref in ch0, mic in ch1) | EC cancels the mic against itself; severe degradation | Keep the interleave order ch0 = mic, ch1 = reference. |
| Browser EC/NS/AGC left on for the mic | The browser alters the mic before the server sees it | Set `echoCancellation`, `noiseSuppression`, and `autoGainControl` to `false` in `getUserMedia` (the server does EC). |
| Mono audio sent with `channels: 2` | Server deinterleaves mono as stereo and garbles both channels | Match the actual audio layout to the `channels` setting. |
| Sampling rate mismatch | Reference and mic drift; EC degrades | Read `AudioContext.sampleRate` after construction and send it as `input_audio_sampling_rate`. |

## Bandwidth and billing

Stereo doubles the input audio bandwidth. For most voice applications this is not a concern.

| Mode | Rate (per second) | Per hour |
| ---- | ----------------- | -------- |
| Mono (default) | ~47 KB/s | ~165 MB |
| Stereo (client reference) | ~94 KB/s | ~330 MB |

After base64 encoding for WebSocket transport, effective stereo bandwidth is about 125 KB/s per session. **Billing does not change**: it is based on mic audio content, not raw WebSocket bytes. The reference channel is stripped on arrival and used only for EC alignment.

## Beyond the browser

The reference audio in this sample is your app's own Web Audio playback. It does not capture other browser tabs or OS-level sounds. On native platforms, capture the system or app playback and interleave it with the mic in the same `[mic, ref, mic, ref, ...]` PCM16 order:

| Platform | Suggested capture method |
| -------- | ------------------------ |
| **Windows** | WASAPI loopback (`IAudioClient` in loopback mode) captures the speaker mix. |
| **macOS** | `AudioUnit` with a tap on the output device. |
| **iOS** | `AVAudioEngine` tap on the main mixer output node. |
| **Android** | Route TTS through your own `AudioTrack` and tap before output. `AudioPlaybackCapture` (Android 10+) cannot capture `USAGE_VOICE_COMMUNICATION` audio. |

Capture the reference as close to the speaker output as possible, before analog processing. The server accepts PCM16 at 8, 16, or 24 kHz and resamples internally to 16 kHz for EC processing.

## Notes and limitations

- **PCM16 only** for the input stream when using a client reference.
- **16 kHz internal processing**: regardless of input rate, the EC model runs at 16 kHz internally. This covers the full speech range and does not affect voice quality.
- EC removes echo (speaker output re-entering the mic). It is not a noise canceller. For ambient noise, configure `input_audio_noise_reduction` (`type: "azure_deep_noise_suppression"`) alongside EC.
- **Only your app's own playback is cancelled.** Web Audio can only tap audio produced inside its own `AudioContext` (the `playbackBus`), so the reference contains just the assistant's TTS. Sound from other tabs, OS notifications, or other apps still reaches the mic and is not cancelled. If a user runs system audio on speakers, that audio can be sent back to the service and degrade recognition. For dedicated audio experiences this is the intended trade-off; if you need system-wide echo cancellation, keep the browser's native `echoCancellation: true` instead of client reference.
- **Reconnection is out of scope.** On an unexpected socket drop the sample tears the session down (`onDisconnected`). Production apps on mobile or unstable networks should add reconnection with exponential backoff and session/history replay.
- Performance varies by environment and degrades in high-reverb rooms, where the echo becomes too diffuse to match against the reference.

## Troubleshooting

### "Microphone not accessible"
- Serve over `http://localhost` or **HTTPS** (required for microphone access).
- Check the browser's site permissions for microphone access.
- Refresh the page and re-allow permissions.

### "Connection failed"
- Verify your **endpoint** and **API key** are correct.
- Confirm the resource uses api-version `2026-07-15` or later with Voice Live enabled.
- Check the browser console for detailed error messages.

### "No audio playback"
- Check browser audio permissions and system volume.
- Verify your speakers are working (use speakers, not headphones, to hear the echo cancellation).

### "Echo cancellation has no effect"
- Ensure all assistant audio routes through the playback bus, not an `<audio>` element or `destination` directly, so the reference channel is not silent.
- Confirm the mic is captured with `echoCancellation`, `noiseSuppression`, and `autoGainControl` set to `false`.
- Confirm `input_audio_sampling_rate` matches the actual `AudioContext.sampleRate`.

## Development

```bash
npm run dev        # Development server
npm run build      # Production build
npm run preview    # Preview production build
npm run type-check # TypeScript type checking
```

Microphone access requires `http://localhost` or an HTTPS origin.

## License

This sample is licensed under the MIT License. See the repository LICENSE for details.
