"""Gate 2C-A G2CA-12: MiniMax M3 provider exceptions release reservations."""
from __future__ import annotations

import pytest

from plugins.spike_p3_m0_cache.tests.test_cache_middleware import (
    _VALID_TENANT,
    _enable_cache,
)
from plugins.spike_p3_m0_fixtures.pluginmgr_helper import make_run_llm_execution


def test_m3_anthropic_messages_provider_exception_releases_reservation(tmp_path, monkeypatch):
    """The provider exception survives and no billable/cached state remains."""
    _, cache_mod, budget_mod = _enable_cache(tmp_path, monkeypatch, daily_budget=10_000)
    calls = {"next": 0, "reserve": 0, "settle": 0, "release": 0}
    original_reserve = budget_mod.reserve
    original_settle = budget_mod.settle
    original_release = budget_mod.release

    def reserve(*args, **kwargs):
        calls["reserve"] += 1
        return original_reserve(*args, **kwargs)

    def settle(*args, **kwargs):
        calls["settle"] += 1
        return original_settle(*args, **kwargs)

    def release(*args, **kwargs):
        calls["release"] += 1
        return original_release(*args, **kwargs)

    monkeypatch.setattr(budget_mod, "reserve", reserve)
    monkeypatch.setattr(budget_mod, "settle", settle)
    monkeypatch.setattr(budget_mod, "release", release)

    class ProviderBoom(RuntimeError):
        pass

    def next_call(_req):
        calls["next"] += 1
        raise ProviderBoom("minimax upstream failure")

    run = make_run_llm_execution(
        api_request_id="m3-budget-exception",
        provider="minimax-cn",
        model="MiniMax-M3",
        api_mode="anthropic_messages",
        approx_input_tokens=100,
    )
    with pytest.raises(ProviderBoom, match="minimax upstream failure"):
        run({"messages": [{"role": "user", "content": "boom"}]}, next_call)

    assert calls == {"next": 1, "reserve": 1, "settle": 0, "release": 1}
    assert cache_mod.cache_size() == 0
    assert budget_mod.get_used(_VALID_TENANT["tenant_id"]) == 0
    assert budget_mod.get_pending_total(_VALID_TENANT["tenant_id"]) == 0
    assert budget_mod.get_reservation(_VALID_TENANT["tenant_id"], "m3-budget-exception") is None
