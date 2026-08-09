"""P3-M0 Spike · budget service 测试(观察 hook · 无 enforcement).

**Codex §I 契约调整**:
- Budget 不再由 `pre_api_request` hook 抛 BudgetExceeded(生产调用点吞异常)
- 现由 `spike_p3_m0_cache` 注册的 `llm_execution` middleware 调用 budget service
- 本文件测 service 函数 · orchestration 端到端由 `spike_p3_m0_cache` 测试覆盖
- Discovery 侧仍通过真实 PluginManager 验证:hook 挂上、observer 只做 audit
"""
from __future__ import annotations

import threading

import pytest

from plugins.spike_p3_m0_fixtures.pluginmgr_helper import (
    get_discovered_module,
    install_fresh_manager,
    write_config,
)


BUDGET_KEY = "spike-p3-m0-budget"


def _enable_budget(tmp_path, monkeypatch):
    write_config(tmp_path, [BUDGET_KEY])
    manager = install_fresh_manager(monkeypatch, tmp_path)
    mod = get_discovered_module(manager, BUDGET_KEY)
    mod.reset_state()
    return manager, mod


# ── Registration(§VIII 真实 PluginManager 门槛) ──────────────────


def test_discovery_registers_observer_hooks(tmp_path, monkeypatch):
    """PluginContext.register_hook 生效 · pre/post_api_request 均挂上。"""
    from hermes_cli.plugins import has_hook

    manager, mod = _enable_budget(tmp_path, monkeypatch)
    # observer 挂上(无 enforcement · 见模块 docstring)
    assert has_hook("pre_api_request") is True
    assert has_hook("post_api_request") is True
    # 不 register llm_execution middleware(orchestration 是 cache 的责任)
    assert manager._middleware.get("llm_execution") in (None, [])


def test_disabled_plugin_not_loaded(tmp_path, monkeypatch):
    from hermes_cli.plugins import has_hook

    write_config(tmp_path, [])
    install_fresh_manager(monkeypatch, tmp_path)
    # 无 hook 挂上
    assert has_hook("pre_api_request") is False


# ── validate_daily_budget · 4 态 + 拒非法(§V) ─────────────────────


def test_validate_daily_budget_states(tmp_path, monkeypatch):
    _, mod = _enable_budget(tmp_path, monkeypatch)
    assert mod.validate_daily_budget(None) is None
    assert mod.validate_daily_budget(0) == 0        # 显式无限
    assert mod.validate_daily_budget(1000) == 1000


@pytest.mark.parametrize(
    "bad_value",
    [True, False, -1, "1000", 1.5, [], {}],
    ids=["true", "false", "negative", "string", "float", "list", "dict"],
)
def test_validate_daily_budget_rejects(tmp_path, monkeypatch, bad_value):
    _, mod = _enable_budget(tmp_path, monkeypatch)
    with pytest.raises(mod.BudgetConfigError):
        mod.validate_daily_budget(bad_value)


# ── reserve / settle · 基本路径 ─────────────────────────────────────


def test_reserve_none_budget_no_op(tmp_path, monkeypatch):
    """budget=None(未启用)· reserve no-op · 不 raise。"""
    _, mod = _enable_budget(tmp_path, monkeypatch)
    mod.reserve("t1", "req_a", 500, budget=None)
    assert mod.get_pending_total("t1") == 0
    assert mod.get_reservation("t1", "req_a") is None


def test_reserve_then_settle_charges_actual(tmp_path, monkeypatch):
    _, mod = _enable_budget(tmp_path, monkeypatch)
    mod.reserve("t1", "req_1", 300, budget=10_000)
    assert mod.get_pending_total("t1") == 300
    mod.settle("t1", "req_1", 120)
    assert mod.get_used("t1") == 120
    assert mod.get_pending_total("t1") == 0


def test_release_removes_reservation_no_charge(tmp_path, monkeypatch):
    _, mod = _enable_budget(tmp_path, monkeypatch)
    mod.reserve("t1", "req_x", 200, budget=10_000)
    mod.release("t1", "req_x")
    assert mod.get_used("t1") == 0
    assert mod.get_pending_total("t1") == 0


# ── reserve 超预算 · raise BudgetExceeded ────────────────────────


def test_reserve_over_budget_raises(tmp_path, monkeypatch):
    _, mod = _enable_budget(tmp_path, monkeypatch)
    with pytest.raises(mod.BudgetExceeded, match="daily budget exhausted"):
        mod.reserve("t1", "req_over", 200, budget=100)
    # 不能 leak reservation
    assert mod.get_pending_total("t1") == 0


def test_used_plus_pending_plus_new_over_budget_raises(tmp_path, monkeypatch):
    _, mod = _enable_budget(tmp_path, monkeypatch)
    mod.reserve("t1", "r_a", 60, budget=200)
    mod.settle("t1", "r_a", 60)   # used=60
    mod.reserve("t1", "r_b", 100, budget=200)   # pending=100 · used=60 · sum=160
    with pytest.raises(mod.BudgetExceeded):
        mod.reserve("t1", "r_c", 50, budget=200)   # 60+100+50=210 > 200


def test_budget_zero_is_unlimited(tmp_path, monkeypatch):
    """budget=0 显式无限 · 大额 reserve 仍成功 · used 仍累加供审计。"""
    _, mod = _enable_budget(tmp_path, monkeypatch)
    mod.reserve("t1", "r_big", 10_000_000, budget=0)
    mod.settle("t1", "r_big", 5_000_000)
    assert mod.get_used("t1") == 5_000_000


# ── api_request_id 唯一性 ─────────────────────────────────────────


def test_duplicate_reserve_raises(tmp_path, monkeypatch):
    _, mod = _enable_budget(tmp_path, monkeypatch)
    mod.reserve("t1", "req_dup", 50, budget=1000)
    with pytest.raises(mod.BudgetExceeded, match="duplicate"):
        mod.reserve("t1", "req_dup", 50, budget=1000)


def test_empty_api_request_id_raises(tmp_path, monkeypatch):
    _, mod = _enable_budget(tmp_path, monkeypatch)
    with pytest.raises(mod.BudgetExceeded, match="anonymous"):
        mod.reserve("t1", "", 50, budget=1000)


# ── UTC daily bucket 隔离 ──────────────────────────────────────────


def test_multiple_tenants_isolated(tmp_path, monkeypatch):
    _, mod = _enable_budget(tmp_path, monkeypatch)
    mod.reserve("tA", "r1", 40, budget=100)
    mod.settle("tA", "r1", 40)
    mod.reserve("tB", "r2", 90, budget=100)
    mod.settle("tB", "r2", 90)
    assert mod.get_used("tA") == 40
    assert mod.get_used("tB") == 90


# ── 并发 reserve/settle · threading.Lock 正确 ─────────────────────


def test_concurrent_reserve_settle_thread_safe(tmp_path, monkeypatch):
    _, mod = _enable_budget(tmp_path, monkeypatch)
    N = 40
    barrier = threading.Barrier(N)

    def worker(i):
        barrier.wait()
        mod.reserve("t_shared", f"req_{i}", 10, budget=10_000)
        mod.settle("t_shared", f"req_{i}", 5)

    threads = [threading.Thread(target=worker, args=(i,)) for i in range(N)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    assert mod.get_used("t_shared") == N * 5
    assert mod.get_pending_total("t_shared") == 0


# ── settle/release 幂等 · 未知 req_id 不 raise ───────────────────


def test_settle_unknown_id_still_accumulates_used(tmp_path, monkeypatch):
    """settle 允许在没有 reservation 的 req_id 上调用 · 仅累加 used(observer 语义)。"""
    _, mod = _enable_budget(tmp_path, monkeypatch)
    mod.settle("t1", "unknown_req", 25)
    assert mod.get_used("t1") == 25


def test_release_unknown_id_no_op(tmp_path, monkeypatch):
    _, mod = _enable_budget(tmp_path, monkeypatch)
    mod.release("t1", "unknown_req")   # 不 raise
    assert mod.get_used("t1") == 0


# ── observer hooks 不 enforce(§I 契约) ─────────────────────────


def test_pre_api_request_observer_never_enforces(tmp_path, monkeypatch):
    """`pre_api_request` observer hook 恒 no-op · 不 raise · 不改 state。

    Codex §I 强制:budget enforcement 已经搬进 llm_execution middleware(见
    spike_p3_m0_cache)· 本 observer 只做 audit trigger point。
    """
    from hermes_cli.plugins import invoke_hook

    _, mod = _enable_budget(tmp_path, monkeypatch)
    # 无 tenant context · 无 config · 直接调 observer · 不 raise · state 不变
    results = invoke_hook(
        "pre_api_request",
        api_request_id="r1",
        approx_input_tokens=999999,
        max_tokens=999999,
    )
    # observer 返回 None(_on_pre_api_request_observer)· invoke_hook 过滤 None → 空 list
    assert results == []
    assert mod.get_used("t_any") == 0
    assert mod.get_pending_total("t_any") == 0
