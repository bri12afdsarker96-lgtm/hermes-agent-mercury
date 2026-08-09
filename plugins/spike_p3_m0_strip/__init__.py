"""P3-M0 Spike · strip-sources prototype(exit ① 普通最终响应).

**Codex §VI fail-closed 契约**:
- sanitizer 异常 → 返回**安全占位** · 记录 audit · **不**返回 None(否则原文透出)
- 无改动 · 返回 None(标准 hook "first non-None str wins" 契约)

**范围**:
- 仅出口 ① `transform_llm_output` @ `agent/turn_finalizer.py:561`
- streaming/interim/interrupt/history-replay/tool-result 五出口 fixture 冻结
  · **本 spike 不实装**(fixture present · implementation pending)
- `_sanitize_surrogates`(fresh baseline turn_finalizer 已加)独立 · 不冲突

**插件启用**:通过 fork `config.yaml` 的 `plugins.enabled` 列表 · **不**用 env。
"""
from __future__ import annotations

import logging
from typing import Any, Optional

from . import sanitize as _sanitize_mod   # module reference · 供 monkeypatch fail-closed 测试

logger = logging.getLogger(__name__)

# fail-closed 占位 · 出现 sanitizer 崩时返回 · 提示用户重试
FAIL_CLOSED_PLACEHOLDER = (
    "[response filtered · sanitizer error · please retry]"
)


def on_transform_llm_output(
    *,
    response_text: str,
    session_id: str = "",
    model: str = "",
    platform: str = "",
    **_kwargs: Any,
) -> Optional[str]:
    """`transform_llm_output` hook · fail-closed on sanitizer exception.

    Contract(`hermes_cli/plugins.py::VALID_HOOKS`):
      - 返回 non-empty str → 覆盖 `final_response`(first-wins 跨 plugins)
      - 返回 None / "" → 保留 `final_response` 不变

    Codex §VI · fail-closed 补丁:
      - 无异常 · 无改动 → 返回 None
      - 无异常 · 有改动 → 返回 stripped str
      - 异常 → 返回 `FAIL_CLOSED_PLACEHOLDER`(**不返回原文**)· 记录 audit
    """
    text = response_text or ""
    try:
        stripped = _sanitize_mod.sanitize_presentation(text, mode="final")
    except Exception as exc:  # noqa: BLE001 — fail-closed · 拒原文泄漏
        logger.error(
            "spike-p3-m0-strip: sanitizer FAILED · fail-closed (session_id=%s model=%s platform=%s): %s",
            session_id, model, platform, exc,
        )
        # audit event · 便于监控告警
        _emit_audit(
            event="strip.sanitizer_failed",
            session_id=session_id,
            model=model,
            platform=platform,
            error_class=type(exc).__name__,
        )
        return FAIL_CLOSED_PLACEHOLDER
    if stripped == text:
        return None   # 无改动
    return stripped


def _emit_audit(**payload: Any) -> None:
    """轻量 audit hook · 通过 lifecycle invoke_hook 触发观察者(如 langfuse/nemo_relay)。"""
    try:
        from hermes_cli.lifecycle import invoke_hook

        invoke_hook("api_request_error", **payload)   # 复用现有 API error 通道
    except Exception:   # noqa: BLE001 — audit never breaks hook
        pass


def register(ctx: Any) -> None:
    """PluginContext hook · called at plugin discovery."""
    ctx.register_hook("transform_llm_output", on_transform_llm_output)
