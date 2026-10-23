"""Actual ASGI routing, loopback and owned-session lifecycle; synthetic grant."""
import asyncio
import threading
import hashlib
import hmac
import secrets
import time
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor

import httpx
import pytest
from fastapi.testclient import TestClient

from hermes_cli import auth, web_server as web
from hermes_cli import enterprise_text as text

PROFILE = "enterprise-text-" + "a" * 32
OWNER = "b" * 64


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(text, "_PROOF_KEY", "1" * 64)
    monkeypatch.setattr(text, "_PROOF_RUNTIME", "2" * 32)
    monkeypatch.setattr(auth, "_SIWC_LAUNCH_HOME", tmp_path.resolve())
    monkeypatch.setattr(web, "_SESSION_TOKEN", "fixture-web-token")
    monkeypatch.setattr(web.app.state, "auth_required", False, raising=False)
    with web._oauth_sessions_lock:
        web._oauth_sessions.clear()
    client = TestClient(web.app, base_url="http://127.0.0.1", headers={
        "X-Hermes-Session-Token": "fixture-web-token", "X-Hermes-Text-Owner": OWNER})
    def sign(request):
        payload = {"path": request.url.path, "query": sorted([list(pair) for pair in request.url.params.multi_items()]),
                   "owner": request.headers.get("x-hermes-text-owner", ""), "body": ""}
        fields = ["v1", text._PROOF_RUNTIME, str(int(time.time() * 1000)), secrets.token_hex(16), "http"]
        message = "\n".join(fields + ["http:" + request.method, hashlib.sha256(text.canonical_proof_payload(payload)).hexdigest()])
        mac = hmac.new(bytes.fromhex(text._PROOF_KEY), message.encode(), hashlib.sha256).hexdigest()
        request.headers["X-Hermes-Text-Proof"] = ".".join(fields + [mac])
    client.event_hooks["request"] = [sign]
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


def commit_grant(profile, *, replacement=False):
    attempt = auth.siwc_prepare_login(profile, new_account=replacement)
    payload = record(attempt, {"state": attempt["state"]}, None)
    if replacement:
        payload["subject"] = "fixture-replacement"
    try:
        return auth.siwc_commit_login(attempt, payload)
    finally:
        payload.clear()


def hold_database_close(monkeypatch, profile):
    from hermes_state import SessionDB
    entered, release, closed = threading.Event(), threading.Event(), threading.Event()
    target = auth.siwc_auth_path(profile).parent / "state.db"
    original = SessionDB.close
    def close(db):
        if db.db_path == target and db._conn is not None and not entered.is_set():
            entered.set()
            try:
                assert release.wait(30)
            finally:
                original(db)
                closed.set()
            return
        return original(db)
    monkeypatch.setattr(SessionDB, "close", close)
    return entered, release, closed


def signed_status_request(client, profile):
    request = client.build_request("GET", "/api/providers/siwc/status", params={"profile": profile})
    for sign in client.event_hooks["request"]:
        sign(request)
    return request


def test_ready_status_prepares_fresh_and_existing_owned_databases_without_cross_profile_reuse(client):
    other = "enterprise-text-" + "d" * 32
    grants = {profile: commit_grant(profile) for profile in (PROFILE, other)}
    paths = {profile: auth.siwc_auth_path(profile).parent / "state.db" for profile in grants}
    assert all(not path.exists() for path in paths.values())
    with ThreadPoolExecutor(max_workers=3) as pool:
        prepared = [pool.submit(text.ready_status, profile) for profile in (PROFILE, PROFILE, other)]
        for profile, result in zip((PROFILE, PROFILE, other), prepared):
            assert result.result(30) == grants[profile]
    assert paths[PROFILE] != paths[other] and all(path.exists() for path in paths.values())
    for profile, grant in grants.items():
        assert text.ready_status(profile) == grant
        params = {"text_only": True, "profile": profile, "owner": OWNER, "owner_scope": hashlib.sha256(profile.encode()).hexdigest(),
                  "registration_id": grant["registration_id"], "generation": grant["generation"],
                  "conversation_id": "prepared-consumer", "prompt_hash": hashlib.sha256(b"no-model").hexdigest()}
        _, entry = text.create(params, object())
        assert text.fact(entry, "unsubmitted") == {"state": "not_started"}
        with text.database(profile) as db:
            row = db.get_session(entry["db_session_id"])
            assert row["source"] == "enterprise_text"
            assert db.db_path == paths[profile]


def test_status_waits_for_actual_database_close_without_blocking_its_event_loop(client, monkeypatch):
    grant = commit_grant(PROFILE)
    entered, release, closed = hold_database_close(monkeypatch, PROFILE)
    other = "enterprise-text-" + "d" * 32
    async def scenario():
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=web.app)) as asynchronous:
            pending = asyncio.create_task(asynchronous.send(signed_status_request(client, PROFILE)))
            try:
                assert await asyncio.to_thread(entered.wait, 20)
                assert not pending.done() and not closed.is_set()
                unrelated = await asyncio.wait_for(asynchronous.send(signed_status_request(client, other)), 3)
                assert unrelated.json()["state"] == "disconnected"
                assert not (auth.siwc_auth_path(other).parent / "state.db").exists()
                assert not pending.done()
            finally:
                release.set()
            response = await asyncio.wait_for(pending, 10)
            assert closed.is_set() and response.json() == grant
    asyncio.run(scenario())


def test_disconnected_status_never_opens_database(client, monkeypatch):
    monkeypatch.setattr(text, "database", lambda profile: pytest.fail("disconnected account must not prepare storage"))
    response = client.get("/api/providers/siwc/status", params={"profile": PROFILE})
    assert response.json()["state"] == "disconnected"


def test_database_prepare_failure_is_unavailable_and_next_status_can_recover(client, monkeypatch):
    from hermes_state import SessionDB
    grant = commit_grant(PROFILE)
    original = SessionDB._init_schema
    fail = [True]
    def initialize(db):
        if fail:
            fail.pop()
            raise RuntimeError("private-initialization-canary")
        return original(db)
    monkeypatch.setattr(SessionDB, "_init_schema", initialize)
    unavailable = client.get("/api/providers/siwc/status", params={"profile": PROFILE})
    assert unavailable.json() == {"state": "unavailable", "reason": "SIWC_RECORD_UNAVAILABLE"}
    assert "private-initialization-canary" not in unavailable.text
    assert client.get("/api/providers/siwc/status", params={"profile": PROFILE}).json() == grant


@pytest.mark.parametrize("change", ["logout", "replacement"])
def test_account_change_while_preparing_cannot_publish_late_ready(client, monkeypatch, change):
    before = commit_grant(PROFILE)
    entered, release, closed = hold_database_close(monkeypatch, PROFILE)
    monkeypatch.setattr(auth, "_siwc_http", lambda *args, **kwargs: {})
    async def scenario():
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=web.app)) as asynchronous:
            pending = asyncio.create_task(asynchronous.send(signed_status_request(client, PROFILE)))
            try:
                assert await asyncio.to_thread(entered.wait, 20)
                assert not pending.done()
                after = await asyncio.to_thread(auth.siwc_logout, PROFILE) if change == "logout" else await asyncio.to_thread(commit_grant, PROFILE, replacement=True)
                assert after["state"] != "ready" or after["registration_id"] != before["registration_id"] or after["generation"] != before["generation"]
            finally:
                release.set()
            response = await asyncio.wait_for(pending, 10)
            assert closed.is_set()
            assert response.json() == {"state": "unavailable", "reason": "SIWC_RECORD_UNAVAILABLE"}
    asyncio.run(scenario())
