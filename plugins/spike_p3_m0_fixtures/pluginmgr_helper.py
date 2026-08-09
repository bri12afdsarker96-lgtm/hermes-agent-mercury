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


def install_fresh_manager(monkeypatch, hermes_home: Path):
    """Replace the global PluginManager with a fresh instance for this test.

    Steps:
      1. Set ``HERMES_HOME`` env → temp dir.
      2. Force ``hermes_cli.config._load_config_impl`` cache clear.
      3. Create fresh :class:`hermes_cli.plugins.PluginManager`.
      4. Monkeypatch ``hermes_cli.plugins._plugin_manager`` → fresh instance.
      5. Call ``discover_and_load(force=True)``.

    Fixture teardown (monkeypatch scope) restores env + module attr.
    Returns the fresh manager.
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

    # 卸载 hermes_plugins.* 命名空间(避免上次 discover 的旧 module 状态污染)
    for name in [k for k in list(sys.modules) if k.startswith("hermes_plugins")]:
        monkeypatch.delitem(sys.modules, name, raising=False)

    fresh.discover_and_load(force=True)
    return fresh


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
