"""P3-M1 primary/fallback configuration contract.

The test drives the production config loader and runtime provider resolver. It
does not duplicate provider selection logic in a test-only helper.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

import pytest
import yaml


REPO_ROOT = Path(__file__).resolve().parents[2]
CONTRACT_PATH = REPO_ROOT / "docs" / "p3-m1-provider-config.yaml"


def _load_contract() -> dict[str, Any]:
    loaded = yaml.safe_load(CONTRACT_PATH.read_text(encoding="utf-8"))
    assert isinstance(loaded, dict)
    return loaded


def _walk_keys(value: Any):
    if isinstance(value, dict):
        for key, child in value.items():
            yield str(key).lower()
            yield from _walk_keys(child)
    elif isinstance(value, list):
        for child in value:
            yield from _walk_keys(child)


@pytest.fixture
def configured_home(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    config = _load_contract()
    (tmp_path / "config.yaml").write_text(
        yaml.safe_dump(config, sort_keys=False),
        encoding="utf-8",
    )
    monkeypatch.setenv("HERMES_HOME", str(tmp_path))
    monkeypatch.setenv("MINIMAX_API_KEY", "test-minimax-key")
    monkeypatch.setenv("DEEPSEEK_API_KEY", "test-deepseek-key")

    from hermes_cli import config as config_module

    config_module._LOAD_CONFIG_CACHE.clear()
    config_module._RAW_CONFIG_CACHE.clear()
    yield tmp_path
    config_module._LOAD_CONFIG_CACHE.clear()
    config_module._RAW_CONFIG_CACHE.clear()


def test_contract_contains_routes_but_no_secret_fields() -> None:
    config = _load_contract()

    assert config["model"] == {
        "default": "MiniMax-M3",
        "provider": "minimax",
        "base_url": "https://api.minimax.io/v1",
        "api_mode": "chat_completions",
    }
    assert config["fallback_providers"] == [
        {"provider": "deepseek", "model": "deepseek-v4-flash"}
    ]

    forbidden = {"api_key", "token", "secret", "password"}
    assert forbidden.isdisjoint(_walk_keys(config))
    serialized = CONTRACT_PATH.read_text(encoding="utf-8")
    assert "test-minimax-key" not in serialized
    assert "test-deepseek-key" not in serialized


def test_primary_runtime_uses_minimax_m3_openai_route(configured_home: Path) -> None:
    from hermes_cli.runtime_provider import resolve_runtime_provider

    runtime = resolve_runtime_provider(
        requested="minimax",
        target_model="MiniMax-M3",
    )

    assert runtime["provider"] == "minimax"
    assert runtime["base_url"] == "https://api.minimax.io/v1"
    assert runtime["api_mode"] == "chat_completions"
    assert runtime["api_key"] == "test-minimax-key"


def test_fallback_chain_resolves_deepseek_v4_flash(configured_home: Path) -> None:
    from hermes_cli.config import load_config
    from hermes_cli.fallback_config import get_fallback_chain
    from hermes_cli.runtime_provider import resolve_runtime_provider

    chain = get_fallback_chain(load_config())
    assert chain == [{"provider": "deepseek", "model": "deepseek-v4-flash"}]

    runtime = resolve_runtime_provider(
        requested=chain[0]["provider"],
        target_model=chain[0]["model"],
    )
    assert runtime["provider"] == "deepseek"
    assert runtime["base_url"] == "https://api.deepseek.com/v1"
    assert runtime["api_mode"] == "chat_completions"
    assert runtime["api_key"] == "test-deepseek-key"


def test_minimax_transport_adds_m3_reasoning_contract(configured_home: Path) -> None:
    import model_tools  # noqa: F401 -- triggers bundled provider discovery
    import providers
    from agent.transports.chat_completions import ChatCompletionsTransport

    profile = providers.get_provider_profile("minimax")
    assert profile is not None

    kwargs = ChatCompletionsTransport().build_kwargs(
        model="MiniMax-M3",
        messages=[{"role": "user", "content": "Reply with: provider-ready"}],
        tools=None,
        provider_profile=profile,
        provider_name="minimax",
        base_url="https://api.minimax.io/v1",
        reasoning_config={"enabled": True, "effort": "medium"},
    )
    assert kwargs["extra_body"] == {
        "reasoning_split": True,
        "thinking": {"type": "adaptive"},
    }
