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
       ├─ 非预算支持 api_mode → fail-CLOSED(见 §II)
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

4. budget enforcement 支持 `chat_completions` 与 `anthropic_messages`；后者是
   MiniMax M3 的正式 messages 走位，**只预算、不 lookup/insert cache**。其他
   mode(`bedrock_converse` / `codex_responses` 等)fail-CLOSED · **不 next_call**。

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

import copy
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


class ConfigLoadError(RuntimeError):
    """The runtime config could not be read safely."""


class ConfigShapeError(RuntimeError):
    """The runtime config has an invalid shape for this plugin."""


class ConfigEnabledTypeError(RuntimeError):
    """``enabled`` was present but was not a literal boolean.

    Keep the fixed message deliberately value-free: configuration values can
    contain secrets or other sensitive operator data and must never surface in
    a middleware response or log record.
    """


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


CACHE_CONTRACT_VERSION = "v2"
CODEC_VERSION = "codec_v1"
CACHE_MAX_SIZE = 256   # LRU cap · 简单进程内 · M0 不 persistent

# Gate 2C-A separates an execution mode that can be budget-enforced from one
# whose response has a stable cache codec.  MiniMax M3 uses
# ``anthropic_messages``: its token accounting is supported, but it is never a
# cache key/lookup/insert candidate.  Keep these explicit allowlists so a new
# upstream API mode cannot accidentally become billable or cacheable.
_BUDGET_ENFORCED_API_MODES = frozenset({"chat_completions", "anthropic_messages"})
_CACHEABLE_API_MODES = frozenset({"chat_completions"})

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
    """Load fork config via ``hermes_cli.config.load_config``.

    Once the middleware has been registered, a config read failure is a
    security failure, not evidence that the plugin is disabled.  Returning an
    empty mapping here would make ``_is_enabled`` false and silently bypass
    budget enforcement through ``next_call``.
    """
    try:
        from hermes_cli.config import load_config

        cfg = load_config()
    except Exception as exc:   # noqa: BLE001
        raise ConfigLoadError("spike cache config could not be loaded") from exc
    if cfg is None:
        return {}
    if not isinstance(cfg, dict):
        raise ConfigShapeError("root config must be a mapping")
    return cfg


def _get_plugin_config() -> Dict[str, Any]:
    """Return the validated ``plugins.spike_p3_m0_cache`` mapping."""
    cfg = _load_config()
    plugins_cfg = cfg.get("plugins")
    if plugins_cfg is None:
        return {}
    if not isinstance(plugins_cfg, dict):
        raise ConfigShapeError("plugins config must be a mapping")
    plugin_cfg = plugins_cfg.get("spike_p3_m0_cache")
    if plugin_cfg is None:
        return {}
    if not isinstance(plugin_cfg, dict):
        raise ConfigShapeError("spike_p3_m0_cache config must be a mapping")
    return plugin_cfg


def _is_enabled(plugin_cfg: Optional[Dict[str, Any]] = None) -> bool:
    """`plugins.spike_p3_m0_cache.enabled` **严格 bool** · 只接受 literal `True`。

    Missing is the backwards-compatible explicit-off default; ``False`` is a
    valid explicit off switch.  Any *present* non-bool value is a configuration
    error rather than a silent bypass, because the outer middleware chain is
    fail-open for ordinary plugin exceptions.
    """
    if plugin_cfg is None:
        plugin_cfg = _get_plugin_config()
    if "enabled" not in plugin_cfg:
        return False
    value = plugin_cfg["enabled"]
    if not isinstance(value, bool):
        raise ConfigEnabledTypeError("config_enabled_type_invalid")
    return value


def _get_tenant_context(
    plugin_cfg: Optional[Dict[str, Any]] = None,
) -> Optional[Dict[str, str]]:
    """严格 fail-closed tenant context · 从 config `plugins.spike_p3_m0_cache.tenant` 读。

    所有 4 字段(tenant_id/principal_id/permission_scope_version/profile_version)必需·
    非空 · 类型 str · 字符白名单 · 任一违反 → 返回 None(fail-closed · log context_invalid).

    **禁**默认填 "system"/"0" 等安全值(Codex §III 明令)。

    T2 首选:由 provisioning 写入该 tenant 独立 HERMES_HOME 的 config.yaml · fork
    进程仅信 config · 不信 prompt/tool_args。
    """
    if plugin_cfg is None:
        plugin_cfg = _get_plugin_config()
    tenant_block = plugin_cfg.get("tenant") or {}
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
    """Return whether this mode can run behind the budget enforcement gate."""
    return api_mode in _BUDGET_ENFORCED_API_MODES


def is_cacheable_request(request: Any, *, api_mode: str = "chat_completions") -> bool:
    """判 request 是否可 lookup/insert cache(**与 budget 决策解耦**)。

    Codex §II:streaming / tools 可以不缓存 · 但**不能不计预算**。
    """
    if api_mode not in _CACHEABLE_API_MODES:
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
    api_mode: str = "chat_completions",
) -> str:
    """SHA-256 of deterministic semantic request components(schema v2).

    Besides identity, messages, and tool schema, every public request option
    that can affect generation is hashed.  This intentionally prefers a cache
    miss over reusing a response produced with different sampling, output,
    reasoning, or provider-specific options.
    """
    messages = request.get("messages") or []
    messages_bytes = json.dumps(messages, sort_keys=True, ensure_ascii=False).encode("utf-8")
    tools_bytes = json.dumps(request.get("tools") or [], sort_keys=True, ensure_ascii=False).encode("utf-8")
    generation_options = {
        key: value
        for key, value in request.items()
        if key not in {"messages", "tools", "stream", "_kb_collection", "_kb_version"}
        and not key.startswith("_")
    }
    generation_options_bytes = json.dumps(
        generation_options,
        sort_keys=True,
        ensure_ascii=False,
    ).encode("utf-8")
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
        "api_mode": api_mode,
        "system_prompt_version": hashlib.sha256(sys_msg_content.encode("utf-8")).hexdigest()[:16],
        "tool_schema_version": hashlib.sha256(tools_bytes).hexdigest()[:16],
        "generation_options_version": hashlib.sha256(generation_options_bytes).hexdigest(),
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
    choices = copy.deepcopy(_get(response, "choices"))
    return {
        "model": _get(response, "model"),
        "choices": choices,
        "usage": {"prompt_tokens": 0, "completion_tokens": 0},   # 顶层 usage = billable_usage · 全 0
        "codec_version": CODEC_VERSION,
        "cache_meta": {
            "hit": True,
            "cache_contract_version": CACHE_CONTRACT_VERSION,
            "origin_usage": copy.deepcopy(origin_usage_obj),
            "billable_usage": {"prompt_tokens": 0, "completion_tokens": 0},
            "saved_usage": copy.deepcopy(origin_usage_obj),
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
    if isinstance(max_tokens_raw, bool):
        raise ValueError("max_tokens must not be bool")
    try:
        max_tokens = int(max_tokens_raw or 0)
    except (TypeError, ValueError) as exc:
        raise ValueError("max_tokens must be an integer") from exc
    if max_tokens < 0:
        raise ValueError("max_tokens must be >= 0")
    estimated = approx_input + max_tokens
    if estimated <= 0:
        raise ValueError("token estimate unavailable")
    return estimated


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
    raw_api_request_id = ctx.get("api_request_id")
    raw_api_mode = ctx.get("api_mode")
    raw_provider = ctx.get("provider")
    raw_model = ctx.get("model")
    context_values = (raw_api_request_id, raw_api_mode, raw_provider, raw_model)
    if any(value is not None and not isinstance(value, str) for value in context_values):
        return _fail_closed_response("", reason_code="invalid_execution_context")
    api_request_id = raw_api_request_id or ""
    api_mode = raw_api_mode or "chat_completions"
    provider = raw_provider or ""
    model = raw_model or ""

    # 1. Resolve config exactly once.  A registered middleware whose config
    # cannot be read/validated must not be mistaken for a disabled plugin:
    # the outer execution chain is intentionally fail-open for ordinary
    # plugins, so leaking an exception here would call the provider directly.
    try:
        plugin_cfg = _get_plugin_config()
    except ConfigLoadError:
        logger.error("spike-cache: config load failed · fail-CLOSED")
        return _fail_closed_response(model, reason_code="config_load_failed")
    except ConfigShapeError:
        logger.error("spike-cache: config shape invalid · fail-CLOSED")
        return _fail_closed_response(model, reason_code="config_shape_invalid")
    except Exception as exc:   # noqa: BLE001
        logger.error(
            "spike-cache: unexpected config resolution failure · type=%s · fail-CLOSED",
            type(exc).__name__,
        )
        return _fail_closed_response(model, reason_code="config_internal_error")

    # 2. Only a missing/false literal bool may pass through. A present non-bool
    # is fail-CLOSED instead of being silently interpreted as disabled.
    try:
        enabled = _is_enabled(plugin_cfg)
    except ConfigEnabledTypeError:
        logger.error("spike-cache: config_enabled_type_invalid · fail-CLOSED")
        return _fail_closed_response(model, reason_code="config_enabled_type_invalid")
    except Exception as exc:   # noqa: BLE001
        logger.error(
            "spike-cache: enabled-state resolution failed · type=%s · fail-CLOSED",
            type(exc).__name__,
        )
        return _fail_closed_response(model, reason_code="config_enabled_error")
    if not enabled:
        return next_call(request)

    # 3. Budget module 硬依赖门(Codex §III:cache 单独启用不得因 budget 缺失 fail-open)
    try:
        budget_mod = _budget_module()
    except ImportError:
        logger.error(
            "spike-cache: budget module missing · enable spike-p3-m0-budget in plugins.enabled · fail-CLOSED",
        )
        return _fail_closed_response(model, reason_code="budget_module_missing")
    except Exception as exc:   # noqa: BLE001
        logger.error(
            "spike-cache: budget module resolution failed · type=%s · fail-CLOSED",
            type(exc).__name__,
        )
        return _fail_closed_response(model, reason_code="budget_module_error")

    # 4. api_mode 支持范围收紧。MiniMax M3 anthropic_messages is budget-only;
    # all other unknown modes fail-CLOSED instead of silently passing through.
    try:
        api_mode_supported = _api_mode_supported(api_mode)
    except Exception as exc:   # noqa: BLE001
        logger.error(
            "spike-cache: api-mode classification failed · type=%s · fail-CLOSED",
            type(exc).__name__,
        )
        return _fail_closed_response(model, reason_code="api_mode_error")
    if not api_mode_supported:
        logger.warning(
            "spike-cache: unsupported budget api_mode=%s · fail-CLOSED",
            api_mode,
        )
        # The unknown API-mode value is useful only for server logs.  It is
        # attacker-controlled context and must not be reflected in the wire
        # response or cache metadata.
        return _fail_closed_response(model, reason_code="unsupported_api_mode")

    # 5. request 类型门(non-dict 无法 estimate token · fail-CLOSED)
    if not isinstance(request, dict):
        logger.warning("spike-cache: request not a dict · fail-CLOSED · type=%s", type(request).__name__)
        return _fail_closed_response(model, reason_code="non_dict_request")

    # Provider and model are mandatory cache identity fields.  Empty values
    # would collapse unrelated upstream attempts into the same key.
    if not provider or not model:
        logger.warning("spike-cache: provider/model context missing · fail-CLOSED")
        return _fail_closed_response(model, reason_code="missing_provider_or_model")

    # 6. tenant context 严格 fail-CLOSED(Codex §III:enforcement 开启时 next_call == 0)
    try:
        tenant_ctx = _get_tenant_context(plugin_cfg)
        tenant_id = tenant_ctx["tenant_id"] if tenant_ctx is not None else None
    except Exception as exc:   # noqa: BLE001
        logger.error(
            "spike-cache: tenant context resolution failed · type=%s · fail-CLOSED",
            type(exc).__name__,
        )
        return _fail_closed_response(model, reason_code="tenant_context_error")
    if tenant_ctx is None:
        return _fail_closed_response(model, reason_code="tenant_context_invalid")
    assert tenant_id is not None

    # 7. Budget config 校验 · BudgetConfigError 硬 fail-CLOSED(Codex §III:不转 None 静默继续)
    tenant_cfg = plugin_cfg.get("tenant")
    # A valid tenant context guarantees this is a mapping.
    raw_budget = tenant_cfg.get("daily_budget_tokens")
    try:
        budget_value = budget_mod.validate_daily_budget(raw_budget)
    except budget_mod.BudgetConfigError:
        logger.error("spike-cache: daily_budget_tokens config invalid · fail-CLOSED")
        return _fail_closed_response(model, reason_code="budget_config_invalid")
    except Exception as exc:   # noqa: BLE001
        logger.error(
            "spike-cache: budget config validation failed · type=%s · fail-CLOSED",
            type(exc).__name__,
        )
        return _fail_closed_response(model, reason_code="budget_config_error")

    # 8. Cache eligibility 判定(与 budget 决策解耦 · Codex §II step 4)
    try:
        cacheable_req = is_cacheable_request(request, api_mode=api_mode)
    except Exception as exc:   # noqa: BLE001
        logger.error(
            "spike-cache: request classification failed · type=%s · fail-CLOSED",
            type(exc).__name__,
        )
        return _fail_closed_response(model, reason_code="request_classification_error")

    # 9. 若可缓存 → lookup · HIT 直接返回(不 reserve).  Any internal
    # pre-provider failure is converted locally to fail-CLOSED so it cannot
    # escape into the outer middleware chain's fail-open policy.
    cache_key: Optional[str] = None
    if cacheable_req:
        try:
            cache_key = build_cache_key(
                request,
                tenant_ctx,
                model=model,
                provider=provider,
                api_mode=api_mode,
            )
            with _lock:
                hit = _cache.get(cache_key)
                if hit is not None:
                    _cache.move_to_end(cache_key)
        except Exception as exc:   # noqa: BLE001
            logger.error(
                "spike-cache: cache lookup/key failure · type=%s · fail-CLOSED",
                type(exc).__name__,
            )
            return _fail_closed_response(model, reason_code="cache_lookup_error")
        if hit is not None:
            # cache hit · 不 reserve · 顶层 usage=0 · shallow copy 防调用方 mutate
            return copy.deepcopy(hit)

    # 10. MISS 或非 cacheable · budget=None 明确表示不启用护栏，因此既不
    # 需要 api_request_id，也不做 token estimation/reserve/settle。
    reservation_active = budget_value is not None
    tokens_needed: Optional[int] = None
    if reservation_active:
        if not api_request_id:
            logger.warning("spike-cache: empty api_request_id · fail-CLOSED · cannot track reservation")
            return _fail_closed_response(model, reason_code="missing_api_request_id")
        try:
            tokens_needed = _estimate_needed_tokens(request, ctx)
        except Exception as exc:   # noqa: BLE001
            logger.error(
                "spike-cache: token estimation failed · type=%s · fail-CLOSED",
                type(exc).__name__,
            )
            return _fail_closed_response(model, reason_code="token_estimation_error")
    try:
        if reservation_active:
            assert tokens_needed is not None
            budget_mod.reserve(tenant_id, api_request_id, tokens_needed, budget=budget_value)
    except budget_mod.BudgetExceeded:
        logger.warning(
            "spike-cache: budget exceeded · tenant=%s api_request_id=%s tokens_needed=%s budget=%s",
            tenant_id, api_request_id, tokens_needed, budget_value,
        )
        return _fail_closed_response(
            model,
            reason_code="budget_exceeded",
        )
    except Exception as exc:   # noqa: BLE001
        # Defensive cleanup in case a future reserve implementation mutates
        # state before raising.  Never expose exception text to the user.
        if reservation_active:
            try:
                budget_mod.release(tenant_id, api_request_id)
            except Exception:   # noqa: BLE001
                pass
        logger.error(
            "spike-cache: budget reserve internal failure · type=%s · fail-CLOSED",
            type(exc).__name__,
        )
        return _fail_closed_response(model, reason_code="budget_reserve_error")

    # 12. next_call · success settle actual / exception release.  This narrow
    # try block deliberately preserves downstream exception identity.
    try:
        response = next_call(request)
    except Exception:
        if reservation_active:
            try:
                budget_mod.release(tenant_id, api_request_id)
            except Exception as cleanup_exc:   # noqa: BLE001
                logger.error(
                    "spike-cache: reservation release failed after provider error · type=%s",
                    type(cleanup_exc).__name__,
                )
        raise

    # 13. Settle 实际用量(所有非异常路径都 settle · cacheable/非 cacheable 无关)
    if reservation_active:
        assert tokens_needed is not None
        actual = _extract_actual_usage(response)
        if actual is None:
            actual = tokens_needed
        try:
            budget_mod.settle(tenant_id, api_request_id, actual)
        except Exception as exc:   # noqa: BLE001
            # Provider cost has already been incurred.  Do not throw into the
            # outer fail-open chain after next_call; clean pending state best
            # effort, record only the exception type, and preserve the response.
            try:
                budget_mod.release(tenant_id, api_request_id)
            except Exception:   # noqa: BLE001
                pass
            logger.error(
                "spike-cache: budget settle internal failure · type=%s",
                type(exc).__name__,
            )

    # 14. 只有 req + resp 皆 cacheable 才 insert.  Cache bookkeeping is
    # best-effort after a paid provider response and must never replace it.
    try:
        cacheable_resp = (
            cacheable_req
            and cache_key is not None
            and is_cacheable_response(response)
        )
    except Exception as exc:   # noqa: BLE001
        logger.error(
            "spike-cache: response classification failed after provider response · type=%s",
            type(exc).__name__,
        )
        cacheable_resp = False
    if cacheable_resp:
        try:
            cached = _extract_cacheable_response(response)
            with _lock:
                _cache[cache_key] = cached
                _cache.move_to_end(cache_key)
                while len(_cache) > CACHE_MAX_SIZE:
                    _cache.popitem(last=False)
        except Exception as exc:   # noqa: BLE001
            logger.error(
                "spike-cache: cache insert failed after provider response · type=%s",
                type(exc).__name__,
            )

    return response


def _extract_actual_usage(response: Any) -> Optional[int]:
    """从 response.usage 抽 token 数；缺失/非法返回 None 触发 reservation fallback。"""
    try:
        if isinstance(response, dict):
            usage = response.get("usage")
        else:
            usage = getattr(response, "usage", None)
        if usage is None:
            return None
        if isinstance(usage, dict):
            if "prompt_tokens" not in usage and "completion_tokens" not in usage:
                return None
            prompt = usage.get("prompt_tokens", 0)
            completion = usage.get("completion_tokens", 0)
        else:
            if not hasattr(usage, "prompt_tokens") and not hasattr(usage, "completion_tokens"):
                return None
            prompt = getattr(usage, "prompt_tokens", 0)
            completion = getattr(usage, "completion_tokens", 0)
        if (
            isinstance(prompt, bool)
            or isinstance(completion, bool)
            or not isinstance(prompt, int)
            or not isinstance(completion, int)
            or prompt < 0
            or completion < 0
        ):
            return None
        return prompt + completion
    except Exception:   # noqa: BLE001
        return None


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
