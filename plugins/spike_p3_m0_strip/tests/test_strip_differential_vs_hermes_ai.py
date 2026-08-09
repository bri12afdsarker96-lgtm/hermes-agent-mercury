"""P3-M0 · fork sanitizer vs Hermes_AI baseline · differential contract lock.

**Codex 第三轮 §VI 强制**:
- fork sanitizer 与 Hermes_AI `ops/audit.py::strip_sources` 差异**必须**明文锁定
- 差异**仅**允许:①`\s?` 前导空白吸收 · ②`.rstrip()` 保留首行 indentation
- 覆盖包含关系:baseline strip 的 · fork 必 strip
- 负例一致:baseline 保留的 · fork 必保留
- baseline 源字符串 verbatim byte-check(飘移即失败)
"""
from __future__ import annotations

import pytest

from plugins.spike_p3_m0_fixtures import hermes_ai_baseline
from plugins.spike_p3_m0_fixtures.citation_cases import ALL_CASES, cases_by_marker
from plugins.spike_p3_m0_strip.sanitize import (
    _INLINE_SOURCE_RE,
    _LINE_SOURCE_RE,
    sanitize_presentation,
)


# ── 1. baseline 源字符串 verbatim byte-check ────────────────────


def test_baseline_regex_verbatim():
    """Vendored baseline 与 Hermes_AI 源必须 byte-identical(source of truth 门)。

    这两个模式串直接从 `hermes_devices/ops/audit.py::_INLINE_RE._LINE_RE.pattern`
    抄写 · 若上游修改 · 本测试**必须**先失败提醒同步 vendor。
    """
    expected_inline = (
        r"[\[【（(]\s*(?:source|来源)\s*[:：]"
        r"(?:[^\[\]【】（）()\n]|[（(][^（）()\n]*[）)]|[\[【][^\[\]【】\n]*[\]】])*"
        r"[\]】）)]"
    )
    expected_line = r"^[ \t]*(?:source|来源)\s*[:：].*$"
    assert hermes_ai_baseline.BASELINE_INLINE_PATTERN == expected_inline, (
        "vendored baseline INLINE pattern drifted · resync from Hermes_AI "
        "hermes_devices/ops/audit.py::_INLINE_RE.pattern"
    )
    assert hermes_ai_baseline.BASELINE_LINE_PATTERN == expected_line, (
        "vendored baseline LINE pattern drifted · resync from Hermes_AI "
        "hermes_devices/ops/audit.py::_LINE_RE.pattern"
    )


# ── 2. Fork inline pattern = baseline + `\s?` 前导 ────────────


def test_fork_inline_pattern_is_baseline_plus_leading_space():
    """fork `_INLINE_SOURCE_RE` = `\\s?` + baseline INLINE pattern(严格锁定)。"""
    assert _INLINE_SOURCE_RE.pattern == r"\s?" + hermes_ai_baseline.BASELINE_INLINE_PATTERN


def test_fork_line_pattern_equals_baseline():
    """fork `_LINE_SOURCE_RE` = baseline LINE pattern(**完全一致**)。"""
    assert _LINE_SOURCE_RE.pattern == hermes_ai_baseline.BASELINE_LINE_PATTERN


# ── 3. 覆盖包含关系:baseline strip 的 · fork 必 strip ─────────


_SOURCE_MARKER_LEFT_BRACKETS = ("[source", "[来源", "[SOURCE", "[Source",
                                 "【source", "【来源", "（source", "(source",
                                 "（来源", "(来源")


def _has_source_marker(text: str) -> bool:
    """Detect any remaining `source:` / `来源:` inline marker(differential coverage)."""
    lowered = text.lower()
    for prefix in ("[source", "[来源", "【source", "【来源", "（source", "(source",
                   "（来源", "(来源"):
        if prefix.lower() in lowered:
            return True
    return False


@pytest.mark.parametrize(
    "case",
    [c for c in ALL_CASES if c.mode == "final" and c.marker_type != "negative"],
    ids=lambda c: c.name,
)
def test_fork_strips_everything_baseline_strips(case):
    """Positive case:baseline 移除的每个 marker · fork 也必移除(**覆盖包含关系**)。

    契约锁定的两点断言(§VI):
      A. 两侧输出**均无** source marker 残留(覆盖完整性)
      B. 两侧输出去除**所有空白**后 byte-identical(差异仅在空白 · UX 增强范围内)
    """
    baseline_out = hermes_ai_baseline.strip_sources(case.raw)
    fork_out = sanitize_presentation(case.raw, mode="final")

    # A. 覆盖完整性(仅对 baseline 实际 strip 的 case 生效)
    # 未闭合标记(§VI:不吞下一行)· baseline 与 fork 均保留 · 跳过此断言
    if baseline_out != case.raw:
        assert not _has_source_marker(baseline_out), (
            f"case={case.name} · baseline 输出仍含 source marker · fixture 缺失或 baseline drift · "
            f"baseline={baseline_out!r}"
        )
        assert not _has_source_marker(fork_out), (
            f"case={case.name} · fork 输出仍含 source marker · 覆盖不完整 · fork={fork_out!r}"
        )

    # B. 差异仅在空白(核心保证:内容 byte-identical after \s+ 剥离)
    import re as _re
    baseline_nowhite = _re.sub(r"\s+", "", baseline_out)
    fork_nowhite = _re.sub(r"\s+", "", fork_out)
    assert baseline_nowhite == fork_nowhite, (
        f"case={case.name} · fork 与 baseline 在去除空白后仍不 byte-identical\n"
        f"  raw:      {case.raw!r}\n"
        f"  baseline: {baseline_out!r}\n"
        f"  fork:     {fork_out!r}\n"
        f"  baseline_nowhite: {baseline_nowhite!r}\n"
        f"  fork_nowhite:     {fork_nowhite!r}\n"
        "差异必须限于 §VI 声明的两点(前导空白、首尾空白)· "
        "否则更新 sanitize.py 或 fixture · 双仓 PR body 同步"
    )


# ── 4. Negative case 一致性:baseline 不 strip · fork 也不 strip ─


@pytest.mark.parametrize("case", cases_by_marker("negative"), ids=lambda c: c.name)
def test_negative_cases_identical(case):
    """Negative case:baseline 与 fork 都必须原样保留(strict equality)。"""
    baseline_out = hermes_ai_baseline.strip_sources(case.raw)
    fork_out = sanitize_presentation(case.raw, mode="final")
    assert baseline_out == case.raw, (
        f"baseline unexpectedly stripped negative case {case.name!r} · "
        f"raw={case.raw!r} baseline={baseline_out!r}"
    )
    assert fork_out == case.raw, (
        f"fork unexpectedly stripped negative case {case.name!r} · "
        f"raw={case.raw!r} fork={fork_out!r}"
    )


# ── 5. UX 差异边界样例(明文示例断言) ─────────────────────────


def test_ux_diff_inline_leading_space():
    """UX 差异 ①:`\\s?` 前导空白吸收 · 单空格样例。"""
    raw = "Answer is X [source: doc]."
    assert hermes_ai_baseline.strip_sources(raw) == "Answer is X ."
    assert sanitize_presentation(raw, mode="final") == "Answer is X."


def test_ux_diff_preserves_leading_indent():
    """UX 差异 ②:`.rstrip()` 保留首行 indentation。"""
    raw = "  Answer with [source: x]"
    assert hermes_ai_baseline.strip_sources(raw) == "Answer with"   # baseline .strip()
    assert sanitize_presentation(raw, mode="final") == "  Answer with"   # fork .rstrip()
