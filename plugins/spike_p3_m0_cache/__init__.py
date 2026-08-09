"""P3-M0 Spike · tenant-safe cache + orchestrator(llm_execution middleware).

**Codex 第三轮 §I / §II / §III / §V 契约(修订)**:

1. 注册 `llm_execution` middleware(`ctx.register_middleware("llm_execution", ...)`)·
   经过 `run_llm_execution_middleware`(`hermes_cli/middleware.py:187`)真正生产走位·
   fail-open on callback(fork middleware 语义 · 见 middleware.py:_run_execution_chain)

2. **控制流严格解耦 · cache eligibility ≠ budget enforcement**:

     插件禁用 → next_call(不 lookup 不 reserve)
     插件启用 →
       ├─ 硬依赖门:budget module 缺失 → fail-CLOSED(结构化 error response · 不 next_call)
       ├─ tenant context 4 字段严格校验(缺/空/非白/超长)→ fail-CLOSED
       ├─ budget config 校验(BudgetConfigError → fail-CLOSED · 不静默 None)
       ├─ 非 chat_completions api_mode → fail-CLOSED(M0 明确缩小支持范围 · 见 §II)
       ├─ 非 dict request → fail-CLOSED
       │
       ├─ 判 cacheable_request(streaming/tools 非 cacheable · **但仍 reserve/settle**)
       │
       ├─ cacheable_request → cache lookup
       │   └─ HIT → 返回 cached + 顶层 usage=0(**不 reserve**)
       │
       ├─ (MISS 或 非 cacheable_request)→ budget.reserve
       │   ├─ raise BudgetExceeded → 结构化非空 error response(**不 next_call**)
       │   └─ 成功 → next_call
       │            ├─ 成功 → budget.settle(actual) + cache insert(若 req+resp 皆 cacheable)
       │            └─ 异常 → budget.release + re-raise

3. 严格 tenant fail-CLOSED:tenant_id / principal_id / permission_scope_version /
   profile_version 任一缺失/空/非法 → **不 next_call** · 返回结构化 fail-closed response
   · **禁**默认填 "system"/"0" 等安全值(Codex §III)

4. **只**支持 `api_mode == "chat_completions"`:其他 3 mode(anthropic_messages /
   bedrock_converse / codex_responses)fail-CLOSED · **不 next_call**(见 §II 明令)·
   M0 缩小支持范围到 chat_completions · 其他 mode 需 M1+ 补 token 估算

5. 顶层 `usage` = billable_usage(全 0)· 原始生成 usage 只在 `cache_meta.origin_usage`

6. 并发:threading.RLock 保护 LRU + insert 序

7. 配置:
   - `plugins.spike_p3_m0_cache.enabled` **严格 bool**(v is True · 拒 "false"/1/等)
   - `plugins.spike_p3_m0_cache.tenant.*`(4 字段 · str · 白名单 · len≤128)
   - `plugins.spike_p3_m0_cache.tenant.daily_budget_tokens`(4 态 · BudgetConfigError 硬 fail-CLOSED)
   - **不用** SPIKE_* env · **不**读 profile.yaml · **不**读 HERMES_DAILY_TOKEN_BUDGET

8. **input token 估算**(Codex §V):不得静默 0 后宣称预算护栏成立。
   - 优先信 ctx.approx_input_tokens(若 int/float > 0)
   - 否则从 request.messages content 字符数 / 4(粗略英文 heuristic · M0 approximation · 见文档)
   - 加上 request.max_tokens 上限 · 得 tokens_needed
"""
from __future__ import annotations

import hashlib
import importlib
import json
import logging
import re
import sys
import threading
from collections import OrderedDict
from typing import Any, Callable, Dict, Optional

logger = logging.getLogger(__name__)


def _budget_module():
    """Locate the budget sibling module regardless of parent package.

    hermes_cli.plugins loads bundled plugins under ``hermes_plugins.*``; running
    the plugins directly from a checkout may see ``plugins.*`` instead. Lazy
    lookup avoids a hard ``from .. import`` that only works under one layout.

    **Codex §III**:budget 模块缺失时 middleware **不**得 fail-open · 由调用方(orchestrator)
    捕获 ImportError 走 fail-CLOSED response · 保持"cache 单独启用"场景可测。
    """
    parent = __name__.rsplit(".", 1)[0] if "." in __name__ else ""
    if parent:
        candidate = f"{parent}.spike_p3_m0_budget"
        if candidate in sys.modules:
            return sys.modules[candidate]
        try:
            return importlib.import_module(candidate)
        except ImportError:
            pass
    raise ImportError(
        "spike_p3_m0_budget module not loaded; enable spike-p3-m0-budget in plugins.enabled"
    )


CACHE_CONTRACT_VERSION = "v1"
CODEC_VERSION = "codec_v1"
CACHE_MAX_SIZE = 256   # LRU cap · 简单进程内 · M0 不 persistent

# 允许 tenant_id/principal_id/permission_scope_version/profile_version 的字符白名单
# (类比 Hermes_AI `_validate_tenant_id` · 保守集合)
_ID_ALLOWED_RE = re.compile(r"^[a-zA-Z0-9_\-]+$")
_ID_MAX_LEN = 128

# fail-closed 结构化 response 消息(非空 · 可展示 · finish_reason=content_filter 抑制 retry)
_BUDGET_EXCEEDED_MESSAGE = (
    "[请求已被拒绝 · tenant 每日预算已达上限 · 请稍后重试或联系管理员]"
)
_BUDGET_FAIL_CLOSED_MESSAGE = (
    "[请求已被拒绝 · 预算护栏未就绪 · 请联系管理员]"
)


# ── Module state · thread-safe LRU ────────────────────────────────────

_lock = threading.RLock()
_cache: "OrderedDict[str, Dict[str, Any]]" = OrderedDict()


# ── Config loading(fork config.yaml · 不用 env) ─────────────────────

def _load_config() -> Dict[str, Any]:
    """Load fork config via `hermes_cli.config.load_config` · returns full config dict."""
    try:
        from hermes_cli.config import load_config

        return load_config() or {}
    except Exception as exc:   # noqa: BLE001
        logger.warning("spike-cache: load_config failed · treated as empty: %s", exc)
        return {}


def _get_plugin_config() -> Dict[str, Any]:
    """Return `plugins.spike_p3_m0_cache` sub-config(dict · empty if未配置)."""
    cfg = _load_config()
    plugins_cfg = cfg.get("plugins") or {}
    return plugins_cfg.get("spike_p3_m0_cache") or {}


def _is_enabled() -> bool:
    """`plugins.spike_p3_m0_cache.enabled` **严格 bool** · 只接受 literal `True`。

    Codex §III 硬约束:拒 `bool("false") == True`(str 转 bool 陷阱)· 拒 int/list/dict。
    True → 启用;其他(False / None / "true" / 1 / [] / {} / ...)→ 视 as 禁用。
    """
    return _get_plugin_config().get("enabled") is True


def _get_tenant_context() -> Optional[Dict[str, str]]:
    """严格 fail-closed tenant context · 从 config `plugins.spike_p3_m0_cache.tenant` 读。

    所有 4 字段(tenant_id/principal_id/permission_scope_version/profile_version)必需·
    非空 · 类型 str · 字符白名单 · 任一违反 → 返回 None(fail-closed · log context_invalid).

    **禁**默认填 "system"/"0" 等安全值(Codex §III 明令)。

    T2 首选:由 provisioning 写入该 tenant 独立 HERMES_HOME 的 config.yaml · fork
    进程仅信 config · 不信 prompt/tool_args。
    """
    tenant_block = _get_plugin_config().get("tenant") or {}
    if not isinstance(tenant_block, dict):
        logger.info("spike-cache: tenant context invalid · not a mapping")
        return None
    required = ("tenant_id", "principal_id", "permission_scope_version", "profile_version")
    resolved: Dict[str, str] = {}
    for field in required:
        v = tenant_block.get(field)
        if v is None:
            logger.info("spike-cache: tenant context invalid · missing field %s", field)
            return None
        if not isinstance(v, str):
            logger.info("spike-cache: tenant context invalid · field %s type=%s(need str)", field, type(v).__name__)
            return None
        if not v.strip():
            logger.info("spike-cache: tenant context invalid · field %s empty/whitespace", field)
            return None
        if len(v) > _ID_MAX_LEN:
            logger.info("spike-cache: tenant context invalid · field %s len=%d > %d", field, len(v), _ID_MAX_LEN)
            return None
        if not _ID_ALLOWED_RE.match(v):
            logger.info("spike-cache: tenant context invalid · field %s non-whitelist chars", field)
            return None
        resolved[field] = v
    return resolved


# ── Cacheability guards ─────────────────────────────────────────────

def _api_mode_supported(api_mode: str) -> bool:
    """M0 只支持 `chat_completions`(见 §II)· 其他 mode fail-CLOSED · 不 next_call。"""
    return api_mode == "chat_completions"


def is_cacheable_request(request: Any, *, api_mode: str = "chat_completions") -> bool:
    """判 request 是否可 lookup/insert cache(**与 budget 决策解耦**)。

    Codex §II:streaming / tools 可以不缓存 · 但**不能不计预算**。
    """
    if not _api_mode_supported(api_mode):
        return False
    if not isinstance(request, dict):
        return False
    if request.get("stream"):
        return False
    tools = request.get("tools") or []
    if tools:
        return False
    return True


def is_cacheable_response(response: Any) -> bool:
    """仅 finish=stop + 无 tool_calls · 支持 SDK 对象和 dict 形态。"""
    try:
        if isinstance(response, dict):
            choices = response.get("choices")
        else:
            choices = getattr(response, "choices", None)
        if not choices:
            return False
        first = choices[0]
        msg = first.get("message") if isinstance(first, dict) else getattr(first, "message", None)
        if not msg:
            return False
        tool_calls = msg.get("tool_calls") if isinstance(msg, dict) else getattr(msg, "tool_calls", None)
        if tool_calls:
            return False
        finish = first.get("finish_reason") if isinstance(first, dict) else getattr(first, "finish_reason", None)
        return finish == "stop"
    except Exception:   # noqa: BLE001
        return False


# ── Cache key builder(§2 schema v1)──────────────────────────────

def build_cache_key(
    request: Dict[str, Any],
    tenant_ctx: Dict[str, str],
    *,
    model: str,
    provider: str,
) -> str:
    """SHA-256 of deterministic key components(12 字段 schema v1)."""
    messages = request.get("messages") or []
    messages_bytes = json.dumps(messages, sort_keys=True, ensure_ascii=False).encode("utf-8")
    tools_bytes = json.dumps(request.get("tools") or [], sort_keys=True, ensure_ascii=False).encode("utf-8")
    # system prompt hash · 从 messages 首 system 消息内容
    sys_msg_content = ""
    for m in messages:
        if isinstance(m, dict) and m.get("role") == "system":
            sys_msg_content = json.dumps(m.get("content"), sort_keys=True, ensure_ascii=False)
            break
    parts = {
        "tenant_id": tenant_ctx["tenant_id"],
        "principal_id": tenant_ctx["principal_id"],
        "permission_scope_version": tenant_ctx["permission_scope_version"],
        "provider": provider or "",
        "model": model or "",
        "system_prompt_version": hashlib.sha256(sys_msg_content.encode("utf-8")).hexdigest()[:16],
        "tool_schema_version": hashlib.sha256(tools_bytes).hexdigest()[:16],
        "profile_version": tenant_ctx["profile_version"],
        "knowledge_collection": str(request.get("_kb_collection") or ""),
        "knowledge_collection_version": str(request.get("_kb_version") or ""),
        "normalized_semantic_messages": hashlib.sha256(messages_bytes).hexdigest(),
        "cache_contract_version": CACHE_CONTRACT_VERSION,
    }
    canonical = json.dumps(parts, sort_keys=True, ensure_ascii=False).encode("utf-8")
    return hashlib.sha256(canonical).hexdigest()


# ── Response归一化 · codec_v1(仅 chat_completions dict 形态)──────

def _extract_cacheable_response(response: Any) -> Dict[str, Any]:
    """Normalize provider response → cacheable dict(codec_v1)· 只 chat_completions dict."""
    def _get(obj, k, default=None):
        return obj.get(k, default) if isinstance(obj, dict) else getattr(obj, k, default)
    origin_usage_obj = _get(response, "usage") or {}
    if not isinstance(origin_usage_obj, dict):
        origin_usage_obj = {
            "prompt_tokens": getattr(origin_usage_obj, "prompt_tokens", 0) or 0,
            "completion_tokens": getattr(origin_usage_obj, "completion_tokens", 0) or 0,
        }
    choices = _get(response, "choices")
    return {
        "model": _get(response, "model"),
        "choices": choices,
        "usage": {"prompt_tokens": 0, "completion_tokens": 0},   # 顶层 usage = billable_usage · 全 0
        "codec_version": CODEC_VERSION,
        "cache_meta": {
            "hit": True,
            "cache_contract_version": CACHE_CONTRACT_VERSION,
            "origin_usage": origin_usage_obj,
            "billable_usage": {"prompt_tokens": 0, "completion_tokens": 0},
            "saved_usage": origin_usage_obj,
            "cache_lookup_cost": None,   # in-memory · 通常 0
        },
    }


# ── Input token 估算(Codex §V:不得静默 0) ──────────────────────

def _estimate_input_tokens_from_messages(request: Dict[str, Any]) -> int:
    """从 messages content 字符数估算 input tokens · **M0 approximation**。

    heuristic:总字符数 ÷ 4(rough 英文 char-per-token)· 中文/emoji 会低估 ·
    但对 M0 预算护栏"防明显超支"目标足够 · 生产 M1+ 需接 tiktoken/tokenizer 精算
    (out-of-band 契约字段 · 见 docs/fork/budget-hook.md §5b)。

    保底:若 messages 全空/无 content · 返回 0 · 由调用方结合 max_tokens 判断。
    """
    if not isinstance(request, dict):
        return 0
    msgs = request.get("messages") or []
    if not isinstance(msgs, list):
        return 0
    total_chars = 0
    for m in msgs:
        if not isinstance(m, dict):
            continue
        content = m.get("content")
        if isinstance(content, str):
            total_chars += len(content)
        elif isinstance(content, list):
            for part in content:
                if isinstance(part, dict):
                    t = part.get("text")
                    if isinstance(t, str):
                        total_chars += len(t)
    return total_chars // 4


def _estimate_needed_tokens(request: Any, ctx: Dict[str, Any]) -> int:
    """总预留 = input 估算 + max_tokens · **不静默 0**(Codex §V)。

    优先信 ctx.approx_input_tokens(若 int/float > 0);否则从 messages 估算 ·
    加上 request.max_tokens(或 ctx.max_tokens)· 得 tokens_needed。
    """
    explicit = ctx.get("approx_input_tokens")
    if isinstance(explicit, bool):
        explicit = None
    if isinstance(explicit, (int, float)) and explicit > 0:
        approx_input = int(explicit)
    else:
        approx_input = _estimate_input_tokens_from_messages(request if isinstance(request, dict) else {})
    max_tokens_raw = None
    if isinstance(request, dict):
        max_tokens_raw = request.get("max_tokens")
    if max_tokens_raw is None:
        max_tokens_raw = ctx.get("max_tokens")
    try:
        max_tokens = int(max_tokens_raw or 0)
    except (TypeError, ValueError):
        max_tokens = 0
    if max_tokens < 0:
        max_tokens = 0
    return approx_input + max_tokens


# ── Structured error responses(Codex §V:非空、安全、可展示) ─────

def _fail_closed_response(model: str, *, reason_code: str, **extras: Any) -> Dict[str, Any]:
    """结构化 fail-closed response · finish_reason=content_filter 抑制 retry/fallback。

    Codex §V:BudgetExceeded / 预算护栏未就绪 时返回必须**非空** · 安全可展示 ·
    不触发 retry。上层 orchestrator 若追加 retry 决策 · 需读 `cache_meta.reason_code`
    做过滤(M1+ 契约:orchestrator 遇 content_filter + cache_meta.reason_code 明确 · 不 retry)。
    """
    return {
        "model": model or "",
        "choices": [{
            "index": 0,
            "message": {
                "role": "assistant",
                "content": _BUDGET_EXCEEDED_MESSAGE if reason_code == "budget_exceeded" else _BUDGET_FAIL_CLOSED_MESSAGE,
            },
            "finish_reason": "content_filter",
        }],
        "usage": {"prompt_tokens": 0, "completion_tokens": 0},
        "cache_meta": {
            "hit": False,
            "budget_exceeded": reason_code == "budget_exceeded",
            "budget_fail_closed": reason_code != "budget_exceeded",
            "reason_code": reason_code,
            **extras,
        },
    }


# ── Orchestrator middleware(cache + budget 显式组合 · 解耦) ─────

def cache_and_budget_middleware(
    request: Any,
    next_call: Callable[[Any], Any],
    **ctx: Any,
) -> Any:
    """`llm_execution` middleware · 严格 Codex 第三轮 §II 控制流(解耦 cache 与 budget)。

    见模块 docstring §2 完整控制流。
    """
    api_request_id = str(ctx.get("api_request_id") or "")
    api_mode = str(ctx.get("api_mode") or "chat_completions")
    provider = str(ctx.get("provider") or "")
    model = str(ctx.get("model") or "")

    # 1. Plugin disabled → next_call 直通(Codex §II step 1)
    if not _is_enabled():
        return next_call(request)

    # 2. Budget module 硬依赖门(Codex §III:cache 单独启用不得因 budget 缺失 fail-open)
    try:
        budget_mod = _budget_module()
    except ImportError as exc:
        logger.error(
            "spike-cache: budget module missing · enable spike-p3-m0-budget in plugins.enabled · fail-CLOSED: %s",
            exc,
        )
        return _fail_closed_response(model, reason_code="budget_module_missing")

    # 3. api_mode 支持范围收紧(Codex §II:非 chat_completions fail-CLOSED · 不静默 pass-through)
    if not _api_mode_supported(api_mode):
        logger.warning(
            "spike-cache: unsupported api_mode=%s · M0 only supports chat_completions · fail-CLOSED",
            api_mode,
        )
        return _fail_closed_response(model, reason_code="unsupported_api_mode", api_mode=api_mode)

    # 4. request 类型门(non-dict 无法 estimate token · fail-CLOSED)
    if not isinstance(request, dict):
        logger.warning("spike-cache: request not a dict · fail-CLOSED · type=%s", type(request).__name__)
        return _fail_closed_response(model, reason_code="non_dict_request")

    # 5. tenant context 严格 fail-CLOSED(Codex §III:enforcement 开启时 next_call == 0)
    tenant_ctx = _get_tenant_context()
    if tenant_ctx is None:
        return _fail_closed_response(model, reason_code="tenant_context_invalid")
    tenant_id = tenant_ctx["tenant_id"]

    # 6. Budget config 校验 · BudgetConfigError 硬 fail-CLOSED(Codex §III:不转 None 静默继续)
    raw_budget = (_get_plugin_config().get("tenant") or {}).get("daily_budget_tokens")
    try:
        budget_value = budget_mod.validate_daily_budget(raw_budget)
    except budget_mod.BudgetConfigError as exc:
        logger.error("spike-cache: daily_budget_tokens config invalid · fail-CLOSED: %s", exc)
        return _fail_closed_response(model, reason_code="budget_config_invalid")

    # 7. api_request_id 门(reserve 需唯一 id · 空则无法 settle)
    if not api_request_id:
        logger.warning("spike-cache: empty api_request_id · fail-CLOSED · cannot track reservation")
        return _fail_closed_response(model, reason_code="missing_api_request_id")

    # 8. Cache eligibility 判定(与 budget 决策解耦 · Codex §II step 4)
    cacheable_req = is_cacheable_request(request, api_mode=api_mode)

    # 9. 若可缓存 → lookup · HIT 直接返回(不 reserve)
    cache_key: Optional[str] = None
    if cacheable_req:
        cache_key = build_cache_key(request, tenant_ctx, model=model, provider=provider)
        with _lock:
            hit = _cache.get(cache_key)
            if hit is not None:
                _cache.move_to_end(cache_key)
        if hit is not None:
            # cache hit · 不 reserve · 顶层 usage=0 · shallow copy 防调用方 mutate
            return dict(hit)

    # 10. MISS 或非 cacheable · 都必须 reserve(Codex §II step 6)
    tokens_needed = _estimate_needed_tokens(request, ctx)
    try:
        budget_mod.reserve(tenant_id, api_request_id, tokens_needed, budget=budget_value)
    except budget_mod.BudgetExceeded:
        logger.warning(
            "spike-cache: budget exceeded · tenant=%s api_request_id=%s tokens_needed=%s budget=%s",
            tenant_id, api_request_id, tokens_needed, budget_value,
        )
        return _fail_closed_response(
            model,
            reason_code="budget_exceeded",
            tenant_id=tenant_id,
            tokens_needed=tokens_needed,
            budget=budget_value,
        )

    # 11. next_call · success settle actual / exception release
    try:
        response = next_call(request)
    except Exception:
        budget_mod.release(tenant_id, api_request_id)
        raise

    # 12. Settle 实际用量(所有非异常路径都 settle · cacheable/非 cacheable 无关)
    actual = _extract_actual_usage(response)
    try:
        budget_mod.settle(tenant_id, api_request_id, actual)
    except budget_mod.BudgetSettleError as exc:
        # 理论不该发生(reserve 刚成功)· 记 audit · 不阻断 response
        logger.error(
            "spike-cache: settle raised BudgetSettleError post-reserve · api_request_id=%s: %s",
            api_request_id, exc,
        )

    # 13. 只有 req + resp 皆 cacheable 才 insert
    if cacheable_req and cache_key is not None and is_cacheable_response(response):
        cached = _extract_cacheable_response(response)
        with _lock:
            _cache[cache_key] = cached
            _cache.move_to_end(cache_key)
            while len(_cache) > CACHE_MAX_SIZE:
                _cache.popitem(last=False)

    return response


def _extract_actual_usage(response: Any) -> int:
    """从 response.usage 抽 prompt+completion tokens."""
    try:
        if isinstance(response, dict):
            usage = response.get("usage") or {}
        else:
            usage = getattr(response, "usage", None) or {}
        if isinstance(usage, dict):
            return int(usage.get("prompt_tokens", 0) or 0) + int(usage.get("completion_tokens", 0) or 0)
        return int(getattr(usage, "prompt_tokens", 0) or 0) + int(getattr(usage, "completion_tokens", 0) or 0)
    except Exception:   # noqa: BLE001
        return 0


def clear_cache() -> None:
    """测试用 · 清空 LRU + reset budget bucket。"""
    with _lock:
        _cache.clear()


def cache_size() -> int:
    with _lock:
        return len(_cache)


def register(ctx: Any) -> None:
    """PluginContext register · 挂 llm_execution middleware(orchestrator)."""
    ctx.register_middleware("llm_execution", cache_and_budget_middleware)
