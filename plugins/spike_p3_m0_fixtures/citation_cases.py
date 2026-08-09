"""P3-M0 · Shared strip-sources fixture(冻结 · Hermes_AI + fork 双仓共享).

**跨仓 SHA-256 校验**:两仓 CI / spike 测试 read 同一份文件内容 · sha256 匹配
才允许消费(见双仓 PR body 互链字段 "fixture SHA-256")· 任一侧修改 · 双仓
PR 必须同步更新 hash · 否则跨仓不一致视为 BLOCKER。

**覆盖面**:
1. 三态最终响应(normal / with citation / mixed)
2. Unicode 边界(多字节 · surrogate pair · emoji · CJK)
3. 任意字节切分点(streaming S1 每一 byte boundary 都 sanitize 正确)
4. 多来源标记形态(inline `[1]` · fenced `<source>` · yaml frontmatter · html tag)
5. interrupt 未闭合标记(partial 到一半 · sanitize 结果不留半括号)
6. Tool result 含来源(transform_tool_result 挂点候选)
7. History replay 转录(session.list/resume presentation 边界)

**M0 首轮 strip prototype 覆盖出口** ①(final) + ④(history);其余 ②③⑤ 由
fixture 冻结契约 · 不实装。
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Callable


@dataclass(frozen=True)
class StripCase:
    """一个 strip 测试样本。

    Attributes:
        name:            测试用例唯一 id(供 pytest parametrize)
        raw:             未 strip 的原始字符串(可含 citation)
        expected:        strip 后期望的字符串
        mode:            触发出口 · "final"/"history"/"streaming"/"interim"/"tool"
        notes:           说明(不参与断言 · 供 review)
    """

    name: str
    raw: str
    expected: str
    mode: str
    notes: str = ""


# ===== 基础 3 态最终响应 =====
NORMAL_FINAL: list[StripCase] = [
    StripCase(
        name="no_citation_pass_through",
        raw="Hello world. This is a normal response.",
        expected="Hello world. This is a normal response.",
        mode="final",
        notes="baseline · 无 citation · 原样透传",
    ),
    StripCase(
        name="inline_bracket_citation",
        raw="The answer is 42 [1]. Reference: doc_abc.",
        expected="The answer is 42. Reference: doc_abc.",
        mode="final",
        notes="inline `[N]` 形态 · 最常见 · strip 移除包括前置空格",
    ),
    StripCase(
        name="multiple_inline_citations",
        raw="Fact one [1]. Fact two [2]. Fact three [3][4].",
        expected="Fact one. Fact two. Fact three.",
        mode="final",
        notes="多来源标记 · 连续 [3][4] 也须移除",
    ),
    StripCase(
        name="fenced_source_block",
        raw="Answer is X.\n\n<sources>\n- doc_abc\n- doc_xyz\n</sources>",
        expected="Answer is X.",
        mode="final",
        notes="fenced <sources>...</sources> 块 · 整块移除 · 保留末尾空行处理由 sanitizer 决定",
    ),
    StripCase(
        name="mixed_inline_and_fenced",
        raw="Answer [1].\n\n<sources>\n[1] doc_abc\n</sources>",
        expected="Answer.",
        mode="final",
        notes="inline + fenced 组合 · 两者都移除",
    ),
]


# ===== Unicode / CJK / emoji 边界 =====
UNICODE_CASES: list[StripCase] = [
    StripCase(
        name="cjk_with_citation",
        raw="发货时间是 48 小时 [1]。",
        expected="发货时间是 48 小时。",
        mode="final",
        notes="CJK 中文 + `[N]` inline citation · 中文标点保留",
    ),
    StripCase(
        name="emoji_with_citation",
        raw="🚀 Launched! [1] 🎉",
        expected="🚀 Launched! 🎉",
        mode="final",
        notes="Emoji 是多字节 UTF-8 · sanitizer 不得断字符",
    ),
    StripCase(
        name="surrogate_pair_preserved",
        raw="𝐇𝐞𝐥𝐥𝐨 [1] 𝕎𝕠𝕣𝕝𝕕",
        expected="𝐇𝐞𝐥𝐥𝐨 𝕎𝕠𝕣𝕝𝕕",
        mode="final",
        notes="astral plane 字符(surrogate pair)· strip 不切裂",
    ),
    StripCase(
        name="rtl_with_citation",
        raw="مرحبا [1] بالعالم",
        expected="مرحبا بالعالم",
        mode="final",
        notes="RTL 阿拉伯文 · sanitizer 不打乱方向",
    ),
]


# ===== Interrupt / partial 未闭合 =====
INTERRUPT_PARTIAL: list[StripCase] = [
    StripCase(
        name="partial_open_bracket",
        raw="The answer is 42 [",
        expected="The answer is 42",
        mode="interim",
        notes="interrupt 时未闭合 `[` · 移除半个开括号",
    ),
    StripCase(
        name="partial_open_source_block",
        raw="Answer.\n\n<sources>\n[1] doc",
        expected="Answer.",
        mode="interim",
        notes="interrupt 时 `<sources>` 未闭合 · 从 tag 起截断",
    ),
    StripCase(
        name="partial_open_bracket_with_number",
        raw="Fact [1",
        expected="Fact",
        mode="interim",
        notes="`[1` 未闭合 · 移除",
    ),
]


# ===== Streaming 字节切分点(S1 完整缓冲策略验证) =====
# 每个 case: 完整字符串 raw + 期望 stripped · 测试时将 raw 按 1..len(raw) 每一 byte
# 切分点分片(chunks) · 送 buffered sanitizer · 最终 emit 必须等于 expected
STREAMING_BYTE_SPLIT: list[StripCase] = [
    StripCase(
        name="stream_split_short",
        raw="A [1]. B [2].",
        expected="A. B.",
        mode="streaming",
        notes="短字符串 · 每字节 boundary 全测",
    ),
    StripCase(
        name="stream_split_cjk",
        raw="答案是 42 [1]。",
        expected="答案是 42。",
        mode="streaming",
        notes="CJK · UTF-8 多字节 · 切分点可能落在字符中间",
    ),
    StripCase(
        name="stream_split_emoji_boundary",
        raw="Done 🎉 [1] end",
        expected="Done 🎉 end",
        mode="streaming",
        notes="emoji 字节边界 · sanitizer 需 utf-8 aware buffering",
    ),
]


# ===== Tool result 含来源(transform_tool_result 挂点) =====
TOOL_RESULT_CASES: list[StripCase] = [
    StripCase(
        name="tool_result_with_inline_source",
        raw='{"answer": "X [1]", "sources": ["doc_a"]}',
        expected='{"answer": "X", "sources": ["doc_a"]}',
        mode="tool",
        notes="JSON tool_result 内含 inline citation · 只 strip answer 里的 · 不改 sources 数组",
    ),
]


# ===== History replay / session.resume 转录 =====
HISTORY_REPLAY_CASES: list[StripCase] = [
    StripCase(
        name="history_assistant_msg_with_citation",
        raw="Previous answer: The result is 42 [1]. [2] concurs.",
        expected="Previous answer: The result is 42. concurs.",
        mode="history",
        notes="从 session.resume 拉出的历史 assistant message · 走 presentation sanitizer · raw canonical 不改",
    ),
]


# ===== 汇总(供 pytest parametrize) =====
ALL_CASES: list[StripCase] = (
    NORMAL_FINAL
    + UNICODE_CASES
    + INTERRUPT_PARTIAL
    + STREAMING_BYTE_SPLIT
    + TOOL_RESULT_CASES
    + HISTORY_REPLAY_CASES
)


def cases_by_mode(mode: str) -> list[StripCase]:
    """按出口模式筛选 cases · 供各 hook prototype 测试消费。"""
    return [c for c in ALL_CASES if c.mode == mode]


def enumerate_byte_split_chunks(raw: str) -> list[tuple[bytes, bytes]]:
    """将 raw 转 UTF-8 后 · 按每 1..N-1 字节切分点返回 (head, tail) 对。

    专供 streaming S1 缓冲策略测试:每一切分点送 buffered sanitizer · 最终
    emit 必须等于 sanitize(raw)。切在多字节字符中间(如 UTF-8 continuation
    byte)· sanitizer 必须**等待更多字节**,不得强解码为 replacement char。
    """
    encoded = raw.encode("utf-8")
    n = len(encoded)
    return [(encoded[:i], encoded[i:]) for i in range(1, n)]
