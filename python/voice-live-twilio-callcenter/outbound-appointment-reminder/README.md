# Outbound Appointment Reminder (Voice Live + Twilio)

Places an **outbound phone call** to a customer and uses Azure Voice Live to
remind them of an appointment, then records whether they **confirmed**, want to
**reschedule**, or **cancel** — as a natural voice conversation.

## Key Features

- Outbound PSTN calling via the Twilio REST API + Media Streams
- Per‑call personalization (customer name + appointment time) passed as Twilio
  `<Parameter>` stream values
- Server‑side Voice Live SDK bridge with G.711 μ‑law (no transcoding)
- Proactive greeting and natural barge‑in
- `record_outcome` function — persists the result (confirmed / reschedule /
  cancel + notes) to JSON
- API key **or** Azure credential (`DefaultAzureCredential`) authentication

## How it works

```
make_call.py → Twilio REST (create call) → customer's phone rings
    → Twilio fetches /outbound-twiml?customer_name=…&appointment_time=…
    → TwiML <Connect><Stream> with <Parameter> details
    → WebSocket /media-stream ⇄ CallBridge ⇄ Azure Voice Live
    → record_outcome() writes the result to ./outcomes
```

The appointment details flow end‑to‑end: `make_call.py` puts them in the TwiML
URL, `/outbound-twiml` embeds them as `<Parameter>` values, and they arrive in
Twilio's `start` event as `customParameters`, which the bridge uses to build the
assistant's instructions.

## Setup

1. **Install dependencies**

   ```bash
   python -m venv .venv
   # Windows: .venv\Scripts\activate  |  Linux/macOS: source .venv/bin/activate
   pip install -r requirements.txt
   ```

2. **Configure** — copy `.env_sample` to `.env` and fill in your values
   (Voice Live endpoint/key, Twilio credentials, `TWILIO_FROM_NUMBER`, and
   `PUBLIC_BASE_URL`).

3. **Run the server**

   ```bash
   python app.py
   ```

4. **Expose it publicly** so Twilio can fetch the TwiML and open the stream:

   ```bash
   ngrok http 8000
   ```

   Put the resulting HTTPS URL in `PUBLIC_BASE_URL` in `.env` (or pass
   `--base-url`).

5. **Place a call**

   ```bash
   python make_call.py \
       --to +15551234567 \
       --name "Jamie Rivera" \
       --time "Tuesday, July 28 at 3:00 PM"
   ```

   The customer's phone rings; when they answer, Voice Live delivers the reminder
   and records the outcome under `./outcomes`.

## `make_call.py` options

| Flag | Required | Description |
| --- | --- | --- |
| `--to` | Yes | Customer phone number (E.164), e.g. `+15551234567`. |
| `--name` | Yes | Customer name used in the reminder. |
| `--time` | Yes | Appointment time text, e.g. `"Tuesday at 3 PM"`. |
| `--from` | No | Your Twilio number; defaults to `TWILIO_FROM_NUMBER`. |
| `--base-url` | No | Public app URL; defaults to `PUBLIC_BASE_URL`. |

## Configuration reference

| Variable | Required | Description |
| --- | --- | --- |
| `AZURE_VOICELIVE_ENDPOINT` | Yes | Your AI Foundry / Voice Live endpoint. |
| `AZURE_VOICELIVE_API_KEY` | Yes* | API key. *Not needed if `USE_TOKEN_CREDENTIAL=true`. |
| `USE_TOKEN_CREDENTIAL` | No | `true` to use `DefaultAzureCredential` (az login). |
| `AZURE_VOICELIVE_MODEL` | No | Defaults to `gpt-realtime`. |
| `AZURE_VOICELIVE_VOICE` | No | Defaults to `en-US-Ava:DragonHDLatestNeural`. |
| `BUSINESS_NAME` | No | Injected into the assistant's instructions. |
| `OUTCOMES_DIR` | No | Where `record_outcome` writes JSON (default `./outcomes`). |
| `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` | Yes | Twilio credentials. |
| `TWILIO_FROM_NUMBER` | Yes | Your Twilio caller ID (E.164). |
| `PUBLIC_BASE_URL` | Yes | Public HTTPS URL of this server. |

## Compliance note

Outbound automated calls are regulated in many regions (e.g. TCPA in the US).
Only call customers who have consented, honor do‑not‑call requests, and disclose
that the caller is an automated assistant.

## Troubleshooting

- **Call connects but is silent**: verify `PUBLIC_BASE_URL` is correct and the
  server logs show "Twilio connected to /media-stream".
- **`make_call.py` errors on missing config**: ensure Twilio credentials,
  `--from`/`TWILIO_FROM_NUMBER`, and `--base-url`/`PUBLIC_BASE_URL` are set.
- **401 Unauthorized (Voice Live)**: check `AZURE_VOICELIVE_API_KEY` or run
  `az login` when `USE_TOKEN_CREDENTIAL=true`.

## License

Licensed under the MIT License. See the repository [LICENSE](../../../LICENSE).
