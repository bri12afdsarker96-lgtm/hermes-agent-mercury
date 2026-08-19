"""P3-M2 编排插件测试（真实 PluginManager + 生产 seam · 不用 env 开关）。

覆盖：默认不加载（opt-in 纪律）、L0 查询改写经 ``apply_tool_request_middleware``
真实走位（目标工具匹配/清洗/fail-open）、verifier 经
``run_llm_execution_middleware`` 真实走位（计步/终局判定/verdict 白名单/
skipped 放行/绝不改正文/计数清零）。模型调用一律注入替身，离线零网络。
"""
from __future__ import annotations

import pytest

from plugins.spike_p3_m0_fixtures.pluginmgr_helper import (
    get_discovered_module,
    install_fresh_manager,
    make_run_llm_execution,
    write_config,
)

PLUGIN_KEY = "orchestration-p3-m2"
SEARCH_TOOL = "search_business_knowledge"
MCP_SEARCH_TOOL = "mcp__hermes_devices_mcp__search_business_knowledge"


def _install(tmp_path, monkeypatch, request, *, l0=None, verifier=None):
    cfg = {}
    if l0 is not None:
        cfg["l0_rewrite"] = l0
    if verifier is not None:
        cfg["verifier"] = verifier
    write_config(tmp_path / "home", [PLUGIN_KEY], orchestration_p3_m2=cfg)
    manager = install_fresh_manager(monkeypatch, tmp_path / "home", request)
    return manager, get_discovered_module(manager, PLUGIN_KEY)


@pytest.fixture()
def apply_tool_request():
    from hermes_cli.middleware import apply_tool_request_middleware

    def _apply(tool_name, args):
        return apply_tool_request_middleware(tool_name, args, skip_relay=True)

    return _apply


# ── 装载纪律 ─────────────────────────────────────────────────────────


def test_not_loaded_by_default(tmp_path, monkeypatch, request):
    write_config(tmp_path / "home", [])   # 未进 plugins.enabled
    manager = install_fresh_manager(monkeypatch, tmp_path / "home", request)
    loaded = manager._plugins.get(PLUGIN_KEY)
    assert loaded is None or loaded.module is None
    assert not manager.has_middleware("tool_request")


def test_loaded_registers_both_middlewares(tmp_path, monkeypatch, request):
    manager, _ = _install(tmp_path, monkeypatch, request)
    assert manager.has_middleware("tool_request")
    assert manager.has_middleware("llm_execution")


# ── L0 查询改写 ──────────────────────────────────────────────────────


def test_l0_disabled_by_default_no_rewrite(tmp_path, monkeypatch, request, apply_tool_request):
    _, mod = _install(tmp_path, monkeypatch, request)   # 无 l0_rewrite 配置块
    mod.set_rewriter(lambda q: "改写后")
    try:
        result = apply_tool_request(SEARCH_TOOL, {"query": "怎么退货啊我上周买的"})
        assert result.payload["query"] == "怎么退货啊我上周买的"
        assert result.changed is False
    finally:
        mod.set_rewriter(None)


def test_l0_rewrites_search_query(tmp_path, monkeypatch, request, apply_tool_request):
    _, mod = _install(tmp_path, monkeypatch, request, l0={"enabled": True})
    mod.set_rewriter(lambda q: "退货 流程 政策")
    try:
        args = {"query": "怎么退货啊我上周买的", "top_k": 5}
        result = apply_tool_request(MCP_SEARCH_TOOL, args)
        assert result.payload["query"] == "退货 流程 政策"
        assert result.payload["top_k"] == 5          # 其它键原样
        assert set(result.payload) == {"query", "top_k"}   # 不加键（additionalProperties: false）
        assert result.changed is True
    finally:
        mod.set_rewriter(None)


def test_l0_ignores_other_tools(tmp_path, monkeypatch, request, apply_tool_request):
    _, mod = _install(tmp_path, monkeypatch, request, l0={"enabled": True})
    calls = []
    mod.set_rewriter(lambda q: calls.append(q) or "X")
    try:
        result = apply_tool_request("tap", {"query": "这不是检索工具的参数吗"})
        assert result.payload["query"] == "这不是检索工具的参数吗"
        assert calls == []
    finally:
        mod.set_rewriter(None)


@pytest.mark.parametrize("bad_output", ["", "   ", "x" * 300])
def test_l0_bad_rewrite_output_keeps_original(
        tmp_path, monkeypatch, request, apply_tool_request, bad_output):
    _, mod = _install(tmp_path, monkeypatch, request, l0={"enabled": True})
    mod.set_rewriter(lambda q: bad_output)
    try:
        result = apply_tool_request(SEARCH_TOOL, {"query": "怎么退货啊我上周买的"})
        assert result.payload["query"] == "怎么退货啊我上周买的"
    finally:
        mod.set_rewriter(None)


def test_l0_rewriter_exception_fail_open(tmp_path, monkeypatch, request, apply_tool_request):
    _, mod = _install(tmp_path, monkeypatch, request, l0={"enabled": True})

    def boom(q):
        raise RuntimeError("model down")

    mod.set_rewriter(boom)
    try:
        result = apply_tool_request(SEARCH_TOOL, {"query": "怎么退货啊我上周买的"})
        assert result.payload["query"] == "怎么退货啊我上周买的"
    finally:
        mod.set_rewriter(None)


def test_l0_short_query_not_rewritten(tmp_path, monkeypatch, request, apply_tool_request):
    _, mod = _install(tmp_path, monkeypatch, request, l0={"enabled": True})
    calls = []
    mod.set_rewriter(lambda q: calls.append(q) or "X")
    try:
        result = apply_tool_request(SEARCH_TOOL, {"query": "退货"})
        assert result.payload["query"] == "退货"
        assert calls == []
    finally:
        mod.set_rewriter(None)


def test_l0_multiline_rewrite_takes_first_line(tmp_path, monkeypatch, request, apply_tool_request):
    _, mod = _install(tmp_path, monkeypatch, request, l0={"enabled": True})
    mod.set_rewriter(lambda q: "退货 政策\n以下是解释：balabala")
    try:
        result = apply_tool_request(SEARCH_TOOL, {"query": "怎么退货啊我上周买的"})
        assert result.payload["query"] == "退货 政策"
    finally:
        mod.set_rewriter(None)


# ── 长链 verifier ────────────────────────────────────────────────────


def _tool_response():
    return {"choices": [{"message": {"role": "assistant", "content": None,
                                     "tool_calls": [{"id": "t1"}]},
                         "finish_reason": "tool_calls"}]}


def _final_response(text="已完成"):
    return {"choices": [{"message": {"role": "assistant", "content": text},
                         "finish_reason": "stop"}],
            "usage": {"prompt_tokens": 1, "completion_tokens": 1}}


def _drive_session(run, mod, *, steps, judge, session_id="s1"):
    """跑 steps-1 次工具响应 + 1 次终局响应，返回终局响应。"""
    mod.set_judge(judge)
    try:
        for _ in range(steps - 1):
            run({"messages": [{"role": "user", "content": "去处理任务"}]},
                lambda req: _tool_response(), session_id=session_id)
        return run({"messages": [{"role": "user", "content": "去处理任务"}]},
                   lambda req: _final_response(), session_id=session_id)
    finally:
        mod.set_judge(None)


def test_verifier_disabled_by_default(tmp_path, monkeypatch, request):
    _, mod = _install(tmp_path, monkeypatch, request)
    mod.reset_state()
    run = make_run_llm_execution()
    out = _drive_session(run, mod, steps=5,
                         judge=lambda t, r: pytest.fail("judge must not run"))
    assert "verify_meta" not in out


def test_verifier_fail_marks_needs_review_never_rewrites(tmp_path, monkeypatch, request):
    _, mod = _install(tmp_path, monkeypatch, request,
                      verifier={"enabled": True, "max_steps": 2})
    mod.reset_state()
    seen = []
    run = make_run_llm_execution()
    out = _drive_session(run, mod, steps=3,
                         judge=lambda t, r: seen.append((t, r)) or "fail")
    assert seen and seen[0][0] == "去处理任务" and seen[0][1] == "已完成"
    assert out["verify_meta"] == {"verdict": "fail", "steps": 3, "needs_review": True}
    assert out["choices"][0]["message"]["content"] == "已完成"   # 正文原封不动


def test_verifier_pass(tmp_path, monkeypatch, request):
    _, mod = _install(tmp_path, monkeypatch, request,
                      verifier={"enabled": True, "max_steps": 2})
    mod.reset_state()
    run = make_run_llm_execution()
    out = _drive_session(run, mod, steps=3, judge=lambda t, r: "PASS")
    assert out["verify_meta"] == {"verdict": "pass", "steps": 3}


@pytest.mark.parametrize("verdict", ["maybe", "pass, but...", ""])
def test_verifier_whitelist_rejects_offlist_verdict(tmp_path, monkeypatch, request, verdict):
    _, mod = _install(tmp_path, monkeypatch, request,
                      verifier={"enabled": True, "max_steps": 1})
    mod.reset_state()
    run = make_run_llm_execution()
    out = _drive_session(run, mod, steps=2, judge=lambda t, r: verdict)
    assert out["verify_meta"]["verdict"] == "skipped"
    assert "needs_review" not in out["verify_meta"]


def test_verifier_judge_exception_skipped(tmp_path, monkeypatch, request):
    _, mod = _install(tmp_path, monkeypatch, request,
                      verifier={"enabled": True, "max_steps": 1})
    mod.reset_state()

    def boom(t, r):
        raise RuntimeError("judge down")

    run = make_run_llm_execution()
    out = _drive_session(run, mod, steps=2, judge=boom)
    assert out["verify_meta"]["verdict"] == "skipped"


def test_verifier_under_threshold_no_judge(tmp_path, monkeypatch, request):
    _, mod = _install(tmp_path, monkeypatch, request,
                      verifier={"enabled": True, "max_steps": 30})
    mod.reset_state()
    run = make_run_llm_execution()
    out = _drive_session(run, mod, steps=3,
                         judge=lambda t, r: pytest.fail("judge must not run"))
    assert "verify_meta" not in out


def test_verifier_counter_resets_after_final(tmp_path, monkeypatch, request):
    _, mod = _install(tmp_path, monkeypatch, request,
                      verifier={"enabled": True, "max_steps": 2})
    mod.reset_state()
    run = make_run_llm_execution()
    _drive_session(run, mod, steps=3, judge=lambda t, r: "pass")   # 触发并清零
    out = _drive_session(run, mod, steps=1,
                         judge=lambda t, r: pytest.fail("counter must reset"))
    assert "verify_meta" not in out   # 新一轮只 1 步，不触发


def test_verifier_no_session_id_passthrough(tmp_path, monkeypatch, request):
    _, mod = _install(tmp_path, monkeypatch, request,
                      verifier={"enabled": True, "max_steps": 1})
    mod.reset_state()
    from hermes_cli.middleware import run_llm_execution_middleware

    out = run_llm_execution_middleware(
        {"messages": []}, lambda req: _final_response())   # ctx 无 session_id
    assert "verify_meta" not in out
