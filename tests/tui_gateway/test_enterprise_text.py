"""Real private SessionDB boundaries, single-attempt contention and imports."""
import hashlib
import hmac
import json
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from types import SimpleNamespace

import pytest

from hermes_cli import auth, enterprise_text as text


@pytest.fixture
def owned(tmp_path, monkeypatch):
    monkeypatch.setattr(auth, "_SIWC_LAUNCH_HOME", tmp_path.resolve())
    profile = "enterprise-text-" + "a" * 32
    auth.siwc_auth_path(profile).parent.mkdir(parents=True)
    monkeypatch.setattr(auth, "siwc_status", lambda _: {"state": "ready", "registration_id": "b" * 32, "generation": 1})
    params = {"text_only": True, "profile": profile, "owner": "c" * 64,
              "owner_scope": "d" * 64, "registration_id": "b" * 32, "generation": 1,
              "conversation_id": "conversation", "prompt_hash": hashlib.sha256(b"instructions").hexdigest()}
    import hermes_cli.runtime_provider as runtime
    monkeypatch.setattr(runtime, "resolve_owned_text_runtime", lambda *args: {"source": "owned-siwc"})
    transport = SimpleNamespace(enterprise_text_channel="e" * 32)
    _, entry = text.create(params, transport)
    return params, transport, entry


def request(**extra):
    return {"request_id": "request", "instructions": "instructions", "input": "private-input-canary", **extra}


def completed():
    return SimpleNamespace(status="completed", protocol_terminal_observed=True, id="response_fixture", output_text="private-draft-canary")


def test_unknown_is_committed_before_sdk_and_draft_never_persists(owned, monkeypatch):
    import agent.codex_runtime as runtime
    _, _, entry = owned
    calls = []
    def sdk(*args, **kwargs):
        calls.append(1)
        assert text.fact(entry, "request")["state"] == "unknown"
        with text.database(entry["profile"]) as db:
            assert not db._conn.in_transaction
        return completed()
    monkeypatch.setattr(runtime, "run_siwc_text_response", sdk)
    assert text.submit(entry, request())["state"] == "received"
    assert text.submit(entry, request())["state"] == "received"
    assert len(calls) == 1
    with text.database(entry["profile"]) as db:
        row = db.get_session(entry["db_session_id"])
        stored = json.dumps(row)
        assert "private-input-canary" not in stored and "private-draft-canary" not in stored
        assert entry["owner"] not in stored
    assert text.accept(entry, "request")["state"] == "completed"
    assert text.result(entry, "request") == {"state": "completed", "response_id": "response_fixture"}


def test_two_live_handles_only_one_attempt_and_recreate_preserves_unknown(owned, monkeypatch):
    import agent.codex_runtime as runtime
    params, transport, first = owned
    _, second = text.create(params, transport)
    started, release = threading.Event(), threading.Event()
    calls = []
    def sdk(*args, **kwargs):
        calls.append(1)
        started.set()
        assert release.wait(5)
        raise ConnectionError("private-error-canary")
    monkeypatch.setattr(runtime, "run_siwc_text_response", sdk)
    with ThreadPoolExecutor(max_workers=2) as pool:
        result = pool.submit(text.submit, first, request())
        assert started.wait(5)
        duplicate = pool.submit(text.submit, second, request())
        assert duplicate.result(5)["state"] == "unknown"
        release.set()
        assert result.result(5)["state"] == "unknown"
    _, restored = text.create(params, object())
    assert text.submit(restored, request())["state"] == "unknown"
    assert len(calls) == 1


def test_no_agent_or_owner_fallback_and_forged_context_rejected(owned, monkeypatch):
    import agent.codex_runtime as runtime
    params, transport, entry = owned
    monkeypatch.setattr(runtime, "run_siwc_text_response", lambda *args, **kwargs: pytest.fail("forbidden send"))
    for bad in (object(), None):
        with pytest.raises(text.TextBoundaryError):
            text.authorize(entry, {"request_id": "request", "owner": params["owner"]}, bad)
    with pytest.raises(text.TextBoundaryError):
        text.submit(entry, request(instructions="foreign"))
    with pytest.raises(text.TextBoundaryError):
        text.create({**params, "command": "forbidden"}, transport)
    assert text.fact(entry, "request")["state"] == "not_started"


def test_stop_before_submit_and_during_resolution_never_sends(owned, monkeypatch):
    import agent.codex_runtime as runtime
    import hermes_cli.runtime_provider as provider
    _, _, entry = owned
    monkeypatch.setattr(runtime, "run_siwc_text_response", lambda *args, **kwargs: pytest.fail("forbidden send"))
    text.stop(entry, "request")
    assert text.submit(entry, request())["state"] == "not_started"
    def resolve(*args):
        text.stop(entry, "second")
        return {"source": "owned-siwc"}
    monkeypatch.setattr(provider, "resolve_owned_text_runtime", resolve)
    assert text.submit(entry, request(request_id="second"))["state"] == "not_started"
    assert text.fact(entry, "second")["state"] == "not_started"


@pytest.mark.parametrize("field,value", [
    ("id", "enterprise-text-forged"), ("source", "enterprise_text"),
    ("parent_session_id", "enterprise-text-parent"), ("model_config", {"_enterprise_text": {}}),
    ("model_config", '{"_enterprise_text":{}}'),
])
def test_real_session_import_refuses_reserved_payload(tmp_path, field, value):
    from hermes_state import SessionDB
    db = SessionDB(db_path=tmp_path / "state.db")
    try:
        payload = {"id": "ordinary", "source": "import", "messages": [], field: value}
        result = db.import_sessions([payload])
        assert result["ok"] is False and result["imported"] == 0
        assert db.get_session(payload["id"]) is None
    finally:
        db.close()


def test_fixed_anchor_ignores_request_profile_contexts(owned):
    from hermes_constants import set_hermes_home_override, reset_hermes_home_override
    params, _, _ = owned
    expected = auth.siwc_auth_path(params["profile"])
    for override in ("C:/foreign-one", "C:/foreign-two"):
        token = set_hermes_home_override(override)
        try:
            assert auth.siwc_auth_path(params["profile"]) == expected
        finally:
            reset_hermes_home_override(token)


def test_real_gateway_registry_creates_text_before_agent_setup_and_fences_generic(owned, monkeypatch):
    from tui_gateway import server
    params, transport, _ = owned
    monkeypatch.setattr(text, "_PROOF_KEY", "1" * 64)
    monkeypatch.setattr(text, "_PROOF_RUNTIME", "2" * 32)
    fields = ["v1", text._PROOF_RUNTIME, str(int(time.time() * 1000)), "f" * 32, transport.enterprise_text_channel]
    message = "\n".join(fields + ["rpc:session.create", hashlib.sha256(text.canonical_proof_payload(params)).hexdigest()])
    mac = hmac.new(bytes.fromhex(text._PROOF_KEY), message.encode(), hashlib.sha256).hexdigest()
    params = {**params, "_main_proof": ".".join(fields + [mac])}
    monkeypatch.setattr(server, "_schedule_agent_build", lambda *args, **kwargs: pytest.fail("agent build"))
    monkeypatch.setattr(server, "_enable_gateway_prompts", lambda: pytest.fail("generic setup"))
    response = server.dispatch({"id": "create", "method": "session.create", "params": params}, transport=transport)
    sid = response["result"]["session_id"]
    try:
        for method in ("prompt.submit", "session.resume", "session.compress", "session.close", "llm.switch", "config.set"):
            result = server.handle_request({"id": "forbidden", "method": method, "params": {"session_id": sid}})
            assert result["error"]["message"] == "LOCAL_TEXT_GENERIC_METHOD_FORBIDDEN"
        forged = server.handle_request({"id": "forged", "method": "session.create", "params": {"model_config": {"_enterprise_text": {}}}})
        assert forged["error"]["code"] == 403
    finally:
        assert server._close_sessions_for_transport(transport)[0] == 1


def test_canonical_title_resume_refuses_reserved_row_before_build(tmp_path, monkeypatch):
    from hermes_state import SessionDB
    from tui_gateway import server
    db = SessionDB(db_path=tmp_path / "aliases.db")
    db.create_session("hidden-id", source="enterprise_text", model_config={"_enterprise_text": {}})
    db.set_session_title("hidden-id", "plain-alias")
    monkeypatch.setattr(server, "_get_db", lambda: db)
    monkeypatch.setattr(server, "_schedule_agent_build", lambda *args, **kwargs: pytest.fail("agent build"))
    try:
        result = server._methods["session.resume"]("alias", {"session_id": "plain-alias"})
        assert result["error"]["message"] == "LOCAL_TEXT_GENERIC_METHOD_FORBIDDEN"
    finally:
        db.close()


def test_real_sdk_stream_facts_and_absolute_observation_deadline(owned, monkeypatch):
    import httpx
    import agent.codex_runtime as runtime
    import hermes_cli.runtime_provider as provider
    _, _, entry = owned
    monkeypatch.setattr(provider, "resolve_owned_text_runtime", lambda *args: {
        "source": "owned-siwc", "base_url": "https://api.openai.com/v1", "api_key": "owned-fixture"})
    calls = []
    def http(request):
        calls.append(request)
        assert text.fact(entry, "request")["state"] == "unknown"
        events = [
            {"type": "response.created", "response": {"id": "r", "model": "gpt-6-luna", "status": "in_progress"}},
            {"type": "response.output_text.delta", "delta": "summary"},
            {"type": "response.completed", "response": {"id": "r", "model": "gpt-6-luna", "status": "completed", "output": []}},
        ]
        return httpx.Response(200, headers={"content-type": "text/event-stream"},
            text="".join("data: " + json.dumps(event) + "\n\n" for event in events))
    original = runtime.run_siwc_text_response
    monkeypatch.setattr(runtime, "run_siwc_text_response", lambda *args, **kwargs: original(*args, **kwargs, http_transport=httpx.MockTransport(http)))
    assert text.submit(entry, request())["state"] == "received"
    facts = text.fact(entry, "request")
    assert facts["started"] and facts["delta_events"] == 1 and facts["observed_terminal_event"] == "response.completed"
    assert facts["response_id"] == "r" and len(calls) == 1

    closed = threading.Event()
    def waiting(*args, **kwargs):
        kwargs["on_stream"](SimpleNamespace(close=closed.set))
        assert closed.wait(3)
        return SimpleNamespace(status="unknown", protocol_terminal_observed=False)
    monkeypatch.setattr(runtime, "run_siwc_text_response", waiting)
    monkeypatch.setattr(text, "MAX_OBSERVATION_SECONDS", 0.05)
    assert text.submit(entry, request(request_id="timed"))["state"] == "unknown"
    assert text.fact(entry, "timed")["interrupt_requested"]


def _last_send_request(entry, **extra):
    return request(mode="knowledge_answer", session_id="enterprise-text-runtime-release",
        context_hash="f" * 64, input_hash=text.digest("private-input-canary"),
        deadline_ms=int(time.time() * 1000) + 30000, **extra)


def _last_send_sdk(monkeypatch, handler):
    import httpx
    import agent.codex_runtime as runtime
    import hermes_cli.runtime_provider as provider
    monkeypatch.setattr(provider, "resolve_owned_text_runtime", lambda *args: {
        "source": "owned-siwc", "base_url": "https://api.openai.com/v1", "api_key": "owned-fixture"})
    original = runtime.run_siwc_text_response
    monkeypatch.setattr(runtime, "run_siwc_text_response", lambda *args, **kwargs:
        original(*args, **kwargs, http_transport=httpx.MockTransport(handler)))


def _last_send_completed_http():
    import httpx
    events = [
        {"type": "response.created", "response": {"id": "r", "model": "gpt-6-luna", "status": "in_progress"}},
        {"type": "response.output_text.delta", "delta": "private-received-draft"},
        {"type": "response.completed", "response": {"id": "r", "model": "gpt-6-luna", "status": "completed", "output": []}},
    ]
    return httpx.Response(200, headers={"content-type": "text/event-stream"},
        text="".join("data: " + json.dumps(event) + "\n\n" for event in events))


def test_last_send_real_sdk_unknown_then_single_ack_without_post_ack_io(owned, monkeypatch):
    _, transport, entry = owned
    sent, frames = [], []
    sealed = False
    original_db, original_status = text.database, auth.siwc_status
    def db(*args):
        assert not sealed, "DB between final ACK and physical POST"
        return original_db(*args)
    def status(*args):
        assert not sealed, "status between final ACK and physical POST"
        return original_status(*args)
    monkeypatch.setattr(text, "database", db)
    monkeypatch.setattr(auth, "siwc_status", status)
    def emit(frame):
        nonlocal sealed
        frames.append(frame)
        assert text.fact(entry, "request")["state"] == "unknown"
        payload = frame["params"]["payload"]
        assert set(payload) == {"request_id", "nonce", "input_hash", "context_hash", "registration_id", "generation", "phase"}
        assert "private-" not in json.dumps(frame)
        ack = {**payload, "session_id": frame["params"]["session_id"], "owner": entry["owner"]}
        assert text.release(entry, ack)["released"]
        with pytest.raises(text.TextBoundaryError):
            text.release(entry, ack)
        sealed = True
        return True
    transport.write = emit
    def http(req):
        nonlocal sealed
        assert sealed
        sealed = False
        sent.append(req)
        return _last_send_completed_http()
    _last_send_sdk(monkeypatch, http)
    params = _last_send_request(entry)
    assert text.submit(entry, params)["state"] == "received"
    assert text.submit(entry, params)["state"] == "received"
    assert len(sent) == len(frames) == 1
    with pytest.raises(text.TextBoundaryError):
        text.release(entry, {**frames[0]["params"]["payload"], "session_id": params["session_id"], "owner": entry["owner"]})


@pytest.mark.parametrize("held_at", ["credential", "claim", "status"])
def test_last_send_revocation_after_each_wait_has_zero_http(owned, monkeypatch, held_at):
    import hermes_cli.runtime_provider as provider
    _, transport, entry = owned
    entered, resume = threading.Event(), threading.Event()
    sent, frames = [], []
    _last_send_sdk(monkeypatch, lambda req: sent.append(req))
    if held_at == "credential":
        original = provider.resolve_owned_text_runtime
        def held(*args):
            entered.set(); assert resume.wait(5)
            return original(*args)
        monkeypatch.setattr(provider, "resolve_owned_text_runtime", held)
    elif held_at == "claim":
        original = text._write_fact
        def held(*args, **kwargs):
            value = original(*args, **kwargs)
            if kwargs.get("claim") is not None:
                entered.set(); assert resume.wait(5)
            return value
        monkeypatch.setattr(text, "_write_fact", held)
    else:
        original = auth.siwc_status
        def held(*args):
            entered.set(); assert resume.wait(5)
            return original(*args)
        monkeypatch.setattr(auth, "siwc_status", held)
    revoked = False
    def emit(frame):
        frames.append(frame)
        assert revoked and text.fact(entry, "request")["state"] == "unknown"
        # Main's fresh S release rejects; its ordinary stop wakes this wait.
        text.stop(entry, "request")
        return True
    transport.write = emit
    with ThreadPoolExecutor(max_workers=1) as pool:
        future = pool.submit(text.submit, entry, _last_send_request(entry))
        assert entered.wait(5)
        revoked = True
        resume.set()
        assert future.result(5)["state"] == "unknown"
    assert len(frames) == 1 and sent == []
    assert text.fact(entry, "request")["interrupt_requested"]


@pytest.mark.parametrize("ending", ["stop", "disconnect", "timeout"])
def test_last_send_no_ack_stop_disconnect_timeout_cannot_send_or_replay(owned, monkeypatch, ending):
    _, transport, entry = owned
    entered = threading.Event()
    sent, frames = [], []
    _last_send_sdk(monkeypatch, lambda req: sent.append(req))
    def emit(frame):
        frames.append(frame); entered.set()
        return True
    transport.write = emit
    if ending == "timeout":
        monkeypatch.setattr(text, "MAX_OBSERVATION_SECONDS", 0.05)
    params = _last_send_request(entry)
    with ThreadPoolExecutor(max_workers=1) as pool:
        future = pool.submit(text.submit, entry, params)
        assert entered.wait(5)
        if ending == "stop":
            text.stop(entry, "request")
        elif ending == "disconnect":
            from tui_gateway import server
            server._teardown_session(entry)
        assert future.result(5)["state"] == "unknown"
    assert text.submit(entry, params)["state"] == "unknown"
    assert len(frames) == 1 and sent == []
    with pytest.raises(text.TextBoundaryError):
        text.release(entry, {**frames[0]["params"]["payload"], "session_id": params["session_id"], "owner": entry["owner"]})


def test_last_send_generation_changed_at_final_status_has_zero_http(owned, monkeypatch):
    _, transport, entry = owned
    _last_send_sdk(monkeypatch, lambda req: pytest.fail("physical HTTP"))
    monkeypatch.setattr(auth, "siwc_status", lambda _: {"state": "ready", "registration_id": "b" * 32, "generation": 2})
    transport.write = lambda frame: pytest.fail("stale generation release challenge")
    assert text.submit(entry, _last_send_request(entry))["state"] == "unknown"
    assert text.fact(entry, "request")["reason"] == "TEXT_ACCOUNT_CHANGED"


def test_last_send_ack_uses_existing_gateway_main_proof_and_owner_channel(owned, monkeypatch):
    from tui_gateway import server
    _, transport, entry = owned
    entered, resume = threading.Event(), threading.Event()
    frames, sent = [], []
    params = _last_send_request(entry)
    monkeypatch.setitem(server._sessions, params["session_id"], entry)
    monkeypatch.setattr(text, "_PROOF_KEY", "1" * 64)
    monkeypatch.setattr(text, "_PROOF_RUNTIME", "2" * 32)
    _last_send_sdk(monkeypatch, lambda req: (sent.append(req), _last_send_completed_http())[1])
    def emit(frame):
        frames.append(frame); entered.set()
        assert resume.wait(5)
        return True
    transport.write = emit
    with ThreadPoolExecutor(max_workers=1) as pool:
        future = pool.submit(text.submit, entry, params)
        assert entered.wait(5)
        ack = {**frames[0]["params"]["payload"], "session_id": params["session_id"], "owner": entry["owner"]}
        rejected = server.dispatch({"id": "bad", "method": "enterprise_text.release", "params": ack}, transport=transport)
        assert rejected["error"]["message"] == "LOCAL_TEXT_MAIN_AUTH_REQUIRED"
        fields = ["v1", text._PROOF_RUNTIME, str(int(time.time() * 1000)), uuid.uuid4().hex, transport.enterprise_text_channel]
        message = "\n".join(fields + ["rpc:enterprise_text.release", hashlib.sha256(text.canonical_proof_payload(ack)).hexdigest()])
        proof = ".".join(fields + [hmac.new(bytes.fromhex(text._PROOF_KEY), message.encode(), hashlib.sha256).hexdigest()])
        reply = server.dispatch({"id": "good", "method": "enterprise_text.release", "params": {**ack, "_main_proof": proof}}, transport=transport)
        assert reply["result"]["released"]
        assert server.dispatch({"id": "replay", "method": "enterprise_text.release", "params": {**ack, "_main_proof": proof}}, transport=transport)["error"]["code"] == 403
        resume.set()
        assert future.result(5)["state"] == "received"
    assert len(sent) == 1


def test_last_send_stop_immediately_before_event_clear_never_loses_wakeup_or_posts(owned, monkeypatch):
    _, transport, entry = owned
    _last_send_sdk(monkeypatch, lambda req: pytest.fail("physical HTTP after stop"))
    transport.write = lambda frame: pytest.fail("release challenge after stop")
    original_clear = entry["text_release_event"].clear
    cleared = []
    def stop_before_clear():
        # Exact interleaving: stop sets the release Event, then clear erases it.
        # The following stop-flag check must refuse before emit/wait/HTTP.
        text.stop(entry, "request")
        original_clear()
        cleared.append(1)
    monkeypatch.setattr(entry["text_release_event"], "clear", stop_before_clear)
    assert text.submit(entry, _last_send_request(entry))["state"] == "unknown"
    assert cleared == [1]
    assert text.fact(entry, "request")["reason"] == "TEXT_OBSERVATION_STOPPED"
