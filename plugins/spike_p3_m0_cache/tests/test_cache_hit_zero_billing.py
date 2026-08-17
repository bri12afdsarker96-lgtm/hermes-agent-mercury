"""Gate 2C-A G2CA-01: cache hits short-circuit before billing or provider work.

This is deliberately exercised through the registered ``llm_execution``
middleware wrapper rather than by invoking the cache implementation directly.
"""
from __future__ import annotations

from plugins.spike_p3_m0_cache.tests.test_cache_middleware import (
    _VALID_TENANT,
    _enable_cache,
)
from plugins.spike_p3_m0_fixtures.pluginmgr_helper import make_run_llm_execution


def test_cache_hit_returns_before_ledger_and_provider(tmp_path, monkeypatch):
    """A stable-key hit performs one lookup and no paid-path side effects."""
    _, cache_mod, budget_mod = _enable_cache(
        tmp_path, monkeypatch, daily_budget=10_000
    )
    request = {"messages": [{"role": "user", "content": "same"}]}

    def seed_provider(_request):
        return {
            "model": "gpt-4o",
            "choices": [{"message": {"content": "cached"}, "finish_reason": "stop"}],
            "usage": {"prompt_tokens": 200, "completion_tokens": 80},
        }

    make_run_llm_execution(
        api_request_id="g2ca01-seed",
        provider="openai",
        model="gpt-4o",
        api_mode="chat_completions",
        approx_input_tokens=300,
    )(request, seed_provider)
    assert cache_mod.cache_size() == 1
    assert budget_mod.get_used(_VALID_TENANT["tenant_id"]) == 280

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

    def next_call(_request):
        calls["next"] += 1
        raise AssertionError("a cache hit must not invoke the provider")

    response = make_run_llm_execution(
        api_request_id="g2ca01-hit",
        provider="openai",
        model="gpt-4o",
        api_mode="chat_completions",
        approx_input_tokens=300,
    )(request, next_call)

    assert calls == {
        "lookup": 1,
        "insert": 0,
        "next": 0,
        "reserve": 0,
        "settle": 0,
        "release": 0,
    }
    assert response["cache_meta"]["hit"] is True
    assert response["usage"] == {"prompt_tokens": 0, "completion_tokens": 0}
    assert response["cache_meta"]["billable_usage"] == {
        "prompt_tokens": 0,
        "completion_tokens": 0,
    }
    assert response["cache_meta"]["origin_usage"] == {
        "prompt_tokens": 200,
        "completion_tokens": 80,
    }
    assert response["cache_meta"]["saved_usage"] == {
        "prompt_tokens": 200,
        "completion_tokens": 80,
    }
    assert response["cache_meta"]["cache_contract_version"] == cache_mod.CACHE_CONTRACT_VERSION
    assert cache_mod.cache_size() == 1
    assert budget_mod.get_used(_VALID_TENANT["tenant_id"]) == 280
    assert budget_mod.get_pending_total(_VALID_TENANT["tenant_id"]) == 0
