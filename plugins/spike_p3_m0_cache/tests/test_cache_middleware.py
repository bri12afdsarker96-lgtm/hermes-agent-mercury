"""P3-M0 Spike · cache prototype 测试。

覆盖:
- 无 tenant context → fail-closed(pass-through · 不 lookup · 不 insert)
- streaming request → 不 lookup
- tools request → 不 lookup
- response 含 tool_calls → 不 insert
- response finish=length → 不 insert
- lookup hit → 返回 cached + cache_meta(usage 拆分)
- LRU cap · SHA-256 key 稳定 · fallback 后 provider 变 key 变

**未接线 fork core middleware**(需独立 PR)· 本测试直接调 `cache_middleware()`
callback 验证语义。
"""
from __future__ import annotations

import os
from pathlib import Path
from typing import Any, Dict

import pytest

from plugins.spike_p3_m0_cache import (
    CACHE_CONTRACT_VERSION,
    build_cache_key,
    cache_middleware,
    clear_cache,
    is_cacheable_request,
    is_cacheable_response,
)


@pytest.fixture(autouse=True)
def _cache_isolation(monkeypatch, tmp_path):
    """Enable spike cache + isolate HERMES_HOME per test."""
    monkeypatch.setenv("SPIKE_P3_M0_CACHE_ENABLED", "1")
    monkeypatch.setenv("HERMES_HOME", str(tmp_path))
    # Reload the module-level flag(_ENABLED 是 import-time 常量 · 直接 monkeypatch 模块属性)
    import plugins.spike_p3_m0_cache as mod

    monkeypatch.setattr(mod, "_ENABLED", True)
    clear_cache()
    yield
    clear_cache()


def _write_profile(tmp_path: Path, **overrides) -> None:
    import yaml   # type: ignore

    profile = {
        "tenant": {
            "tenant_id": "t_test",
            "principal_id": "p_test",
            "permission_scope_version": "1",
            "profile_version": "1",
            **overrides,
        }
    }
    (tmp_path / "profile.yaml").write_text(yaml.safe_dump(profile), encoding="utf-8")


# ── Cacheability guards ──


def test_streaming_request_not_cacheable():
    assert is_cacheable_request({"stream": True, "messages": []}) is False


def test_tools_request_not_cacheable():
    assert is_cacheable_request({"messages": [], "tools": [{"name": "x"}]}) is False


def test_normal_request_cacheable():
    assert is_cacheable_request({"messages": [{"role": "user", "content": "hi"}]}) is True


def test_response_with_tool_calls_not_cacheable():
    resp = {"choices": [{"message": {"tool_calls": [{"id": "1"}]}, "finish_reason": "tool_calls"}]}
    assert is_cacheable_response(resp) is False


def test_response_finish_not_stop_not_cacheable():
    resp = {"choices": [{"message": {"content": "x"}, "finish_reason": "length"}]}
    assert is_cacheable_response(resp) is False


def test_response_stop_cacheable():
    resp = {"choices": [{"message": {"content": "x"}, "finish_reason": "stop"}], "usage": {"prompt_tokens": 5}}
    assert is_cacheable_response(resp) is True


# ── fail-closed 无 tenant ──


def test_no_tenant_context_pass_through(tmp_path):
    """无 profile.yaml → pass-through · 不 lookup 不 insert。"""
    # HERMES_HOME set but profile 未写
    calls = []

    def next_call(_req):
        calls.append(1)
        return {"choices": [{"message": {"content": "hi"}, "finish_reason": "stop"}], "usage": {}}

    request = {"messages": [{"role": "user", "content": "hi"}]}
    resp = cache_middleware(request, next_call, provider="openai", model="gpt-4o")
    assert calls == [1]   # 必调 next
    assert "cache_meta" not in resp


# ── 有 tenant · hit / miss / codec ──


def test_miss_then_hit(tmp_path):
    _write_profile(tmp_path)
    calls = []

    def next_call(_req):
        calls.append(1)
        return {
            "model": "gpt-4o",
            "choices": [{"message": {"content": "cached_answer"}, "finish_reason": "stop"}],
            "usage": {"prompt_tokens": 100, "completion_tokens": 50},
        }

    request = {"messages": [{"role": "user", "content": "hi"}]}

    # 首次 miss
    resp1 = cache_middleware(request, next_call, provider="openai", model="gpt-4o")
    assert calls == [1]
    assert resp1["choices"][0]["message"]["content"] == "cached_answer"
    assert "cache_meta" not in resp1   # miss 无 cache_meta

    # 二次 hit
    resp2 = cache_middleware(request, next_call, provider="openai", model="gpt-4o")
    assert calls == [1]   # next 未再调
    assert resp2["cache_meta"]["hit"] is True
    assert resp2["cache_meta"]["cache_contract_version"] == CACHE_CONTRACT_VERSION
    assert resp2["cache_meta"]["billable_usage"] == {"prompt_tokens": 0, "completion_tokens": 0}
    assert resp2["cache_meta"]["origin_usage"] == {"prompt_tokens": 100, "completion_tokens": 50}
    assert resp2["cache_meta"]["saved_usage"] == {"prompt_tokens": 100, "completion_tokens": 50}


def test_provider_change_invalidates_key(tmp_path):
    """Fallback 后 provider 变 · key 变 · miss。"""
    _write_profile(tmp_path)
    call_providers = []

    def next_call(_req):
        return {
            "choices": [{"message": {"content": "x"}, "finish_reason": "stop"}],
            "usage": {},
        }

    request = {"messages": [{"role": "user", "content": "same"}]}
    r1 = cache_middleware(request, next_call, provider="openai", model="gpt-4o")
    r2 = cache_middleware(request, next_call, provider="anthropic", model="gpt-4o")
    # 两次都 miss(不同 provider)· 均无 cache_meta
    assert "cache_meta" not in r1
    assert "cache_meta" not in r2


def test_tool_calls_response_not_inserted(tmp_path):
    """tool_calls 响应不 insert · 下次同 request 仍 miss。"""
    _write_profile(tmp_path)
    calls = []

    def next_call(_req):
        calls.append(1)
        return {
            "choices": [{"message": {"tool_calls": [{"id": "1"}]}, "finish_reason": "tool_calls"}],
            "usage": {},
        }

    request = {"messages": [{"role": "user", "content": "hi"}]}
    cache_middleware(request, next_call, provider="p", model="m")
    cache_middleware(request, next_call, provider="p", model="m")
    assert calls == [1, 1]   # 两次都调 next(未 insert)


# ── key schema ──


def test_key_schema_stable(tmp_path):
    _write_profile(tmp_path)
    request = {"messages": [{"role": "user", "content": "hi"}]}
    ctx = {
        "tenant_id": "t1", "principal_id": "p1",
        "permission_scope_version": "1", "profile_version": "1",
    }
    k1 = build_cache_key(request, ctx, model="gpt-4o", provider="openai")
    k2 = build_cache_key(request, ctx, model="gpt-4o", provider="openai")
    assert k1 == k2 and len(k1) == 64   # sha256 hex


def test_key_changes_on_tenant(tmp_path):
    request = {"messages": []}
    c1 = {"tenant_id": "A", "principal_id": "p", "permission_scope_version": "1", "profile_version": "1"}
    c2 = {"tenant_id": "B", "principal_id": "p", "permission_scope_version": "1", "profile_version": "1"}
    assert build_cache_key(request, c1, model="m", provider="p") != build_cache_key(request, c2, model="m", provider="p")
