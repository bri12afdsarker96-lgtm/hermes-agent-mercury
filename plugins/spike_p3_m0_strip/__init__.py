"""P3-M0 Spike · strip-sources prototype(exit ① 普通最终响应).

**范围严守**(见 `../spike-p3-m0-fixtures/README.md` 与 Hermes_AI 侧
`docs/fork/strip-contract.md`):

- 仅覆盖出口 ① `transform_llm_output` @ `agent/turn_finalizer.py:561`
- streaming/interim/interrupt/history-replay/tool-result 各出口 fixture 冻结
  · **本 spike 不实装**
- `_sanitize_surrogates`(fresh baseline 已在 turn_finalizer 内)独立于本 hook
  · 顺序上 sanitize 后于 transform_llm_output · 二者协同不干扰
- raw canonical transcript 完全不改(finalizer 已在 :317/:333 写入原文)
- 无第三方 plugin 冲突:hook 返回 non-None str 首个胜出 · 本 plugin 无 None 短路

**不是** C4 单点方案(只覆盖 5 出口之 1)。M0 首轮证据 + 契约冻结 · 不称 C4 兑现。
"""
from __future__ import annotations

import logging
from typing import Any, Optional

from . import sanitize as _sanitize_mod   # module reference · 供 monkeypatch fail-open 测试

logger = logging.getLogger(__name__)


def on_transform_llm_output(
    *,
    response_text: str,
    session_id: str = "",
    model: str = "",
    platform: str = "",
    **_kwargs: Any,
) -> Optional[str]:
    """Return stripped text · None if unchanged.

    Hook contract(`hermes_cli/plugins.py::VALID_HOOKS`):
      - First non-empty str return wins across all plugins consuming this hook.
      - None / empty str leaves `final_response` unchanged.
      - Fired at `agent/turn_finalizer.py:561`.
    """
    try:
        stripped = _sanitize_mod.sanitize_presentation(response_text or "", mode="final")
    except Exception as exc:  # noqa: BLE001 — fail-open · never break chat
        logger.warning("spike-p3-m0-strip on_transform_llm_output failed: %s", exc)
        return None
    if stripped == (response_text or ""):
        return None  # 无改动 · 保留
    return stripped


def register(ctx: Any) -> None:
    """PluginContext hook · called at plugin discovery."""
    ctx.register_hook("transform_llm_output", on_transform_llm_output)
