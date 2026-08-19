"""P3-M2 主脑编排段 · L0 查询改写 + 长链 verifier（章程 C2/C3/C7）。

两个子功能都是**优化护栏而非安全门**（安全门 = spike_p3_m0_cache 的
budget/tenant fail-closed 组合），因此整体语义是 fail-open：任何配置/模型/
内部异常都不得阻断正常请求。

**L0 查询改写（tool_request middleware · 章程 C3 agentic RAG）**

只拦知识检索工具 ``search_business_knowledge``（含 MCP 前缀形态
``mcp__<server>__search_business_knowledge``），用小模型把口语化客户问题
改写成检索友好查询——语义对齐 Hermes_AI ``ops/retrieval.py::rewrite_query``
（L0 rewrite · 失败原样返回）。模型调用复用 ``agent.auxiliary_client.call_llm``
（task=``l0_query_rewrite``，模型由 config ``auxiliary.l0_query_rewrite.*``
指定，如 MiniMax M2 档小模型——复用现有解析链，不自建 client）。

* 只替换 ``query`` 值，不增删键（MCP inputSchema ``additionalProperties:
  false`` 下新增键会被服务端拒绝）；
* 改写输出清洗：strip → 取首行 → 空/超长(>256)/与原相同 → 放弃改写；
* 任何异常 → 原 query（fail-open）。

**长链 verifier（llm_execution middleware · 章程 C7③）**

按 ``session_id`` 统计 LLM 调用步数；当会话产生**终局响应**（finish=stop
且无 tool_calls）且步数超过 ``verifier.max_steps``（默认 30）时，用独立
小模型（task=``task_verifier``）复核任务是否完成。语义对齐 Hermes_AI
``hermes_devices/verifier.py::maybe_verify``：

* verdict 白名单 ``pass``/``fail``——模型输出越界一律记 ``skipped``
  放行（防话术操纵）；
* ``fail`` 只在响应 dict 附加 ``verify_meta.needs_review=True`` 标记，
  **绝不自动重试、绝不改写正文**（重试权在上层/人工）；
* judge 不可用/异常 → ``skipped`` 放行，零阻断。

配置（config.yaml · 不用 env——与 spike 插件同纪律）::

    plugins:
      enabled: [orchestration_p3_m2, ...]
      orchestration_p3_m2:
        l0_rewrite:
          enabled: true          # 严格 bool；缺省/False 关闭
        verifier:
          enabled: true
          max_steps: 30
"""
from __future__ import annotations

import logging
import threading
from typing import Any, Callable, Dict, Optional

logger = logging.getLogger(__name__)

SEARCH_TOOL_BASENAME = "search_business_knowledge"

REWRITE_MAX_LEN = 256          # 改写结果超长视为模型跑偏，放弃
_JUDGE_INPUT_MAX_CHARS = 2000  # 送 judge 的任务/结果各自截断上限
DEFAULT_VERIFIER_MAX_STEPS = 30

_REWRITE_SYSTEM = (
    "你是检索查询改写器。把用户的口语化问题改写成一条简洁、关键词明确的"
    "知识库检索查询。只输出改写后的查询本身，不要解释、不要引号。"
)
_JUDGE_SYSTEM = (
    "你是独立的结果校验器。判断助手的最终输出是否完成了用户任务且没有明显"
    "错误或遗漏。只输出一个词：pass 或 fail。"
)

# 测试注入点（None = 走 auxiliary_client 生产链）。
_rewriter: Optional[Callable[[str], str]] = None
_judge: Optional[Callable[[str, str], str]] = None

_steps_lock = threading.RLock()
_session_steps: Dict[str, int] = {}


# ── 配置（fail-open：读不到/形状不对一律视为关闭） ────────────────────


def _feature_config(feature: str) -> Dict[str, Any]:
    try:
        from hermes_cli.config import load_config

        cfg = load_config() or {}
        plugins_cfg = cfg.get("plugins") or {}
        plugin_cfg = plugins_cfg.get("orchestration_p3_m2") or {}
        block = plugin_cfg.get(feature) or {}
        return block if isinstance(block, dict) else {}
    except Exception:  # noqa: BLE001 - 优化功能：配置异常 = 关闭，不阻断请求
        return {}


def _feature_enabled(feature: str, block: Optional[Dict[str, Any]] = None) -> bool:
    if block is None:
        block = _feature_config(feature)
    return block.get("enabled") is True   # 严格 bool · 缺省关闭


# ── L0 查询改写 ──────────────────────────────────────────────────────


def set_rewriter(fn: Optional[Callable[[str], str]]) -> None:
    """测试注入：替换改写实现（None 恢复生产链）。"""
    global _rewriter
    _rewriter = fn


def _extract_message_content(response: Any) -> str:
    if isinstance(response, dict):
        choices = response.get("choices")
    else:
        choices = getattr(response, "choices", None)
    if not choices:
        return ""
    first = choices[0]
    msg = first.get("message") if isinstance(first, dict) else getattr(first, "message", None)
    if msg is None:
        return ""
    content = msg.get("content") if isinstance(msg, dict) else getattr(msg, "content", None)
    return content if isinstance(content, str) else ""


def _call_aux_llm(task: str, system: str, user: str, max_tokens: int) -> str:
    from agent.auxiliary_client import call_llm

    response = call_llm(
        task=task,
        messages=[
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
        temperature=0.0,
        max_tokens=max_tokens,
    )
    return _extract_message_content(response)


def _default_rewriter(query: str) -> str:
    return _call_aux_llm("l0_query_rewrite", _REWRITE_SYSTEM, query, max_tokens=128)


def _is_search_tool(tool_name: Any) -> bool:
    if not isinstance(tool_name, str):
        return False
    return tool_name == SEARCH_TOOL_BASENAME or tool_name.endswith(
        f"__{SEARCH_TOOL_BASENAME}"
    )


def l0_rewrite_middleware(tool_name: Any = None, args: Any = None, **_ctx: Any):
    """``tool_request`` middleware：知识检索 query 的 L0 改写（fail-open）。"""
    try:
        if not _is_search_tool(tool_name) or not isinstance(args, dict):
            return None
        query = args.get("query")
        if not isinstance(query, str) or len(query.strip()) <= 3:
            return None
        if not _feature_enabled("l0_rewrite"):
            return None
        rewriter = _rewriter or _default_rewriter
        rewritten = (rewriter(query) or "").strip().splitlines()
        candidate = rewritten[0].strip() if rewritten else ""
        if not candidate or len(candidate) > REWRITE_MAX_LEN or candidate == query:
            return None
        new_args = dict(args)
        new_args["query"] = candidate   # 只换值不加键（additionalProperties: false）
        return {"args": new_args, "source": "orchestration-p3-m2", "reason": "l0_query_rewrite"}
    except Exception as exc:  # noqa: BLE001 - fail-open：改写失败用原 query
        logger.info("orchestration: l0 rewrite skipped · %s", type(exc).__name__)
        return None


# ── 长链 verifier ────────────────────────────────────────────────────


def set_judge(fn: Optional[Callable[[str, str], str]]) -> None:
    """测试注入：替换 judge 实现（None 恢复生产链）。签名 (task, result) -> verdict。"""
    global _judge
    _judge = fn


def reset_state() -> None:
    """测试用：清空会话步数计数。"""
    with _steps_lock:
        _session_steps.clear()


def _default_judge(task: str, result: str) -> str:
    user = f"用户任务：\n{task}\n\n助手最终输出：\n{result}\n\n只输出 pass 或 fail。"
    return _call_aux_llm("task_verifier", _JUDGE_SYSTEM, user, max_tokens=8)


def _is_final_response(response: Any) -> bool:
    try:
        if isinstance(response, dict):
            choices = response.get("choices")
        else:
            choices = getattr(response, "choices", None)
        if not choices:
            return False
        first = choices[0]
        msg = first.get("message") if isinstance(first, dict) else getattr(first, "message", None)
        if msg is None:
            return False
        tool_calls = msg.get("tool_calls") if isinstance(msg, dict) else getattr(msg, "tool_calls", None)
        if tool_calls:
            return False
        finish = first.get("finish_reason") if isinstance(first, dict) else getattr(first, "finish_reason", None)
        return finish == "stop"
    except Exception:  # noqa: BLE001
        return False


def _last_user_text(request: Any) -> str:
    if not isinstance(request, dict):
        return ""
    for msg in reversed(request.get("messages") or []):
        if isinstance(msg, dict) and msg.get("role") == "user":
            content = msg.get("content")
            if isinstance(content, str):
                return content[:_JUDGE_INPUT_MAX_CHARS]
    return ""


def _max_steps(block: Dict[str, Any]) -> int:
    raw = block.get("max_steps", DEFAULT_VERIFIER_MAX_STEPS)
    if isinstance(raw, bool) or not isinstance(raw, int) or raw < 1:
        return DEFAULT_VERIFIER_MAX_STEPS
    return raw


def verifier_middleware(request: Any = None, next_call: Callable[..., Any] = None, **ctx: Any):
    """``llm_execution`` middleware：会话计步 + 超长链终局复核（fail-open）。"""
    if next_call is None:  # pragma: no cover - 框架保证存在，防御式直接放弃
        return None
    block = _feature_config("verifier")
    session_id = ctx.get("session_id")
    if not _feature_enabled("verifier", block) or not isinstance(session_id, str) or not session_id:
        return next_call(request)

    with _steps_lock:
        if session_id not in _session_steps and len(_session_steps) >= 1024:
            _session_steps.clear()   # 防泄漏兜底：异常中断会话的残留计数
        _session_steps[session_id] = _session_steps.get(session_id, 0) + 1

    response = next_call(request)

    try:
        if not _is_final_response(response):
            return response
        with _steps_lock:
            steps = _session_steps.pop(session_id, 0)
        if steps <= _max_steps(block):
            return response
        verdict = "skipped"
        try:
            judge = _judge or _default_judge
            raw = (judge(_last_user_text(request), _extract_message_content(response)) or "")
            raw = raw.strip().lower()
            if raw in ("pass", "fail"):   # 白名单：越界输出不采信（防话术操纵）
                verdict = raw
        except Exception as exc:  # noqa: BLE001 - judge 不可用：skipped 放行
            logger.info("orchestration: verifier skipped · %s", type(exc).__name__)
        if isinstance(response, dict):
            meta = {"verdict": verdict, "steps": steps}
            if verdict == "fail":
                meta["needs_review"] = True   # 只标记，不重试、不改正文（C7③）
            response.setdefault("verify_meta", meta)
        if verdict == "fail":
            logger.warning(
                "orchestration: verifier FAIL · session=%s steps=%d · needs human review",
                session_id, steps,
            )
    except Exception as exc:  # noqa: BLE001 - 校验环节异常绝不吞掉已产生的响应
        logger.info("orchestration: verifier post-check error · %s", type(exc).__name__)
    return response


def register(ctx: Any) -> None:
    ctx.register_middleware("tool_request", l0_rewrite_middleware)
    ctx.register_middleware("llm_execution", verifier_middleware)
