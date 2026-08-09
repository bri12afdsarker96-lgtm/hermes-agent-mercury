"""Presentation-boundary sanitizer(spike 骨架 · 只实装 mode="final")。

**冻结契约**(见 Hermes_AI 侧 `docs/fork/strip-contract.md` §6):

```
sanitize_presentation(text: str, *, mode: str) -> str
    mode:
      - "final"     : 出口 ① `transform_llm_output`(**M0 首轮实装**)
      - "history"   : 出口 ④ session.resume/list(fixture 冻结 · 不实装)
      - "streaming" : 出口 ② 缓冲后 sanitize(fixture 冻结 · 不实装)
      - "interim"   : 出口 ③ interim_assistant_callback wrap(fixture 冻结)
      - "tool"      : 出口 ⑤ transform_tool_result(fixture 冻结)
```

**策略**(见 strip-contract §4):
- streaming 默认完整缓冲后 sanitize(牺牲实时性 · 保零泄漏)· 有状态 parser 是
  M2+ 优化项 · 必须通过每字节切分点 + Unicode 边界 + interrupt 未闭合测试
- final mode 只针对完整字符串 · 无跨 chunk 复杂性
"""
from __future__ import annotations

import re

# ── 3 种常见 citation 形态(见 fixture citation_cases.py NORMAL_FINAL) ──

# 1. inline `[N]` `[N][M]` 形态 · 移除包括前置单空格
_INLINE_CITATION_RE = re.compile(r" ?\[\d+\](?:\[\d+\])*")

# 2. fenced `<sources>...</sources>` 块 · 整块移除(含前后空行)
_FENCED_SOURCES_RE = re.compile(
    r"\n{0,2}<sources>[\s\S]*?</sources>\n?",
    re.MULTILINE,
)


def sanitize_presentation(text: str, *, mode: str) -> str:
    """Strip citation / source markers · 按 mode 返回 sanitized text.

    M0 首轮:仅实装 mode="final"。其他 mode 返回原字符串(不改)· 契约冻结 · 待
    M1+ 分阶段实装。
    """
    if mode != "final":
        return text
    return _sanitize_final(text)


def _sanitize_final(text: str) -> str:
    """出口 ① · 普通最终响应 sanitize。"""
    if not text:
        return text
    # 先移 fenced · 避免 fenced 内 `[N]` 被 inline 规则误命中(应整块删)
    stripped = _FENCED_SOURCES_RE.sub("", text)
    stripped = _INLINE_CITATION_RE.sub("", stripped)
    # 收尾 trailing whitespace(移 citation 后可能留)
    return stripped.rstrip()
