# Inbound AI Receptionist (Voice Live + Twilio)

An AI receptionist that answers **inbound phone calls**. When someone dials your
Twilio number, Azure Voice Live greets them, answers questions about your
business, can take a message, and can transfer the call to a human — all as a
natural, low‑latency voice conversation.

## Key Features

- Inbound PSTN call handling via Twilio Media Streams
- Server‑side Voice Live SDK bridge (the phone is the only client)
- G.711 μ‑law 8 kHz audio passed through with **no transcoding**
- Proactive greeting and natural barge‑in (caller can interrupt)
- `take_message` function — persists caller messages to JSON
- `transfer_to_human` function — redirects the live call via the Twilio REST API
- API key **or** Azure credential (`DefaultAzureCredential`) authentication

## How it works

```
Caller → Twilio number → (Voice webhook) /incoming-call → TwiML <Connect><Stream>
      → WebSocket /media-stream ⇄ CallBridge ⇄ Azure Voice Live
```

1. Twilio requests `/incoming-call` and receives TwiML telling it to open a Media
   Stream to `wss://<host>/media-stream`.
2. `/media-stream` connects to Voice Live, configures a G.711 μ‑law session, and
   bridges audio in both directions.
3. Voice Live drives the conversation and calls functions when appropriate.

## Setup

1. **Install dependencies**

   ```bash
   python -m venv .venv
   # Windows: .venv\Scripts\activate  |  Linux/macOS: source .venv/bin/activate
   pip install -r requirements.txt
   ```

2. **Configure** — copy `.env_sample` to `.env` and fill in your values:

   ```bash
   cp .env_sample .env
   ```

   At minimum set `AZURE_VOICELIVE_ENDPOINT` and `AZURE_VOICELIVE_API_KEY`
   (or set `USE_TOKEN_CREDENTIAL=true` and run `az login`).

3. **Run the server**

   ```bash
   python app.py
   ```

4. **Expose it publicly** so Twilio can reach it:

   ```bash
   ngrok http 8000
   ```

5. **Point your Twilio number at it.** In the Twilio Console, open your phone
   number's *Voice Configuration* and set **A call comes in** → *Webhook* to:

   ```
   https://<your-ngrok-subdomain>.ngrok.app/incoming-call     (HTTP POST)
   ```

6. **Call your Twilio number** and talk to the receptionist. Try: *"What are your
   hours?"*, *"Can I leave a message?"*, or *"Can I speak to someone?"*

## Configuration reference

| Variable | Required | Description |
| --- | --- | --- |
| `AZURE_VOICELIVE_ENDPOINT` | Yes | Your AI Foundry / Voice Live endpoint. |
| `AZURE_VOICELIVE_API_KEY` | Yes* | API key. *Not needed if `USE_TOKEN_CREDENTIAL=true`. |
| `USE_TOKEN_CREDENTIAL` | No | `true` to use `DefaultAzureCredential` (az login). |
| `AZURE_VOICELIVE_MODEL` | No | Defaults to `gpt-realtime`. |
| `AZURE_VOICELIVE_VOICE` | No | Defaults to `en-US-Ava:DragonHDLatestNeural`. |
| `BUSINESS_NAME` | No | Injected into the receptionist's instructions. |
| `RECEPTIONIST_INSTRUCTIONS` | No | Override the full system prompt. |
| `MESSAGES_DIR` | No | Where `take_message` writes JSON (default `./messages`). |
| `TRANSFER_PHONE_NUMBER` | No | Number to transfer callers to. |
| `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` | No | Required only for transfers. |

## Customizing the receptionist

Edit the business facts and behavior by setting `BUSINESS_NAME` and
`RECEPTIONIST_INSTRUCTIONS` in `.env`, or edit the `INSTRUCTIONS` default in
[`app.py`](./app.py). Add new capabilities by adding a `FunctionTool` in
`build_tools()` and handling it in `CallBridge._execute_function_call`.

## Troubleshooting

- **Caller hears silence**: confirm your public URL is reachable and the Twilio
  webhook points at `/incoming-call`. Check that the WebSocket upgraded (look for
  "Twilio connected to /media-stream" in the logs).
- **`wss` connection fails**: the TwiML `<Stream url>` is built from the `Host`
  header — make sure Twilio reaches you over HTTPS (ngrok/Azure), not raw HTTP.
- **401 Unauthorized**: verify `AZURE_VOICELIVE_API_KEY`, or run `az login` when
  using `USE_TOKEN_CREDENTIAL=true`.
- **Transfer does nothing**: set `TRANSFER_PHONE_NUMBER`, `TWILIO_ACCOUNT_SID`,
  and `TWILIO_AUTH_TOKEN`.

## License

Licensed under the MIT License. See the repository [LICENSE](../../../LICENSE).
