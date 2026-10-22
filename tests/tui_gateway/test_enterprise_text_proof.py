"""Local main-origin request authentication, using synthetic runtime secrets."""
import hashlib
import hmac
import json
import secrets
import os
import subprocess
import sys
import time
from concurrent.futures import ThreadPoolExecutor

import pytest

from hermes_cli import enterprise_text as text

PROFILE = "enterprise-text-" + "a" * 32
OWNER = "b" * 64
CHANNEL = "c" * 32


@pytest.fixture(autouse=True)
def runtime(monkeypatch):
    monkeypatch.setattr(text, "_PROOF_KEY", "1" * 64)
    monkeypatch.setattr(text, "_PROOF_RUNTIME", "2" * 32)
    monkeypatch.setattr(text, "_PROOF_NONCES", {})


def proof(operation, payload, channel=CHANNEL, *, issued=None, nonce=None, key=None, runtime=None):
    fields = ["v1", runtime or text._PROOF_RUNTIME, str(issued or int(time.time() * 1000)), nonce or secrets.token_hex(16), channel]
    message = "\n".join(fields + [operation, hashlib.sha256(text.canonical_proof_payload(payload)).hexdigest()])
    mac = hmac.new(bytes.fromhex(key or text._PROOF_KEY), message.encode(), hashlib.sha256).hexdigest()
    return ".".join(fields + [mac])


@pytest.mark.parametrize("mutation", ["key", "runtime", "past", "future", "operation", "payload", "channel", "malformed"])
def test_modified_or_stale_proof_never_consumes_nonce(mutation):
    payload = {"owner": OWNER, "request_id": "request", "input": "合成文本"}
    kwargs = {"key": "3" * 64} if mutation == "key" else {"runtime": "3" * 32} if mutation == "runtime" else {}
    if mutation in {"past", "future"}:
        kwargs["issued"] = int(time.time() * 1000) + (-31000 if mutation == "past" else 4000)
    signed = proof("rpc:enterprise_text.submit", payload, **kwargs)
    if mutation == "malformed":
        signed = "untrusted.invalid"
    with pytest.raises(text.TextBoundaryError, match="^LOCAL_TEXT_MAIN_AUTH_REQUIRED$"):
        text.verify_main_proof(signed, "rpc:enterprise_text.status" if mutation == "operation" else "rpc:enterprise_text.submit",
                               {**payload, "input": "changed"} if mutation == "payload" else payload,
                               "d" * 32 if mutation == "channel" else CHANNEL)
    assert text._PROOF_NONCES == {}


def test_valid_nonce_is_consumed_atomically_and_capacity_does_not_evict(monkeypatch):
    payload = {"owner": OWNER}
    signed = proof("rpc:enterprise_text.status", payload)
    def verify(_):
        try:
            text.verify_main_proof(signed, "rpc:enterprise_text.status", payload, CHANNEL)
            return True
        except text.TextBoundaryError:
            return False
    with ThreadPoolExecutor(max_workers=8) as pool:
        assert sum(pool.map(verify, range(16))) == 1
    monkeypatch.setattr(text, "_PROOF_NONCE_LIMIT", 1)
    with pytest.raises(text.TextBoundaryError):
        text.verify_main_proof(proof("rpc:enterprise_text.status", payload), "rpc:enterprise_text.status", payload, CHANNEL)
    assert len(text._PROOF_NONCES) == 1
    assert verify(None) is False


@pytest.mark.parametrize("value", [1.1, float("nan"), 9007199254740992, "\ud800", {"non-ascii键": "value"}])
def test_ambiguous_canonical_values_are_rejected(value):
    with pytest.raises((ValueError, UnicodeError)):
        text.canonical_proof_payload(value)


@pytest.fixture
def client(tmp_path, monkeypatch):
    from fastapi.testclient import TestClient
    from hermes_cli import auth, web_server as web
    monkeypatch.setattr(auth, "_SIWC_LAUNCH_HOME", tmp_path.resolve())
    monkeypatch.setattr(web, "_SESSION_TOKEN", "ordinary-renderer-fixture")
    monkeypatch.setattr(web.app.state, "auth_required", False, raising=False)
    monkeypatch.setattr(web, "_oauth_sessions", {"fixture-login": {"provider": "openai-siwc", "profile": PROFILE,
        "owner": OWNER, "status": "pending", "expires_at": time.time() + 60}})
    result = TestClient(web.app, base_url="http://127.0.0.1", headers={
        "X-Hermes-Session-Token": "ordinary-renderer-fixture", "X-Hermes-Text-Owner": OWNER})
    yield result
    result.close()


@pytest.mark.parametrize("method,path", [
    ("POST", "/api/providers/oauth/openai-siwc/start"), ("GET", "/api/providers/siwc/status"),
    ("POST", "/api/providers/siwc/logout"), ("GET", "/api/providers/oauth/openai-siwc/poll/fixture-login"),
    ("DELETE", "/api/providers/oauth/sessions/fixture-login"),
])
def test_ordinary_http_token_and_valid_owner_cannot_access_owned_endpoints(client, monkeypatch, method, path):
    from hermes_cli import auth, web_server as web
    def forbidden(*args, **kwargs):
        pytest.fail("Rejected request reached an owned authentication side effect")
    for name in ("siwc_status", "siwc_logout", "siwc_prepare_login"):
        monkeypatch.setattr(auth, name, forbidden)
    monkeypatch.setattr(web, "_gc_oauth_sessions", forbidden)
    for headers in ({}, {"X-Hermes-Text-Proof": "invalid"}):
        response = client.request(method, path, params={"profile": PROFILE}, headers=headers)
        assert response.status_code == 403
        assert response.json()["detail"] == "LOCAL_TEXT_MAIN_AUTH_REQUIRED"
    assert not web._oauth_sessions["fixture-login"].get("cancelled")


def test_actual_http_signature_covers_query_owner_and_empty_body(client, monkeypatch):
    from hermes_cli import auth
    calls = []
    monkeypatch.setattr(auth, "siwc_status", lambda profile: calls.append(profile) or {"state": "ready"})
    path = "/api/providers/siwc/status"
    payload = {"path": path, "query": [["profile", PROFILE]], "owner": OWNER, "body": ""}
    for change in ("owner", "query", "body", "duplicate"):
        headers = {"X-Hermes-Text-Proof": proof("http:GET", payload, "http")}
        if change == "owner":
            headers["X-Hermes-Text-Owner"] = "f" * 64
        params = [("profile", PROFILE if change != "query" else "default")]
        if change == "duplicate":
            params.append(("profile", PROFILE))
        response = client.request("GET", path, params=params, headers=headers, content=b"nonempty" if change == "body" else b"")
        assert response.status_code == 403
    assert calls == []
    signed = proof("http:GET", payload, "http")
    headers = {"X-Hermes-Text-Proof": signed}
    assert client.get(path, params={"profile": PROFILE}, headers=headers).status_code == 200
    assert client.get(path, params={"profile": PROFILE}, headers=headers).status_code == 403
    assert calls == [PROFILE]


def rpc(ws, method, params, rid):
    ws.send_json({"jsonrpc": "2.0", "id": rid, "method": method, "params": params})
    for _ in range(20):
        message = ws.receive_json()
        if message.get("id") == rid:
            return message
    pytest.fail("Missing bounded RPC response")


def test_real_websockets_require_private_proof_and_bind_it_to_the_current_channel(client, monkeypatch):
    from hermes_cli import auth
    from tui_gateway import server
    calls = []
    monkeypatch.setattr(auth, "siwc_status", lambda profile: calls.append(profile) or {
        "state": "ready", "registration_id": "d" * 32, "generation": 1})
    monkeypatch.setattr(server, "_schedule_agent_build", lambda *args: pytest.fail("Text path must not build an agent"))
    endpoint = "/api/ws?token=ordinary-renderer-fixture"
    with client.websocket_connect(endpoint) as first, client.websocket_connect(endpoint) as second:
        challenge = rpc(first, "enterprise_text.capabilities", {}, "public")["result"]
        other = rpc(second, "enterprise_text.capabilities", {}, "other")["result"]
        assert challenge["protocol_version"] == 2 and challenge["channel_id"] != other["channel_id"]
        assert calls == []
        params = {"text_only": True, "profile": PROFILE, "owner": OWNER, "owner_scope": "e" * 64,
            "registration_id": "d" * 32, "generation": 1, "conversation_id": "conversation", "prompt_hash": "f" * 64}
        for method in ("session.create", "enterprise_text.submit", "enterprise_text.status", "enterprise_text.stop", "enterprise_text.accept"):
            response = rpc(first, method, params if method == "session.create" else {"owner": OWNER, "session_id": "chosen", "request_id": "request"}, method)
            assert response["error"]["message"] == "LOCAL_TEXT_MAIN_AUTH_REQUIRED"
        assert calls == []
        signed = proof("rpc:session.create", params, challenge["channel_id"])
        assert rpc(second, "session.create", {**params, "_main_proof": signed}, "cross")["error"]["message"] == "LOCAL_TEXT_MAIN_AUTH_REQUIRED"
        response = rpc(first, "session.create", {**params, "_main_proof": signed}, "main")
        assert response["result"]["session_id"].startswith("enterprise-text-runtime-")
        assert calls == [PROFILE]
        assert rpc(first, "session.create", {**params, "_main_proof": signed}, "replay")["error"]["message"] == "LOCAL_TEXT_MAIN_AUTH_REQUIRED"


@pytest.mark.parametrize("route", ["sanitize", "inherited", "builder", "unscrubbed", "terminal"])
def test_bootstrap_authority_never_survives_subprocess_environment_merges(monkeypatch, route):
    from tools.environments import local
    key = "HERMES_ENTERPRISE_TEXT_BOOTSTRAP_KEY"
    runtime = "HERMES_ENTERPRISE_TEXT_RUNTIME_ID"
    extra = {key: "synthetic", runtime: "synthetic", local._HERMES_PROVIDER_ENV_FORCE_PREFIX + key: "synthetic"}
    for name, value in extra.items():
        monkeypatch.setenv(name, value)
    base = {**os.environ, "LOCAL_TEST_CANARY": "ordinary"}
    if route == "sanitize":
        result = local._sanitize_subprocess_env(base, extra)
    elif route == "inherited":
        result = local.hermes_subprocess_env(inherit_credentials=True)
    elif route == "terminal":
        result = local._make_run_env(base)
    else:
        result = local.build_subprocess_env(base, scrub_secrets=route != "unscrubbed", extra=extra)
    assert not any(name.upper().endswith((key, runtime)) for name in result)


def test_bootstrap_removes_authority_before_an_actual_inheriting_child():
    program = '''import hermes_bootstrap, os, subprocess, sys
assert hermes_bootstrap._enterprise_text_bootstrap == ("synthetic-bootstrap", "synthetic-runtime")
assert not any(name.startswith("HERMES_ENTERPRISE_TEXT_") for name in os.environ)
child = subprocess.run([sys.executable, "-c", "import os; assert not any(name.startswith('HERMES_ENTERPRISE_TEXT_') for name in os.environ); print('PASS')"], capture_output=True, text=True, timeout=10)
assert child.returncode == 0 and child.stdout.strip() == "PASS"
print("PASS")
'''
    child = subprocess.run([sys.executable, "-c", program], capture_output=True, text=True, timeout=20,
        env={**os.environ, "HERMES_ENTERPRISE_TEXT_BOOTSTRAP_KEY": "synthetic-bootstrap", "HERMES_ENTERPRISE_TEXT_RUNTIME_ID": "synthetic-runtime"})
    assert child.returncode == 0 and child.stdout.strip() == "PASS", "Bootstrap child check failed"


def test_malformed_websocket_frame_never_logs_payload_or_proof(client, caplog):
    canary = "private-text-log-canary"
    signed = proof("rpc:enterprise_text.status", {"owner": OWNER})
    with client.websocket_connect("/api/ws?token=ordinary-renderer-fixture") as ws:
        ws.send_text('{"_main_proof":"' + signed + '","input":"' + canary)
        for _ in range(20):
            response = ws.receive_json()
            if response.get("error", {}).get("code") == -32700:
                break
        else:
            pytest.fail("Missing parse-error response")
    assert canary not in caplog.text and signed not in caplog.text and text._PROOF_KEY not in caplog.text


@pytest.mark.parametrize("key", ["HERMES_ENTERPRISE_TEXT_BOOTSTRAP_KEY", "HERMES_ENTERPRISE_TEXT_RUNTIME_ID"])
def test_bootstrap_authority_cannot_be_persisted_by_generic_env_writer(key):
    from hermes_cli.config import _reject_denylisted_env_var
    with pytest.raises(ValueError, match="Internal bootstrap authority cannot be persisted"):
        _reject_denylisted_env_var(key)
