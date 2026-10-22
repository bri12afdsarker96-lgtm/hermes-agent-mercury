"""Strict text policy against the real consumer and SDK/HTTP serialization."""
import builtins
import json

import httpx
import pytest

from agent.codex_runtime import (
    CodexTextProtocolError, _consume_codex_event_stream, run_siwc_text_response,
)


def created(identity="r"):
    return {"type": "response.created", "response": {"id": identity, "model": "gpt-6-luna", "status": "in_progress"}}


def delta(text="summary"):
    return {"type": "response.output_text.delta", "delta": text}


def terminal(kind="completed", identity="r", **extra):
    return {"type": "response." + kind, "response": {"id": identity, "status": kind,
        "model": "gpt-6-luna", "output": [], **extra}}


def consume(events, **kwargs):
    return _consume_codex_event_stream(events, model="gpt-6-luna", strict_text=True, **kwargs)


def test_real_completed_is_required():
    response = consume([created(), delta(), terminal()])
    assert response.status == "completed" and response.protocol_terminal_observed
    assert response.id == "r" and response.output_text == "summary"


@pytest.mark.parametrize("events", [[created()], [created(), delta()]])
def test_eof_is_unknown(events):
    response = consume(events)
    assert response.status == "unknown" and not response.protocol_terminal_observed


@pytest.mark.parametrize("kind", ["failed", "incomplete"])
def test_text_before_failure_is_not_success(kind):
    response = consume([created(), delta(), terminal(kind)])
    assert response.status == kind and response.protocol_terminal_observed


@pytest.mark.parametrize("events", [
    [delta(), terminal()], [created(), delta(), terminal(identity="foreign")],
    [created(), created("foreign")],
    [created(), delta(), terminal(status="failed")],
    [created(), delta(), terminal(error={"message": "private-canary"})],
    [created(), delta(), terminal(model="gpt-6-sol")],
])
def test_foreign_or_inconsistent_protocol_rejected(events):
    with pytest.raises(CodexTextProtocolError) as caught:
        consume(events)
    assert "private-canary" not in str(caught.value)


@pytest.mark.parametrize("kind", ["function_call", "custom_tool_call", "web_search_call", "computer_call", "mcp_call"])
@pytest.mark.parametrize("location", ["event", "terminal"])
def test_tool_items_never_dispatch(kind, location):
    item = {"type": kind, "arguments": "private-canary"}
    events = [created(), delta()]
    events += ([{"type": "response.output_item.done", "item": item}]
               if location == "event" else [terminal(output=[item])])
    with pytest.raises(CodexTextProtocolError, match="TEXT_FORBIDDEN_OUTPUT"):
        consume(events)


def test_error_path_does_not_import_agent_or_relay(monkeypatch):
    original = builtins.__import__
    def restricted(name, *args, **kwargs):
        assert name not in {"run_agent", "agent.relay_llm"}
        return original(name, *args, **kwargs)
    monkeypatch.setattr(builtins, "__import__", restricted)
    with pytest.raises(CodexTextProtocolError, match="TEXT_UPSTREAM_ERROR"):
        consume([created(), {"type": "error", "message": "private-canary"}])


def test_observer_failure_is_finite():
    def broken(_):
        raise ValueError("private-canary")
    with pytest.raises(CodexTextProtocolError, match="TEXT_OBSERVER_FAILED"):
        consume([created(), delta(), terminal()], on_event=broken)


def test_local_stop_is_not_remote_terminal():
    response = consume([created(), delta(), terminal()], interrupt_check=lambda: True)
    assert response.interrupted and response.status == "unknown"
    assert not response.protocol_terminal_observed


def test_output_budget():
    with pytest.raises(CodexTextProtocolError, match="TEXT_OUTPUT_LIMIT"):
        consume([created(), delta("abcdef")], max_text_chars=5)


def test_sdk_wire_has_one_request_and_no_environment_overrides(monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "environment-canary")
    monkeypatch.setenv("OPENAI_BASE_URL", "http://127.0.0.1:1")
    monkeypatch.setenv("OPENAI_ORG_ID", "organization-canary")
    monkeypatch.setenv("OPENAI_PROJECT_ID", "project-canary")
    calls = []
    def handle(request):
        calls.append(request)
        assert str(request.url) == "https://api.openai.com/v1/responses"
        assert request.headers["authorization"] == "Bearer owned-fixture"
        body = json.loads(request.content)
        assert body == {"model": "gpt-6-luna", "instructions": "summarize safely",
            "input": [{"role": "user", "content": "explicit user text"}],
            "reasoning": {"effort": "medium"}, "tools": [], "store": False, "stream": True}
        content = "".join("data: " + json.dumps(e) + "\n\n" for e in [created(), delta(), terminal()])
        return httpx.Response(200, text=content, headers={"content-type": "text/event-stream"})
    response = run_siwc_text_response({"source": "owned-siwc", "base_url": "https://api.openai.com/v1",
        "api_key": "owned-fixture"}, "summarize safely", "explicit user text", http_transport=httpx.MockTransport(handle))
    assert len(calls) == 1 and response.status == "completed"


def test_connection_loss_is_never_retried():
    calls = []
    def handle(request):
        calls.append(request)
        raise httpx.ReadError("private-canary")
    with pytest.raises(Exception):
        run_siwc_text_response({"source": "owned-siwc", "base_url": "https://api.openai.com/v1",
            "api_key": "owned-fixture"}, "instructions", "input", http_transport=httpx.MockTransport(handle))
    assert len(calls) == 1
