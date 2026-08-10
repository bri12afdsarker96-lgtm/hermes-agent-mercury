"""P3-M0 Spike · shared test helper · fresh PluginManager + tmp HERMES_HOME.

**Codex §VIII 契约**:所有 3 spike 插件测试必须走真实 `PluginManager.discover_and_load`
+ 临时 `config.yaml` 启用 · `has_middleware("llm_execution") == True`
+ 通过 `run_llm_execution_middleware` / `invoke_hook` 触发 · **不用** `SPIKE_*` env
+ **不污染**全局 manager(fixture teardown 严格还原)。

**为什么用 fresh PluginManager 而非复用全局**:
- 全局 `_plugin_manager` 单例 · 一次 discover 后所有插件都 cached
- 测试需要:临时 config 启用 → discover → 验证 → teardown 还原
- 用 fresh instance + monkeypatch global · 严格隔离 · zero pollution
"""
from __future__ import annotations

import sys
from pathlib import Path
from typing import Any, Dict, List, Optional

import yaml


def write_config(hermes_home: Path, enabled: List[str], **plugin_cfg: Any) -> None:
    """Write ``config.yaml`` under ``hermes_home`` enabling the given plugins.

    ``plugin_cfg`` keyword args become entries under ``plugins.<name>``. Example:
        write_config(tmp, ["spike-p3-m0-cache"], spike_p3_m0_cache={"enabled": True, ...})
    """
    hermes_home.mkdir(parents=True, exist_ok=True)
    cfg: Dict[str, Any] = {
        "plugins": {
            "enabled": list(enabled),
            **plugin_cfg,
        },
    }
    (hermes_home / "config.yaml").write_text(
        yaml.safe_dump(cfg, sort_keys=True, allow_unicode=True), encoding="utf-8"
    )


def install_fresh_manager(monkeypatch, hermes_home: Path, request=None):
    """Replace the global PluginManager with a fresh instance for this test.

    Steps:
      1. Set ``HERMES_HOME`` env → temp dir.
      2. Force ``hermes_cli.config._load_config_impl`` cache clear.
      3. Create fresh :class:`hermes_cli.plugins.PluginManager`.
      4. Monkeypatch ``hermes_cli.plugins._plugin_manager`` → fresh instance.
      5. Call ``discover_and_load(force=True)``.

    Fixture teardown (monkeypatch scope) restores env + module attr.
    Returns the fresh manager.

    **Codex 第三轮 §VI**:测试可选调用 :func:`assert_no_plugin_module_leak` (见下)
    在 teardown 阶段快照对比 `hermes_plugins.*`,证明 discover 引入的模块在
    fixture 结束后全部清除,不污染后续测试。
    """
    from hermes_cli import plugins as plugins_mod

    monkeypatch.setenv("HERMES_HOME", str(hermes_home))
    # 强制 config cache 失效 · load_config 内部 mtime_ns 键 · 换 HERMES_HOME 自然 miss
    try:
        from hermes_cli import config as config_mod

        if hasattr(config_mod, "_CONFIG_CACHE"):
            monkeypatch.setattr(config_mod, "_CONFIG_CACHE", {}, raising=False)
    except Exception:
        pass

    fresh = plugins_mod.PluginManager()
    monkeypatch.setattr(plugins_mod, "_plugin_manager", fresh)

    # 快照:进入 fixture 前 sys.modules 里已经存在的 hermes_plugins.* 集合
    pre_existing = {k for k in list(sys.modules) if k.startswith("hermes_plugins")}
    # 卸载 hermes_plugins.* 命名空间(避免上次 discover 的旧 module 状态污染)
    for name in list(pre_existing):
        monkeypatch.delitem(sys.modules, name, raising=False)

    fresh.discover_and_load(force=True)

    # Codex 第三轮 §VI:teardown 显式清除 discover 引入的 hermes_plugins.* 新键,
    # 确保 fixture 结束后 sys.modules 恢复到"进入 fixture 前"的精确状态。
    # 若 request 传入 · 用 pytest addfinalizer(monkeypatch 无此 API);否则记录
    # 一个显式 helper 供测试手工清理与验证。
    if request is not None:
        def _cleanup_new_plugin_modules():
            for name in list(sys.modules):
                if name.startswith("hermes_plugins") and name not in pre_existing:
                    sys.modules.pop(name, None)
        request.addfinalizer(_cleanup_new_plugin_modules)

    return fresh


def snapshot_plugin_modules() -> set:
    """Snapshot of currently-loaded ``hermes_plugins.*`` module names.

    Used by :func:`assert_no_plugin_module_leak` and the standalone test
    ``test_pluginmgr_helper_cleanup_leaves_no_sys_modules_residue`` to prove
    that `install_fresh_manager` + monkeypatch teardown removes every module it
    caused to be inserted.
    """
    return {k for k in sys.modules if k.startswith("hermes_plugins")}


def assert_no_plugin_module_leak(before: set) -> None:
    """Assert no new ``hermes_plugins.*`` entries remain in sys.modules.

    Call **after** monkeypatch fixture teardown to verify cleanup.
    """
    after = snapshot_plugin_modules()
    leaked = after - before
    assert not leaked, (
        f"hermes_plugins.* module leak after fixture teardown: {sorted(leaked)} · "
        "install_fresh_manager teardown did not clean up loaded plugin modules"
    )


def get_discovered_module(manager, plugin_key: str):
    """Return the imported module object of a plugin by its plugin.yaml `name`."""
    loaded = manager._plugins.get(plugin_key)
    if loaded is None:
        raise KeyError(f"plugin {plugin_key!r} not discovered · loaded keys: {list(manager._plugins)}")
    if loaded.module is None:
        raise RuntimeError(f"plugin {plugin_key!r} discovered but module is None · error={loaded.error!r}")
    return loaded.module


def make_run_llm_execution(**default_ctx):
    """Return a helper that invokes `run_llm_execution_middleware` with default ctx.

    Simplifies tests: ``run = make_run_llm_execution(api_request_id="r1", ...)``
    then ``run(request, next_call, provider="p")``.
    """
    from hermes_cli.middleware import run_llm_execution_middleware

    def _run(request, next_call, **override_ctx):
        ctx = {**default_ctx, **override_ctx}
        return run_llm_execution_middleware(request, next_call, **ctx)

    return _run
