"""Presentation-boundary sanitizer(spike · mode="final" 实装 · 其他 skeleton).

**向后兼容基线**:Hermes_AI `hermes_devices/ops/audit.py::strip_sources`
(charter C4 · fixture SHA-256 双仓锁死)

**Codex §VI 契约**:
- 只 strip 明确的 `[source|来源: ...]` / `【来源:...】` / 独立行 `source:` `来源:`
- 允许一层嵌套中文括号(与 Hermes_AI 一致)
- **不得**无条件 strip 裸 `[N]`(需结构化 sources metadata 配对 · 本 M0 spike 不做)
- 未闭合标记不吞下一行
- **fail-closed** on sanitizer exception:返回安全占位 · **不**返回原文

**冻结 · pending 出口**:
- mode="streaming":skeleton pass-through(pending · S1 完整缓冲 · M1+)
- mode="history":skeleton pass-through(pending · presentation boundary · M1+)
- mode="interim":skeleton pass-through(pending · M1+)
- mode="tool":skeleton pass-through(pending · M1+)
"""
from __future__ import annotations

import re

# ── 向后兼容 Hermes_AI ops/audit.py::_INLINE_RE ──────────────────────────
# 匹配 [source: ...] / [来源: ...] / 【来源:...】 / (source: ...) 等 ·
# 允许一层嵌套中文/半角括号(如 [来源: FAQ(2026版)]).
_INLINE_SOURCE_RE = re.compile(
    r"\s?[\[【（(]\s*(?:source|来源)\s*[:：]"
    r"(?:[^\[\]【】（）()\n]|[（(][^（）()\n]*[）)]|[\[【][^\[\]【】\n]*[\]】])*"
    r"[\]】）)]",
    re.IGNORECASE,
)

# ── 独立行 `source:` / `来源:` · 整行(含换行)移除 ──────────────────────
_LINE_SOURCE_RE = re.compile(
    r"^[ \t]*(?:source|来源)\s*[:：].*$",
    re.IGNORECASE | re.MULTILINE,
)

# ── Trailing whitespace / 连续空行清理(sub 完的后处理)──────────────
_TRAILING_WS_RE = re.compile(r"[ \t]+(?=\n|$)")
_MULTI_NEWLINE_RE = re.compile(r"\n{3,}")


class SanitizerError(RuntimeError):
    """Sanitizer 内部错误 · 触发 fail-closed(见 hook `__init__.py`)。"""


def sanitize_presentation(text: str, *, mode: str) -> str:
    """Strip source markers · 按 mode 返回 sanitized text.

    M0 首轮:仅实装 mode="final"。其他 mode 返回原字符串(skeleton pass-through ·
    fixture present · implementation pending)。
    """
    if mode != "final":
        return text
    return _sanitize_final(text)


def _sanitize_final(text: str) -> str:
    """出口 ① · 普通最终响应 sanitize · Hermes_AI ops/audit.py 兼容。"""
    if not text:
        return text
    out = _INLINE_SOURCE_RE.sub("", text)
    out = _LINE_SOURCE_RE.sub("", out)
    # 清理 sub 留下的行尾空格 · 3+ 连续空行合并为 2
    out = _TRAILING_WS_RE.sub("", out)
    out = _MULTI_NEWLINE_RE.sub("\n\n", out)
    # 清理结果末尾空行(与 Hermes_AI baseline 一致)
    return out.rstrip()
