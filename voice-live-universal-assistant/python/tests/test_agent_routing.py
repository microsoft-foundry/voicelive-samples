"""
Agent routing tests: the server's own configuration decides which Foundry
resource, project, agent, version, and managed identity a session uses.
Client-supplied values are ignored unless VOICELIVE_ALLOW_CLIENT_AGENT_OVERRIDE=true.

No real Azure connection needed — VoiceLiveHandler is mocked.
"""

import asyncio
import os
import sys
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import app  # noqa: E402

SERVER_ENV = {
    "AZURE_VOICELIVE_ENDPOINT": "https://example.services.ai.azure.com/",
    "AZURE_VOICELIVE_API_KEY": "placeholder",
    "AZURE_VOICELIVE_AGENT_NAME": "server-agent",
    "AZURE_VOICELIVE_PROJECT": "server-project",
}

CLIENT_ROUTING = {
    "type": "start_session",
    "mode": "agent",
    "agent_name": "client-agent",
    "project": "client-project",
    "agent_version": "7",
    "foundry_resource_override": "client-resource",
    "auth_identity_client_id": "00000000-0000-0000-0000-000000000000",
}


def _start_and_capture_config(env: dict, message: dict):
    """Run _start_session with a mocked handler and return the SessionConfig it received."""
    handler_cls = MagicMock()
    handler_cls.return_value.start = AsyncMock()
    handler_cls.return_value.stop = AsyncMock()
    websocket = MagicMock()
    websocket.send_text = AsyncMock()
    config = {k: v for k, v in message.items() if k != "type"}
    with patch.dict(os.environ, env, clear=True), patch.object(app, "VoiceLiveHandler", handler_cls), patch.object(
        app, "_credential", None
    ):
        asyncio.run(app._start_session("test-client", config, websocket))
        app._handlers.clear()
    assert handler_cls.called, websocket.send_text.call_args
    return handler_cls.call_args.kwargs["config"]


@pytest.fixture(scope="module")
def locked_config():
    return _start_and_capture_config(SERVER_ENV, CLIENT_ROUTING)


@pytest.fixture(scope="module")
def override_config():
    env = {**SERVER_ENV, "VOICELIVE_ALLOW_CLIENT_AGENT_OVERRIDE": "true"}
    return _start_and_capture_config(env, CLIENT_ROUTING)


class TestAgentRoutingLockedByDefault:
    def test_agent_name_uses_server_value(self, locked_config):
        assert locked_config.agent_name == "server-agent"

    def test_project_uses_server_value(self, locked_config):
        assert locked_config.project_name == "server-project"

    def test_agent_version_ignored(self, locked_config):
        assert locked_config.agent_version is None

    def test_foundry_resource_override_ignored(self, locked_config):
        assert locked_config.foundry_resource_override is None

    def test_auth_identity_client_id_ignored(self, locked_config):
        assert locked_config.auth_identity_client_id is None

    def test_config_endpoint_reports_override_disabled(self):
        with patch.dict(os.environ, SERVER_ENV, clear=True):
            assert asyncio.run(app.get_config())["allowClientAgentOverride"] is False


class TestAgentRoutingOverrideOptIn:
    def test_agent_name_uses_client_value(self, override_config):
        assert override_config.agent_name == "client-agent"

    def test_project_uses_client_value(self, override_config):
        assert override_config.project_name == "client-project"

    def test_agent_version_uses_client_value(self, override_config):
        assert override_config.agent_version == "7"

    def test_foundry_resource_override_uses_client_value(self, override_config):
        assert override_config.foundry_resource_override == "client-resource"

    def test_auth_identity_client_id_uses_client_value(self, override_config):
        assert override_config.auth_identity_client_id == "00000000-0000-0000-0000-000000000000"

    def test_config_endpoint_reports_override_enabled(self):
        env = {**SERVER_ENV, "VOICELIVE_ALLOW_CLIENT_AGENT_OVERRIDE": "true"}
        with patch.dict(os.environ, env, clear=True):
            assert asyncio.run(app.get_config())["allowClientAgentOverride"] is True
