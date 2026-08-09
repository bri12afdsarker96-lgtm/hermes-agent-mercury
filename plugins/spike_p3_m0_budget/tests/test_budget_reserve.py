"""P3-M0 Spike · budget prototype 测试。

覆盖(见 `docs/fork/budget-hook.md` §9):
- 无 tenant context → fail-open(不 reserve · 不 settle · 不 raise)
- tenant context + budget=None → 不 reserve
- reserve 成功 → settle 匹配 usage
- reserve 失败(超预算)→ raise BudgetExceeded
- cache hit → settle 不 charge(reserve 后被 middleware short-circuit 时)
- retry / fallback → reservation 独立(每 api_request_id 一次)
"""
from __future__ import annotations

from pathlib import Path

import pytest

from plugins.spike_p3_m0_budget import (
    BudgetExceeded,
    get_daily_used,
    on_post_api_request,
    on_pre_api_request,
    reset_state,
)


@pytest.fixture(autouse=True)
def _budget_isolation(monkeypatch, tmp_path):
    monkeypatch.setenv("SPIKE_P3_M0_BUDGET_ENABLED", "1")
    monkeypatch.setenv("HERMES_HOME", str(tmp_path))
    import plugins.spike_p3_m0_budget as mod

    monkeypatch.setattr(mod, "_ENABLED", True)
    reset_state()
    yield
    reset_state()


def _write_profile(tmp_path: Path, *, tenant_id="t_test", daily=None):
    import yaml   # type: ignore

    tenant_block = {"tenant_id": tenant_id}
    if daily is not None:
        tenant_block["daily_budget_tokens"] = daily
    (tmp_path / "profile.yaml").write_text(
        yaml.safe_dump({"tenant": tenant_block}), encoding="utf-8"
    )


# ── fail-open scenarios ──


def test_no_tenant_context_no_reserve(tmp_path):
    """无 profile.yaml → fail-open · 不 raise · 不影响 state。"""
    on_pre_api_request(api_request_id="req_1", approx_input_tokens=100, max_tokens=200)
    on_post_api_request(api_request_id="req_1", usage={"prompt_tokens": 100, "completion_tokens": 50})
    assert get_daily_used("t_test") == 0


def test_tenant_without_budget_no_reserve(tmp_path):
    """tenant 有 · daily_budget=None → 不 reserve · 不 settle · 不 raise。"""
    _write_profile(tmp_path, daily=None)
    on_pre_api_request(api_request_id="req_2", approx_input_tokens=100, max_tokens=200)
    on_post_api_request(api_request_id="req_2", usage={"prompt_tokens": 100, "completion_tokens": 50})
    assert get_daily_used("t_test") == 0


# ── reserve / settle 正常路径 ──


def test_reserve_then_settle_charges_actual(tmp_path):
    _write_profile(tmp_path, daily=10000)
    on_pre_api_request(api_request_id="req_A", approx_input_tokens=100, max_tokens=200)
    on_post_api_request(
        api_request_id="req_A",
        usage={"prompt_tokens": 80, "completion_tokens": 40},
    )
    # actual = 80+40 = 120(reserve 是 300 · settle 时按 actual 扣)
    assert get_daily_used("t_test") == 120


# ── reserve 失败 · raise BudgetExceeded ──


def test_reserve_exceeds_budget_raises(tmp_path):
    _write_profile(tmp_path, daily=100)
    # 首次 reserve 200 · 超预算 100 · raise
    with pytest.raises(BudgetExceeded, match="daily budget exhausted"):
        on_pre_api_request(api_request_id="req_over", approx_input_tokens=100, max_tokens=200)


def test_multiple_reserves_accumulate(tmp_path):
    _write_profile(tmp_path, daily=500)
    # 第一次 reserve 100 + settle 90(实用)· daily_used=90
    on_pre_api_request(api_request_id="r1", approx_input_tokens=50, max_tokens=50)
    on_post_api_request(api_request_id="r1", usage={"prompt_tokens": 50, "completion_tokens": 40})
    assert get_daily_used("t_test") == 90
    # 第二次 reserve 100 · 累计 used=90 · 90+100 <= 500 · 通过
    on_pre_api_request(api_request_id="r2", approx_input_tokens=50, max_tokens=50)
    on_post_api_request(api_request_id="r2", usage={"prompt_tokens": 50, "completion_tokens": 60})
    assert get_daily_used("t_test") == 200


# ── cache hit · settle 不 charge ──


def test_cache_hit_settle_no_charge(tmp_path):
    _write_profile(tmp_path, daily=10000)
    on_pre_api_request(api_request_id="req_cache", approx_input_tokens=100, max_tokens=200)
    # response 带 cache_meta.hit=True · settle 不 charge
    on_post_api_request(
        api_request_id="req_cache",
        response={"cache_meta": {"hit": True}},
        usage={"prompt_tokens": 80, "completion_tokens": 40},
    )
    assert get_daily_used("t_test") == 0


# ── retry · reservation 独立 ──


def test_multiple_api_request_ids_independent(tmp_path):
    _write_profile(tmp_path, daily=10000)
    on_pre_api_request(api_request_id="attempt_1", approx_input_tokens=50, max_tokens=50)
    on_pre_api_request(api_request_id="attempt_2", approx_input_tokens=100, max_tokens=100)
    on_post_api_request(api_request_id="attempt_1", usage={"prompt_tokens": 40, "completion_tokens": 30})
    on_post_api_request(api_request_id="attempt_2", usage={"prompt_tokens": 80, "completion_tokens": 60})
    assert get_daily_used("t_test") == 210   # 70 + 140


# ── env not enabled · no-op ──


def test_disabled_no_op(monkeypatch, tmp_path):
    monkeypatch.setenv("SPIKE_P3_M0_BUDGET_ENABLED", "0")
    import plugins.spike_p3_m0_budget as mod

    monkeypatch.setattr(mod, "_ENABLED", False)
    _write_profile(tmp_path, daily=100)
    # 即使 profile.yaml 有 tenant + budget · disabled 状态不 raise
    on_pre_api_request(api_request_id="req_off", approx_input_tokens=1000, max_tokens=1000)
    on_post_api_request(api_request_id="req_off", usage={"prompt_tokens": 500})
    assert get_daily_used("t_test") == 0
