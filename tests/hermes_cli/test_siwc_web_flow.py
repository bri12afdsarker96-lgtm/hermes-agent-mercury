"""Actual ASGI routing, loopback and owned-session lifecycle; synthetic grant."""
import threading
import time
import urllib.parse
import urllib.request

import pytest
from fastapi.testclient import TestClient

from hermes_cli import auth, web_server as web

PROFILE = "enterprise-text-" + "a" * 32
OWNER = "b" * 64


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(auth, "_SIWC_LAUNCH_HOME", tmp_path.resolve())
    monkeypatch.setattr(web, "_SESSION_TOKEN", "fixture-web-token")
    monkeypatch.setattr(web.app.state, "auth_required", False, raising=False)
    with web._oauth_sessions_lock:
        web._oauth_sessions.clear()
    client = TestClient(web.app, base_url="http://127.0.0.1", headers={
        "X-Hermes-Session-Token": "fixture-web-token", "X-Hermes-Text-Owner": OWNER})
    yield client
    with web._oauth_sessions_lock:
        for session in web._oauth_sessions.values():
            session["cancelled"] = True
        web._oauth_sessions.clear()
    client.close()


def start(client):
    response = client.post("/api/providers/oauth/openai-siwc/start", params={"profile": PROFILE})
    assert response.status_code == 200, response.text
    login = response.json()
    query = urllib.parse.parse_qs(urllib.parse.urlsplit(login["auth_url"]).query)
    assert "id_token_hint" not in query
    return login, query


def callback(query):
    uri = query["redirect_uri"][0]
    assert urllib.parse.urlsplit(uri).hostname == "127.0.0.1"
    url = uri + "?" + urllib.parse.urlencode({"state": query["state"][0], "code": "synthetic-code", "client_id": "fixture-issued"})
    with urllib.request.urlopen(url, timeout=3) as response:
        assert response.status == 200


def record(attempt, callback, uri):
    assert callback["state"] == attempt["state"]
    return {"issuer": auth.SIWC_ISSUER, "subject": "fixture-owned", "client_id": "fixture-issued",
        "resource": auth.SIWC_RESOURCE, "scopes": auth.SIWC_SCOPES.split(), "host_id": attempt["host_id"],
        "access_token": "fixture-access", "refresh_token": "fixture-refresh", "expires_at": time.time() + 3600}


def poll(client, sid):
    return client.get(f"/api/providers/oauth/openai-siwc/poll/{sid}", params={"profile": PROFILE})


def test_real_web_flow_listener_is_live_and_validated_commit_is_owned(client, monkeypatch):
    monkeypatch.setattr(auth, "siwc_exchange_login", record)
    login, query = start(client)
    assert poll(client, login["session_id"]).json()["status"] == "pending"
    callback(query)
    for _ in range(60):
        result = poll(client, login["session_id"]).json()
        if result["status"] != "pending":
            break
        time.sleep(0.02)
    assert result["status"] == "approved"
    status = client.get("/api/providers/siwc/status", params={"profile": PROFILE}).json()
    assert status["state"] == "ready" and status["generation"] == 1
    assert not any(key in str(result) for key in ("access_token", "refresh_token", "subject", "fixture-owned"))


def test_cancel_during_exchange_cannot_activate_owned_record(client, monkeypatch):
    entered, release, finished = threading.Event(), threading.Event(), threading.Event()
    def exchange(*args):
        entered.set()
        assert release.wait(5)
        value = record(*args)
        finished.set()
        return value
    monkeypatch.setattr(auth, "siwc_exchange_login", exchange)
    login, query = start(client)
    callback(query)
    assert entered.wait(3)
    assert client.delete(f"/api/providers/oauth/sessions/{login['session_id']}", params={"profile": PROFILE}).json()["ok"]
    release.set()
    assert finished.wait(3)
    time.sleep(0.05)
    assert auth.siwc_status(PROFILE)["state"] == "disconnected"
    assert poll(client, login["session_id"]).status_code == 404


def test_cross_owner_poll_cancel_and_bad_profile_cannot_touch_pending(client):
    login, _ = start(client)
    other = {"X-Hermes-Text-Owner": "c" * 64}
    assert client.get(f"/api/providers/oauth/openai-siwc/poll/{login['session_id']}", params={"profile": PROFILE}, headers=other).status_code == 404
    assert client.delete(f"/api/providers/oauth/sessions/{login['session_id']}", params={"profile": PROFILE}, headers=other).status_code == 404
    assert poll(client, login["session_id"]).json()["status"] == "pending"
    for profile in ("default", "../foreign", "current"):
        assert client.post("/api/providers/oauth/openai-siwc/start", params={"profile": profile}).status_code == 400
