# -------------------------------------------------------------------------
# Copyright (c) Microsoft Corporation. All rights reserved.
# Licensed under the MIT License.
# -------------------------------------------------------------------------
"""
Place an outbound appointment-reminder call via the Twilio REST API.

The call fetches TwiML from your running app.py (`/outbound-twiml`), which opens
a Media Stream to Voice Live carrying the appointment details.

Example:
    python make_call.py \
        --to +15551234567 \
        --name "Jamie Rivera" \
        --time "Tuesday, July 28 at 3:00 PM"

Requires a publicly reachable server URL (PUBLIC_BASE_URL), e.g. your ngrok
HTTPS address. Set it in .env or pass --base-url.
"""
from __future__ import annotations

import argparse
import os
from urllib.parse import urlencode

from dotenv import load_dotenv

load_dotenv("./.env", override=True)


def main() -> None:
    parser = argparse.ArgumentParser(description="Place an outbound appointment reminder call.")
    parser.add_argument("--to", required=True, help="Customer phone number in E.164 format, e.g. +15551234567")
    parser.add_argument("--name", required=True, help="Customer name.")
    parser.add_argument("--time", required=True, help="Appointment time, e.g. 'Tuesday at 3 PM'.")
    parser.add_argument(
        "--base-url",
        default=os.environ.get("PUBLIC_BASE_URL", ""),
        help="Public HTTPS base URL of your running app (e.g. https://abc123.ngrok.app).",
    )
    parser.add_argument(
        "--from",
        dest="from_number",
        default=os.environ.get("TWILIO_FROM_NUMBER", ""),
        help="Your Twilio phone number (E.164). Defaults to TWILIO_FROM_NUMBER.",
    )
    args = parser.parse_args()

    account_sid = os.environ.get("TWILIO_ACCOUNT_SID", "")
    auth_token = os.environ.get("TWILIO_AUTH_TOKEN", "")

    missing = [
        name
        for name, value in {
            "TWILIO_ACCOUNT_SID": account_sid,
            "TWILIO_AUTH_TOKEN": auth_token,
            "--from / TWILIO_FROM_NUMBER": args.from_number,
            "--base-url / PUBLIC_BASE_URL": args.base_url,
        }.items()
        if not value
    ]
    if missing:
        raise SystemExit("Missing required configuration: " + ", ".join(missing))

    from twilio.rest import Client

    query = urlencode({"customer_name": args.name, "appointment_time": args.time})
    twiml_url = f"{args.base_url.rstrip('/')}/outbound-twiml?{query}"

    client = Client(account_sid, auth_token)
    call = client.calls.create(to=args.to, from_=args.from_number, url=twiml_url)
    print(f"Placed call {call.sid} to {args.to}")


if __name__ == "__main__":
    main()
