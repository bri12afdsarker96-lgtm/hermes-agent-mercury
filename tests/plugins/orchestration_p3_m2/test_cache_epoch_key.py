"""缓存 epoch key 测试（P3-M2 主脑编排段 · cache contract v3）。

契约：``request["_kb_epoch"]``（宿主注入 · Hermes_AI ``EpochSnapshot.cache_epoch``）
进入 cache key 的 ``authority_epoch`` 段——知识 publish/withdraw/quarantine/
restore 任一 bump epoch 都必须使既有缓存 miss；未注入（"" 缺省）时行为与
无知识数据面部署完全一致。单元层直接断言 ``build_cache_key``；端到端走
真实 PluginManager + ``run_llm_execution_middleware`` 验证 hit→bump→miss。
"""
from __future__ import annotations

import pytest

from plugins.spike_p3_m0_fixtures.pluginmgr_helper import (
    get_discovered_module,
    install_fresh_manager,
    make_run_llm_execution,
    write_config,
)

CACHE_KEY = "spike-p3-m0-cache"
BUDGET_KEY = "spike-p3-m0-budget"

TENANT = {
    "tenant_id": "t_alpha",
    "principal_id": "p_alpha",
    "permission_scope_version": "1",
    "profile_version": "1",
}


def _base_request(**extra):
    req = {"messages": [{"role": "user", "content": "退货政策是什么"}]}
    req.update(extra)
    return req


# ── 单元：build_cache_key ────────────────────────────────────────────


@pytest.fixture()
def cache_mod(tmp_path, monkeypatch, request):
    write_config(tmp_path / "home", [CACHE_KEY, BUDGET_KEY],
                 spike_p3_m0_cache={"enabled": True, "tenant": dict(TENANT)})
    manager = install_fresh_manager(monkeypatch, tmp_path / "home", request)
    mod = get_discovered_module(manager, CACHE_KEY)
    mod.clear_cache()
    yield mod
    mod.clear_cache()


def _key(mod, **extra):
    return mod.build_cache_key(_base_request(**extra), TENANT,
                               model="m", provider="p")


def test_contract_version_is_v3(cache_mod):
    assert cache_mod.CACHE_CONTRACT_VERSION == "v3"


def test_epoch_change_changes_key(cache_mod):
    k1 = _key(cache_mod, _kb_epoch="g1.t3")
    k2 = _key(cache_mod, _kb_epoch="g1.t4")
    k3 = _key(cache_mod, _kb_epoch="g2.t3")
    assert len({k1, k2, k3}) == 3


def test_same_epoch_same_key(cache_mod):
    assert _key(cache_mod, _kb_epoch="g1.t3") == _key(cache_mod, _kb_epoch="g1.t3")


def test_missing_epoch_equals_empty_epoch(cache_mod):
    # 未接线部署（无 _kb_epoch）与显式空值哈希一致——行为保持向后兼容
    assert _key(cache_mod) == _key(cache_mod, _kb_epoch="")


def test_epoch_present_differs_from_absent(cache_mod):
    assert _key(cache_mod, _kb_epoch="g1.t1") != _key(cache_mod)


def test_kb_epoch_not_in_generation_options(cache_mod):
    # _kb_epoch 只进 authority_epoch 段：值相同的两次构造 key 必须一致，
    # 且与其它下划线私有字段一样不影响 generation_options 哈希。
    k1 = cache_mod.build_cache_key(
        _base_request(_kb_epoch="g1.t1", temperature=0.2), TENANT,
        model="m", provider="p")
    k2 = cache_mod.build_cache_key(
        _base_request(_kb_epoch="g1.t1", temperature=0.2, _private_junk="x"), TENANT,
        model="m", provider="p")
    assert k1 == k2


# ── 端到端：hit → epoch bump → miss ──────────────────────────────────


def test_epoch_bump_invalidates_cached_response(cache_mod):
    run = make_run_llm_execution(api_request_id="r1", provider="p",
                                 model="m", api_mode="chat_completions")
    calls = []

    def provider(req):
        calls.append(1)
        return {"model": "m",
                "choices": [{"index": 0,
                             "message": {"role": "assistant", "content": "答案"},
                             "finish_reason": "stop"}],
                "usage": {"prompt_tokens": 3, "completion_tokens": 2}}

    r1 = run(_base_request(_kb_epoch="g1.t3"), provider)
    assert len(calls) == 1 and r1["choices"][0]["message"]["content"] == "答案"

    r2 = run(_base_request(_kb_epoch="g1.t3"), provider)
    assert len(calls) == 1                      # 同 epoch → cache hit
    assert r2["cache_meta"]["hit"] is True
    assert r2["usage"] == {"prompt_tokens": 0, "completion_tokens": 0}

    r3 = run(_base_request(_kb_epoch="g1.t4"), provider)
    assert len(calls) == 2                      # epoch bump（撤回/发布）→ 强制 miss
    assert "cache_meta" not in r3 or not r3.get("cache_meta", {}).get("hit")
