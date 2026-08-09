"""P3-M0 Spike · tenant-safe cache + orchestrator(llm_execution middleware).

**Codex §I / §III / §IV 契约**:

1. 注册 `llm_execution` middleware(`ctx.register_middleware("llm_execution", ...)`)·
   经过 `run_llm_execution_middleware`(`hermes_cli/middleware.py:187`)真正生产走位·
   fail-open on callback(fork middleware 语义 · 见 middleware.py:_run_execution_chain)
2. 显式 orchestrate order:
     cache lookup
       ├─ hit → 返回 cached + 顶层 usage=0 · cache_meta.hit=True · **不 reserve budget**
       └─ miss → budget reserve
                 → next_call(request)
                   ├─ success → cache insert(if cacheable) + budget settle(actual)
                   └─ exception → budget release · re-raise
3. 严格 tenant fail-closed:tenant_id/principal_id/permission_scope_version/
   profile_version 任一缺失/空/非法 → 走 next_call(不 lookup 不 insert)· log context_invalid
4. **只**支持 `api_mode == "chat_completions"`;其他 3 mode fail-closed pass-through
5. 顶层 `usage` = billable_usage(全 0)· 原始生成 usage 只在 `cache_meta.origin_usage`
6. 并发:threading.Lock 保护 LRU + insert 序
7. 配置:从 `hermes_cli.config.load_config` 读 `plugins.spike_p3_m0_cache.enabled` 等
   · **不**用 SPIKE_* env · **不**读 profile.yaml
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
    for name, mod in list(sys.modules.items()):
        if name.endswith(".spike_p3_m0_budget") or name == "spike_p3_m0_budget":
            return mod
    raise ImportError(
        "spike_p3_m0_budget module not loaded; enable it in plugins.enabled"
    )

CACHE_CONTRACT_VERSION = "v1"
CODEC_VERSION = "codec_v1"
CACHE_MAX_SIZE = 256   # LRU cap · 简单进程内 · M0 不 persistent

# 允许 tenant_id/principal_id/permission_scope_version/profile_version 的字符白名单
# (类比 Hermes_AI `_validate_tenant_id` · 保守集合)
_ID_ALLOWED_RE = re.compile(r"^[a-zA-Z0-9_\-]+$")
_ID_MAX_LEN = 128


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
    """`plugins.spike_p3_m0_cache.enabled` · 默认 False(opt-in)。"""
    return bool(_get_plugin_config().get("enabled"))


def _get_tenant_context() -> Optional[Dict[str, str]]:
    """严格 fail-closed tenant context · 从 config `plugins.spike_p3_m0_cache.tenant` 读。

    所有 4 字段(tenant_id/principal_id/permission_scope_version/profile_version)必需·
    非空 · 类型 str · 字符白名单 · 任一违反 → 返回 None(fail-closed · log context_invalid).

    **禁**默认填 "system"/"0" 等安全值(Codex §III 明令)。

    T2 首选:由 provisioning 写入该 tenant 独立 HERMES_HOME 的 config.yaml · fork
    进程仅信 config · 不信 prompt/tool_args。
    """
    tenant_block = _get_plugin_config().get("tenant") or {}
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


def _get_budget_for_tenant() -> Optional[int]:
    """`plugins.spike_p3_m0_cache.tenant.daily_budget_tokens` · 4 态归一化。

    非法值(bool/负/str/float)→ 记录 audit · 返回 None(fail-open · 不 enforce)
    """
    raw = (_get_plugin_config().get("tenant") or {}).get("daily_budget_tokens")
    budget_mod = _budget_module()
    try:
        return budget_mod.validate_daily_budget(raw)
    except budget_mod.BudgetConfigError as exc:
        logger.warning("spike-cache: daily_budget_tokens config invalid · not enforced: %s", exc)
        return None


# ── Cacheability guards(§4)── 只支持 chat_completions ────────────

def _api_mode_supported(api_mode: str) -> bool:
    """M0 只支持 `chat_completions` · 其他 fail-closed pass-through。"""
    return api_mode == "chat_completions"


def is_cacheable_request(request: Any, *, api_mode: str = "chat_completions") -> bool:
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


# ── Orchestrator middleware(cache + budget 显式组合)────────────

def cache_and_budget_middleware(
    request: Any,
    next_call: Callable[[Any], Any],
    **ctx: Any,
) -> Any:
    """`llm_execution` middleware · 严格 Codex §I 顺序:

    cache lookup → hit(返回 · 不 reserve)/ miss → reserve → next_call →
      success(cache insert + settle actual)/ exception(release + re-raise)

    fail-closed 无 tenant · fail-closed 非 chat_completions · fail-open 非 dict.
    """
    api_request_id = ctx.get("api_request_id") or ""
    api_mode = ctx.get("api_mode") or "chat_completions"
    provider = ctx.get("provider") or ""
    model = ctx.get("model") or ""

    # Fast pass-through · 未启用 / 不支持 mode / 非 dict request
    if not _is_enabled() or not _api_mode_supported(api_mode) or not isinstance(request, dict):
        return next_call(request)

    tenant_ctx = _get_tenant_context()
    if not tenant_ctx:
        # 严格 fail-closed · 无 tenant → 走 next_call(不 lookup 不 insert · 不 reserve)
        return next_call(request)

    if not is_cacheable_request(request, api_mode=api_mode):
        return next_call(request)

    key = build_cache_key(request, tenant_ctx, model=model, provider=provider)
    tenant_id = tenant_ctx["tenant_id"]

    # ── 1. Cache lookup ──
    with _lock:
        hit = _cache.get(key)
        if hit is not None:
            _cache.move_to_end(key)   # LRU touch
    if hit is not None:
        # Hit · 返回 cached · **不 reserve budget** · 顶层 usage=0
        return dict(hit)   # shallow copy · 避免调用方 mutate

    # ── 2. Miss · budget reserve(basedon config budget) ──
    budget_value = _get_budget_for_tenant()
    approx_input = int(ctx.get("approx_input_tokens") or 0)
    max_tokens = int(request.get("max_tokens") or ctx.get("max_tokens") or 0)
    tokens_needed = approx_input + max_tokens

    budget_mod = _budget_module()
    try:
        budget_mod.reserve(tenant_id, api_request_id, tokens_needed, budget=budget_value)
    except budget_mod.BudgetExceeded:
        # 预算超支 · 明确阻断 · 不调 next_call · 返回结构化 error response
        logger.warning("spike-cache-orchestrator: budget exceeded · tenant=%s api_request_id=%s", tenant_id, api_request_id)
        return {
            "model": model,
            "choices": [{"message": {"content": ""}, "finish_reason": "content_filter"}],
            "usage": {"prompt_tokens": 0, "completion_tokens": 0},
            "cache_meta": {"hit": False, "budget_exceeded": True, "tenant_id": tenant_id},
        }

    # ── 3. next_call · success settle actual / exception release ──
    try:
        response = next_call(request)
    except Exception:
        budget_mod.release(tenant_id, api_request_id)
        raise

    # ── 4. Cache insert(if cacheable) + budget settle actual ──
    actual = _extract_actual_usage(response)
    budget_mod.settle(tenant_id, api_request_id, actual)

    if is_cacheable_response(response):
        cached = _extract_cacheable_response(response)
        with _lock:
            _cache[key] = cached
            _cache.move_to_end(key)
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
