"""G2CA-07 · strict cache-plugin activation contract.

The plugin manager intentionally loads modules listed in ``plugins.enabled``.
Once listed, a malformed ``enabled`` value must reject the request before the
provider callback, rather than quietly behaving as a disabled plugin.
"""
from __future__ import annotations

import json

import pytest

from hermes_cli.plugins import has_hook, has_middleware
from plugins.spike_p3_m0_cache.tests.test_cache_middleware import (
    BUDGET_KEY,
    CACHE_KEY,
    _enable_cache,
    _is_fail_closed,
)
from plugins.spike_p3_m0_fixtures.pluginmgr_helper import make_run_llm_execution


def _request() -> dict:
    return {
        "messages": [{"role": "user", "content": "strict enabled contract"}],
        "max_tokens": 32,
    }


def test_explicit_bool_true_loads_both_plugins_and_runs_cleanly(tmp_path, monkeypatch, caplog):
    """Literal YAML ``true`` loads cache + budget hooks without a plugin error."""
    manager, cache_mod, budget_mod = _enable_cache(
        tmp_path, monkeypatch, daily_budget=1_000, enabled=True,
    )

    assert manager._plugins[CACHE_KEY].module is cache_mod
    assert manager._plugins[CACHE_KEY].error is None
    assert manager._plugins[BUDGET_KEY].module is budget_mod
    assert manager._plugins[BUDGET_KEY].error is None
    assert cache_mod._is_enabled() is True
    assert has_middleware("llm_execution") is True
    assert has_hook("pre_api_request") is True
    assert has_hook("post_api_request") is True

    calls = {"next": 0}

    def next_call(_req):
        calls["next"] += 1
        return {
            "choices": [{"message": {"content": "ok"}, "finish_reason": "stop"}],
            "usage": {"total_tokens": 7},
        }

    run = make_run_llm_execution(
        api_request_id="g2ca07-bool-true", provider="p", model="m",
        api_mode="chat_completions", approx_input_tokens=8,
    )
    response = run(_request(), next_call)

    assert calls["next"] == 1
    assert not _is_fail_closed(response)
    assert not [record for record in caplog.records if record.levelname == "ERROR"]


def test_explicit_bool_false_is_a_valid_disabled_state(tmp_path, monkeypatch):
    """Only booleans are valid: literal ``false`` remains an explicit off switch."""
    _, cache_mod, _ = _enable_cache(
        tmp_path, monkeypatch, daily_budget=1_000, enabled=False,
    )
    calls = {"next": 0}

    def next_call(_req):
        calls["next"] += 1
        return {"choices": [], "usage": {}}

    run = make_run_llm_execution(
        api_request_id="g2ca07-bool-false", provider="p", model="m",
        api_mode="chat_completions", approx_input_tokens=8,
    )
    response = run(_request(), next_call)

    assert cache_mod._is_enabled() is False
    assert calls["next"] == 1
    assert not _is_fail_closed(response)


@pytest.mark.parametrize("enabled_value", ["true", "false", 1, 0, None, [], {}])
def test_non_bool_enabled_fails_closed_before_provider(tmp_path, monkeypatch, enabled_value):
    """Any present non-bool setting is a config error, never a silent bypass."""
    _, cache_mod, _ = _enable_cache(
        tmp_path, monkeypatch, daily_budget=1_000, enabled=enabled_value,
    )
    calls = {"next": 0}

    def next_call(_req):
        calls["next"] += 1
        return {"choices": [], "usage": {}}

    run = make_run_llm_execution(
        api_request_id="g2ca07-invalid-enabled", provider="p", model="m",
        api_mode="chat_completions", approx_input_tokens=8,
    )
    response = run(_request(), next_call)

    assert calls["next"] == 0
    assert _is_fail_closed(response)
    assert response["cache_meta"]["reason_code"] == "config_enabled_type_invalid"
    with pytest.raises(Exception, match="config_enabled_type_invalid"):
        cache_mod._is_enabled()


def test_invalid_enabled_value_never_echoes_in_error_surface(tmp_path, monkeypatch):
    """The fixed reason code must not expose the malformed config value."""
    secret_like_value = "UNTRUSTED_ENABLED_VALUE_DO_NOT_ECHO"
    _, _, _ = _enable_cache(
        tmp_path, monkeypatch, daily_budget=1_000, enabled=secret_like_value,
    )

    run = make_run_llm_execution(
        api_request_id="g2ca07-redaction", provider="p", model="m",
        api_mode="chat_completions", approx_input_tokens=8,
    )
    response = run(_request(), lambda _req: pytest.fail("provider must not run"))

    surface = json.dumps(response, sort_keys=True)
    assert "config_enabled_type_invalid" in surface
    assert secret_like_value not in surface
