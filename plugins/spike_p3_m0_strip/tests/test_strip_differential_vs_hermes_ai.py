r"""P3-M0 · fork sanitizer vs Hermes_AI baseline · differential contract lock.

**Codex 第三轮 §VI 强制**:
- fork sanitizer 与 Hermes_AI `ops/audit.py::strip_sources` 差异**必须**明文锁定
- 差异**仅**允许:①`\s?` 前导空白吸收 · ②`.rstrip()` 保留首行 indentation
- 覆盖包含关系:baseline strip 的 · fork 必 strip
- 负例一致:baseline 保留的 · fork 必保留
- 用输入/输出行为证明覆盖包含关系，不锁死正则实现文本
"""
from __future__ import annotations

import pytest

from plugins.spike_p3_m0_fixtures import hermes_ai_baseline
from plugins.spike_p3_m0_fixtures.citation_cases import ALL_CASES, cases_by_marker
from plugins.spike_p3_m0_strip.sanitize import sanitize_presentation


# ── 1. 覆盖包含关系:baseline strip 的 · fork 必 strip ─────────


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


# ── 6. Codex §7 反例证明:前导差异不吞换行、不扩大删除范围 ─────


def test_leading_space_does_not_eat_newline_before_marker():
    """前一行的 `\\n` **不得**被前导消耗吞掉 · 否则会拼接下一行(§7 反例)。

    这是当前实施 `[ \\t]?` 而非 `\\s?` 的核心理由。曾用的 `\\s?` 匹配 `\\n` ·
    `"Line A\\n[source: kb]Next"` → `"Line ANext"`(BUG)· 现改为 `[ \\t]?` ·
    结果应保持换行结构:`"Line A\\nNext"`。
    """
    raw = "Line A\n[source: kb]Next word"
    fork_out = sanitize_presentation(raw, mode="final")
    # baseline 不吃前导 · 直接删 marker · 结果保持换行 · 后接 Next word
    baseline_out = hermes_ai_baseline.strip_sources(raw)
    # 关键断言:换行未被吞 · 无行拼接
    assert "\n" in fork_out, (
        f"fork 前导消耗吞掉了 `\\n` · 拼接了下一行 · got={fork_out!r} · "
        "前导 regex 必须是 `[ \\t]?` 不是 `\\s?`"
    )
    assert fork_out == "Line A\nNext word", (
        f"fork 处理跨行 marker 错 · raw={raw!r} got={fork_out!r} expected='Line A\\nNext word'"
    )
    # 同时 · fork 与 baseline 保持一致(此 case 前导不消耗 · 空白差异不体现)
    assert fork_out == baseline_out


def test_leading_space_does_not_eat_double_newline_before_marker():
    """双换行边界同理 · 前导消耗**不吃** `\\n` · 段落分隔保留。"""
    raw = "Paragraph A ends here.\n\n[source: kb]Paragraph B starts."
    fork_out = sanitize_presentation(raw, mode="final")
    # 双 \n 应保留(不吞任何 \n · 段落分隔完整)
    assert "\n\n" in fork_out, (
        f"fork 吞掉了段落分隔 · got={fork_out!r}"
    )
    assert fork_out == "Paragraph A ends here.\n\nParagraph B starts."


def test_leading_space_only_absorbs_single_space_or_tab():
    """前导 `[ \\t]?` 只吸收 1 个空格 / tab · 不吸收其他 whitespace。"""
    # 空格 · 吸收
    assert sanitize_presentation("X [source: k]Y", mode="final") == "XY"
    # tab · 吸收
    assert sanitize_presentation("X\t[source: k]Y", mode="final") == "XY"
    # 换行 · 不吸收(§7 硬约束)
    assert sanitize_presentation("X\n[source: k]Y", mode="final") == "X\nY"
    # 回车 · 不吸收(避免 Windows 场景意外拼接)
    assert sanitize_presentation("X\r[source: k]Y", mode="final") == "X\rY"


def test_whitespace_diff_does_not_widen_source_deletion_range():
    """空白差异**不**扩大 source 删除范围:非 source 括号一律保留。

    Codex §7:确保 `\\s?` → `[ \\t]?` 与 `.rstrip()` 的两处 UX 增强·
    不会让 fork 意外删掉 baseline 保留的内容。
    """
    # 非 source 括号(`[normal]`)紧跟 source marker · 只 source 被删
    raw = "Result: [normal] [source: kb] end."
    fork_out = sanitize_presentation(raw, mode="final")
    baseline_out = hermes_ai_baseline.strip_sources(raw)
    assert "[normal]" in fork_out, f"fork 误删了 [normal] · got={fork_out!r}"
    assert "[normal]" in baseline_out
    # source marker 已删
    assert "[source" not in fork_out.lower()
    # 两侧内容(去空白)一致
    import re as _re
    assert _re.sub(r"\s+", "", fork_out) == _re.sub(r"\s+", "", baseline_out)


def test_trailing_whitespace_rstrip_scope_matches_baseline_content():
    """`.rstrip()` 只掐尾空白 · 不改变文本主体 · 与 baseline `.strip()` 内容一致(仅首空白 diff)。"""
    raw = "Answer here [source: k]\n\n   "
    fork_out = sanitize_presentation(raw, mode="final")
    baseline_out = hermes_ai_baseline.strip_sources(raw)
    # 两侧 trailing 皆掐 · 主体一致
    assert fork_out == "Answer here"
    assert baseline_out == "Answer here"


def test_leading_whitespace_only_diff_between_baseline_and_fork():
    """首行 indentation 场景 · fork 保留 · baseline 掐 · 主体 byte-identical。"""
    raw = "   Answer [source: k]"
    fork_out = sanitize_presentation(raw, mode="final")
    baseline_out = hermes_ai_baseline.strip_sources(raw)
    # fork 保留首 3 空格 · baseline 全 strip
    assert fork_out == "   Answer"
    assert baseline_out == "Answer"
    # 去空白后主体 byte-identical
    import re as _re
    assert _re.sub(r"\s+", "", fork_out) == _re.sub(r"\s+", "", baseline_out) == "Answer"


def test_middle_line_source_marker_preserves_surrounding_newlines():
    """中间行的 inline source marker · 两侧换行完整保留 · 无行拼接。"""
    raw = "Line 1\nLine 2 [source: k]\nLine 3"
    fork_out = sanitize_presentation(raw, mode="final")
    assert fork_out == "Line 1\nLine 2\nLine 3"


def test_marker_at_start_of_line_preserves_prev_line_terminator():
    """行首 marker 场景 · 前一行的 `\\n` 保留 · 只删 marker + 前导水平空白(若有)。"""
    raw_no_lead = "Line 1\n[source: k]Line 2 content"
    raw_with_lead = "Line 1\n \t[source: k]Line 2 content"

    out_no_lead = sanitize_presentation(raw_no_lead, mode="final")
    out_with_lead = sanitize_presentation(raw_with_lead, mode="final")

    # 无 leading horizontal ws · 结果 "Line 1\nLine 2 content"
    assert out_no_lead == "Line 1\nLine 2 content"
    # 有 leading horizontal ws · marker 前导吸收 1 个 · 剩下 " \t"?
    # 实际:`[ \t]?[source: k]` 匹配 `\t[source: k]` · 前面的 " " 保留 · 结果 "Line 1\n Line 2 content"
    # 关键点:换行未被吞 · 有 \n
    assert "\n" in out_with_lead
    assert out_with_lead == "Line 1\n Line 2 content"
