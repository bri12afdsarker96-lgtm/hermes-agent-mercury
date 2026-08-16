"""G2CA-08 · Spike plugin enablement is explicit and alias-stable.

This is fork-side evidence only.  A cache-only configuration is safely
fail-closed by the cache middleware; a budget-only configuration deliberately
has no execution middleware.  The cross-repository HA verifier is the
separate Gate 2C-B boundary that rejects either partial configuration before a
provider call.
"""
from __future__ import annotations

import pytest

from hermes_cli.plugins import has_hook, has_middleware
from plugins.spike_p3_m0_fixtures.pluginmgr_helper import (
    get_discovered_module,
    install_fresh_manager,
    make_run_llm_execution,
    write_config,
)


CACHE_KEY = "spike-p3-m0-cache"
BUDGET_KEY = "spike-p3-m0-budget"
_CACHE_CONFIG = {
    "enabled": True,
    "tenant": {
        "tenant_id": "t_g2ca08",
        "principal_id": "p_g2ca08",
        "permission_scope_version": "1",
        "profile_version": "1",
        "daily_budget_tokens": 1_000,
    },
}


def _load(tmp_path, monkeypatch, enabled):
    write_config(
        tmp_path,
        enabled,
        spike_p3_m0_cache=_CACHE_CONFIG,
    )
    return install_fresh_manager(monkeypatch, tmp_path)


@pytest.mark.parametrize(
    "enabled",
    [
        [CACHE_KEY, BUDGET_KEY],
        ["spike_p3_m0_cache", "spike_p3_m0_budget"],
    ],
    ids=["hyphen-identifiers", "underscore-identifiers"],
)
def test_complete_spike_pair_loads_for_hyphen_and_underscore_identifiers(
    tmp_path, monkeypatch, enabled,
):
    """Both documented config spellings select the same two plugin modules."""
    manager = _load(tmp_path, monkeypatch, enabled)

    assert get_discovered_module(manager, CACHE_KEY).__name__.endswith("spike_p3_m0_cache")
    assert get_discovered_module(manager, BUDGET_KEY).__name__.endswith("spike_p3_m0_budget")
    assert manager._plugins[CACHE_KEY].error is None
    assert manager._plugins[BUDGET_KEY].error is None
    assert has_middleware("llm_execution") is True
    assert has_hook("pre_api_request") is True
    assert has_hook("post_api_request") is True


@pytest.mark.parametrize(
    "enabled",
    [[CACHE_KEY], ["spike_p3_m0_cache"]],
    ids=["hyphen-cache-only", "underscore-cache-only"],
)
def test_cache_only_is_fail_closed_before_provider(tmp_path, monkeypatch, enabled):
    """The fork cannot quietly run cache enforcement without its budget peer."""
    manager = _load(tmp_path, monkeypatch, enabled)
    get_discovered_module(manager, CACHE_KEY)
    assert manager._plugins[BUDGET_KEY].module is None
    assert has_middleware("llm_execution") is True

    calls = {"next": 0}

    def next_call(_request):
        calls["next"] += 1
        return {"choices": [], "usage": {}}

    run = make_run_llm_execution(
        api_request_id="g2ca08-cache-only", provider="p", model="m",
        api_mode="chat_completions", approx_input_tokens=8,
    )
    response = run(
        {"messages": [{"role": "user", "content": "no budget peer"}]},
        next_call,
    )

    assert calls["next"] == 0
    assert response["cache_meta"]["reason_code"] == "budget_module_missing"


@pytest.mark.parametrize(
    "enabled",
    [[BUDGET_KEY], ["spike_p3_m0_budget"]],
    ids=["hyphen-budget-only", "underscore-budget-only"],
)
def test_budget_only_has_observer_hooks_but_no_execution_middleware(
    tmp_path, monkeypatch, enabled,
):
    """Budget-only never impersonates the cache orchestrator or a verifier."""
    manager = _load(tmp_path, monkeypatch, enabled)

    get_discovered_module(manager, BUDGET_KEY)
    assert manager._plugins[CACHE_KEY].module is None
    assert has_middleware("llm_execution") is False
    assert has_hook("pre_api_request") is True
    assert has_hook("post_api_request") is True
