"""Owned-store, real loopback and signed OIDC fixtures; never real OAuth."""
import base64
import json
import os
import socket
import time
import urllib.error
import urllib.parse
import urllib.request

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa

from hermes_cli import auth

PROFILE = "enterprise-text-" + "a" * 32


@pytest.fixture
def owned(tmp_path, monkeypatch):
    monkeypatch.setattr(auth, "get_hermes_home", lambda: tmp_path)
    for name in ("_read_codex_tokens", "_pool_codex_access_token", "_recover_codex_tokens_from_cli", "_load_provider_state"):
        def forbidden(*args, **kwargs):
            pytest.fail("default credential fallback called")
        monkeypatch.setattr(auth, name, forbidden)
    return tmp_path


@pytest.fixture(scope="module")
def signing_key():
    return rsa.generate_private_key(public_exponent=65537, key_size=2048)


def token_payload(signing_key, attempt, *, client="issued-client", subject="owned-subject", **claims_override):
    claims = {"iss": auth.SIWC_ISSUER, "aud": client, "sub": subject, "iat": int(time.time()),
              "exp": int(time.time()) + 600, "nonce": attempt["nonce"], **claims_override}
    return {"access_token": "fixture-access-canary", "refresh_token": "fixture-refresh-canary",
            "id_token": jwt.encode(claims, signing_key, algorithm="RS256", headers={"kid": "fixture"}),
            "token_type": "Bearer", "expires_in": 3600, "scope": auth.SIWC_SCOPES}


def install_http(monkeypatch, signing_key, payload, calls):
    key = json.loads(jwt.algorithms.RSAAlgorithm.to_jwk(signing_key.public_key()))
    key["kid"] = "fixture"
    def request(url, *, form=None):
        calls.append((url, form))
        if url == auth.SIWC_JWKS_ENDPOINT:
            return {"keys": [key]}
        if url == auth.SIWC_TOKEN_ENDPOINT:
            return payload
        if url == auth.SIWC_REVOKE_ENDPOINT:
            return {}
        pytest.fail("unexpected endpoint")
    monkeypatch.setattr(auth, "_siwc_http", request)


def connect(owned, monkeypatch, signing_key):
    attempt = auth.siwc_prepare_login(PROFILE)
    payload = token_payload(signing_key, attempt)
    calls = []
    install_http(monkeypatch, signing_key, payload, calls)
    record = auth.siwc_exchange_login(attempt, {"state": attempt["state"], "code": "fixture-code",
        "client_id": "issued-client"}, "http://127.0.0.1:1455/auth/callback")
    status = auth.siwc_commit_login(attempt, record)
    return attempt, record, status, calls


def test_missing_owned_store_never_imports_default(owned):
    assert auth.siwc_status(PROFILE)["state"] == "disconnected"
    with pytest.raises(auth.AuthError, match="Local ChatGPT"):
        auth.resolve_siwc_runtime_credentials(PROFILE, "missing", 0)
    assert not auth.siwc_auth_path(PROFILE).exists()


@pytest.mark.parametrize("profile", [None, "", "default", "current", "../other", "C:/private", PROFILE + "/other"])
def test_explicit_owner_path_required(owned, profile):
    with pytest.raises(auth.AuthError):
        auth.siwc_prepare_login(profile)


def test_new_grant_preserves_host_and_does_not_change_active_provider(owned):
    a = auth.siwc_prepare_login(PROFILE)
    b = auth.siwc_prepare_login(PROFILE)
    assert a["host_id"] == b["host_id"] and a["host_id"].startswith("urn:uuid:")
    assert a["state"] != b["state"] and a["nonce"] != b["nonce"] and a["verifier"] != b["verifier"]
    store = json.loads(auth.siwc_auth_path(PROFILE).read_text())
    assert "active_provider" not in store
    query = urllib.parse.parse_qs(urllib.parse.urlsplit(auth.siwc_authorize_url(a, "http://127.0.0.1:1455/auth/callback")).query)
    assert query["client_id"] == ["dynamic_agent_client"]
    assert query["resource"] == [auth.SIWC_RESOURCE] and "id_token_hint" not in query


@pytest.mark.parametrize("alter", [{"aud": "other-client"}, {"iss": "https://other.invalid"},
    {"nonce": "wrong"}, {"exp": int(time.time()) - 120}, {"sub": ""}])
def test_signed_but_invalid_identity_does_not_activate(owned, monkeypatch, signing_key, alter):
    attempt = auth.siwc_prepare_login(PROFILE)
    payload = token_payload(signing_key, attempt, **alter)
    calls = []
    install_http(monkeypatch, signing_key, payload, calls)
    with pytest.raises(auth.AuthError) as caught:
        auth.siwc_exchange_login(attempt, {"state": attempt["state"], "code": "fixture-code", "client_id": "issued-client"},
                                 "http://127.0.0.1:1455/auth/callback")
    assert "fixture-access-canary" not in str(caught.value)
    assert auth.siwc_status(PROFILE)["state"] == "disconnected"


@pytest.mark.parametrize("callback", [{"state": "bad", "code": "x", "client_id": "issued-client"},
    {"code": "x"}, {"code": "x", "client_id": "dynamic_agent_client"},
    {"error": "access_denied", "client_id": "issued-client"}])
def test_bad_callback_does_not_exchange(owned, monkeypatch, callback):
    attempt = auth.siwc_prepare_login(PROFILE)
    callback.setdefault("state", attempt["state"])
    def forbidden(*args, **kwargs):
        pytest.fail("invalid callback exchanged")
    monkeypatch.setattr(auth, "_siwc_http", forbidden)
    with pytest.raises(auth.AuthError):
        auth.siwc_exchange_login(attempt, callback, "http://127.0.0.1:1455/auth/callback")


def test_granted_scope_is_checked_not_callback_scope(owned, monkeypatch, signing_key):
    attempt = auth.siwc_prepare_login(PROFILE)
    payload = token_payload(signing_key, attempt)
    payload["scope"] = "openid profile email"
    install_http(monkeypatch, signing_key, payload, [])
    with pytest.raises(auth.AuthError) as caught:
        auth.siwc_exchange_login(attempt, {"state": attempt["state"], "code": "fixture-code", "client_id": "issued-client",
            "scope": auth.SIWC_SCOPES}, "http://127.0.0.1:1455/auth/callback")
    assert caught.value.code == "siwc_permission_missing"


def test_owned_record_and_windows_protection(owned, monkeypatch, signing_key):
    _, _, status, _ = connect(owned, monkeypatch, signing_key)
    credentials = auth.resolve_siwc_runtime_credentials(PROFILE, status["registration_id"], status["generation"])
    assert credentials["source"] == "owned-siwc" and credentials["base_url"] == auth.SIWC_RESOURCE
    assert credentials["api_key"] == "fixture-access-canary"
    serialized = auth.siwc_auth_path(PROFILE).read_text()
    if os.name == "nt":
        assert "fixture-access-canary" not in serialized and "fixture-refresh-canary" not in serialized
        with pytest.raises(auth.AuthError):
            auth._siwc_dpapi(base64.b64decode(json.loads(serialized)["providers"][auth.SIWC_PROVIDER]
                ["accounts"][status["registration_id"]]["credential"]["dpapi"]), b"foreign-owner", decrypt=True)


def test_reauthorization_uses_issued_client_and_identity(owned, monkeypatch, signing_key):
    _, _, status, _ = connect(owned, monkeypatch, signing_key)
    attempt = auth.siwc_prepare_login(PROFILE)
    assert attempt["client_id"] == "issued-client" and attempt["subject"] == "owned-subject"
    query = urllib.parse.parse_qs(urllib.parse.urlsplit(auth.siwc_authorize_url(attempt, "http://127.0.0.1:1455/auth/callback")).query)
    assert "agent_name_hint" not in query and "id_token_hint" not in query
    with pytest.raises(auth.AuthError):
        auth.siwc_exchange_login(attempt, {"state": attempt["state"], "code": "x", "client_id": "other-client"},
                                 "http://127.0.0.1:1455/auth/callback")
    assert auth.siwc_status(PROFILE)["registration_id"] == status["registration_id"]


def test_late_login_cannot_undo_logout(owned, monkeypatch, signing_key):
    attempt, record, _, _ = connect(owned, monkeypatch, signing_key)
    pending = auth.siwc_prepare_login(PROFILE)
    auth.siwc_logout(PROFILE)
    with pytest.raises(auth.AuthError):
        auth.siwc_commit_login(pending, record)
    assert auth.siwc_status(PROFILE)["state"] != "ready"


def expire_record(profile, registration):
    path = auth.siwc_auth_path(profile)
    with auth._auth_store_lock(target_path=path):
        store = auth._load_auth_store(path)
        state = auth._siwc_state(store)
        account = state["accounts"][registration]
        record = auth._siwc_unseal(profile, registration, account["credential"])
        record["expires_at"] = 1
        account["credential"] = auth._siwc_seal(profile, registration, record)
        auth._siwc_write(store, state, path)


def test_unknown_refresh_does_not_replay_rotation(owned, monkeypatch, signing_key):
    _, _, status, _ = connect(owned, monkeypatch, signing_key)
    expire_record(PROFILE, status["registration_id"])
    calls = []
    def dropped(url, *, form=None):
        calls.append(form)
        raise TimeoutError("fixture-refresh-canary")
    monkeypatch.setattr(auth, "_siwc_http", dropped)
    with pytest.raises(TimeoutError):
        auth.resolve_siwc_runtime_credentials(PROFILE, status["registration_id"], status["generation"])
    with pytest.raises(auth.AuthError) as caught:
        auth.resolve_siwc_runtime_credentials(PROFILE, status["registration_id"], status["generation"])
    assert caught.value.code == "siwc_refresh_unconfirmed" and len(calls) == 1
    assert calls[0]["client_id"] == "issued-client" and "scope" not in calls[0]


def test_logout_during_refresh_cannot_resurrect_tokens(owned, monkeypatch, signing_key):
    _, _, status, _ = connect(owned, monkeypatch, signing_key)
    expire_record(PROFILE, status["registration_id"])
    def delayed(url, *, form=None):
        if url == auth.SIWC_REVOKE_ENDPOINT:
            return {}
        assert form["grant_type"] == "refresh_token"
        auth.siwc_logout(PROFILE)
        return {"access_token": "late-access", "refresh_token": "late-refresh", "token_type": "Bearer",
                "expires_in": 3600, "scope": auth.SIWC_SCOPES}
    monkeypatch.setattr(auth, "_siwc_http", delayed)
    with pytest.raises(auth.AuthError):
        auth.resolve_siwc_runtime_credentials(PROFILE, status["registration_id"], status["generation"])
    assert auth.siwc_status(PROFILE)["state"] != "ready"


def test_remote_logout_failure_is_not_reported_confirmed(owned, monkeypatch, signing_key):
    connect(owned, monkeypatch, signing_key)
    def down(*args, **kwargs):
        raise TimeoutError("private-canary")
    monkeypatch.setattr(auth, "_siwc_http", down)
    result = auth.siwc_logout(PROFILE)
    assert result == {"state": "disconnected", "remote_revocation_confirmed": False}
    assert auth.siwc_status(PROFILE)["state"] != "ready"


def test_real_loopback_binds_before_url_and_consumes_once():
    observed = []
    def ready(uri):
        observed.append(uri)
        def send(query):
            request = urllib.request.Request(uri + "?" + query)
            with urllib.request.urlopen(request, timeout=2) as response:
                return response.status
        for invalid in ["state=wrong&code=x&client_id=issued", "state=expected&code=x&client_id=a&client_id=b"]:
            with pytest.raises(urllib.error.HTTPError):
                send(invalid)
        assert send("state=expected&code=x&client_id=issued") == 200
        with pytest.raises(urllib.error.HTTPError):
            send("state=expected&code=x&client_id=issued")
    result = auth._oauth_wait_for_callback("http://127.0.0.1:0/auth/callback", expected_state="expected",
        on_ready=ready, ephemeral_port=True, product_name="ChatGPT", provider=auth.SIWC_PROVIDER)
    assert result["client_id"] == "issued" and result["code"] == "x"
    port = urllib.parse.urlsplit(observed[0]).port
    with socket.socket() as client:
        assert client.connect_ex(("127.0.0.1", port)) != 0


def test_loopback_cancel_closes_owned_listener():
    observed = []
    with pytest.raises(auth.AuthError) as caught:
        auth._oauth_wait_for_callback("http://127.0.0.1:0/auth/callback", expected_state="expected",
            on_ready=observed.append, cancel_check=lambda: True, ephemeral_port=True, provider=auth.SIWC_PROVIDER)
    assert caught.value.code == "oauth_cancelled"
    with socket.socket() as client:
        assert client.connect_ex(("127.0.0.1", urllib.parse.urlsplit(observed[0]).port)) != 0
