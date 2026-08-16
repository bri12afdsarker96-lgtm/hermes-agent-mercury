"""P3-M0 Spike · cache + budget orchestrator middleware 测试(**真实生产走位**).

**Codex 第三轮 §I / §II / §III / §V / §VIII 契约**:
- 通过临时 `config.yaml` 启用插件 · 走真实 `PluginManager.discover_and_load`
- `has_middleware("llm_execution") == True`
- 通过 `run_llm_execution_middleware` 触发 · **不**直接调 `cache_and_budget_middleware`
- **不用** `SPIKE_*` env(fork AGENTS.md red-line 3)· **不污染**全局 manager
- **cache eligibility ≠ budget enforcement 严格解耦**:
  * streaming / tools 非 cacheable · **但仍 reserve/settle**
  * 非 chat_completions api_mode → fail-CLOSED(next_call == 0)· M0 缩小支持范围
  * budget 模块缺失 / tenant context 缺失 / budget config 非法 → fail-CLOSED · next_call == 0
- cache miss + cacheable req → reserve/settle 各 1 次
- cache hit → 不 reserve · 顶层 usage=0
- provider exception → release 且原样传播
- 严格 bool `enabled`(bool("false")==True 陷阱阻断)
"""
from __future__ import annotations

import pytest

from plugins.spike_p3_m0_fixtures.pluginmgr_helper import (
    get_discovered_module,
    install_fresh_manager,
    make_run_llm_execution,
    write_config,
)


CACHE_KEY = "spike-p3-m0-cache"
BUDGET_KEY = "spike-p3-m0-budget"


# ── shared valid tenant block ─────────────────────────────────────────

_VALID_TENANT = {
    "tenant_id": "t_alpha",
    "principal_id": "p_alpha",
    "permission_scope_version": "1",
    "profile_version": "1",
}


def _enable_cache(
    tmp_path,
    monkeypatch,
    *,
    daily_budget=None,
    tenant=_VALID_TENANT,
    enabled=True,
    include_budget=True,
):
    tenant_cfg = dict(tenant)
    if daily_budget is not None:
        tenant_cfg["daily_budget_tokens"] = daily_budget
    enabled_list = [CACHE_KEY]
    if include_budget:
        enabled_list.append(BUDGET_KEY)
    write_config(
        tmp_path,
        enabled_list,
        spike_p3_m0_cache={
            "enabled": enabled,
            "tenant": tenant_cfg,
        },
    )
    manager = install_fresh_manager(monkeypatch, tmp_path)
    cache_mod = get_discovered_module(manager, CACHE_KEY)
    cache_mod.clear_cache()
    budget_mod = None
    if include_budget:
        budget_mod = get_discovered_module(manager, BUDGET_KEY)
        budget_mod.reset_state()
    return manager, cache_mod, budget_mod


def _is_fail_closed(resp):
    """Structured fail-closed response 特征:cache_meta 含 budget_exceeded 或 budget_fail_closed。"""
    if not isinstance(resp, dict):
        return False
    meta = resp.get("cache_meta") or {}
    return bool(meta.get("budget_exceeded") or meta.get("budget_fail_closed"))


# ── Registration invariants(§I 强要求) ─────────────────────────────


def test_discover_registers_llm_execution_middleware(tmp_path, monkeypatch):
    from hermes_cli.plugins import has_middleware

    manager, _, _ = _enable_cache(tmp_path, monkeypatch)
    assert has_middleware("llm_execution") is True
    assert len(manager._middleware.get("llm_execution", [])) == 1


def test_disabled_plugin_not_loaded(tmp_path, monkeypatch):
    from hermes_cli.plugins import has_middleware

    write_config(tmp_path, [])
    install_fresh_manager(monkeypatch, tmp_path)
    assert has_middleware("llm_execution") is False


def test_enabled_bool_strict_true_only(tmp_path, monkeypatch):
    """Codex §III:`enabled` 严格 bool True · 拒 str/int/其他(bool('false')==True 陷阱)。"""
    # enabled = "false"(str)· 应视 as 禁用 · 直通 next_call
    manager, cache_mod, budget_mod = _enable_cache(
        tmp_path, monkeypatch, daily_budget=100, enabled="false",
    )
    counters = {"next": 0}

    def next_call(_req):
        counters["next"] += 1
        return {"choices": [{"message": {"content": "x"}, "finish_reason": "stop"}], "usage": {}}

    run = make_run_llm_execution(
        api_request_id="r1", provider="p", model="m", api_mode="chat_completions",
        approx_input_tokens=500,
    )
    resp = run({"messages": [{"role": "user", "content": "x"}], "max_tokens": 500}, next_call)
    # 未启用 → 直通 next · 未 reserve
    assert counters["next"] == 1
    assert not _is_fail_closed(resp)


@pytest.mark.parametrize("enabled_value", [1, "true", "yes", [1], {"x": 1}])
def test_enabled_non_bool_treated_as_disabled(tmp_path, monkeypatch, enabled_value):
    """任何非 literal-True 值(int / str / list / dict)· 视 as 禁用 · 直通 next。"""
    _, _, _ = _enable_cache(
        tmp_path, monkeypatch, daily_budget=100, enabled=enabled_value,
    )
    counters = {"next": 0}

    def next_call(_req):
        counters["next"] += 1
        return {"choices": [{"message": {"content": "x"}, "finish_reason": "stop"}], "usage": {}}

    run = make_run_llm_execution(
        api_request_id="r1", provider="p", model="m", api_mode="chat_completions",
    )
    resp = run({"messages": [{"role": "user", "content": "hi"}]}, next_call)
    assert counters["next"] == 1
    assert not _is_fail_closed(resp)


# ── Cache miss(cacheable request) → reserve+settle 各 1 次 ─────


def test_miss_reserves_and_settles_once(tmp_path, monkeypatch):
    manager, cache_mod, budget_mod = _enable_cache(
        tmp_path, monkeypatch, daily_budget=10_000
    )

    call_count = {"next": 0}

    def next_call(_req):
        call_count["next"] += 1
        return {
            "model": "gpt-4o",
            "choices": [{"message": {"content": "hi"}, "finish_reason": "stop"}],
            "usage": {"prompt_tokens": 100, "completion_tokens": 50},
        }

    run = make_run_llm_execution(
        api_request_id="req_miss_1",
        provider="openai",
        model="gpt-4o",
        api_mode="chat_completions",
        approx_input_tokens=200,
    )
    resp = run({"messages": [{"role": "user", "content": "hi"}]}, next_call)

    assert call_count["next"] == 1
    assert resp["choices"][0]["message"]["content"] == "hi"
    # settle 累加 actual usage = 150
    assert budget_mod.get_used(_VALID_TENANT["tenant_id"]) == 150
    assert budget_mod.get_pending_total(_VALID_TENANT["tenant_id"]) == 0


# ── Cache hit → budget reserve 0 次 · 顶层 usage=0(§I 强要求) ─────


def test_hit_no_reserve_and_zero_top_usage(tmp_path, monkeypatch):
    manager, cache_mod, budget_mod = _enable_cache(
        tmp_path, monkeypatch, daily_budget=10_000
    )

    counters = {"next": 0}

    def next_call(_req):
        counters["next"] += 1
        return {
            "model": "gpt-4o",
            "choices": [{"message": {"content": "cached"}, "finish_reason": "stop"}],
            "usage": {"prompt_tokens": 200, "completion_tokens": 80},
        }

    run = make_run_llm_execution(
        api_request_id="req_a",
        provider="openai",
        model="gpt-4o",
        api_mode="chat_completions",
        approx_input_tokens=300,
    )
    req = {"messages": [{"role": "user", "content": "same"}]}

    # 首次 miss · settle 280
    run(req, next_call)
    assert counters["next"] == 1
    assert budget_mod.get_used(_VALID_TENANT["tenant_id"]) == 280

    # 二次 hit · next_call 0 次 · used 不变(reserve 0 次)
    run2 = make_run_llm_execution(
        api_request_id="req_b",
        provider="openai",
        model="gpt-4o",
        api_mode="chat_completions",
    )
    resp = run2(req, next_call)
    assert counters["next"] == 1
    assert budget_mod.get_used(_VALID_TENANT["tenant_id"]) == 280
    assert resp["usage"] == {"prompt_tokens": 0, "completion_tokens": 0}
    assert resp["cache_meta"]["hit"] is True
    assert resp["cache_meta"]["billable_usage"] == {"prompt_tokens": 0, "completion_tokens": 0}
    assert resp["cache_meta"]["origin_usage"] == {"prompt_tokens": 200, "completion_tokens": 80}
    assert resp["cache_meta"]["saved_usage"] == {"prompt_tokens": 200, "completion_tokens": 80}
    assert resp["cache_meta"]["cache_contract_version"] == cache_mod.CACHE_CONTRACT_VERSION
    assert budget_mod.get_pending_total(_VALID_TENANT["tenant_id"]) == 0


# ── Budget 超支 → next_call 0 次(§I / §V 强要求 · 非空结构化响应) ─


def test_budget_exceeded_blocks_next_call_returns_safe_response(tmp_path, monkeypatch):
    manager, cache_mod, budget_mod = _enable_cache(
        tmp_path, monkeypatch, daily_budget=100
    )

    counters = {"next": 0}

    def next_call(_req):
        counters["next"] += 1
        return {"model": "m", "choices": [{"message": {"content": "x"}, "finish_reason": "stop"}], "usage": {}}

    run = make_run_llm_execution(
        api_request_id="req_over", provider="openai", model="m", api_mode="chat_completions",
        approx_input_tokens=500,
    )
    resp = run(
        {"messages": [{"role": "user", "content": "x"}], "max_tokens": 500},
        next_call,
    )
    # 超支明确 short-circuit · next 未调
    assert counters["next"] == 0
    # 非空结构化 error response · 抑制 retry · Codex §V
    assert resp["cache_meta"]["budget_exceeded"] is True
    assert resp["cache_meta"]["reason_code"] == "budget_exceeded"
    # 用户可见响应不得暴露租户标识、预算值或内部估算。
    assert "tenant_id" not in resp["cache_meta"]
    assert "budget" not in resp["cache_meta"]
    assert "tokens_needed" not in resp["cache_meta"]
    # 非空 assistant message(可展示给用户)
    assert resp["choices"][0]["message"]["role"] == "assistant"
    assert resp["choices"][0]["message"]["content"]   # 非空字符串
    # finish_reason 抑制 retry(content_filter)
    assert resp["choices"][0]["finish_reason"] == "content_filter"
    # 顶层 usage=0
    assert resp["usage"] == {"prompt_tokens": 0, "completion_tokens": 0}
    # 无 pending reservation(reserve 抛异常 · 未记账)
    assert budget_mod.get_pending_total(_VALID_TENANT["tenant_id"]) == 0
    assert budget_mod.get_used(_VALID_TENANT["tenant_id"]) == 0


def test_budget_exceeded_on_streaming_also_blocks_next_call(tmp_path, monkeypatch):
    """Codex §V:streaming 请求 + 预算超限 · next_call 也必须 0 次(解耦证明)。"""
    manager, cache_mod, budget_mod = _enable_cache(
        tmp_path, monkeypatch, daily_budget=50
    )
    counters = {"next": 0}

    def next_call(_req):
        counters["next"] += 1
        return {"choices": [{"message": {"content": "x"}, "finish_reason": "stop"}], "usage": {}}

    run = make_run_llm_execution(
        api_request_id="r_stream", provider="p", model="m", api_mode="chat_completions",
        approx_input_tokens=500,
    )
    resp = run(
        {"messages": [{"role": "user", "content": "x"}], "stream": True, "max_tokens": 100},
        next_call,
    )
    assert counters["next"] == 0   # streaming 也被 reserve 门阻断
    assert resp["cache_meta"]["budget_exceeded"] is True


def test_budget_exceeded_on_tools_also_blocks_next_call(tmp_path, monkeypatch):
    """Codex §V:tools request + 预算超限 · next_call 也必须 0 次(解耦证明)。"""
    manager, cache_mod, budget_mod = _enable_cache(
        tmp_path, monkeypatch, daily_budget=50
    )
    counters = {"next": 0}

    def next_call(_req):
        counters["next"] += 1
        return {"choices": [{"message": {"content": "x"}, "finish_reason": "stop"}], "usage": {}}

    run = make_run_llm_execution(
        api_request_id="r_tools", provider="p", model="m", api_mode="chat_completions",
        approx_input_tokens=500,
    )
    resp = run(
        {"messages": [{"role": "user", "content": "x"}], "tools": [{"name": "search"}], "max_tokens": 100},
        next_call,
    )
    assert counters["next"] == 0
    assert resp["cache_meta"]["budget_exceeded"] is True


def test_non_cacheable_request_still_reserves_and_settles(tmp_path, monkeypatch):
    """Codex §II:streaming/tools 非 cacheable · **但仍 reserve/settle**(解耦)。"""
    manager, cache_mod, budget_mod = _enable_cache(
        tmp_path, monkeypatch, daily_budget=10_000
    )
    counters = {"next": 0}

    def next_call(_req):
        counters["next"] += 1
        return {"choices": [{"message": {"content": "streamed"}, "finish_reason": "stop"}],
                "usage": {"prompt_tokens": 60, "completion_tokens": 40}}

    # streaming request(不缓存 · 但必须 reserve)
    run = make_run_llm_execution(
        api_request_id="r_s1", provider="p", model="m", api_mode="chat_completions",
        approx_input_tokens=100,
    )
    resp = run({"messages": [{"role": "user", "content": "x"}], "stream": True}, next_call)
    assert counters["next"] == 1
    assert budget_mod.get_used(_VALID_TENANT["tenant_id"]) == 100   # settle 60+40
    # 不 cache · 二次同请求仍 miss(需 fresh api_request_id)
    run2 = make_run_llm_execution(
        api_request_id="r_s2", provider="p", model="m", api_mode="chat_completions",
        approx_input_tokens=100,
    )
    run2({"messages": [{"role": "user", "content": "x"}], "stream": True}, next_call)
    assert counters["next"] == 2   # 再调 next
    assert budget_mod.get_used(_VALID_TENANT["tenant_id"]) == 200   # 再 settle 100


# ── Provider exception → reservation 释放 + 传播 ────────────────────


def test_provider_exception_releases_reservation(tmp_path, monkeypatch):
    manager, cache_mod, budget_mod = _enable_cache(
        tmp_path, monkeypatch, daily_budget=10_000
    )

    class ProviderBoom(RuntimeError):
        pass

    def next_call(_req):
        raise ProviderBoom("upstream 500")

    run = make_run_llm_execution(
        api_request_id="req_boom", provider="openai", model="m", api_mode="chat_completions",
        approx_input_tokens=100,
    )
    with pytest.raises(ProviderBoom, match="upstream 500"):
        run({"messages": [{"role": "user", "content": "x"}], "max_tokens": 100}, next_call)

    assert budget_mod.get_pending_total(_VALID_TENANT["tenant_id"]) == 0
    assert budget_mod.get_used(_VALID_TENANT["tenant_id"]) == 0
    assert budget_mod.get_reservation(_VALID_TENANT["tenant_id"], "req_boom") is None


def test_provider_exception_identity_survives_release_failure(tmp_path, monkeypatch):
    """清理失败不得遮蔽 provider 原异常。"""
    _, _, budget_mod = _enable_cache(tmp_path, monkeypatch, daily_budget=10_000)

    class ProviderBoom(RuntimeError):
        pass

    def next_call(_req):
        raise ProviderBoom("provider-original")

    def release_boom(*_args, **_kwargs):
        raise RuntimeError("cleanup-failed")

    monkeypatch.setattr(budget_mod, "release", release_boom)
    run = make_run_llm_execution(
        api_request_id="req_release_boom",
        provider="openai",
        model="m",
        api_mode="chat_completions",
        approx_input_tokens=100,
    )
    with pytest.raises(ProviderBoom, match="provider-original"):
        run({"messages": [{"role": "user", "content": "x"}], "max_tokens": 100}, next_call)


def test_null_budget_skips_reservation_and_settle(tmp_path, monkeypatch):
    """null 是合法无限态：允许 provider，且不制造 unknown-settle 错误。"""
    _, _, budget_mod = _enable_cache(tmp_path, monkeypatch, daily_budget=None)
    calls = {"reserve": 0, "settle": 0, "next": 0}

    monkeypatch.setattr(
        budget_mod,
        "reserve",
        lambda *_args, **_kwargs: calls.__setitem__("reserve", calls["reserve"] + 1),
    )
    monkeypatch.setattr(
        budget_mod,
        "settle",
        lambda *_args, **_kwargs: calls.__setitem__("settle", calls["settle"] + 1),
    )

    def next_call(_req):
        calls["next"] += 1
        return {
            "choices": [{"message": {"content": "ok"}, "finish_reason": "stop"}],
            "usage": {"prompt_tokens": 4, "completion_tokens": 2},
        }

    run = make_run_llm_execution(
        api_request_id="req_null_budget",
        provider="openai",
        model="m",
        api_mode="chat_completions",
        approx_input_tokens=10,
    )
    resp = run({"messages": [{"role": "user", "content": "x"}]}, next_call)
    assert resp["choices"][0]["message"]["content"] == "ok"
    assert calls == {"reserve": 0, "settle": 0, "next": 1}


def test_null_budget_requires_neither_request_id_nor_token_estimate(tmp_path, monkeypatch):
    """null 明确关闭预算护栏；miss 不应被预算专用字段阻断。"""
    _, _, budget_mod = _enable_cache(tmp_path, monkeypatch, daily_budget=None)
    calls = {"reserve": 0, "settle": 0, "next": 0}
    monkeypatch.setattr(
        budget_mod,
        "reserve",
        lambda *_args, **_kwargs: calls.__setitem__("reserve", calls["reserve"] + 1),
    )
    monkeypatch.setattr(
        budget_mod,
        "settle",
        lambda *_args, **_kwargs: calls.__setitem__("settle", calls["settle"] + 1),
    )

    def next_call(_req):
        calls["next"] += 1
        return {
            "choices": [{"message": {"content": "ok"}, "finish_reason": "stop"}],
            "usage": {"prompt_tokens": 4, "completion_tokens": 2},
        }

    run = make_run_llm_execution(
        api_request_id="",
        provider="openai",
        model="m",
        api_mode="chat_completions",
    )
    response = run(
        {"messages": [], "max_tokens": "not-needed-with-null-budget"},
        next_call,
    )
    assert response["choices"][0]["message"]["content"] == "ok"
    assert calls == {"reserve": 0, "settle": 0, "next": 1}


def test_missing_usage_settles_reserved_estimate(tmp_path, monkeypatch):
    """provider 未回 usage 时按预留值结算，禁止按 0 洗预算。"""
    _, _, budget_mod = _enable_cache(tmp_path, monkeypatch, daily_budget=10_000)

    def next_call(_req):
        return {"choices": [{"message": {"content": "ok"}, "finish_reason": "stop"}]}

    run = make_run_llm_execution(
        api_request_id="req_missing_usage",
        provider="openai",
        model="m",
        api_mode="chat_completions",
        approx_input_tokens=123,
        max_tokens=77,
    )
    run({"messages": [{"role": "user", "content": "x"}], "max_tokens": 77}, next_call)
    assert budget_mod.get_used(_VALID_TENANT["tenant_id"]) == 200
    assert budget_mod.get_pending_total(_VALID_TENANT["tenant_id"]) == 0


@pytest.mark.parametrize(
    "usage",
    [
        {"prompt_tokens": "5", "completion_tokens": 2},
        {"prompt_tokens": 1.5, "completion_tokens": 2},
        {"prompt_tokens": -1, "completion_tokens": 2},
        {"prompt_tokens": True, "completion_tokens": 2},
    ],
)
def test_invalid_usage_types_settle_reserved_estimate(tmp_path, monkeypatch, usage):
    """非严格非负整数 usage 不可信，必须按 reservation 保守结算。"""
    _, _, budget_mod = _enable_cache(tmp_path, monkeypatch, daily_budget=10_000)

    run = make_run_llm_execution(
        api_request_id="req_invalid_usage",
        provider="openai",
        model="m",
        api_mode="chat_completions",
        approx_input_tokens=123,
        max_tokens=77,
    )
    run(
        {"messages": [{"role": "user", "content": "x"}], "max_tokens": 77},
        lambda _req: {
            "choices": [{"message": {"content": "ok"}, "finish_reason": "stop"}],
            "usage": usage,
        },
    )
    assert budget_mod.get_used(_VALID_TENANT["tenant_id"]) == 200


def test_cache_hit_returns_deep_copy(tmp_path, monkeypatch):
    """调用方修改一次 hit 结果不得污染后续缓存。"""
    _, _, _ = _enable_cache(tmp_path, monkeypatch, daily_budget=10_000)
    calls = {"next": 0}

    def next_call(_req):
        calls["next"] += 1
        return {
            "model": "gpt-4o",
            "choices": [{"message": {"content": "stable"}, "finish_reason": "stop"}],
            "usage": {"prompt_tokens": 5, "completion_tokens": 5},
        }

    req = {"messages": [{"role": "user", "content": "same"}]}
    make_run_llm_execution(
        api_request_id="copy_miss", provider="openai", model="gpt-4o",
        api_mode="chat_completions", approx_input_tokens=10,
    )(req, next_call)
    first_hit = make_run_llm_execution(
        api_request_id="copy_hit_1", provider="openai", model="gpt-4o",
        api_mode="chat_completions", approx_input_tokens=10,
    )(req, next_call)
    first_hit["choices"][0]["message"]["content"] = "poisoned"
    first_hit["cache_meta"]["origin_usage"]["prompt_tokens"] = 999

    second_hit = make_run_llm_execution(
        api_request_id="copy_hit_2", provider="openai", model="gpt-4o",
        api_mode="chat_completions", approx_input_tokens=10,
    )(req, next_call)
    assert calls["next"] == 1
    assert second_hit["choices"][0]["message"]["content"] == "stable"
    assert second_hit["cache_meta"]["origin_usage"]["prompt_tokens"] == 5


def test_cache_hit_does_not_require_budget_request_id(tmp_path, monkeypatch):
    """命中不调用 provider/预算，因此不应要求 api_request_id。"""
    _, _, _ = _enable_cache(tmp_path, monkeypatch, daily_budget=10_000)
    calls = {"next": 0}
    request = {"messages": [{"role": "user", "content": "same"}]}

    def next_call(_req):
        calls["next"] += 1
        return {
            "model": "gpt-4o",
            "choices": [{"message": {"content": "cached"}, "finish_reason": "stop"}],
            "usage": {"prompt_tokens": 5, "completion_tokens": 5},
        }

    make_run_llm_execution(
        api_request_id="cache_seed",
        provider="openai",
        model="gpt-4o",
        api_mode="chat_completions",
        approx_input_tokens=10,
    )(request, next_call)
    hit = make_run_llm_execution(
        api_request_id="",
        provider="openai",
        model="gpt-4o",
        api_mode="chat_completions",
    )(request, next_call)
    assert calls["next"] == 1
    assert hit["cache_meta"]["hit"] is True


# ── Tenant context / api_mode / non-dict / budget config fail-CLOSED ─


@pytest.mark.parametrize(
    "bad_tenant",
    [
        {"tenant_id": "", "principal_id": "p", "permission_scope_version": "1", "profile_version": "1"},
        {"tenant_id": "t", "principal_id": "", "permission_scope_version": "1", "profile_version": "1"},
        {"tenant_id": "t", "principal_id": "p", "permission_scope_version": "1"},
        {"tenant_id": "t/../evil", "principal_id": "p", "permission_scope_version": "1", "profile_version": "1"},
        {"tenant_id": "a" * 200, "principal_id": "p", "permission_scope_version": "1", "profile_version": "1"},
    ],
    ids=["empty-tenant", "empty-principal", "missing-profile-version", "non-whitelist-chars", "over-max-len"],
)
def test_invalid_tenant_fail_closed_blocks_next_call(tmp_path, monkeypatch, bad_tenant):
    """Codex §III:enforcement 开启时 · 缺失/非法 tenant · **next_call == 0** · 结构化 fail-closed。"""
    manager, cache_mod, budget_mod = _enable_cache(
        tmp_path, monkeypatch, daily_budget=100, tenant=bad_tenant
    )
    counters = {"next": 0}

    def next_call(_req):
        counters["next"] += 1
        return {"choices": [{"message": {"content": "x"}, "finish_reason": "stop"}], "usage": {}}

    run = make_run_llm_execution(
        api_request_id="r1", provider="p", model="m", api_mode="chat_completions",
        approx_input_tokens=500,
    )
    resp = run({"messages": [{"role": "user", "content": "x"}], "max_tokens": 500}, next_call)
    assert counters["next"] == 0   # fail-CLOSED · 严格
    assert resp["cache_meta"]["budget_fail_closed"] is True
    assert resp["cache_meta"]["reason_code"] == "tenant_context_invalid"
    assert resp["choices"][0]["message"]["content"]   # 非空可展示 error
    assert resp["choices"][0]["finish_reason"] == "content_filter"


def test_no_tenant_config_fail_closed(tmp_path, monkeypatch):
    """config.yaml 无 tenant 段 · fail-CLOSED(不走 next_call)。"""
    write_config(
        tmp_path,
        [CACHE_KEY, BUDGET_KEY],
        spike_p3_m0_cache={"enabled": True},   # 无 tenant 段
    )
    install_fresh_manager(monkeypatch, tmp_path)
    counters = {"next": 0}

    def next_call(_req):
        counters["next"] += 1
        return {"choices": [{"message": {"content": "x"}, "finish_reason": "stop"}], "usage": {}}

    run = make_run_llm_execution(
        api_request_id="r1", provider="p", model="m", api_mode="chat_completions",
    )
    resp = run({"messages": [{"role": "user", "content": "hi"}]}, next_call)
    assert counters["next"] == 0
    assert resp["cache_meta"]["reason_code"] == "tenant_context_invalid"


def test_unsupported_api_mode_fail_closed(tmp_path, monkeypatch):
    """未知 api_mode 明确 fail-CLOSED；具体值不属于用户可见 response。"""
    manager, cache_mod, budget_mod = _enable_cache(tmp_path, monkeypatch, daily_budget=10_000)
    counters = {"next": 0}

    def next_call(_req):
        counters["next"] += 1
        return {"choices": [{"message": {"content": "x"}, "finish_reason": "stop"}], "usage": {}}

    run = make_run_llm_execution(
        api_request_id="r1", provider="p", model="m", api_mode="responses",
    )
    resp = run({"messages": [{"role": "user", "content": "x"}]}, next_call)
    assert counters["next"] == 0
    assert resp["cache_meta"]["reason_code"] == "unsupported_api_mode"
    assert "api_mode" not in resp["cache_meta"]


def test_non_dict_request_fail_closed(tmp_path, monkeypatch):
    """非 dict request 无法 estimate token · fail-CLOSED。"""
    manager, cache_mod, budget_mod = _enable_cache(tmp_path, monkeypatch, daily_budget=10_000)
    counters = {"next": 0}

    def next_call(_req):
        counters["next"] += 1
        return None

    run = make_run_llm_execution(
        api_request_id="r1", provider="p", model="m", api_mode="chat_completions",
    )
    resp = run(["not", "a", "dict"], next_call)   # list · 非 dict
    assert counters["next"] == 0
    assert resp["cache_meta"]["reason_code"] == "non_dict_request"


@pytest.mark.parametrize("bad_budget", [True, False, -1, "1000", 1.5])
def test_invalid_budget_config_fail_closed(tmp_path, monkeypatch, bad_budget):
    """Codex §III:BudgetConfigError 硬 fail-CLOSED · **不**转 None 静默继续。"""
    manager, cache_mod, budget_mod = _enable_cache(
        tmp_path, monkeypatch, daily_budget=bad_budget
    )
    counters = {"next": 0}

    def next_call(_req):
        counters["next"] += 1
        return {"choices": [{"message": {"content": "x"}, "finish_reason": "stop"}], "usage": {}}

    run = make_run_llm_execution(
        api_request_id="r1", provider="p", model="m", api_mode="chat_completions",
    )
    resp = run({"messages": [{"role": "user", "content": "x"}]}, next_call)
    assert counters["next"] == 0
    assert resp["cache_meta"]["reason_code"] == "budget_config_invalid"


def test_missing_api_request_id_fail_closed(tmp_path, monkeypatch):
    """空 api_request_id · reserve 无法追踪 · fail-CLOSED。"""
    manager, cache_mod, budget_mod = _enable_cache(tmp_path, monkeypatch, daily_budget=10_000)
    counters = {"next": 0}

    def next_call(_req):
        counters["next"] += 1
        return {"choices": [{"message": {"content": "x"}, "finish_reason": "stop"}], "usage": {}}

    run = make_run_llm_execution(
        api_request_id="", provider="p", model="m", api_mode="chat_completions",
    )
    resp = run({"messages": [{"role": "user", "content": "x"}]}, next_call)
    assert counters["next"] == 0
    assert resp["cache_meta"]["reason_code"] == "missing_api_request_id"


@pytest.mark.parametrize(
    ("provider", "model"),
    [("", "m"), ("openai", "")],
)
def test_missing_provider_or_model_fail_closed(
    tmp_path, monkeypatch, provider, model,
):
    """缓存身份字段缺失时不得生成可碰撞的空值 key。"""
    _enable_cache(tmp_path, monkeypatch, daily_budget=10_000)
    counters = {"next": 0}

    def next_call(_req):
        counters["next"] += 1

    response = make_run_llm_execution(
        api_request_id="req_identity",
        provider=provider,
        model=model,
        api_mode="chat_completions",
    )({"messages": [{"role": "user", "content": "x"}]}, next_call)
    assert counters["next"] == 0
    assert response["cache_meta"]["reason_code"] == "missing_provider_or_model"


def test_non_string_execution_context_fail_closed(tmp_path, monkeypatch):
    _enable_cache(tmp_path, monkeypatch, daily_budget=10_000)
    counters = {"next": 0}

    response = make_run_llm_execution(
        api_request_id="req_identity",
        provider={"unexpected": "mapping"},
        model="m",
        api_mode="chat_completions",
    )(
        {"messages": [{"role": "user", "content": "x"}]},
        lambda _req: counters.__setitem__("next", counters["next"] + 1),
    )
    assert counters["next"] == 0
    assert response["cache_meta"]["reason_code"] == "invalid_execution_context"


# ── Cache alone(budget disabled)· 硬依赖门 fail-CLOSED ─────────────


def test_cache_alone_without_budget_fail_closed(tmp_path, monkeypatch):
    """Codex §III:cache 单独启用时 budget 缺失 · **必须 fail-CLOSED** · 不 pass-through。"""
    # 只启用 cache · 不启用 budget · 但 config tenant 完整
    manager, cache_mod, _ = _enable_cache(
        tmp_path, monkeypatch, daily_budget=1000, include_budget=False,
    )
    counters = {"next": 0}

    def next_call(_req):
        counters["next"] += 1
        return {"choices": [{"message": {"content": "x"}, "finish_reason": "stop"}], "usage": {}}

    run = make_run_llm_execution(
        api_request_id="r1", provider="p", model="m", api_mode="chat_completions",
    )
    resp = run({"messages": [{"role": "user", "content": "x"}]}, next_call)
    # budget module 未加载 · 硬 fail-CLOSED
    assert counters["next"] == 0
    assert resp["cache_meta"]["budget_fail_closed"] is True
    assert resp["cache_meta"]["reason_code"] == "budget_module_missing"


# ── Cache key schema stability(§2 v1 schema) ──────────────────────


def test_cache_key_stable_and_deterministic(tmp_path, monkeypatch):
    manager, cache_mod, budget_mod = _enable_cache(tmp_path, monkeypatch, daily_budget=10_000)
    req = {"messages": [{"role": "user", "content": "hi"}]}
    ctx = dict(_VALID_TENANT)
    k1 = cache_mod.build_cache_key(req, ctx, model="gpt-4o", provider="openai")
    k2 = cache_mod.build_cache_key(req, ctx, model="gpt-4o", provider="openai")
    assert k1 == k2 and len(k1) == 64


def test_cache_key_changes_on_provider(tmp_path, monkeypatch):
    manager, cache_mod, budget_mod = _enable_cache(tmp_path, monkeypatch, daily_budget=10_000)
    req = {"messages": []}
    ctx = dict(_VALID_TENANT)
    k1 = cache_mod.build_cache_key(req, ctx, model="m", provider="openai")
    k2 = cache_mod.build_cache_key(req, ctx, model="m", provider="anthropic")
    assert k1 != k2


@pytest.mark.parametrize(
    ("field", "first", "second"),
    [
        ("temperature", 0, 0.8),
        ("top_p", 0.9, 1.0),
        ("max_tokens", 64, 128),
        ("response_format", {"type": "text"}, {"type": "json_object"}),
        ("seed", 1, 2),
        ("extra_body", {"reasoning": {"effort": "low"}}, {"reasoning": {"effort": "high"}}),
    ],
)
def test_cache_key_changes_on_generation_options(
    tmp_path, monkeypatch, field, first, second,
):
    """相同 messages 但生成语义不同，必须产生不同 cache key。"""
    _, cache_mod, _ = _enable_cache(tmp_path, monkeypatch, daily_budget=10_000)
    ctx = dict(_VALID_TENANT)
    base = {"messages": [{"role": "user", "content": "same"}]}
    req_a = dict(base, **{field: first})
    req_b = dict(base, **{field: second})
    key_a = cache_mod.build_cache_key(req_a, ctx, model="m", provider="openai")
    key_b = cache_mod.build_cache_key(req_b, ctx, model="m", provider="openai")
    assert key_a != key_b


def test_cache_key_changes_on_tenant(tmp_path, monkeypatch):
    manager, cache_mod, budget_mod = _enable_cache(tmp_path, monkeypatch, daily_budget=10_000)
    req = {"messages": []}
    a = dict(_VALID_TENANT, tenant_id="tA")
    b = dict(_VALID_TENANT, tenant_id="tB")
    ka = cache_mod.build_cache_key(req, a, model="m", provider="p")
    kb = cache_mod.build_cache_key(req, b, model="m", provider="p")
    assert ka != kb


# ── Tool-call response 不 insert · 下次仍 miss ────────────────────


def test_tool_calls_response_not_inserted(tmp_path, monkeypatch):
    manager, cache_mod, budget_mod = _enable_cache(tmp_path, monkeypatch, daily_budget=10_000)

    counters = {"next": 0}

    def next_call(_req):
        counters["next"] += 1
        return {
            "choices": [{"message": {"tool_calls": [{"id": "1"}]}, "finish_reason": "tool_calls"}],
            "usage": {"prompt_tokens": 10, "completion_tokens": 5},
        }

    run1 = make_run_llm_execution(api_request_id="r1", provider="p", model="m", api_mode="chat_completions")
    run2 = make_run_llm_execution(api_request_id="r2", provider="p", model="m", api_mode="chat_completions")
    req = {"messages": [{"role": "user", "content": "call tool"}]}
    run1(req, next_call)
    run2(req, next_call)
    assert counters["next"] == 2


# ── Input token estimation (Codex §V:不静默 0) ────────────────────


def test_input_tokens_estimated_from_messages_when_no_ctx(tmp_path, monkeypatch):
    """无 ctx.approx_input_tokens · 从 messages char count / 4 估算 · 不静默 0。"""
    manager, cache_mod, budget_mod = _enable_cache(tmp_path, monkeypatch, daily_budget=1000)
    counters = {"next": 0}

    def next_call(_req):
        counters["next"] += 1
        return {"choices": [{"message": {"content": "ok"}, "finish_reason": "stop"}],
                "usage": {"prompt_tokens": 5, "completion_tokens": 2}}

    # 未传 approx_input_tokens · content 长约 4000 字符 → 估算 ~1000 tokens 触发超支
    long_content = "x" * 4000
    run = make_run_llm_execution(
        api_request_id="r1", provider="p", model="m", api_mode="chat_completions",
    )
    resp = run({"messages": [{"role": "user", "content": long_content}], "max_tokens": 100}, next_call)
    # 估算 = 4000/4 + 100 = 1100 · budget=1000 · 超支
    assert counters["next"] == 0
    assert resp["cache_meta"]["budget_exceeded"] is True
    assert "tokens_needed" not in resp["cache_meta"]


@pytest.mark.parametrize("bad_max_tokens", [True, -1, "not-an-int"])
def test_invalid_or_unknown_token_estimate_fails_closed(
    tmp_path, monkeypatch, bad_max_tokens,
):
    _, _, _ = _enable_cache(tmp_path, monkeypatch, daily_budget=1000)
    counters = {"next": 0}

    def next_call(_req):
        counters["next"] += 1

    run = make_run_llm_execution(
        api_request_id="bad_estimate",
        provider="p",
        model="m",
        api_mode="chat_completions",
    )
    resp = run({"messages": [], "max_tokens": bad_max_tokens}, next_call)
    assert counters["next"] == 0
    assert resp["cache_meta"]["reason_code"] == "token_estimation_error"


# ── Registered middleware must not inherit the core fail-open policy ──


def _run_with_counter():
    counters = {"next": 0}

    def next_call(_req):
        counters["next"] += 1
        return {
            "choices": [{"message": {"content": "provider output"}, "finish_reason": "stop"}],
            "usage": {"prompt_tokens": 1, "completion_tokens": 1},
        }

    run = make_run_llm_execution(
        api_request_id="r_fail_closed",
        provider="p",
        model="m",
        api_mode="chat_completions",
        approx_input_tokens=10,
    )
    return counters, next_call, run


def _assert_internal_failure_is_safe(resp, counters, reason_code):
    assert counters["next"] == 0
    assert resp["cache_meta"]["reason_code"] == reason_code
    assert resp["choices"][0]["message"]["content"]
    rendered = repr(resp)
    assert "private user input" not in rendered
    assert "TOP_SECRET_INTERNAL_EXCEPTION" not in rendered


def test_registered_plugin_config_load_error_fail_closed(tmp_path, monkeypatch):
    _, cache_mod, _ = _enable_cache(tmp_path, monkeypatch, daily_budget=1000)
    from hermes_cli import config as config_mod

    def boom():
        raise RuntimeError("TOP_SECRET_INTERNAL_EXCEPTION")

    monkeypatch.setattr(config_mod, "load_config", boom)
    counters, next_call, run = _run_with_counter()
    resp = run(
        {"messages": [{"role": "user", "content": "private user input"}]},
        next_call,
    )
    _assert_internal_failure_is_safe(resp, counters, "config_load_failed")


@pytest.mark.parametrize(
    "bad_config",
    [
        {"plugins": []},
        {"plugins": {"spike_p3_m0_cache": []}},
    ],
    ids=["plugins-not-mapping", "plugin-config-not-mapping"],
)
def test_registered_plugin_malformed_config_shape_fail_closed(
    tmp_path, monkeypatch, bad_config,
):
    _, cache_mod, _ = _enable_cache(tmp_path, monkeypatch, daily_budget=1000)
    monkeypatch.setattr(cache_mod, "_load_config", lambda: bad_config)
    counters, next_call, run = _run_with_counter()
    resp = run(
        {"messages": [{"role": "user", "content": "private user input"}]},
        next_call,
    )
    _assert_internal_failure_is_safe(resp, counters, "config_shape_invalid")


def test_tenant_context_internal_error_fail_closed(tmp_path, monkeypatch):
    _, cache_mod, _ = _enable_cache(tmp_path, monkeypatch, daily_budget=1000)

    def boom(_plugin_cfg):
        raise RuntimeError("TOP_SECRET_INTERNAL_EXCEPTION")

    monkeypatch.setattr(cache_mod, "_get_tenant_context", boom)
    counters, next_call, run = _run_with_counter()
    resp = run(
        {"messages": [{"role": "user", "content": "private user input"}]},
        next_call,
    )
    _assert_internal_failure_is_safe(resp, counters, "tenant_context_error")


def test_cache_key_internal_error_fail_closed(tmp_path, monkeypatch):
    _, cache_mod, _ = _enable_cache(tmp_path, monkeypatch, daily_budget=1000)

    def boom(*_args, **_kwargs):
        raise RuntimeError("TOP_SECRET_INTERNAL_EXCEPTION")

    monkeypatch.setattr(cache_mod, "build_cache_key", boom)
    counters, next_call, run = _run_with_counter()
    resp = run(
        {"messages": [{"role": "user", "content": "private user input"}]},
        next_call,
    )
    _assert_internal_failure_is_safe(resp, counters, "cache_lookup_error")


def test_budget_reserve_internal_error_fail_closed(tmp_path, monkeypatch):
    _, _, budget_mod = _enable_cache(tmp_path, monkeypatch, daily_budget=1000)

    def boom(*_args, **_kwargs):
        raise RuntimeError("TOP_SECRET_INTERNAL_EXCEPTION")

    monkeypatch.setattr(budget_mod, "reserve", boom)
    counters, next_call, run = _run_with_counter()
    resp = run(
        {"messages": [{"role": "user", "content": "private user input"}]},
        next_call,
    )
    _assert_internal_failure_is_safe(resp, counters, "budget_reserve_error")


@pytest.mark.parametrize(
    ("target", "reason_code"),
    [
        ("_is_enabled", "config_enabled_error"),
        ("_api_mode_supported", "api_mode_error"),
        ("is_cacheable_request", "request_classification_error"),
        ("_estimate_needed_tokens", "token_estimation_error"),
    ],
)
def test_other_pre_provider_internal_errors_fail_closed(
    tmp_path, monkeypatch, target, reason_code,
):
    _, cache_mod, _ = _enable_cache(tmp_path, monkeypatch, daily_budget=1000)

    def boom(*_args, **_kwargs):
        raise RuntimeError("TOP_SECRET_INTERNAL_EXCEPTION")

    monkeypatch.setattr(cache_mod, target, boom)
    counters, next_call, run = _run_with_counter()
    resp = run(
        {"messages": [{"role": "user", "content": "private user input"}]},
        next_call,
    )
    _assert_internal_failure_is_safe(resp, counters, reason_code)


def test_budget_validation_internal_error_fail_closed(tmp_path, monkeypatch):
    _, _, budget_mod = _enable_cache(tmp_path, monkeypatch, daily_budget=1000)

    def boom(_value):
        raise RuntimeError("TOP_SECRET_INTERNAL_EXCEPTION")

    monkeypatch.setattr(budget_mod, "validate_daily_budget", boom)
    counters, next_call, run = _run_with_counter()
    resp = run(
        {"messages": [{"role": "user", "content": "private user input"}]},
        next_call,
    )
    _assert_internal_failure_is_safe(resp, counters, "budget_config_error")


def test_response_classification_error_preserves_provider_response(tmp_path, monkeypatch):
    """provider 已成功后，缓存分类错误只能降级为不缓存。"""
    _, cache_mod, _ = _enable_cache(tmp_path, monkeypatch, daily_budget=1000)

    def boom(_response):
        raise RuntimeError("TOP_SECRET_INTERNAL_EXCEPTION")

    monkeypatch.setattr(cache_mod, "is_cacheable_response", boom)
    expected = {
        "choices": [{"message": {"content": "provider-success"}, "finish_reason": "stop"}],
        "usage": {"prompt_tokens": 2, "completion_tokens": 3},
    }
    run = make_run_llm_execution(
        api_request_id="response_classification",
        provider="p",
        model="m",
        api_mode="chat_completions",
        approx_input_tokens=10,
    )
    assert run({"messages": [{"role": "user", "content": "x"}]}, lambda _req: expected) is expected
