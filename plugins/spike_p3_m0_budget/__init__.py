"""P3-M0 Spike · tenant budget service module(no hooks · used by cache orchestrator).

**Codex §I / §V 契约**:
- **不**通过 `pre_api_request` 抛 BudgetExceeded(生产调用点会吞异常)
- 由 `spike_p3_m0_cache` 注册的 `llm_execution` middleware 内部按序调用:
  cache lookup → miss → **budget reserve** → next_call → success settle actual /
  exception release reservation
- `pre_api_request/post_api_request` 只做观察 audit(见 __init__.py 底部可选注册)

**4 态 budget**(与 Hermes_AI P2-0.1 一致):
- 缺失(config 无 `tenant.daily_budget_tokens` 键)· 不启用租户 budget
- `null`(显式 None)· 不启用(provisioning 明确无限期不 enforce · 与 0 区分)
- `0`(显式 int 0)· 显式无限 · reserve 恒 True · used 仍计
- `>0`(int)· 具体上限
- **拒**:bool / 负数 / str / float · 抛 `BudgetConfigError` · enforcement 上层必须 fail-CLOSED

**UTC daily bucket**:key = (tenant_id, utc_date_str) · 天粒度 · pending reservations 与
used 一起判断超支。

**并发**:threading.Lock · reserve/settle/release 全序 · api_request_id 唯一.
"""
from __future__ import annotations

import datetime
import logging
import threading
from typing import Any, Dict, Optional

logger = logging.getLogger(__name__)

BUDGET_CONTRACT_VERSION = "v1"


class BudgetExceeded(RuntimeError):
    """租户预算超支 · **不由 hook 抛** · 由 llm_execution middleware 内部捕获转 audit。"""


class BudgetConfigError(ValueError):
    """budget 配置字段类型/值非法 · 由 orchestrator 硬 fail-CLOSED(**不**再静默转 None)。"""


class BudgetSettleError(RuntimeError):
    """settle/release 在无 reservation 上被调用 · **不改** used(严格幂等)。

    Codex 第三轮 §IV:settle 必须仅结算仍存在的 reservation;unknown/double settle
    不得增加 used。抛此异常供 orchestrator 记 audit 但不阻断。
    """


# ── Module state · 单进程 · 非 persistent ─────────────────────────────

_lock = threading.RLock()   # reentrant · reserve/settle 内部可能连续调用
# 天粒度桶 · key = (tenant_id, "YYYY-MM-DD" UTC) · value = { "used": int, "reservations": {req_id: tokens} }
_bucket: Dict[str, Dict[str, Any]] = {}
# Active reservations must remember the UTC bucket in which they were created.
# A provider call can cross midnight; settle/release must then touch the original
# bucket instead of leaking the reservation in yesterday's ledger.
_reservation_bucket: Dict[tuple[str, str], str] = {}


def _today_utc() -> str:
    """UTC 日期字符串 · YYYY-MM-DD 格式 · 天粒度 bucket key。"""
    return datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%d")


def _bucket_key(tenant_id: str, utc_date: Optional[str] = None) -> str:
    return f"{tenant_id}::{utc_date or _today_utc()}"


def _get_or_create_bucket_by_key(key: str) -> Dict[str, Any]:
    b = _bucket.get(key)
    if b is None:
        b = {"used": 0, "reservations": {}}
        _bucket[key] = b
    return b


def _get_or_create_bucket(tenant_id: str) -> Dict[str, Any]:
    return _get_or_create_bucket_by_key(_bucket_key(tenant_id))


# ── 4 态 budget validation ───────────────────────────────────────────

def validate_daily_budget(value: Any) -> Optional[int]:
    """校验 config `tenant.daily_budget_tokens` 字段 · 返回归一化 int | None。

    None → None(未启用)
    0    → 0(显式无限)
    正整数 → 正整数
    bool / 负数 / str / float → raise BudgetConfigError · enforcement 上层必须
    返回结构化 fail-CLOSED response，禁止转换为 None 后继续 provider 调用。
    """
    if value is None:
        return None
    # bool 是 int 子类 · 必须先拒
    if isinstance(value, bool):
        raise BudgetConfigError(f"daily_budget_tokens type=bool 非法 · got {value!r}")
    if not isinstance(value, int):
        raise BudgetConfigError(f"daily_budget_tokens 需 int · got {type(value).__name__} {value!r}")
    if value < 0:
        raise BudgetConfigError(f"daily_budget_tokens 需 >=0 · got {value}")
    return value


# ── Reserve / Settle / Release · 由 orchestrator middleware 调用 ─────

def reserve(tenant_id: str, api_request_id: str, tokens_needed: int, *, budget: Optional[int]) -> None:
    """尝试预留 · 超预算 raise BudgetExceeded · budget=None 直接 no-op(未启用)。

    `budget=0` 是显式无限 · reserve 恒成功 · used 仍会累加供审计观察。
    """
    if not api_request_id:
        raise BudgetExceeded("reserve: empty api_request_id · 拒绝 anonymous 预留")
    if tokens_needed < 0:
        tokens_needed = 0
    if budget is None:
        return   # 未启用
    with _lock:
        reservation_key = (tenant_id, api_request_id)
        # api_request_id 在该 tenant 的所有活跃 UTC bucket 中唯一。
        if reservation_key in _reservation_bucket:
            raise BudgetExceeded(
                f"reserve: api_request_id={api_request_id!r} already reserved · duplicate"
            )
        bucket_key = _bucket_key(tenant_id)
        b = _get_or_create_bucket_by_key(bucket_key)
        pending_total = sum(b["reservations"].values())
        # budget=0 无限 · used + pending + new 不做上限比较
        if budget > 0:
            projected = b["used"] + pending_total + tokens_needed
            if projected > budget:
                raise BudgetExceeded(
                    f"tenant {tenant_id} daily budget exhausted "
                    f"(used={b['used']}, pending={pending_total}, need={tokens_needed}, budget={budget})"
                )
        b["reservations"][api_request_id] = tokens_needed
        _reservation_bucket[reservation_key] = bucket_key


def settle(tenant_id: str, api_request_id: str, actual_tokens: int) -> None:
    """结算实际用量 · **仅结算仍存在的 reservation** · 累加 used。

    Codex 第三轮 §IV(**严格幂等**):
    - 若 reservation 存在 · 移除并累加 used
    - 若 reservation 不存在(未 reserve / double settle / release 后 settle):
      **不改** used · raise BudgetSettleError · 由 orchestrator 记 audit
    """
    if actual_tokens < 0:
        actual_tokens = 0
    with _lock:
        reservation_key = (tenant_id, api_request_id)
        bucket_key = _reservation_bucket.get(reservation_key)
        if bucket_key is None:
            raise BudgetSettleError(
                f"settle: no reservation for api_request_id={api_request_id!r} · "
                "double settle or missing reserve"
            )
        b = _get_or_create_bucket_by_key(bucket_key)
        if api_request_id not in b["reservations"]:
            # The index and bucket must move atomically under the same lock.
            _reservation_bucket.pop(reservation_key, None)
            raise BudgetSettleError(
                f"settle: reservation index corrupt for api_request_id={api_request_id!r}"
            )
        b["reservations"].pop(api_request_id)
        _reservation_bucket.pop(reservation_key, None)
        b["used"] = b["used"] + actual_tokens


def release(tenant_id: str, api_request_id: str) -> bool:
    """异常 / cancel / timeout 路径 · 释放 reservation · 不计 used。

    Codex 第三轮 §IV(**幂等**):
    - 若 reservation 存在 · 移除 · 返回 True
    - 若 reservation 不存在 · **no-op** · 返回 False(便于 orchestrator 检测 double release)
    - 任何情况下 · used 不变
    """
    with _lock:
        reservation_key = (tenant_id, api_request_id)
        bucket_key = _reservation_bucket.pop(reservation_key, None)
        if bucket_key is None:
            return False
        b = _get_or_create_bucket_by_key(bucket_key)
        return b["reservations"].pop(api_request_id, None) is not None


# ── 观察 helpers · 测试用 ─────────────────────────────────────────────

def get_used(tenant_id: str) -> int:
    with _lock:
        return _get_or_create_bucket(tenant_id)["used"]


def get_pending_total(tenant_id: str) -> int:
    with _lock:
        return sum(_get_or_create_bucket(tenant_id)["reservations"].values())


def get_reservation(tenant_id: str, api_request_id: str) -> Optional[int]:
    with _lock:
        bucket_key = _reservation_bucket.get((tenant_id, api_request_id))
        if bucket_key is None:
            return None
        return _get_or_create_bucket_by_key(bucket_key)["reservations"].get(api_request_id)


def reset_state() -> None:
    """测试用 · 清空全部 bucket。"""
    with _lock:
        _bucket.clear()
        _reservation_bucket.clear()


# ── register: 只挂 observer hooks · 无 enforcement · 无 middleware ────

def _on_pre_api_request_observer(**_kwargs: Any) -> None:
    """观察者:reserve 已由 orchestrator middleware 完成 · 此 hook 无 enforcement。"""
    return


def _on_post_api_request_observer(**_kwargs: Any) -> None:
    """观察者:settle 已由 orchestrator middleware 完成 · 此 hook 无 enforcement。"""
    return


def register(ctx: Any) -> None:
    """PluginContext register · 只挂观察 hooks · 不含 enforcement。

    真实 enforcement 在 `spike_p3_m0_cache` 注册的 `llm_execution` middleware 内。
    """
    ctx.register_hook("pre_api_request", _on_pre_api_request_observer)
    ctx.register_hook("post_api_request", _on_post_api_request_observer)
