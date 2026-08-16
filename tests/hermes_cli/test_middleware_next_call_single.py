"""Gate 2C-A G2CA-05: ``llm_execution`` advances downstream at most once.

These checks exercise the fork's public middleware runner with the enabled
Spike plugins.  They specifically guard the core single-use ``next_call``
frame rather than duplicating cache or ledger accounting assertions.
"""
from __future__ import annotations

from plugins.spike_p3_m0_cache.tests.test_cache_middleware import _enable_cache
from plugins.spike_p3_m0_fixtures.pluginmgr_helper import make_run_llm_execution


def _provider_response(content: str = "ok"):
    return {
        "model": "gpt-4o",
        "choices": [{"message": {"content": content}, "finish_reason": "stop"}],
        "usage": {"prompt_tokens": 11, "completion_tokens": 7},
    }


def test_cache_hit_does_not_advance_downstream(tmp_path, monkeypatch):
    """A hit is served by middleware and invokes the terminal call zero times."""
    _enable_cache(tmp_path, monkeypatch, daily_budget=10_000)
    request = {"messages": [{"role": "user", "content": "same request"}]}
    make_run_llm_execution(
        api_request_id="g2ca05-seed",
        provider="openai",
        model="gpt-4o",
        api_mode="chat_completions",
        approx_input_tokens=20,
    )(request, lambda _request: _provider_response("cached"))

    downstream_calls = 0

    def terminal(_request):
        nonlocal downstream_calls
        downstream_calls += 1
        raise AssertionError("cache hit must not reach the provider")

    response = make_run_llm_execution(
        api_request_id="g2ca05-hit",
        provider="openai",
        model="gpt-4o",
        api_mode="chat_completions",
        approx_input_tokens=20,
    )(request, terminal)

    assert downstream_calls == 0
    assert response["cache_meta"]["hit"] is True


def test_cache_miss_advances_downstream_exactly_once(tmp_path, monkeypatch):
    """A miss may pay once, but it cannot re-run the provider callback."""
    _enable_cache(tmp_path, monkeypatch, daily_budget=10_000)
    downstream_calls = 0

    def terminal(_request):
        nonlocal downstream_calls
        downstream_calls += 1
        assert downstream_calls == 1, "one middleware invocation cannot call provider twice"
        return _provider_response("miss")

    response = make_run_llm_execution(
        api_request_id="g2ca05-miss",
        provider="openai",
        model="gpt-4o",
        api_mode="chat_completions",
        approx_input_tokens=20,
    )({"messages": [{"role": "user", "content": "new request"}]}, terminal)

    assert downstream_calls == 1
    assert response["choices"][0]["message"]["content"] == "miss"


def test_pre_downstream_plugin_refusal_does_not_advance_downstream(
    tmp_path, monkeypatch
):
    """A fail-closed plugin guard returns locally before any terminal call."""
    _enable_cache(tmp_path, monkeypatch, daily_budget=10_000)
    downstream_calls = 0

    def terminal(_request):
        nonlocal downstream_calls
        downstream_calls += 1
        raise AssertionError("a pre-downstream refusal must not call provider")

    response = make_run_llm_execution(
        api_request_id="g2ca05-refused",
        provider="openai",
        model="gpt-4o",
        api_mode="untrusted_gate2ca_mode",
        approx_input_tokens=20,
    )({"messages": [{"role": "user", "content": "refuse"}]}, terminal)

    assert downstream_calls == 0
    assert response["cache_meta"]["reason_code"] == "unsupported_api_mode"
