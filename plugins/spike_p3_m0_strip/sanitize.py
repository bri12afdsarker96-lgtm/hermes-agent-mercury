"""Presentation-boundary sanitizer(spike · mode="final" 实装 · 其他 skeleton).

**向后兼容基线(有明确增强 · 见"差异说明")**:
- Hermes_AI `hermes_devices/ops/audit.py::strip_sources`(charter C4 · fixture SHA-256 双仓锁死)

**Codex §VI 契约**:
- 只 strip 明确的 `[source|来源: ...]` / `【来源:...】` / 独立行 `source:` `来源:`
- 允许一层嵌套中文括号(与 Hermes_AI 一致)
- **不得**无条件 strip 裸 `[N]`(需结构化 sources metadata 配对 · 本 M0 spike 不做)
- 未闭合标记不吞下一行
- **fail-closed** on sanitizer exception:返回安全占位 · **不**返回原文

**与 Hermes_AI baseline 的差异(Codex 第三轮 §VI · 明文锁定)**:

fork sanitizer 相对 baseline 做了两处**用户体验增强**,由 differential test 锁死:

| 差异 | Hermes_AI baseline | fork sanitizer | 用户可见效果 |
|---|---|---|---|
| `_INLINE_SOURCE_RE` 前导 | `[\[【（(]...`(不吃前导空白) | `\s?[\[【（(]...`(吃 1 个前导空白) | `"Answer [source:x]." → baseline: "Answer ." · fork: "Answer."` |
| 结果末尾清理 | `.strip()`(掐首尾空白) | `.rstrip()`(仅掐尾) | 保留首行 indentation(如 `"  Answer"`)· 只去尾空 |

**契约锁定**:
- baseline strip 的每个 source marker · fork 也必须 strip(**覆盖包含关系**)
- baseline 不 strip 的(negative case)· fork 也不 strip(**负例一致**)
- 差异**仅**在于两点 UX 增强(前导空白、尾空白)· 由
  `tests/test_strip_differential_vs_hermes_ai.py` 一一断言

**冻结 · pending 出口**:
- mode="streaming":skeleton pass-through(pending · S1 完整缓冲 · M1+)
- mode="history":skeleton pass-through(pending · presentation boundary · M1+)
- mode="interim":skeleton pass-through(pending · M1+)
- mode="tool":skeleton pass-through(pending · M1+)
"""
from __future__ import annotations

import re

# ── 与 Hermes_AI ops/audit.py::_INLINE_RE 差 1 个前导 `\s?` ─────────────
# body class 完全一致 · 允许一层嵌套中文/半角括号(如 [来源: FAQ(2026版)]).
_INLINE_SOURCE_RE = re.compile(
    r"\s?[\[【（(]\s*(?:source|来源)\s*[:：]"
    r"(?:[^\[\]【】（）()\n]|[（(][^（）()\n]*[）)]|[\[【][^\[\]【】\n]*[\]】])*"
    r"[\]】）)]",
    re.IGNORECASE,
)

# ── 独立行 `source:` / `来源:` · 整行(含换行)移除 · 与 baseline 完全一致 ─
_LINE_SOURCE_RE = re.compile(
    r"^[ \t]*(?:source|来源)\s*[:：].*$",
    re.IGNORECASE | re.MULTILINE,
)

# ── Trailing whitespace / 连续空行清理(sub 完的后处理 · 与 baseline 一致)─
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
    """出口 ① · 普通最终响应 sanitize · Hermes_AI ops/audit.py 兼容 + UX 增强。"""
    if not text:
        return text
    out = _INLINE_SOURCE_RE.sub("", text)
    out = _LINE_SOURCE_RE.sub("", out)
    # 清理 sub 留下的行尾空格 · 3+ 连续空行合并为 2
    out = _TRAILING_WS_RE.sub("", out)
    out = _MULTI_NEWLINE_RE.sub("\n\n", out)
    # rstrip 而非 strip:保留首行 indentation(见模块 docstring "差异说明")
    return out.rstrip()
