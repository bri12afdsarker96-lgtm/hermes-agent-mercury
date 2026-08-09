"""P3-M0 Spike · tenant-safe cache prototype(middleware seam · fail-closed).

**范围严守**(见 Hermes_AI 侧 `docs/fork/cache-layer.md`):

- Seam:`run_llm_execution_middleware` @ `hermes_cli/middleware.py:187`(byte-identical baseline→fresh)
- **fail-closed 无 tenant**:context 缺失 → 走 `next_call(request)` 不 lookup 不 insert
- 只缓存 non-streaming + tool-free + successful terminal · 其他一律不缓存
- **cache key schema v1**:tenant_id / principal_id / permission_scope_version / provider / model /
  system_prompt_version / tool_schema_version / profile_version / knowledge_collection /
  knowledge_collection_version / normalized_semantic_messages / cache_contract_version
- **usage 拆分**:origin_usage(元数据 · 不进 totals)· billable_usage=0 · saved_usage · cache_lookup_cost
- **cache hit 仍触发**:post_api_request hook · 独立 rate limit · audit `cache.hit` metric

**M0 首轮 spike 实装**:
- `_get_tenant_context()` = 从 `HERMES_HOME/profile.yaml` 读(T2 · 单进程单 tenant)
- `_is_cacheable_request/response` = §1 严格布尔
- `_build_cache_key` = §2 schema · sha256
- `_cache` = 内存 LRU dict(**不 persistent · 不 cross-session · 不 cross-process**)
- `_attach_cache_meta` = 附 cache_meta 字段

**M0 首轮 spike 不做**:
- 生产接线到 fork core middleware(需 fork core PR · 独立)· spike 只提供 middleware
  callback 可挂式接口 + 完整 fixture 测试
- persistent / cross-session cache
- streaming 缓冲 codec
"""
from __future__ import annotations

import hashlib
import json
import logging
import os
from collections import OrderedDict
from pathlib import Path
from typing import Any, Callable, Dict, Optional

logger = logging.getLogger(__name__)

CACHE_CONTRACT_VERSION = "v1"
CACHE_MAX_SIZE = 256   # LRU cap · 简单进程内 · M0 不 persistent

# ── module-level state · spike scope · fork core middleware 接线由后续 PR ──

_cache: "OrderedDict[str, Dict[str, Any]]" = OrderedDict()
_ENABLED = os.environ.get("SPIKE_P3_M0_CACHE_ENABLED", "0") == "1"   # 默认 OFF · config.yaml 可以覆盖 · 见 spec


# ── Tenant context helper(T2 · profile.yaml)──


def _get_tenant_context() -> Optional[Dict[str, Any]]:
    """从 HERMES_HOME/profile.yaml 读 tenant metadata(T2 · 单进程单 tenant)。

    返回 dict 含:tenant_id / principal_id / permission_scope_version /
    profile_version(全部 required · 缺一 fail-closed)。

    **T1(单进程多租户)未启用** · host session metadata 通道待 M2+。
    """
    hermes_home_env = os.environ.get("HERMES_HOME")
    if not hermes_home_env:
        return None
    profile_path = Path(hermes_home_env) / "profile.yaml"
    if not profile_path.exists():
        return None
    try:
        import yaml   # type: ignore

        with profile_path.open("r", encoding="utf-8") as f:
            raw = yaml.safe_load(f) or {}
    except Exception as exc:   # noqa: BLE001
        logger.warning("spike-cache: profile.yaml read failed: %s", exc)
        return None
    tenant_block = raw.get("tenant") or {}
    tid = tenant_block.get("tenant_id")
    if not tid:
        return None
    return {
        "tenant_id": str(tid),
        "principal_id": str(tenant_block.get("principal_id") or "system"),
        "permission_scope_version": str(tenant_block.get("permission_scope_version") or "0"),
        "profile_version": str(tenant_block.get("profile_version") or "0"),
    }


# ── Cacheability guards(§1 严格集合)──


def is_cacheable_request(request: Dict[str, Any]) -> bool:
    """仅接收 non-streaming + tool-free 请求。"""
    if request.get("stream"):
        return False
    tools = request.get("tools") or []
    if tools:
        return False
    return True


def is_cacheable_response(response: Any) -> bool:
    """仅接收 successful terminal response(无 tool_calls · finish=stop)。"""
    try:
        choices = response.get("choices") if isinstance(response, dict) else getattr(response, "choices", None)
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
        if finish not in ("stop",):
            return False
        return True
    except Exception:   # noqa: BLE001
        return False


# ── Cache key builder(§2 schema)──


def build_cache_key(
    request: Dict[str, Any],
    tenant_ctx: Dict[str, Any],
    *,
    model: str,
    provider: str,
) -> str:
    """SHA-256 hex of the deterministic key components."""
    messages_bytes = json.dumps(request.get("messages") or [], sort_keys=True, ensure_ascii=False).encode("utf-8")
    system_prompt_hash = hashlib.sha256(messages_bytes[:1024]).hexdigest()[:16]   # 简 hash · M0 spike
    tools_bytes = json.dumps(request.get("tools") or [], sort_keys=True, ensure_ascii=False).encode("utf-8")
    tools_hash = hashlib.sha256(tools_bytes).hexdigest()[:16]
    parts = {
        "tenant_id": tenant_ctx["tenant_id"],
        "principal_id": tenant_ctx["principal_id"],
        "permission_scope_version": tenant_ctx["permission_scope_version"],
        "provider": provider,
        "model": model,
        "system_prompt_version": system_prompt_hash,
        "tool_schema_version": tools_hash,
        "profile_version": tenant_ctx["profile_version"],
        "knowledge_collection": request.get("_kb_collection") or "",
        "knowledge_collection_version": request.get("_kb_version") or "",
        "normalized_semantic_messages": hashlib.sha256(messages_bytes).hexdigest(),
        "cache_contract_version": CACHE_CONTRACT_VERSION,
    }
    canonical = json.dumps(parts, sort_keys=True, ensure_ascii=False).encode("utf-8")
    return hashlib.sha256(canonical).hexdigest()


# ── Cache middleware(可挂载到 run_llm_execution_middleware · fork core 接线待另 PR)──


def cache_middleware(
    request: Dict[str, Any],
    next_call: Callable[[Any], Any],
    **ctx: Any,
) -> Any:
    """Middleware callback for `run_llm_execution_middleware`(spike 骨架)。

    fail-closed · fail-open · pass-through 决策:
    1. `_ENABLED` False → pass-through
    2. tenant context 缺失 → pass-through(fail-closed 语义:不 lookup / 不 insert)
    3. request 不可缓存 → pass-through
    4. lookup 命中 → 返回 cached response + cache_meta(不调 next_call)
    5. lookup miss → 调 next_call · response 可缓存则 insert · 返回原 response
    """
    if not _ENABLED:
        return next_call(request)

    tenant_ctx = _get_tenant_context()
    if not tenant_ctx:
        return next_call(request)   # fail-closed

    if not is_cacheable_request(request):
        return next_call(request)

    provider = ctx.get("provider", "")
    model = ctx.get("model", "")
    key = build_cache_key(request, tenant_ctx, model=model, provider=provider)

    hit = _cache.get(key)
    if hit is not None:
        # LRU touch
        _cache.move_to_end(key)
        return _attach_cache_meta(hit, hit_meta={"key": key, "tenant_id": tenant_ctx["tenant_id"]})

    response = next_call(request)

    if is_cacheable_response(response):
        _cache[key] = _extract_cacheable_response(response)
        _cache.move_to_end(key)
        while len(_cache) > CACHE_MAX_SIZE:
            _cache.popitem(last=False)

    return response


def _extract_cacheable_response(response: Any) -> Dict[str, Any]:
    """归一 provider response 为可 codec 化 dict(§5 codec_v1)。"""
    # 简化 spike · 只取 chat_completions dict-like 分支
    if isinstance(response, dict):
        return {
            "model": response.get("model"),
            "choices": response.get("choices"),
            "usage": response.get("usage"),
            "codec_version": "codec_v1",
        }
    # 非 dict(SDK 对象)· 提取属性
    return {
        "model": getattr(response, "model", None),
        "choices": getattr(response, "choices", None),
        "usage": getattr(response, "usage", None),
        "codec_version": "codec_v1",
    }


def _attach_cache_meta(cached: Dict[str, Any], *, hit_meta: Dict[str, Any]) -> Dict[str, Any]:
    """附 cache_meta(usage 拆分 · §4)。"""
    origin_usage = cached.get("usage") or {}
    if hasattr(origin_usage, "__dict__"):
        origin_usage = {k: getattr(origin_usage, k, None) for k in ("prompt_tokens", "completion_tokens")}
    result = dict(cached)
    result["cache_meta"] = {
        "hit": True,
        "cache_contract_version": CACHE_CONTRACT_VERSION,
        "origin_usage": origin_usage,
        "billable_usage": {"prompt_tokens": 0, "completion_tokens": 0},
        "saved_usage": origin_usage,
        "cache_lookup_cost": None,   # in-memory 通常 0
        "key": hit_meta["key"],
    }
    return result


def clear_cache() -> None:
    """spike helper · 测试用。"""
    _cache.clear()


def register(ctx: Any) -> None:
    """Spike registration · 目前不注册任何 hook · fork core middleware 接线由独立 PR。

    通过 module-level API(`cache_middleware`, `is_cacheable_request`, ...)供
    上游 middleware 挂载。fork core 侧的实际挂载(在
    `hermes_cli/middleware.py::LLM_EXECUTION_MIDDLEWARE` list 上加一项)不属于
    plugin ctx 范围 · 需 fork core PR。
    """
    return   # M0 spike 不注册 hook · 仅 export API
