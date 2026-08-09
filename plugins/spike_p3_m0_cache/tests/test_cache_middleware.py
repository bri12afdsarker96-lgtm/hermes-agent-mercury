"""P3-M0 Spike · cache + budget orchestrator middleware 测试(**真实生产走位**).

**Codex §I / §VIII 契约**:
- 通过临时 `config.yaml` 启用插件 · 走真实 `PluginManager.discover_and_load`
- `has_middleware("llm_execution") == True`
- 通过 `run_llm_execution_middleware` 触发 · **不**直接调 `cache_and_budget_middleware`
- **不用** `SPIKE_*` env(fork AGENTS.md red-line 3)· **不污染**全局 manager
- 覆盖:
  * cache miss → budget reserve/settle 各 1 次
  * cache hit  → budget reserve 0 次(顶层 usage=0)
  * budget 超支 → next_call 0 次(structured error response · budget_exceeded)
  * provider exception → reservation 释放 · exception 传播
  * tenant context 缺失/非法 → fail-closed(pass-through · 不 lookup 不 reserve)
  * streaming / tools request → pass-through
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
):
    tenant_cfg = dict(tenant)
    if daily_budget is not None:
        tenant_cfg["daily_budget_tokens"] = daily_budget
    write_config(
        tmp_path,
        [CACHE_KEY, BUDGET_KEY],
        spike_p3_m0_cache={
            "enabled": True,
            "tenant": tenant_cfg,
        },
    )
    manager = install_fresh_manager(monkeypatch, tmp_path)
    cache_mod = get_discovered_module(manager, CACHE_KEY)
    budget_mod = get_discovered_module(manager, BUDGET_KEY)
    cache_mod.clear_cache()
    budget_mod.reset_state()
    return manager, cache_mod, budget_mod


# ── Registration invariants(§I 强要求) ─────────────────────────────


def test_discover_registers_llm_execution_middleware(tmp_path, monkeypatch):
    """PluginContext.register_middleware("llm_execution", ...) 生效 · fork middleware.py 契约。"""
    from hermes_cli.plugins import has_middleware

    manager, _, _ = _enable_cache(tmp_path, monkeypatch)
    assert has_middleware("llm_execution") is True
    assert len(manager._middleware.get("llm_execution", [])) == 1


def test_disabled_plugin_not_loaded(tmp_path, monkeypatch):
    """`plugins.enabled` 不含 spike-p3-m0-cache · discover 不 load · 无 middleware。"""
    from hermes_cli.plugins import has_middleware

    write_config(tmp_path, [])   # 空 enabled · 无插件加载
    install_fresh_manager(monkeypatch, tmp_path)
    assert has_middleware("llm_execution") is False


# ── Cache miss → budget reserve+settle 各 1 次(§I 强要求) ─────────


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
    )
    resp = run({"messages": [{"role": "user", "content": "hi"}]}, next_call)

    assert call_count["next"] == 1
    assert resp["choices"][0]["message"]["content"] == "hi"
    # settle 累加 actual usage = 150
    assert budget_mod.get_used(_VALID_TENANT["tenant_id"]) == 150
    # 无 pending reservations
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
    assert counters["next"] == 1   # 未再调 next
    assert budget_mod.get_used(_VALID_TENANT["tenant_id"]) == 280   # 未 charge
    # 顶层 usage = billable_usage = 全 0
    assert resp["usage"] == {"prompt_tokens": 0, "completion_tokens": 0}
    # cache_meta 拆分正确
    assert resp["cache_meta"]["hit"] is True
    assert resp["cache_meta"]["billable_usage"] == {"prompt_tokens": 0, "completion_tokens": 0}
    assert resp["cache_meta"]["origin_usage"] == {"prompt_tokens": 200, "completion_tokens": 80}
    assert resp["cache_meta"]["saved_usage"] == {"prompt_tokens": 200, "completion_tokens": 80}
    assert resp["cache_meta"]["cache_contract_version"] == cache_mod.CACHE_CONTRACT_VERSION
    # 二次调用不该有 pending reservation(hit 直接返回)
    assert budget_mod.get_pending_total(_VALID_TENANT["tenant_id"]) == 0


# ── Budget 超支 → next_call 0 次(§I 强要求) ────────────────────────


def test_budget_exceeded_blocks_next_call(tmp_path, monkeypatch):
    manager, cache_mod, budget_mod = _enable_cache(
        tmp_path, monkeypatch, daily_budget=100   # 极小
    )

    counters = {"next": 0}

    def next_call(_req):
        counters["next"] += 1
        return {
            "model": "m",
            "choices": [{"message": {"content": "x"}, "finish_reason": "stop"}],
            "usage": {"prompt_tokens": 0, "completion_tokens": 0},
        }

    run = make_run_llm_execution(
        api_request_id="req_over",
        provider="openai",
        model="m",
        api_mode="chat_completions",
        approx_input_tokens=500,   # 已远超 budget 100
    )
    resp = run(
        {"messages": [{"role": "user", "content": "x"}], "max_tokens": 500},
        next_call,
    )
    # 超支明确 short-circuit · next 未调
    assert counters["next"] == 0
    # 结构化 error response · budget_exceeded=True
    assert resp["cache_meta"]["budget_exceeded"] is True
    assert resp["cache_meta"]["tenant_id"] == _VALID_TENANT["tenant_id"]
    # 无 pending reservation(reserve 抛异常 · 未记账)
    assert budget_mod.get_pending_total(_VALID_TENANT["tenant_id"]) == 0
    assert budget_mod.get_used(_VALID_TENANT["tenant_id"]) == 0


# ── Provider exception → reservation 释放 + 传播(§I 强要求) ───────


def test_provider_exception_releases_reservation(tmp_path, monkeypatch):
    manager, cache_mod, budget_mod = _enable_cache(
        tmp_path, monkeypatch, daily_budget=10_000
    )

    class ProviderBoom(RuntimeError):
        pass

    def next_call(_req):
        raise ProviderBoom("upstream 500")

    run = make_run_llm_execution(
        api_request_id="req_boom",
        provider="openai",
        model="m",
        api_mode="chat_completions",
        approx_input_tokens=100,
    )
    with pytest.raises(ProviderBoom, match="upstream 500"):
        run({"messages": [{"role": "user", "content": "x"}], "max_tokens": 100}, next_call)

    # reservation 已释放 · used 未增
    assert budget_mod.get_pending_total(_VALID_TENANT["tenant_id"]) == 0
    assert budget_mod.get_used(_VALID_TENANT["tenant_id"]) == 0
    assert budget_mod.get_reservation(_VALID_TENANT["tenant_id"], "req_boom") is None


# ── Tenant context fail-closed(§III 严格) ─────────────────────────


@pytest.mark.parametrize(
    "bad_tenant",
    [
        {"tenant_id": "", "principal_id": "p", "permission_scope_version": "1", "profile_version": "1"},
        {"tenant_id": "t", "principal_id": "", "permission_scope_version": "1", "profile_version": "1"},
        {"tenant_id": "t", "principal_id": "p", "permission_scope_version": "1"},   # 缺 profile_version
        {"tenant_id": "t/../evil", "principal_id": "p", "permission_scope_version": "1", "profile_version": "1"},
        {"tenant_id": "a" * 200, "principal_id": "p", "permission_scope_version": "1", "profile_version": "1"},
    ],
    ids=["empty-tenant", "empty-principal", "missing-profile-version", "non-whitelist-chars", "over-max-len"],
)
def test_invalid_tenant_pass_through(tmp_path, monkeypatch, bad_tenant):
    """任一 tenant 字段违反 · pass-through(不 lookup 不 reserve)· fail-closed。"""
    manager, cache_mod, budget_mod = _enable_cache(
        tmp_path, monkeypatch, daily_budget=100, tenant=bad_tenant
    )

    counters = {"next": 0}

    def next_call(_req):
        counters["next"] += 1
        return {"choices": [{"message": {"content": "x"}, "finish_reason": "stop"}], "usage": {}}

    run = make_run_llm_execution(
        api_request_id="r1", provider="p", model="m", api_mode="chat_completions",
        approx_input_tokens=500,   # 若 reserve 生效必超支 · 用于反证 fail-closed 走 next
    )
    resp = run({"messages": [{"role": "user", "content": "x"}], "max_tokens": 500}, next_call)
    assert counters["next"] == 1   # 走 next(未 reserve, 否则会 budget_exceeded)
    assert "cache_meta" not in resp


def test_no_tenant_config_pass_through(tmp_path, monkeypatch):
    """config.yaml 无 tenant 段 · fail-closed pass-through。"""
    write_config(
        tmp_path,
        [CACHE_KEY, BUDGET_KEY],
        spike_p3_m0_cache={"enabled": True},   # 无 tenant 段
    )
    manager = install_fresh_manager(monkeypatch, tmp_path)

    counters = {"next": 0}

    def next_call(_req):
        counters["next"] += 1
        return {"choices": [{"message": {"content": "x"}, "finish_reason": "stop"}], "usage": {}}

    run = make_run_llm_execution(
        api_request_id="r1", provider="p", model="m", api_mode="chat_completions",
    )
    resp = run({"messages": [{"role": "user", "content": "hi"}]}, next_call)
    assert counters["next"] == 1
    assert "cache_meta" not in resp


# ── Streaming / tools request pass-through(§4 mode 限定) ───────────


def test_streaming_request_pass_through(tmp_path, monkeypatch):
    manager, cache_mod, budget_mod = _enable_cache(tmp_path, monkeypatch, daily_budget=10_000)
    counters = {"next": 0}

    def next_call(_req):
        counters["next"] += 1
        return {"choices": [{"message": {"content": "x"}, "finish_reason": "stop"}], "usage": {}}

    run = make_run_llm_execution(
        api_request_id="r1", provider="p", model="m", api_mode="chat_completions",
    )
    # 首次 · streaming=True → 不 lookup 不 insert
    run({"messages": [{"role": "user", "content": "x"}], "stream": True}, next_call)
    # 二次 · streaming=True · 仍 miss → next 再调
    run({"messages": [{"role": "user", "content": "x"}], "stream": True}, next_call)
    assert counters["next"] == 2


def test_tools_request_pass_through(tmp_path, monkeypatch):
    manager, cache_mod, budget_mod = _enable_cache(tmp_path, monkeypatch, daily_budget=10_000)
    counters = {"next": 0}

    def next_call(_req):
        counters["next"] += 1
        return {"choices": [{"message": {"content": "x"}, "finish_reason": "stop"}], "usage": {}}

    run = make_run_llm_execution(
        api_request_id="r1", provider="p", model="m", api_mode="chat_completions",
    )
    req = {"messages": [{"role": "user", "content": "x"}], "tools": [{"name": "search"}]}
    run(req, next_call)
    run(req, next_call)
    assert counters["next"] == 2   # 两次 miss(不 insert)


def test_non_chat_completions_mode_pass_through(tmp_path, monkeypatch):
    manager, cache_mod, budget_mod = _enable_cache(tmp_path, monkeypatch, daily_budget=10_000)
    counters = {"next": 0}

    def next_call(_req):
        counters["next"] += 1
        return {"choices": [{"message": {"content": "x"}, "finish_reason": "stop"}], "usage": {}}

    run = make_run_llm_execution(
        api_request_id="r1", provider="p", model="m", api_mode="responses",   # 非 chat_completions
    )
    req = {"messages": [{"role": "user", "content": "x"}]}
    run(req, next_call)
    run(req, next_call)
    assert counters["next"] == 2   # 两次都 miss(不 insert)


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
    assert counters["next"] == 2   # 两次都 miss · tool_calls 不 insert
