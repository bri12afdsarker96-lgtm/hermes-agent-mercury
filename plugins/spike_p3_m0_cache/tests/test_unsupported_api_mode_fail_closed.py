"""Gate 2C-A G2CA-15: unknown API modes must fail before cache, budget, or provider work."""
from __future__ import annotations

import json

from plugins.spike_p3_m0_cache.tests.test_cache_middleware import _enable_cache
from plugins.spike_p3_m0_fixtures.pluginmgr_helper import make_run_llm_execution


def test_unsupported_api_mode_has_no_side_effects_or_wire_echo(tmp_path, monkeypatch):
    _, cache_mod, budget_mod = _enable_cache(tmp_path, monkeypatch, daily_budget=10_000)
    forbidden_mode = "untrusted_mode_with_internal_details"
    calls = {"key": 0, "reserve": 0, "settle": 0, "release": 0, "next": 0}
    original_key = cache_mod.build_cache_key
    original_reserve = budget_mod.reserve
    original_settle = budget_mod.settle
    original_release = budget_mod.release

    def build_cache_key(*args, **kwargs):
        calls["key"] += 1
        return original_key(*args, **kwargs)

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
    monkeypatch.setattr(budget_mod, "reserve", reserve)
    monkeypatch.setattr(budget_mod, "settle", settle)
    monkeypatch.setattr(budget_mod, "release", release)

    def next_call(_req):
        calls["next"] += 1
        raise AssertionError("unsupported mode must not invoke a provider")

    response = make_run_llm_execution(
        api_request_id="unsupported-mode",
        provider="deepseek",
        model="deepseek-v4-flash",
        api_mode=forbidden_mode,
        approx_input_tokens=99,
    )({"messages": [{"role": "user", "content": "x"}]}, next_call)

    assert response["cache_meta"]["reason_code"] == "unsupported_api_mode"
    assert calls == {"key": 0, "reserve": 0, "settle": 0, "release": 0, "next": 0}
    assert cache_mod.cache_size() == 0
    assert forbidden_mode not in json.dumps(response, sort_keys=True)
