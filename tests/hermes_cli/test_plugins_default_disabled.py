"""Gate 2C-A G2CA-06: stock configuration never enables Spike plugins."""
from __future__ import annotations

from hermes_cli import plugins as plugins_mod
from plugins.spike_p3_m0_fixtures.pluginmgr_helper import install_fresh_manager


def test_stock_config_without_enabled_allowlist_loads_neither_spike_plugin(
    tmp_path, monkeypatch
):
    """The missing allow-list is opt-in default, not an implicit Spike enablement."""
    (tmp_path / "config.yaml").write_text("plugins: {}\n", encoding="utf-8")

    manager = install_fresh_manager(monkeypatch, tmp_path)

    assert plugins_mod._get_enabled_plugins() is None
    # Discovery retains manifest records for diagnostics, but a missing opt-in
    # allow-list must leave both plugin modules unloaded and unregistered.
    for plugin_id in ("spike-p3-m0-cache", "spike-p3-m0-budget"):
        loaded = manager._plugins[plugin_id]
        assert loaded.module is None
        assert loaded.error is not None
        assert "not enabled in config" in loaded.error
    assert plugins_mod.has_middleware("llm_execution") is False
    assert plugins_mod.has_hook("pre_api_request") is False
    assert plugins_mod.has_hook("post_api_request") is False
