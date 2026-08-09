"""P3-M0 Spike · budget service 测试(observer hook · service API).

**Codex 第三轮 §IV 契约(修订)**:
- settle 仅结算**仍存在**的 reservation · unknown/double settle → raise BudgetSettleError · **不改** used
- release 幂等 · 返回 True(存在)/ False(不存在)· 不改 used
- 40 线程 barrier 精确超限测试:budget = N * per-req · 超过 N 个必 raise
- UTC 跨日 rollover 真测试(monkeypatch `_today_utc`)
- observer hooks 恒 no-op(无 enforcement)
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
    from hermes_cli.plugins import has_hook

    manager, mod = _enable_budget(tmp_path, monkeypatch)
    assert has_hook("pre_api_request") is True
    assert has_hook("post_api_request") is True
    assert manager._middleware.get("llm_execution") in (None, [])


def test_disabled_plugin_not_loaded(tmp_path, monkeypatch):
    from hermes_cli.plugins import has_hook

    write_config(tmp_path, [])
    install_fresh_manager(monkeypatch, tmp_path)
    assert has_hook("pre_api_request") is False


# ── validate_daily_budget · 4 态 + 拒非法(§V) ─────────────────────


def test_validate_daily_budget_states(tmp_path, monkeypatch):
    _, mod = _enable_budget(tmp_path, monkeypatch)
    assert mod.validate_daily_budget(None) is None
    assert mod.validate_daily_budget(0) == 0
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


def test_release_removes_reservation_returns_true(tmp_path, monkeypatch):
    """release 存在的 reservation · 返回 True · used 不变。"""
    _, mod = _enable_budget(tmp_path, monkeypatch)
    mod.reserve("t1", "req_x", 200, budget=10_000)
    assert mod.release("t1", "req_x") is True
    assert mod.get_used("t1") == 0
    assert mod.get_pending_total("t1") == 0


def test_release_unknown_returns_false_no_op(tmp_path, monkeypatch):
    """Codex §IV:release unknown reservation · 返回 False · no-op(幂等)。"""
    _, mod = _enable_budget(tmp_path, monkeypatch)
    assert mod.release("t1", "never_reserved") is False
    assert mod.get_used("t1") == 0
    assert mod.get_pending_total("t1") == 0


def test_release_after_release_returns_false(tmp_path, monkeypatch):
    """double release · 第二次返回 False · 无副作用。"""
    _, mod = _enable_budget(tmp_path, monkeypatch)
    mod.reserve("t1", "req_x", 100, budget=1000)
    assert mod.release("t1", "req_x") is True
    assert mod.release("t1", "req_x") is False
    assert mod.get_used("t1") == 0


# ── reserve 超预算 · raise BudgetExceeded ────────────────────────


def test_reserve_over_budget_raises(tmp_path, monkeypatch):
    _, mod = _enable_budget(tmp_path, monkeypatch)
    with pytest.raises(mod.BudgetExceeded, match="daily budget exhausted"):
        mod.reserve("t1", "req_over", 200, budget=100)
    assert mod.get_pending_total("t1") == 0


def test_used_plus_pending_plus_new_over_budget_raises(tmp_path, monkeypatch):
    _, mod = _enable_budget(tmp_path, monkeypatch)
    mod.reserve("t1", "r_a", 60, budget=200)
    mod.settle("t1", "r_a", 60)
    mod.reserve("t1", "r_b", 100, budget=200)
    with pytest.raises(mod.BudgetExceeded):
        mod.reserve("t1", "r_c", 50, budget=200)


def test_budget_zero_is_unlimited(tmp_path, monkeypatch):
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


# ── settle 严格幂等(Codex §IV 修订)─────────────────────────────


def test_settle_unknown_id_raises_and_does_not_charge(tmp_path, monkeypatch):
    """Codex §IV 修订:settle 无 reservation · **raise BudgetSettleError · 不改 used**。

    旧契约"unknown settle 累加 used"是**错误**的 · 会导致 unknown id 洗钱。
    """
    _, mod = _enable_budget(tmp_path, monkeypatch)
    with pytest.raises(mod.BudgetSettleError, match="no reservation"):
        mod.settle("t1", "unknown_req", 25)
    assert mod.get_used("t1") == 0


def test_double_settle_raises_after_first_ok(tmp_path, monkeypatch):
    """double settle · 第二次 raise · used 不再加。"""
    _, mod = _enable_budget(tmp_path, monkeypatch)
    mod.reserve("t1", "req_1", 50, budget=1000)
    mod.settle("t1", "req_1", 50)   # 首次 OK
    assert mod.get_used("t1") == 50
    with pytest.raises(mod.BudgetSettleError):
        mod.settle("t1", "req_1", 999)   # 第二次 · reservation 已消 · raise
    assert mod.get_used("t1") == 50   # 未增


def test_settle_after_release_raises(tmp_path, monkeypatch):
    """release 后 settle · reservation 不存在 · raise · used 不变。"""
    _, mod = _enable_budget(tmp_path, monkeypatch)
    mod.reserve("t1", "req_1", 50, budget=1000)
    mod.release("t1", "req_1")
    with pytest.raises(mod.BudgetSettleError):
        mod.settle("t1", "req_1", 25)
    assert mod.get_used("t1") == 0


# ── 多 tenant 隔离 ──────────────────────────────────────────────────


def test_multiple_tenants_isolated(tmp_path, monkeypatch):
    _, mod = _enable_budget(tmp_path, monkeypatch)
    mod.reserve("tA", "r1", 40, budget=100)
    mod.settle("tA", "r1", 40)
    mod.reserve("tB", "r2", 90, budget=100)
    mod.settle("tB", "r2", 90)
    assert mod.get_used("tA") == 40
    assert mod.get_used("tB") == 90


# ── 并发 reserve/settle · 无 race ────────────────────────────────


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


# ── 真并发超限:Codex §IV 强要求 · 精确 N 成功 / rest 失败 ─────────


def test_concurrent_reserve_precise_success_and_exceeded_counts(tmp_path, monkeypatch):
    """40 线程 barrier reserve · budget 只允许 N 个成功 · 精确 N 成功 · 40-N 失败。

    Codex §IV:证明无超扣、无 race race-double-count。
    """
    _, mod = _enable_budget(tmp_path, monkeypatch)
    N_THREADS = 40
    PER_REQ = 10
    N_SUCCESS = 15   # 只允许 15 个成功
    BUDGET = N_SUCCESS * PER_REQ   # 150
    barrier = threading.Barrier(N_THREADS)
    successes = []
    exceeded = []
    success_lock = threading.Lock()

    def worker(i):
        barrier.wait()
        try:
            mod.reserve("t_precise", f"r{i}", PER_REQ, budget=BUDGET)
            with success_lock:
                successes.append(i)
        except mod.BudgetExceeded:
            with success_lock:
                exceeded.append(i)

    threads = [threading.Thread(target=worker, args=(i,)) for i in range(N_THREADS)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    assert len(successes) == N_SUCCESS, (
        f"expected exactly {N_SUCCESS} successes · got {len(successes)}"
    )
    assert len(exceeded) == N_THREADS - N_SUCCESS
    assert mod.get_pending_total("t_precise") == BUDGET   # 全部成功者仍 pending

    # settle 全部成功者 · 无超扣
    for i in successes:
        mod.settle("t_precise", f"r{i}", PER_REQ)
    assert mod.get_used("t_precise") == BUDGET
    assert mod.get_pending_total("t_precise") == 0


# ── UTC 跨日 rollover 真测试(Codex §IV) ────────────────────────


def test_utc_day_rollover_isolates_bucket(tmp_path, monkeypatch):
    """monkeypatch `_today_utc` 模拟跨日 · 昨日 used 不影响今日 budget。"""
    _, mod = _enable_budget(tmp_path, monkeypatch)

    day1 = "2026-08-09"
    day2 = "2026-08-10"

    # Day 1 · 用满 budget=100 的 80
    monkeypatch.setattr(mod, "_today_utc", lambda: day1)
    mod.reserve("t_roll", "r_d1", 80, budget=100)
    mod.settle("t_roll", "r_d1", 80)
    assert mod.get_used("t_roll") == 80

    # Day 2 · 昨日 used 不算入今日 · 今日仍可 reserve 满 100
    monkeypatch.setattr(mod, "_today_utc", lambda: day2)
    # 新 bucket · used 归 0
    assert mod.get_used("t_roll") == 0
    mod.reserve("t_roll", "r_d2", 100, budget=100)
    mod.settle("t_roll", "r_d2", 100)
    assert mod.get_used("t_roll") == 100

    # 回到 Day 1 · 昨日 bucket 仍 80(未被今日污染)
    monkeypatch.setattr(mod, "_today_utc", lambda: day1)
    assert mod.get_used("t_roll") == 80


# ── observer hooks 不 enforce(§I 契约) ─────────────────────────


def test_pre_api_request_observer_never_enforces(tmp_path, monkeypatch):
    from hermes_cli.plugins import invoke_hook

    _, mod = _enable_budget(tmp_path, monkeypatch)
    results = invoke_hook(
        "pre_api_request",
        api_request_id="r1",
        approx_input_tokens=999999,
        max_tokens=999999,
    )
    assert results == []
    assert mod.get_used("t_any") == 0
    assert mod.get_pending_total("t_any") == 0
