"""P3-M0 Spike · strip prototype 出口 ① 测试。

**Fixture 双仓共享**:
- Hermes_AI: `tests/fixtures/strip_sources/citation_cases.py`
- fork:      `plugins/spike_p3_m0_fixtures/citation_cases.py`
- SHA-256:  `0cd6ac14035292103ecf574aa6434cf3fcc4d0bdcbe9f21f32a0ba7e9ae26212`
- 跨仓校验:PR body 互链字段 · 任一侧修改双仓 PR 必须同步更新 hash
"""
from __future__ import annotations

import hashlib
from pathlib import Path

import pytest

from plugins.spike_p3_m0_fixtures.citation_cases import (
    ALL_CASES,
    StripCase,
    cases_by_mode,
)
from plugins.spike_p3_m0_strip import on_transform_llm_output
from plugins.spike_p3_m0_strip.sanitize import sanitize_presentation

_HERE = Path(__file__).parent
_FIXTURE_DIR = _HERE.parent.parent / "spike_p3_m0_fixtures"


# ── Fixture SHA-256 校验(跨仓一致性 门槛)──

EXPECTED_FIXTURE_SHA256 = "0cd6ac14035292103ecf574aa6434cf3fcc4d0bdcbe9f21f32a0ba7e9ae26212"


def test_fixture_sha256_matches_hermes_ai():
    """跨仓 fixture 内容一致性 · SHA-256 必须匹配。"""
    fixture_path = _FIXTURE_DIR / "citation_cases.py"
    actual = hashlib.sha256(fixture_path.read_bytes()).hexdigest()
    assert actual == EXPECTED_FIXTURE_SHA256, (
        f"fixture SHA-256 mismatch:\n  expected: {EXPECTED_FIXTURE_SHA256}\n  "
        f"actual:   {actual}\n跨仓 fixture 不一致 · 需同步"
    )


# ── 出口 ① 普通最终响应 sanitize(M0 首轮 spike 覆盖)──


@pytest.mark.parametrize("case", cases_by_mode("final"), ids=lambda c: c.name)
def test_sanitize_final_mode(case: StripCase):
    """全 final-mode fixture case · sanitize_presentation(mode='final') 正确。"""
    got = sanitize_presentation(case.raw, mode="final")
    assert got == case.expected, (
        f"case={case.name}\n  raw:      {case.raw!r}\n  "
        f"expected: {case.expected!r}\n  got:      {got!r}\n  notes:    {case.notes}"
    )


@pytest.mark.parametrize("case", cases_by_mode("final"), ids=lambda c: c.name)
def test_transform_llm_output_hook(case: StripCase):
    """`on_transform_llm_output` hook 契约:
    - 有改动 · 返回 stripped str
    - 无改动 · 返回 None(第一个 non-None str 胜出)"""
    result = on_transform_llm_output(response_text=case.raw)
    if case.raw == case.expected:
        assert result is None, f"unchanged input should return None · case={case.name}"
    else:
        assert result == case.expected, f"case={case.name}: got {result!r}"


def test_hook_none_returns_none():
    """空输入 · 返回 None(与"不改动"契约一致)· 不 crash。"""
    assert on_transform_llm_output(response_text="") is None
    assert on_transform_llm_output(response_text=None) is None  # type: ignore[arg-type]


def test_hook_fail_open_on_exception(monkeypatch):
    """sanitizer 崩 · hook 返回 None(fail-open · 不阻断 chat)。"""
    from plugins.spike_p3_m0_strip import sanitize as sanitize_mod

    def boom(*args, **kwargs):
        raise RuntimeError("simulated sanitizer crash")

    monkeypatch.setattr(sanitize_mod, "sanitize_presentation", boom)
    # hook 内 try/except 保护 · 返回 None(final_response 未被覆盖)
    result = on_transform_llm_output(response_text="Answer [1].")
    assert result is None


# ── 其他 mode 冻结契约(M0 首轮不实装 · 只 skeleton)──


@pytest.mark.parametrize("mode", ["history", "streaming", "interim", "tool"])
def test_other_modes_skeleton_pass_through(mode: str):
    """非 final mode · 当前 spike skeleton 原样返回(契约冻结 · M1+ 分阶段实装)。"""
    text = "Answer [1]. Reference doc_abc."
    got = sanitize_presentation(text, mode=mode)
    assert got == text, f"mode={mode} should pass-through in M0 spike"


# ── 冻结契约 · 出口 ②/③/④/⑤ 待 M1+(fixture 已覆盖 · 实装待议) ──


@pytest.mark.parametrize("mode", ["streaming", "interim", "history", "tool"])
def test_fixture_frozen_for_non_final_modes(mode: str):
    """fixture 有非 final mode case · 供后续实装参照。"""
    cases = cases_by_mode(mode)
    assert len(cases) >= 1, f"fixture 应含 {mode} mode case"
