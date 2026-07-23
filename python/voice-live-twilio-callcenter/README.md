# Voice Live + Twilio Call Center Samples

These samples show how to connect the **Azure AI Speech Voice Live** API to the
**public telephone network (PSTN)** using [Twilio Programmable Voice](https://www.twilio.com/docs/voice)
and [Media Streams](https://www.twilio.com/docs/voice/media-streams). A real
caller dials (or is dialed by) a Twilio phone number, and Voice Live handles the
conversation end‑to‑end with natural, low‑latency speech‑to‑speech.

Unlike the microphone‑based quickstarts in this repo, these samples run as a
**server‑side WebSocket bridge**: Twilio streams call audio to your service, your
service relays it to Voice Live, and Voice Live's audio is streamed back to the
caller. The Voice Live SDK runs entirely on the server — the phone is the client.

## Samples

| Sample | Direction | Scenario |
| --- | --- | --- |
| [`inbound-receptionist`](./inbound-receptionist) | Inbound | Answers incoming calls as an AI receptionist — greets the caller, answers FAQs, takes a message, and transfers to a human. |
| [`outbound-appointment-reminder`](./outbound-appointment-reminder) | Outbound | Places an outbound call to a customer, confirms an appointment, and records whether they confirmed, rescheduled, or cancelled. |

Each subfolder is self‑contained with its own `app.py`, `requirements.txt`,
`.env_sample`, and `README.md`.

## How it works

Twilio Media Streams and Voice Live both speak **G.711 μ‑law at 8 kHz**, so audio
flows through the bridge as base64 with **no transcoding**:

```
                 PSTN                      WebSocket (μ-law 8kHz base64)
Caller  ◄──────────────────►  Twilio  ◄──────────────────────────────►  Your bridge (FastAPI)
                                                                              │
                                                                              │  Voice Live SDK
                                                                              ▼
                                                                        Azure Voice Live
```

- **Inbound audio**: Twilio `media` frames (`media.payload`) are passed straight
  into `connection.input_audio_buffer.append(audio=payload)`.
- **Outbound audio**: Voice Live `response.audio.delta` bytes are base64‑encoded
  and sent back to Twilio as `media` frames.
- **Barge‑in**: when the caller starts speaking, the bridge sends Twilio a
  `clear` message and cancels the in‑progress Voice Live response.

## Prerequisites

- [Python 3.9+](https://www.python.org/downloads/)
- An [AI Foundry resource](https://learn.microsoft.com/azure/ai-services/multi-service-resource)
  with Voice Live enabled (endpoint + API key, or Azure credentials)
- A [Twilio account](https://www.twilio.com/try-twilio) with:
  - A **Voice‑capable phone number**
  - Your **Account SID** and **Auth Token** (from the Twilio Console)
- A way to expose your local server to the public internet so Twilio can reach it,
  e.g. [ngrok](https://ngrok.com/) (`ngrok http 8000`) or an Azure deployment.

## Quick start

1. Pick a sample folder and follow its README.
2. Copy `.env_sample` to `.env` and fill in your Voice Live and Twilio values.
3. Install dependencies:

   ```bash
   python -m venv .venv
   # Windows: .venv\Scripts\activate  |  Linux/macOS: source .venv/bin/activate
   pip install -r requirements.txt
   ```

4. Start the bridge, expose it with a tunnel, and point Twilio at the public URL.

## Notes on production use

These samples prioritize clarity over completeness. Before going to production,
consider: authenticating Twilio webhooks with
[request signature validation](https://www.twilio.com/docs/usage/webhooks/webhooks-security),
per‑call error handling and reconnection, call recording consent where legally
required, and horizontal scaling of the WebSocket bridge.

## Resources

- [Azure AI Speech — Voice Live documentation](https://learn.microsoft.com/azure/ai-services/speech-service/voice-live)
- [Voice Live Python SDK](https://learn.microsoft.com/python/api/overview/azure/ai-voicelive-readme)
- [Twilio Media Streams](https://www.twilio.com/docs/voice/media-streams)
- [Twilio TwiML `<Connect><Stream>`](https://www.twilio.com/docs/voice/twiml/stream)

## License

Licensed under the MIT License. See the repository [LICENSE](../../LICENSE).
