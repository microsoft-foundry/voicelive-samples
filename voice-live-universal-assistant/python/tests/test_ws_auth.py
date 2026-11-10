"""
/ws authentication tests: the WebSocket requires the Container Apps
authentication principal header by default, and allows anonymous use only
when VOICELIVE_ALLOW_ANONYMOUS=true.

No real Azure connection needed — session start is mocked.
"""

import json
import os
import sys
from unittest.mock import AsyncMock, patch

import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import app  # noqa: E402

PRINCIPAL_HEADERS = {"X-MS-CLIENT-PRINCIPAL-ID": "00000000-0000-0000-0000-000000000001"}
START_MESSAGE = json.dumps({"type": "start_session", "mode": "model"})


def _connect_and_start(env: dict, headers: dict | None = None):
    """Connect to /ws, send start_session, and return (first_message, start_session_mock)."""
    async def _reply_started(client_id, config, websocket):
        await websocket.send_text(json.dumps({"type": "session_started"}))

    start_mock = AsyncMock(side_effect=_reply_started)
    with patch.dict(os.environ, env, clear=True), patch.object(app, "_start_session", start_mock):
        with TestClient(app.app) as client:
            with client.websocket_connect("/ws/test-client", headers=headers or {}) as ws:
                ws.send_text(START_MESSAGE)
                try:
                    first = json.loads(ws.receive_text())
                except WebSocketDisconnect:
                    first = None
    return first, start_mock


class TestWsAuthRequiredByDefault:
    def test_ws_rejects_without_principal(self):
        first, start_mock = _connect_and_start({})
        assert first["type"] == "error"
        assert "Authentication required" in first["message"]
        start_mock.assert_not_called()

    def test_ws_rejects_blank_principal(self):
        first, start_mock = _connect_and_start({}, {"X-MS-CLIENT-PRINCIPAL-ID": " "})
        assert first["type"] == "error"
        start_mock.assert_not_called()

    def test_ws_closes_with_policy_violation(self):
        with patch.dict(os.environ, {}, clear=True), TestClient(app.app) as client:
            with client.websocket_connect("/ws/test-client") as ws:
                ws.receive_text()
                with pytest.raises(WebSocketDisconnect) as closed:
                    ws.receive_text()
        assert closed.value.code == 1008

    def test_ws_accepts_with_principal(self):
        _, start_mock = _connect_and_start({}, PRINCIPAL_HEADERS)
        start_mock.assert_called_once()

    def test_config_reports_auth_required(self):
        with patch.dict(os.environ, {}, clear=True), TestClient(app.app) as client:
            assert client.get("/config").json()["authRequired"] is True


class TestWsAnonymousOptIn:
    def test_ws_accepts_without_principal_when_anonymous_allowed(self):
        _, start_mock = _connect_and_start({"VOICELIVE_ALLOW_ANONYMOUS": "true"})
        start_mock.assert_called_once()

    def test_config_reports_auth_not_required(self):
        with patch.dict(os.environ, {"VOICELIVE_ALLOW_ANONYMOUS": "true"}, clear=True), TestClient(app.app) as client:
            assert client.get("/config").json()["authRequired"] is False
