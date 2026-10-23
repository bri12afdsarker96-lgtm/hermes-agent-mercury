"""Explicit owned catalog checks: real stores/ASGI, only mock upstream HTTP."""
import asyncio
import hashlib
import hmac
import json
import secrets
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from types import SimpleNamespace

import httpx
import pytest
from fastapi.testclient import TestClient

from hermes_cli import auth, enterprise_text as text, web_server as web

PROFILE = "enterprise-text-" + "a" * 32
OWNER = "b" * 64
ROUTE = "/api/providers/siwc/models/check"
REAL_CLIENT = httpx.Client


def grant(profile=PROFILE, *, subject="owned-catalog", expires_in=3600):
    attempt = auth.siwc_prepare_login(profile, new_account=True)
    record = {"issuer": auth.SIWC_ISSUER, "subject": subject, "client_id": "issued-catalog-client",
              "resource": auth.SIWC_RESOURCE, "scopes": auth.SIWC_SCOPES.split(), "host_id": attempt["host_id"],
              "access_token": "catalog-access-canary", "refresh_token": "catalog-refresh-canary",
              "expires_at": time.time() + expires_in}
    return auth.siwc_commit_login(attempt, record)


@pytest.fixture
def owned(tmp_path, monkeypatch):
    monkeypatch.setattr(auth, "_SIWC_LAUNCH_HOME", tmp_path.resolve())
    def forbidden(*args, **kwargs):
        pytest.fail("Preflight must not refresh, authorize or borrow default credentials")
    for name in ("_read_codex_tokens", "_pool_codex_access_token", "_recover_codex_tokens_from_cli", "_load_provider_state", "_siwc_http"):
        monkeypatch.setattr(auth, name, forbidden)
    load = auth._load_auth_store
    def explicit_load(target_path=None):
        assert target_path is not None and tmp_path.resolve() in target_path.parents
        return load(target_path)
    monkeypatch.setattr(auth, "_load_auth_store", explicit_load)
    return grant()


def install_catalog(monkeypatch, payload=None, *, status=200, handler=None, content=None, headers=None):
    requests, options = [], []
    def upstream(request):
        requests.append(request)
        assert request.method == "GET" and str(request.url) == "https://api.openai.com/v1/models"
        assert request.headers["authorization"] == "Bearer catalog-access-canary"
        assert request.headers["accept-encoding"] == "identity"
        if handler is not None:
            return handler(request)
        kwargs = {"content": content} if content is not None else {"json": payload}
        return httpx.Response(status, headers=headers, **kwargs)
    def client(**kwargs):
        options.append(kwargs)
        assert kwargs == {"timeout": 5.0, "trust_env": False, "follow_redirects": False}
        return REAL_CLIENT(transport=httpx.MockTransport(upstream), **kwargs)
    monkeypatch.setattr(auth.httpx, "Client", client)
    return requests, options


def result(owned, state):
    return {"model_status": state, "model": "gpt-6-luna", "reasoning_effort": "medium",
            "registration_id": owned["registration_id"], "generation": owned["generation"]}


def check(owned, profile=PROFILE):
    return auth.siwc_check_model_support(profile, owned["registration_id"], owned["generation"])


def mutate_record(patch=None, *, state_patch=None):
    path = auth.siwc_auth_path(PROFILE)
    with auth._auth_store_lock(target_path=path):
        store = auth._load_auth_store(path)
        state = auth._siwc_state(store)
        registration = state["selected"]
        account = state["accounts"][registration]
        if patch:
            record = auth._siwc_unseal(PROFILE, registration, account["credential"])
            record.update(patch)
            account.update(credential=auth._siwc_seal(PROFILE, registration, record), revision=account["revision"] + 1)
        if state_patch:
            state_patch(state, account)
        auth._siwc_write(store, state, path)


@pytest.mark.parametrize("catalog,expected", [
    ({"models": [{"slug": "gpt-6-luna", "visibility": "list", "unknown_metadata": {"ignored": True}}]}, "supported"),
    ({"models": []}, "unsupported"),
    ({"models": [{"slug": "gpt-6-luna", "visibility": "hide"}]}, "unsupported"),
    ({"models": [{"slug": "gpt-6-luna-preview", "visibility": "list"}]}, "unsupported"),
    ({"models": [{"slug": "GPT-6-LUNA", "visibility": "list"}]}, "unsupported"),
    ({"data": [{"slug": "gpt-6-luna", "visibility": "list"}]}, "unconfirmed"),
    ([{"slug": "gpt-6-luna", "visibility": "list"}], "unconfirmed"),
    ({"models": None}, "unconfirmed"),
    ({"models": "gpt-6-luna"}, "unconfirmed"),
    ({"models": [None]}, "unconfirmed"),
    ({"models": [{"id": "gpt-6-luna", "visibility": "list"}]}, "unconfirmed"),
    ({"models": [{"slug": "gpt-6-luna"}]}, "unconfirmed"),
    ({"models": [{"slug": "", "visibility": "list"}]}, "unconfirmed"),
    ({"models": [{"slug": " gpt-6-luna", "visibility": "list"}]}, "unconfirmed"),
    ({"models": [{"slug": "gpt-6-luna", "visibility": True}]}, "unconfirmed"),
    ({"models": [{"slug": "gpt-6-luna", "visibility": ""}]}, "unconfirmed"),
    ({"models": [{"slug": "x" * 257, "visibility": "list"}]}, "unconfirmed"),
    ({"models": [{"slug": "gpt-6-luna", "visibility": "x" * 65}]}, "unconfirmed"),
    ({"models": [{"slug": "gpt-6-luna", "visibility": "list"}, {"slug": "gpt-6-luna", "visibility": "hide"}]}, "unconfirmed"),
    ({"models": [{"slug": "other", "visibility": "list"}, {"slug": "other", "visibility": "hide"}]}, "unconfirmed"),
])
def test_model_preflight_exact_catalog_and_finite_public_result(owned, monkeypatch, catalog, expected):
    requests, options = install_catalog(monkeypatch, catalog)
    path = auth.siwc_auth_path(PROFILE)
    before = path.read_bytes()
    assert check(owned) == result(owned, expected)
    assert len(requests) == len(options) == 1
    assert path.read_bytes() == before


@pytest.mark.parametrize("status", [301, 401, 403, 429, 500])
def test_model_preflight_http_failure_is_unconfirmed_without_retry_or_leak(owned, monkeypatch, caplog, status):
    requests, _ = install_catalog(monkeypatch, {"models": [{"slug": "gpt-6-luna", "visibility": "list"}],
                                              "private": "private-upstream-canary"}, status=status)
    public = check(owned)
    assert public == result(owned, "unconfirmed") and len(requests) == 1
    assert "canary" not in json.dumps(public) + caplog.text


@pytest.mark.parametrize("content", [b"<html>private-body-canary</html>",
    b'{"models":[],"models":[{"slug":"gpt-6-luna","visibility":"list"}]}',
    b'{"models":[{"slug":"gpt-6-luna","visibility":"hide","visibility":"list"}]}',
    b'{"models":[],"bad":NaN}', b" " * 1_048_577],
    ids=["html", "duplicate_root_key", "duplicate_model_key", "nonfinite_json", "oversize_body"])
def test_model_preflight_invalid_json_duplicate_keys_and_body_limit(owned, monkeypatch, content):
    requests, _ = install_catalog(monkeypatch, content=content)
    assert check(owned) == result(owned, "unconfirmed") and len(requests) == 1


def test_model_preflight_rejects_compression_before_decoding(owned, monkeypatch):
    class UnreadBody(httpx.SyncByteStream):
        def __iter__(self):
            pytest.fail("Compressed response must not be consumed")
    requests, _ = install_catalog(monkeypatch, handler=lambda request: httpx.Response(
        200, stream=UnreadBody(), headers={"content-encoding": "gzip"}))
    assert check(owned) == result(owned, "unconfirmed") and len(requests) == 1


def test_model_preflight_timeout_has_no_retry_and_next_explicit_check_recovers(owned, monkeypatch):
    attempts = []
    def upstream(request):
        attempts.append(1)
        if len(attempts) == 1:
            raise httpx.ReadTimeout("private-error-canary", request=request)
        return httpx.Response(200, json={"models": [{"slug": "gpt-6-luna", "visibility": "list"}]})
    requests, _ = install_catalog(monkeypatch, handler=upstream)
    assert check(owned) == result(owned, "unconfirmed") and len(requests) == 1
    assert check(owned) == result(owned, "supported") and len(requests) == 2


@pytest.mark.parametrize("boundary", ["headers", "chunk"])
def test_model_preflight_deadline_discards_late_headers_or_chunks(owned, monkeypatch, boundary):
    clock = [0.0]
    monkeypatch.setattr(auth, "time", SimpleNamespace(time=time.time, monotonic=lambda: clock[0]))
    class LateChunk(httpx.SyncByteStream):
        def __iter__(self):
            clock[0] = 10.0
            yield b'{"models":[]}'
    def upstream(request):
        if boundary == "headers":
            clock[0] = 10.0
            return httpx.Response(200, json={"models": [{"slug": "gpt-6-luna", "visibility": "list"}]})
        return httpx.Response(200, stream=LateChunk())
    requests, _ = install_catalog(monkeypatch, handler=upstream)
    assert check(owned) == result(owned, "unconfirmed") and len(requests) == 1


def test_model_preflight_deadline_stops_tiny_transport_chunks_before_aggregation(owned, monkeypatch):
    clock, consumed, closed = [0.0], [], []
    monkeypatch.setattr(auth, "time", SimpleNamespace(time=time.time, monotonic=lambda: clock[0]))
    class Trickle(httpx.SyncByteStream):
        def __iter__(self):
            for index in range(20):
                clock[0] += 3
                consumed.append(index)
                yield b" "
        def close(self):
            closed.append(True)
    requests, _ = install_catalog(monkeypatch, handler=lambda request: httpx.Response(200, stream=Trickle()))
    assert check(owned) == result(owned, "unconfirmed") and len(requests) == 1
    assert consumed == [0, 1, 2, 3] and closed


@pytest.mark.parametrize("change", ["near_expiry", "expired", "pending", "generation", "missing_profile"])
def test_model_preflight_cannot_refresh_or_fallback_before_get(owned, monkeypatch, change):
    requests, _ = install_catalog(monkeypatch, {"models": []})
    if change in {"near_expiry", "expired"}:
        mutate_record({"expires_at": time.time() + (30 if change == "near_expiry" else -1)})
    if change == "pending":
        mutate_record(state_patch=lambda state, account: account.update(refresh_pending=True))
    if change == "generation":
        owned = {**owned, "generation": owned["generation"] + 1}
    path = auth.siwc_auth_path(PROFILE)
    before = path.read_bytes()
    assert check(owned, "enterprise-text-" + "c" * 32 if change == "missing_profile" else PROFILE) == result(owned, "unconfirmed")
    assert requests == [] and path.read_bytes() == before


def test_model_preflight_opt_out_preserves_original_default_refresh(owned, monkeypatch):
    mutate_record({"expires_at": time.time() + 30})
    calls = []
    def refresh(url, *, form=None):
        calls.append((url, form))
        assert url == auth.SIWC_TOKEN_ENDPOINT and form["grant_type"] == "refresh_token"
        return {"access_token": "new-default-access", "refresh_token": "new-default-refresh",
                "token_type": "Bearer", "expires_in": 3600, "scope": auth.SIWC_SCOPES}
    monkeypatch.setattr(auth, "_siwc_http", refresh)
    resolved = auth.resolve_siwc_runtime_credentials(PROFILE, owned["registration_id"], owned["generation"])
    assert resolved["api_key"] == "new-default-access" and len(calls) == 1
    assert auth.siwc_status(PROFILE) == owned


@pytest.mark.parametrize("change", ["logout", "replacement", "expired", "rotated_token", "pending"])
def test_model_preflight_held_get_never_publishes_after_identity_or_expiry_change(owned, monkeypatch, change):
    entered, release = threading.Event(), threading.Event()
    def upstream(request):
        entered.set()
        assert release.wait(10)
        return httpx.Response(200, json={"models": [{"slug": "gpt-6-luna", "visibility": "list"}]})
    requests, _ = install_catalog(monkeypatch, handler=upstream)
    with ThreadPoolExecutor(max_workers=1) as pool:
        pending = pool.submit(check, owned)
        try:
            assert entered.wait(5)
            if change == "logout":
                monkeypatch.setattr(auth, "_siwc_http", lambda *args, **kwargs: {})
                auth.siwc_logout(PROFILE)
            elif change == "replacement":
                grant(subject="replacement-owner")
            elif change == "expired":
                mutate_record({"expires_at": time.time() - 1})
            elif change == "rotated_token":
                mutate_record({"access_token": "rotated-catalog-canary"})
            else:
                mutate_record(state_patch=lambda state, account: account.update(refresh_pending=True))
        finally:
            release.set()
        assert pending.result(5) == result(owned, "unconfirmed") and len(requests) == 1


@pytest.fixture
def client(owned, monkeypatch):
    monkeypatch.setattr(text, "_PROOF_KEY", "1" * 64)
    monkeypatch.setattr(text, "_PROOF_RUNTIME", "2" * 32)
    monkeypatch.setattr(text, "_PROOF_NONCES", {})
    monkeypatch.setattr(web, "_SESSION_TOKEN", "catalog-session-fixture")
    monkeypatch.setattr(web.app.state, "auth_required", False, raising=False)
    instance = TestClient(web.app, base_url="http://127.0.0.1", headers={
        "X-Hermes-Session-Token": "catalog-session-fixture", "X-Hermes-Text-Owner": OWNER})
    yield instance
    instance.close()


def signed(client, owned, *, content=b"", params=None):
    request = client.build_request("POST", ROUTE, params=params or {
        "profile": PROFILE, "registration_id": owned["registration_id"], "generation": str(owned["generation"])}, content=content)
    payload = {"path": request.url.path, "query": sorted([list(pair) for pair in request.url.params.multi_items()]),
               "owner": OWNER, "body": ""}
    fields = ["v1", text._PROOF_RUNTIME, str(int(time.time() * 1000)), secrets.token_hex(16), "http"]
    message = "\n".join(fields + ["http:POST", hashlib.sha256(text.canonical_proof_payload(payload)).hexdigest()])
    mac = hmac.new(bytes.fromhex(text._PROOF_KEY), message.encode(), hashlib.sha256).hexdigest()
    request.headers["X-Hermes-Text-Proof"] = ".".join(fields + [mac])
    return request


def test_model_preflight_actual_signed_post_and_nonce_replay(owned, client, monkeypatch):
    requests, _ = install_catalog(monkeypatch, {"models": [{"slug": "gpt-6-luna", "visibility": "list"}]})
    request = signed(client, owned)
    assert client.send(request).json() == result(owned, "supported")
    assert client.send(request).status_code == 403
    assert len(requests) == 1


@pytest.mark.parametrize("change", ["missing_proof", "invalid_proof", "query", "owner", "body", "duplicate", "profile"])
def test_model_preflight_proof_boundary_precedes_store_and_http(owned, client, monkeypatch, change):
    def forbidden(*args, **kwargs):
        pytest.fail("Rejected private request reached the credential store")
    monkeypatch.setattr(auth, "_load_auth_store", forbidden)
    requests, _ = install_catalog(monkeypatch, {"models": []})
    request = signed(client, owned, content=b"body-canary" if change == "body" else b"")
    if change == "missing_proof":
        del request.headers["X-Hermes-Text-Proof"]
    elif change == "invalid_proof":
        request.headers["X-Hermes-Text-Proof"] = "invalid"
    elif change == "query":
        request.url = request.url.copy_set_param("generation", str(owned["generation"] + 1))
    elif change == "owner":
        request.headers["X-Hermes-Text-Owner"] = "c" * 64
    elif change == "duplicate":
        request.url = request.url.copy_add_param("profile", PROFILE)
    elif change == "profile":
        request.url = request.url.copy_set_param("profile", "enterprise-text-" + "c" * 32)
    assert client.send(request).status_code == 403
    assert requests == []


@pytest.mark.parametrize("patch", [{"profile": "default"}, {"registration_id": "invalid"},
    {"generation": "-1"}, {"generation": "1.0"}, {"generation": "01"},
    {"generation": "9007199254740992"}, {"extra": "unused"}])
def test_model_preflight_exact_signed_query_shape(owned, client, monkeypatch, patch):
    def forbidden(*args, **kwargs):
        pytest.fail("Invalid explicit selection reached the store")
    monkeypatch.setattr(auth, "_load_auth_store", forbidden)
    requests, _ = install_catalog(monkeypatch, {"models": []})
    params = {"profile": PROFILE, "registration_id": owned["registration_id"], "generation": str(owned["generation"]), **patch}
    assert client.send(signed(client, owned, params=params)).status_code == 400
    assert requests == []


def test_model_preflight_waiting_executor_keeps_private_admission_responsive(owned, client, monkeypatch):
    entered, release = threading.Event(), threading.Event()
    def upstream(request):
        entered.set()
        assert release.wait(10)
        return httpx.Response(200, json={"models": []})
    requests, _ = install_catalog(monkeypatch, handler=upstream)
    async def scenario():
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=web.app)) as asynchronous:
            pending = asyncio.create_task(asynchronous.send(signed(client, owned)))
            try:
                assert await asyncio.to_thread(entered.wait, 5)
                assert not pending.done()
                # Another original private request must complete on this event loop.
                request = signed(client, owned)
                request.headers["X-Hermes-Text-Proof"] = "invalid"
                rejected = await asyncio.wait_for(asynchronous.send(request), 2)
                assert rejected.status_code == 403 and not pending.done()
            finally:
                release.set()
            assert (await asyncio.wait_for(pending, 5)).json() == result(owned, "unsupported")
    asyncio.run(scenario())
    assert len(requests) == 1
