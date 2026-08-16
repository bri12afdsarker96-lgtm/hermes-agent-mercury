"""Gate 2C-A G2CA-03: provider failures release their exact reservation."""
from __future__ import annotations

import pytest

from plugins.spike_p3_m0_cache.tests.test_cache_middleware import (
    _VALID_TENANT,
    _enable_cache,
)
from plugins.spike_p3_m0_fixtures.pluginmgr_helper import make_run_llm_execution


def test_provider_exception_releases_same_request_id_for_a_serial_retry(
    tmp_path, monkeypatch
):
    """Failure is native, unbilled, and leaves its ID reusable after release."""
    _, cache_mod, budget_mod = _enable_cache(
        tmp_path, monkeypatch, daily_budget=10_000
    )
    request_id = "g2ca03-provider-failure"
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

    def release(tenant_id, api_request_id):
        trace.append(("release", tenant_id, api_request_id))
        return original_release(tenant_id, api_request_id)

    monkeypatch.setattr(budget_mod, "reserve", reserve)
    monkeypatch.setattr(budget_mod, "settle", settle)
    monkeypatch.setattr(budget_mod, "release", release)

    class ProviderFailure(RuntimeError):
        pass

    def failing_provider(_request):
        assert budget_mod.get_reservation(
            _VALID_TENANT["tenant_id"], request_id
        ) == 100
        trace.append(("provider_failure", request_id))
        raise ProviderFailure("upstream unavailable")

    run = make_run_llm_execution(
        api_request_id=request_id,
        provider="openai",
        model="gpt-4o",
        api_mode="chat_completions",
        approx_input_tokens=100,
    )
    request = {"messages": [{"role": "user", "content": "retry safely"}]}

    with pytest.raises(ProviderFailure, match="upstream unavailable"):
        run(request, failing_provider)

    # The failed attempt alone is strictly reserve -> provider -> release.
    assert trace == [
        ("reserve", _VALID_TENANT["tenant_id"], request_id, 100),
        ("provider_failure", request_id),
        ("release", _VALID_TENANT["tenant_id"], request_id),
    ]
    assert budget_mod.get_used(_VALID_TENANT["tenant_id"]) == 0
    assert budget_mod.get_pending_total(_VALID_TENANT["tenant_id"]) == 0
    assert budget_mod.get_reservation(_VALID_TENANT["tenant_id"], request_id) is None
    assert cache_mod.cache_size() == 0

    def retry_provider(_request):
        assert budget_mod.get_reservation(
            _VALID_TENANT["tenant_id"], request_id
        ) == 100
        trace.append(("provider_retry", request_id))
        return {
            "model": "gpt-4o",
            "choices": [{"message": {"content": "retry succeeded"}, "finish_reason": "stop"}],
            "usage": {"prompt_tokens": 31, "completion_tokens": 9},
        }

    response = run(request, retry_provider)

    assert [event[0] for event in trace] == [
        "reserve", "provider_failure", "release", "reserve", "provider_retry", "settle"
    ]
    assert trace[3] == ("reserve", _VALID_TENANT["tenant_id"], request_id, 100)
    assert trace[5] == ("settle", _VALID_TENANT["tenant_id"], request_id, 40)
    assert response["choices"][0]["message"]["content"] == "retry succeeded"
    assert budget_mod.get_used(_VALID_TENANT["tenant_id"]) == 40
    assert budget_mod.get_pending_total(_VALID_TENANT["tenant_id"]) == 0
