"""P3-M0 Spike · tenant budget prototype(pre/post_api_request · T2 · fail-open).

**范围严守**(见 Hermes_AI 侧 `docs/fork/budget-hook.md`):

- Reserve @ `pre_api_request` @ `agent/conversation_loop.py:2586`
- Settle  @ `post_api_request` @ `agent/conversation_loop.py:6114`
- **明令删除**:`HERMES_DAILY_TOKEN_BUDGET` 冒充 per-tenant budget
- **T2 首选**:tenant-per-process/profile · 从 `HERMES_HOME/profile.yaml` 读
  `tenant.daily_budget_tokens` · 非用户可见 env
- **fail-open**:context 缺失 · 不 reserve · 不 settle · 不阻断 chat · 不声称多租户已启用
- cache hit(response 带 `cache_meta.hit=True`)· settle 时不扣(reservation 已在 pre 阶段
  发生 · 但可选:M0 spike 简化为 pre 只在 middleware short-circuit 前判断)

**M0 首轮 spike 实装**:
- `_get_tenant_budget_context()` 从 profile.yaml 读
- module-level `_tenant_budget_bucket`(简 dict · 单进程 · 非 persistent)
- reserve / settle 契约
- BudgetExceeded exception

**M0 首轮 spike 不做**:
- 生产接线 fork core · plugin ctx.register_hook 已挂 · 但 fork core 需装配 `hermes tools` 类似方式启用
- CAS · 跨进程 budget 同步
- Hermes_AI SQL sync(等 M1+ · 走 out-of-band gateway sync)
"""
from __future__ import annotations

import logging
import os
import threading
from pathlib import Path
from typing import Any, Dict, Optional

logger = logging.getLogger(__name__)

BUDGET_CONTRACT_VERSION = "v1"


class BudgetExceeded(RuntimeError):
    """租户预算超支 · 阻断本次 API 调用。"""


# ── Module state · 单进程 · 非 persistent(M0) ──

_lock = threading.Lock()
_reservations: Dict[str, Dict[str, Any]] = {}   # api_request_id → {tenant_id, tokens}
_daily_used: Dict[str, int] = {}   # tenant_id → tokens_used_today(no daily reset · M0 spike)

_ENABLED = os.environ.get("SPIKE_P3_M0_BUDGET_ENABLED", "0") == "1"


def _get_tenant_budget_context() -> Optional[Dict[str, Any]]:
    """T2 · 从 HERMES_HOME/profile.yaml 读 tenant + budget。

    Returns dict with: tenant_id, daily_budget_tokens(int|None), budget_contract_version
    """
    hermes_home_env = os.environ.get("HERMES_HOME")
    if not hermes_home_env:
        return None
    profile_path = Path(hermes_home_env) / "profile.yaml"
    if not profile_path.exists():
        return None
    try:
        import yaml   # type: ignore

        raw = yaml.safe_load(profile_path.read_text(encoding="utf-8")) or {}
    except Exception as exc:   # noqa: BLE001
        logger.warning("spike-budget: profile.yaml read failed: %s", exc)
        return None
    tenant_block = raw.get("tenant") or {}
    tid = tenant_block.get("tenant_id")
    if not tid:
        return None
    daily = tenant_block.get("daily_budget_tokens")
    if daily is not None:
        try:
            daily = int(daily)
        except (TypeError, ValueError):
            daily = None
    return {
        "tenant_id": str(tid),
        "daily_budget_tokens": daily,
        "budget_contract_version": BUDGET_CONTRACT_VERSION,
    }


# ── Hook callbacks ──


def on_pre_api_request(
    *,
    task_id: str = "",
    turn_id: str = "",
    api_request_id: str = "",
    session_id: str = "",
    platform: str = "",
    model: str = "",
    provider: str = "",
    base_url: str = "",
    api_mode: str = "",
    api_call_count: int = 0,
    retry_count: int = 0,
    request_messages: Any = None,
    message_count: int = 0,
    tool_count: int = 0,
    approx_input_tokens: int = 0,
    request_char_count: int = 0,
    max_tokens: int = 0,
    started_at: float = 0.0,
    middleware_trace: Any = None,
    request: Any = None,
    **_ctx: Any,
) -> None:
    """Reserve tokens against tenant daily budget.

    Fail-open policy(§4 budget-hook.md):
    - `_ENABLED` False → skip
    - no tenant context → skip · **不声称多租户已启用**
    - no daily_budget set → skip
    - reservation exceeds budget → raise `BudgetExceeded`(fail-close · 阻断)
    """
    if not _ENABLED or not api_request_id:
        return
    ctx = _get_tenant_budget_context()
    if not ctx or ctx.get("daily_budget_tokens") is None:
        return
    tid = ctx["tenant_id"]
    budget = ctx["daily_budget_tokens"]
    tokens_needed = int(approx_input_tokens or 0) + int(max_tokens or 0)
    with _lock:
        used = _daily_used.get(tid, 0)
        if used + tokens_needed > budget:
            raise BudgetExceeded(
                f"tenant {tid} daily budget exhausted "
                f"(used={used}, need={tokens_needed}, budget={budget})"
            )
        _reservations[api_request_id] = {"tenant_id": tid, "tokens": tokens_needed}


def on_post_api_request(
    *,
    task_id: str = "",
    turn_id: str = "",
    api_request_id: str = "",
    session_id: str = "",
    platform: str = "",
    model: str = "",
    provider: str = "",
    base_url: str = "",
    api_mode: str = "",
    api_call_count: int = 0,
    api_duration: float = 0.0,
    started_at: float = 0.0,
    ended_at: float = 0.0,
    finish_reason: str = "",
    message_count: int = 0,
    response_model: Any = None,
    response: Any = None,
    usage: Any = None,
    assistant_message: Any = None,
    assistant_content_chars: int = 0,
    assistant_tool_call_count: int = 0,
    **_ctx: Any,
) -> None:
    """Settle actual usage(usage 已 canonicalized by fork · conversation_loop:3437-3448)。

    Cache hit(response 带 `cache_meta.hit=True`)· settle 不扣(reservation 已 pop)。
    """
    if not api_request_id:
        return
    with _lock:
        reservation = _reservations.pop(api_request_id, None)
    if not reservation:
        return
    # Cache hit 保护:若 response 是 cache hit · 不 charge actual usage
    is_cache_hit = False
    if isinstance(response, dict):
        cache_meta = response.get("cache_meta") or {}
        is_cache_hit = bool(cache_meta.get("hit"))
    if is_cache_hit:
        return   # cache hit · reserve 归零 · 不 charge
    actual = 0
    if isinstance(usage, dict):
        actual = int(usage.get("prompt_tokens", 0) or 0) + int(usage.get("completion_tokens", 0) or 0)
    with _lock:
        _daily_used[reservation["tenant_id"]] = _daily_used.get(reservation["tenant_id"], 0) + actual


# ── Spike helpers · 测试用 ──


def reset_state() -> None:
    with _lock:
        _reservations.clear()
        _daily_used.clear()


def get_daily_used(tenant_id: str) -> int:
    return _daily_used.get(tenant_id, 0)


def register(ctx: Any) -> None:
    ctx.register_hook("pre_api_request", on_pre_api_request)
    ctx.register_hook("post_api_request", on_post_api_request)
