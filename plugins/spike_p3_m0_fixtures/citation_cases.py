"""P3-M0 · Shared strip-sources fixture(冻结 · Hermes_AI + fork 双仓共享).

**跨仓 SHA-256 校验**:两仓 pytest read 同一份文件内容 · sha256 匹配
才允许消费(见双仓 PR body 互链字段 "fixture SHA-256")· 任一侧修改 · 双仓
PR 必须同步更新 hash · 否则跨仓不一致视为 BLOCKER。

**向后兼容基线**:Hermes_AI `hermes_devices/ops/audit.py::strip_sources`
(charter C4 · 已合入 main)· fork 侧 sanitize_presentation 至少覆盖该
基线所有正例 + 加严 negative cases。

**覆盖面**:
1. 正例(必须 strip):[source:...] · [来源:...] · [source：...] · [来源：...] ·
   独立行 source: / 来源: · 全角/半角括号 · 嵌套中文括号
2. Negative(必须原样保留):bare [1] / [2][3] · Markdown footnote reference ·
   JSON 数组 [] · 数组下标 arr[0] · 年份 [2024] · 版本 [v1.2] · 代码块内 ·
   非 source/来源 关键字的 [xxx]
3. Unicode 边界:CJK · emoji · surrogate pair · RTL
4. Streaming 字节切分点(S1 完整缓冲策略验证)· 每 1..N-1 byte 分片
5. Interrupt 未闭合标记 · 不吞下一行
6. Presentation vs raw transcript 边界(canonical 保留 · presentation strip)
7. Tool result 含来源
8. History replay 转录

**M0 首轮 strip prototype 只实装 mode="final"** · 其他 mode(streaming/history/
interim/tool)是 **skeleton pass-through**(fixture present · implementation
pending)。
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Callable


@dataclass(frozen=True)
class StripCase:
    """一个 strip 测试样本。

    Attributes:
        name:            测试用例唯一 id(供 pytest parametrize)· 全 fixture 唯一
        raw:             未 strip 的原始字符串
        expected:        strip 后期望的字符串(必须严格 == · 不允许"包含")
        mode:            触发出口 · "final" | "history" | "streaming" | "interim" | "tool"
        marker_type:     声称触及的 marker 分类 · 供 pytest 校验实际存在
                         "source_inline" | "source_line" | "unclosed" |
                         "unicode" | "streaming_split" | "negative" |
                         "history_replay" | "tool_result_json"
        notes:           说明(不参与断言)
    """

    name: str
    raw: str
    expected: str
    mode: str
    marker_type: str
    notes: str = ""


# ============================================================================
# 正例(必须 strip · 与 Hermes_AI ops/audit.py::strip_sources 向后兼容)
# ============================================================================

INLINE_SOURCE_CASES: list[StripCase] = [
    StripCase(
        name="inline_source_ascii",
        raw="Answer is X [source: doc_abc].",
        expected="Answer is X.",
        mode="final",
        marker_type="source_inline",
        notes="ASCII `[source: X]` · Hermes_AI baseline · 保末尾句点",
    ),
    StripCase(
        name="inline_source_zh_colon",
        raw="答案是 X [source:doc_abc]。",
        expected="答案是 X。",
        mode="final",
        marker_type="source_inline",
        notes="全角句点 + 半角冒号",
    ),
    StripCase(
        name="inline_lai_yuan_half_width",
        raw="答案是 X [来源: doc_abc]。",
        expected="答案是 X。",
        mode="final",
        marker_type="source_inline",
        notes="中文 `[来源: X]` · 半角括号",
    ),
    StripCase(
        name="inline_lai_yuan_full_width",
        raw="答案是 X 【来源:doc_abc】。",
        expected="答案是 X。",
        mode="final",
        marker_type="source_inline",
        notes="全角方括号 【】",
    ),
    StripCase(
        name="inline_lai_yuan_full_width_colon",
        raw="答案是 X 【来源:doc_abc】。",
        expected="答案是 X。",
        mode="final",
        marker_type="source_inline",
        notes="全角冒号 · 与半角冒号等效处理",
    ),
    StripCase(
        name="inline_lai_yuan_paren_nested_zh",
        raw="答案 【来源:FAQ(2026版)】。",
        expected="答案。",
        mode="final",
        marker_type="source_inline",
        notes="嵌套中文括号(2026版)· 一层嵌套 · 与 Hermes_AI baseline 兼容",
    ),
    StripCase(
        name="inline_multiple_sources",
        raw="点 A [source: a]。点 B [来源: b]。点 C [source:c]。",
        expected="点 A。点 B。点 C。",
        mode="final",
        marker_type="source_inline",
        notes="多个 inline source · 全部移除",
    ),
]

LINE_SOURCE_CASES: list[StripCase] = [
    StripCase(
        name="line_source_ascii",
        raw="Answer is X.\nsource: doc_abc",
        expected="Answer is X.",
        mode="final",
        marker_type="source_line",
        notes="独立行 `source: X` · 整行移除",
    ),
    StripCase(
        name="line_lai_yuan_zh",
        raw="答案是 X。\n来源:doc_abc",
        expected="答案是 X。",
        mode="final",
        marker_type="source_line",
        notes="独立行 `来源: X`",
    ),
    StripCase(
        name="line_source_case_insensitive",
        raw="Answer.\nSource: doc_abc",
        expected="Answer.",
        mode="final",
        marker_type="source_line",
        notes="`Source:`(首字母大写)· case-insensitive",
    ),
]


# ============================================================================
# Negative cases(必须原样保留 · Codex §VI 明令)
# ============================================================================

NEGATIVE_CASES: list[StripCase] = [
    StripCase(
        name="neg_bare_bracket_number",
        raw="See [1] and [2] for details.",
        expected="See [1] and [2] for details.",
        mode="final",
        marker_type="negative",
        notes="裸 `[N]` 无结构化 sources metadata · **不得**无条件 strip",
    ),
    StripCase(
        name="neg_markdown_footnote",
        raw="A footnote reference[^1] and definition below.",
        expected="A footnote reference[^1] and definition below.",
        mode="final",
        marker_type="negative",
        notes="Markdown footnote `[^N]` · 原样保留",
    ),
    StripCase(
        name="neg_json_array",
        raw='Data: {"items": [1, 2, 3]}.',
        expected='Data: {"items": [1, 2, 3]}.',
        mode="final",
        marker_type="negative",
        notes="JSON array · 括号不得 strip",
    ),
    StripCase(
        name="neg_array_index",
        raw="arr[0] and arr[10] access.",
        expected="arr[0] and arr[10] access.",
        mode="final",
        marker_type="negative",
        notes="数组下标 · 原样保留",
    ),
    StripCase(
        name="neg_year_bracket",
        raw="Published in [2024]. Version [v1.2].",
        expected="Published in [2024]. Version [v1.2].",
        mode="final",
        marker_type="negative",
        notes="年份/版本号 [2024] [v1.2] · 无 source 关键字 · 原样保留",
    ),
    StripCase(
        name="neg_code_block_brackets",
        raw="Code: `arr[i] = arr[j]` swap.",
        expected="Code: `arr[i] = arr[j]` swap.",
        mode="final",
        marker_type="negative",
        notes="代码块内的括号 · 原样保留",
    ),
    StripCase(
        name="neg_non_source_keyword_bracket",
        raw="Note [important]: check this.",
        expected="Note [important]: check this.",
        mode="final",
        marker_type="negative",
        notes="`[important]` 非 source/来源 · 原样保留",
    ),
]


# ============================================================================
# 未闭合标记(interrupt · 不吞下一行)
# ============================================================================

UNCLOSED_CASES: list[StripCase] = [
    StripCase(
        name="unclosed_open_bracket_only",
        raw="Answer is X [source: partial\nNext line intact.",
        expected="Answer is X [source: partial\nNext line intact.",
        mode="final",
        marker_type="unclosed",
        notes="未闭合 `[source:` · **保留下一行** · 不吞",
    ),
    StripCase(
        name="unclosed_zh_bracket_at_end",
        raw="答案 【来源:doc",
        expected="答案 【来源:doc",
        mode="interim",
        marker_type="unclosed",
        notes="流式 interrupt · 未闭合中括 · 保留(等待更多 chunk)",
    ),
]


# ============================================================================
# Unicode 边界
# ============================================================================

UNICODE_CASES: list[StripCase] = [
    StripCase(
        name="unicode_cjk_full",
        raw="发货时间是 48 小时 [source: policy]。",
        expected="发货时间是 48 小时。",
        mode="final",
        marker_type="unicode",
        notes="CJK + inline source",
    ),
    StripCase(
        name="unicode_emoji_with_source",
        raw="🚀 Launched! [source: press_release] 🎉",
        expected="🚀 Launched! 🎉",
        mode="final",
        marker_type="unicode",
        notes="Emoji 多字节 · source strip 不断字符",
    ),
    StripCase(
        name="unicode_surrogate_pair",
        raw="𝐇𝐞𝐥𝐥𝐨 [source: mathml] 𝕎𝕠𝕣𝕝𝕕",
        expected="𝐇𝐞𝐥𝐥𝐨 𝕎𝕠𝕣𝕝𝕕",
        mode="final",
        marker_type="unicode",
        notes="Astral plane 字符 · surrogate pair 不切裂",
    ),
    StripCase(
        name="unicode_rtl_arabic",
        raw="مرحبا [source: greeting] بالعالم",
        expected="مرحبا بالعالم",
        mode="final",
        marker_type="unicode",
        notes="RTL 阿拉伯文 · 方向保持",
    ),
]


# ============================================================================
# Streaming 字节切分点(S1 完整缓冲策略验证)
# ============================================================================

STREAMING_BYTE_SPLIT_CASES: list[StripCase] = [
    StripCase(
        name="stream_split_ascii",
        raw="A [source: a] B [source: b] end.",
        expected="A B end.",
        mode="streaming",
        marker_type="streaming_split",
        notes="ASCII · 每字节 boundary 全测(见 enumerate_byte_split_chunks)",
    ),
    StripCase(
        name="stream_split_cjk",
        raw="答案 [source: doc] 是 42。",
        expected="答案 是 42。",
        mode="streaming",
        marker_type="streaming_split",
        notes="CJK · UTF-8 多字节 · 切分点可能落在字符中间 · 缓冲重组",
    ),
    StripCase(
        name="stream_split_emoji_boundary",
        raw="Done 🎉 [source: r] end",
        expected="Done 🎉 end",
        mode="streaming",
        marker_type="streaming_split",
        notes="Emoji 字节边界 · UTF-8 aware buffering",
    ),
]


# ============================================================================
# Tool result 含来源
# ============================================================================

TOOL_RESULT_CASES: list[StripCase] = [
    StripCase(
        name="tool_result_with_inline_source",
        raw='{"answer": "X [source: doc_a]", "sources": ["doc_a"]}',
        expected='{"answer": "X", "sources": ["doc_a"]}',
        mode="tool",
        marker_type="tool_result_json",
        notes="JSON tool_result 内 answer 含 inline source · strip answer · 保留 sources 数组",
    ),
]


# ============================================================================
# History replay(session.list/resume 转录 · presentation boundary)
# ============================================================================

HISTORY_REPLAY_CASES: list[StripCase] = [
    StripCase(
        name="history_assistant_msg_source",
        raw="Previous: The result is 42 [source: analysis]. [来源: report] concurs.",
        expected="Previous: The result is 42. concurs.",
        mode="history",
        marker_type="history_replay",
        notes="History replay 出口 · presentation sanitize · raw canonical 不改",
    ),
]


# ============================================================================
# 汇总(供 pytest parametrize)
# ============================================================================

ALL_CASES: list[StripCase] = (
    INLINE_SOURCE_CASES
    + LINE_SOURCE_CASES
    + NEGATIVE_CASES
    + UNCLOSED_CASES
    + UNICODE_CASES
    + STREAMING_BYTE_SPLIT_CASES
    + TOOL_RESULT_CASES
    + HISTORY_REPLAY_CASES
)


VALID_MARKER_TYPES: frozenset[str] = frozenset({
    "source_inline",
    "source_line",
    "negative",
    "unclosed",
    "unicode",
    "streaming_split",
    "tool_result_json",
    "history_replay",
})

VALID_MODES: frozenset[str] = frozenset({
    "final", "history", "streaming", "interim", "tool",
})


def cases_by_mode(mode: str) -> list[StripCase]:
    """按出口模式筛选 cases · 供各 hook prototype 测试消费。"""
    return [c for c in ALL_CASES if c.mode == mode]


def cases_by_marker(marker_type: str) -> list[StripCase]:
    """按 marker 分类筛选 · 供分层断言。"""
    return [c for c in ALL_CASES if c.marker_type == marker_type]


def enumerate_byte_split_chunks(raw: str) -> list[tuple[bytes, bytes]]:
    """将 raw 转 UTF-8 后 · 按每 1..N-1 字节切分点返回 (head, tail) 对。

    专供 streaming S1 缓冲策略测试:每一切分点送 buffered sanitizer · 最终
    emit 必须等于 sanitize(raw)。切在多字节字符中间(如 UTF-8 continuation
    byte)· sanitizer **必须等待更多字节** · 不得强解码为 replacement char。
    """
    encoded = raw.encode("utf-8")
    n = len(encoded)
    return [(encoded[:i], encoded[i:]) for i in range(1, n)]
