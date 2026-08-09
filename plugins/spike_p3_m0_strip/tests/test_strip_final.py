"""P3-M0 Spike · strip prototype 出口 ① 测试(**真实 PluginManager · invoke_hook**).

**Codex §VI / §VIII 契约**:
- 通过临时 `config.yaml` 启用插件 · 真实 `PluginManager.discover_and_load`
- 通过 `hermes_cli.plugins.invoke_hook("transform_llm_output", ...)` 触发
- 覆盖:
  * fixture SHA-256 双仓一致(cross-repo lock)
  * final-mode 全 fixture case parametrize · sanitize_presentation 直调
  * 有改动 hook 返回 stripped str · 无改动返回 None
  * sanitizer 异常 → hook 返回 FAIL_CLOSED_PLACEHOLDER(**fail-closed** · 不返回原文)
  * negative case:bare [N] / JSON / footnote ref 等**必须**原样保留
  * streaming byte-split · UTF-8 缓冲 · sanitize 结果与整体一致
"""
from __future__ import annotations

import hashlib
from pathlib import Path

import pytest

from plugins.spike_p3_m0_fixtures.citation_cases import (
    ALL_CASES,
    StripCase,
    cases_by_marker,
    cases_by_mode,
    enumerate_byte_split_chunks,
)
from plugins.spike_p3_m0_fixtures.pluginmgr_helper import (
    get_discovered_module,
    install_fresh_manager,
    write_config,
)


STRIP_KEY = "spike-p3-m0-strip"
_HERE = Path(__file__).parent
_FIXTURE_DIR = _HERE.parent.parent / "spike_p3_m0_fixtures"

# 与 Hermes_AI `tests/test_p3_m0_fixture_gate.py::EXPECTED_SHA256` 完全一致
EXPECTED_FIXTURE_SHA256 = (
    "47155c24dfd58019d1c7abdf3870e30099da29f56fe9535d4054d16b50168666"
)


# ── Fixture SHA-256 校验(跨仓一致性 门槛) ─────────────────────


def test_fixture_sha256_matches_hermes_ai():
    fixture_path = _FIXTURE_DIR / "citation_cases.py"
    actual = hashlib.sha256(fixture_path.read_bytes()).hexdigest()
    assert actual == EXPECTED_FIXTURE_SHA256, (
        f"fixture SHA-256 mismatch:\n  expected: {EXPECTED_FIXTURE_SHA256}\n  "
        f"actual:   {actual}\n跨仓 fixture 不一致 · 需双仓同步更新"
    )


# ── Discovery / registration(§VIII) ────────────────────────────


def _enable_strip(tmp_path, monkeypatch):
    write_config(tmp_path, [STRIP_KEY])
    manager = install_fresh_manager(monkeypatch, tmp_path)
    mod = get_discovered_module(manager, STRIP_KEY)
    return manager, mod


def test_discover_registers_transform_llm_output_hook(tmp_path, monkeypatch):
    from hermes_cli.plugins import has_hook

    manager, mod = _enable_strip(tmp_path, monkeypatch)
    assert has_hook("transform_llm_output") is True


def test_disabled_plugin_not_loaded(tmp_path, monkeypatch):
    from hermes_cli.plugins import has_hook

    write_config(tmp_path, [])
    install_fresh_manager(monkeypatch, tmp_path)
    assert has_hook("transform_llm_output") is False


# ── final-mode sanitize_presentation 全 fixture parametrize ────


@pytest.mark.parametrize("case", cases_by_mode("final"), ids=lambda c: c.name)
def test_sanitize_final_mode(case: StripCase):
    """全 final mode fixture case · sanitize_presentation(mode='final') 正确。"""
    from plugins.spike_p3_m0_strip.sanitize import sanitize_presentation

    got = sanitize_presentation(case.raw, mode="final")
    assert got == case.expected, (
        f"case={case.name}\n  raw:      {case.raw!r}\n  "
        f"expected: {case.expected!r}\n  got:      {got!r}\n  notes:    {case.notes}"
    )


# ── Negative case:bare [N] / JSON / footnote 必须原样保留(§VI 硬约束) ──


@pytest.mark.parametrize("case", cases_by_marker("negative"), ids=lambda c: c.name)
def test_negative_cases_preserved(case: StripCase):
    """negative case:sanitize 不得吞掉 · 原样返回。"""
    from plugins.spike_p3_m0_strip.sanitize import sanitize_presentation

    got = sanitize_presentation(case.raw, mode="final")
    assert got == case.raw, (
        f"NEGATIVE case={case.name} 被误 strip · raw={case.raw!r} got={got!r}"
    )


# ── Hook 契约(通过 invoke_hook · 真实 PluginManager 走位) ────────


@pytest.mark.parametrize("case", cases_by_mode("final"), ids=lambda c: c.name)
def test_transform_llm_output_hook_via_invoke_hook(tmp_path, monkeypatch, case: StripCase):
    from hermes_cli.plugins import invoke_hook

    _enable_strip(tmp_path, monkeypatch)
    results = invoke_hook(
        "transform_llm_output",
        response_text=case.raw,
        session_id="s_test",
        model="m",
        platform="cli",
    )
    if case.raw == case.expected:
        assert results == [], f"unchanged input · hook 应返回 None(过滤后空 list)· case={case.name}"
    else:
        assert results == [case.expected], (
            f"case={case.name} · expected [{case.expected!r}] · got {results!r}"
        )


def test_hook_empty_input_returns_none(tmp_path, monkeypatch):
    from hermes_cli.plugins import invoke_hook

    _enable_strip(tmp_path, monkeypatch)
    assert invoke_hook("transform_llm_output", response_text="") == []


# ── fail-CLOSED on sanitizer exception(§VI 硬约束) ─────────────


def test_hook_fail_closed_on_sanitizer_exception(tmp_path, monkeypatch):
    """sanitizer 崩 · hook 返回 FAIL_CLOSED_PLACEHOLDER · **不**返回原文。

    Codex §VI:sanitizer 失败必须拒原文透出 · 返回安全占位符 · 记录 audit。
    """
    from hermes_cli.plugins import invoke_hook

    _, strip_mod = _enable_strip(tmp_path, monkeypatch)
    from plugins.spike_p3_m0_fixtures.pluginmgr_helper import get_discovered_module
    # 从 discover 后的 module 修改 sanitize 依赖(fresh manager 下的 module)
    sanitize_dep = strip_mod._sanitize_mod

    def boom(*_args, **_kwargs):
        raise RuntimeError("simulated sanitizer crash")

    monkeypatch.setattr(sanitize_dep, "sanitize_presentation", boom)

    dangerous_text = "SECRET INTERNAL DATA · SHOULD NOT LEAK · [source: internal]"
    results = invoke_hook(
        "transform_llm_output",
        response_text=dangerous_text,
        session_id="s_test",
        model="m",
        platform="cli",
    )
    # 关键断言:不返回原文 · 返回占位符
    assert len(results) == 1
    assert results[0] == strip_mod.FAIL_CLOSED_PLACEHOLDER
    assert dangerous_text not in results[0], "fail-closed 泄漏原文 · 违 §VI 硬约束"


# ── 其他 mode 契约冻结(skeleton pass-through · M1+ 实装) ──────


@pytest.mark.parametrize("mode", ["history", "streaming", "interim", "tool"])
def test_non_final_modes_skeleton_pass_through(mode: str):
    from plugins.spike_p3_m0_strip.sanitize import sanitize_presentation

    text = "Answer with citation [source: kb_2024]. More text."
    got = sanitize_presentation(text, mode=mode)
    assert got == text, f"mode={mode} 应 pass-through(M0 skeleton · 见 §VI 冻结)"


# ── Streaming byte-split · S1 完整缓冲后 sanitize 与整体一致 ───


@pytest.mark.parametrize("case", cases_by_marker("streaming_split"), ids=lambda c: c.name)
def test_streaming_full_buffer_matches_final(case: StripCase):
    """S1 策略验证:任意字节切分点分片 → 缓冲拼回 → UTF-8 decode → final sanitize
    → 结果必须等于对整体 raw 直接 final sanitize 的结果(与 case.expected 一致)。
    """
    from plugins.spike_p3_m0_strip.sanitize import sanitize_presentation

    expected = sanitize_presentation(case.raw, mode="final")
    assert expected == case.expected, (
        f"streaming_split case={case.name} · 直接 final sanitize 与 fixture expected 不一致 · "
        f"expected={case.expected!r} got={expected!r}"
    )
    # 每个切分点:两段拼接 · decode · sanitize · 与 expected 一致
    for head, tail in enumerate_byte_split_chunks(case.raw):
        buf = head + tail
        text = buf.decode("utf-8")
        got = sanitize_presentation(text, mode="final")
        assert got == expected, (
            f"streaming byte-split 破坏 sanitize · case={case.name} "
            f"head_len={len(head)} · got={got!r} expected={expected!r}"
        )
