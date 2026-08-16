"""Gate 2C-A G2CA-02: a cache miss charges in the exact safe order.

The test deliberately enters through the registered ``llm_execution``
middleware.  It is not a unit test of the budget helpers: the ordering must
hold at the real cache/budget orchestration seam.
"""
from __future__ import annotations

from plugins.spike_p3_m0_cache.tests.test_cache_middleware import (
    _VALID_TENANT,
    _enable_cache,
)
from plugins.spike_p3_m0_fixtures.pluginmgr_helper import make_run_llm_execution


def test_cache_miss_reserves_then_calls_provider_then_settles_actual_usage(
    tmp_path, monkeypatch
):
    """A paid miss has one stable reservation around one provider call."""
    _, cache_mod, budget_mod = _enable_cache(
        tmp_path, monkeypatch, daily_budget=10_000
    )
    request_id = "g2ca02-miss-1"
    estimated_tokens = 120
    actual_tokens = 73
    trace = []
    original_reserve = budget_mod.reserve
    original_settle = budget_mod.settle
    original_release = budget_mod.release

    def reserve(tenant_id, api_request_id, tokens_needed, *, budget):
        trace.append(("reserve", tenant_id, api_request_id, tokens_needed))
        return original_reserve(
            tenant_id, api_request_id, tokens_needed, budget=budget
        )

    def settle(tenant_id, api_request_id, actual):
        trace.append(("settle", tenant_id, api_request_id, actual))
        return original_settle(tenant_id, api_request_id, actual)

    def release(*args, **kwargs):
        trace.append(("release", args, kwargs))
        return original_release(*args, **kwargs)

    monkeypatch.setattr(budget_mod, "reserve", reserve)
    monkeypatch.setattr(budget_mod, "settle", settle)
    monkeypatch.setattr(budget_mod, "release", release)

    def provider(_request):
        # Reserve must already be durable when the paid provider begins.
        assert budget_mod.get_reservation(
            _VALID_TENANT["tenant_id"], request_id
        ) == estimated_tokens
        trace.append(("provider", request_id))
        return {
            "model": "gpt-4o",
            "choices": [{"message": {"content": "paid miss"}, "finish_reason": "stop"}],
            "usage": {"prompt_tokens": 51, "completion_tokens": 22},
        }

    response = make_run_llm_execution(
        api_request_id=request_id,
        provider="openai",
        model="gpt-4o",
        api_mode="chat_completions",
        approx_input_tokens=estimated_tokens,
    )({"messages": [{"role": "user", "content": "uncached"}]}, provider)

    assert [event[0] for event in trace] == ["reserve", "provider", "settle"]
    assert trace[0] == (
        "reserve",
        _VALID_TENANT["tenant_id"],
        request_id,
        estimated_tokens,
    )
    assert trace[1] == ("provider", request_id)
    assert trace[2] == (
        "settle",
        _VALID_TENANT["tenant_id"],
        request_id,
        actual_tokens,
    )
    assert response["choices"][0]["message"]["content"] == "paid miss"
    assert budget_mod.get_used(_VALID_TENANT["tenant_id"]) == actual_tokens
    assert budget_mod.get_pending_total(_VALID_TENANT["tenant_id"]) == 0
    assert cache_mod.cache_size() == 1
