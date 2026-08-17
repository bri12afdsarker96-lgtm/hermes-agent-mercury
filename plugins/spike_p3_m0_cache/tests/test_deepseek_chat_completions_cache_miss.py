"""Gate 2C-A G2CA-13: DeepSeek cache miss must traverse the full ledger path."""
from __future__ import annotations

from plugins.spike_p3_m0_cache.tests.test_cache_middleware import (
    _VALID_TENANT,
    _enable_cache,
)
from plugins.spike_p3_m0_fixtures.pluginmgr_helper import make_run_llm_execution


def test_deepseek_chat_completions_miss_reserves_settles_and_inserts_once(tmp_path, monkeypatch):
    _, cache_mod, budget_mod = _enable_cache(tmp_path, monkeypatch, daily_budget=10_000)
    calls = {"lookup": 0, "insert": 0, "next": 0, "reserve": 0, "settle": 0, "release": 0}
    original_key = cache_mod.build_cache_key
    original_insert = cache_mod._extract_cacheable_response
    original_reserve = budget_mod.reserve
    original_settle = budget_mod.settle
    original_release = budget_mod.release

    def build_cache_key(*args, **kwargs):
        calls["lookup"] += 1
        return original_key(*args, **kwargs)

    def extract_cacheable_response(*args, **kwargs):
        calls["insert"] += 1
        return original_insert(*args, **kwargs)

    def reserve(*args, **kwargs):
        calls["reserve"] += 1
        return original_reserve(*args, **kwargs)

    def settle(*args, **kwargs):
        calls["settle"] += 1
        return original_settle(*args, **kwargs)

    def release(*args, **kwargs):
        calls["release"] += 1
        return original_release(*args, **kwargs)

    monkeypatch.setattr(cache_mod, "build_cache_key", build_cache_key)
    monkeypatch.setattr(cache_mod, "_extract_cacheable_response", extract_cacheable_response)
    monkeypatch.setattr(budget_mod, "reserve", reserve)
    monkeypatch.setattr(budget_mod, "settle", settle)
    monkeypatch.setattr(budget_mod, "release", release)

    def next_call(_req):
        calls["next"] += 1
        return {
            "model": "deepseek-v4-flash",
            "choices": [{"message": {"content": "miss"}, "finish_reason": "stop"}],
            "usage": {"prompt_tokens": 55, "completion_tokens": 45},
        }

    response = make_run_llm_execution(
        api_request_id="deepseek-miss-1",
        provider="deepseek",
        model="deepseek-v4-flash",
        api_mode="chat_completions",
        approx_input_tokens=100,
    )({"messages": [{"role": "user", "content": "cache me"}]}, next_call)

    assert response["choices"][0]["message"]["content"] == "miss"
    assert calls == {"lookup": 1, "insert": 1, "next": 1, "reserve": 1, "settle": 1, "release": 0}
    assert cache_mod.cache_size() == 1
    assert budget_mod.get_used(_VALID_TENANT["tenant_id"]) == 100
    assert budget_mod.get_pending_total(_VALID_TENANT["tenant_id"]) == 0
