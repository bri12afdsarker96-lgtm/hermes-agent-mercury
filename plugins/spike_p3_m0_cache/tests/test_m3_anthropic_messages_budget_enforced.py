"""Gate 2C-A G2CA-11: MiniMax M3 anthropic_messages is budget-only."""
from __future__ import annotations

from plugins.spike_p3_m0_cache.tests.test_cache_middleware import (
    _VALID_TENANT,
    _enable_cache,
)
from plugins.spike_p3_m0_fixtures.pluginmgr_helper import make_run_llm_execution


def test_m3_anthropic_messages_budget_enforced_and_cache_bypassed(tmp_path, monkeypatch):
    """A real llm_execution path reserves/settles, while both cache paths stay unused."""
    _, cache_mod, budget_mod = _enable_cache(tmp_path, monkeypatch, daily_budget=10_000)
    calls = {"next": 0, "reserve": 0, "settle": 0, "release": 0, "cache_key": 0}
    original_reserve = budget_mod.reserve
    original_settle = budget_mod.settle
    original_release = budget_mod.release
    original_cache_key = cache_mod.build_cache_key

    def reserve(*args, **kwargs):
        calls["reserve"] += 1
        return original_reserve(*args, **kwargs)

    def settle(*args, **kwargs):
        calls["settle"] += 1
        return original_settle(*args, **kwargs)

    def release(*args, **kwargs):
        calls["release"] += 1
        return original_release(*args, **kwargs)

    def build_cache_key(*args, **kwargs):
        calls["cache_key"] += 1
        return original_cache_key(*args, **kwargs)

    monkeypatch.setattr(budget_mod, "reserve", reserve)
    monkeypatch.setattr(budget_mod, "settle", settle)
    monkeypatch.setattr(budget_mod, "release", release)
    monkeypatch.setattr(cache_mod, "build_cache_key", build_cache_key)

    def next_call(_req):
        calls["next"] += 1
        return {
            "model": "MiniMax-M3",
            "choices": [{"message": {"content": "ok"}, "finish_reason": "stop"}],
            "usage": {"prompt_tokens": 70, "completion_tokens": 30},
        }

    request = {"messages": [{"role": "user", "content": "budget this M3 request"}]}
    for request_id in ("m3-budget-1", "m3-budget-2"):
        response = make_run_llm_execution(
            api_request_id=request_id,
            provider="minimax-cn",
            model="MiniMax-M3",
            api_mode="anthropic_messages",
            approx_input_tokens=100,
        )(request, next_call)
        assert response["choices"][0]["message"]["content"] == "ok"

    assert calls == {"next": 2, "reserve": 2, "settle": 2, "release": 0, "cache_key": 0}
    assert cache_mod.cache_size() == 0
    assert budget_mod.get_used(_VALID_TENANT["tenant_id"]) == 200
    assert budget_mod.get_pending_total(_VALID_TENANT["tenant_id"]) == 0
