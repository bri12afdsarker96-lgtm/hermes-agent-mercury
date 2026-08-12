"""Opt-in real forced-fallback gate for the P3-M1 provider contract.

The primary credential remains valid, but its endpoint is overridden to an
unused loopback port. The production conversation loop must recognize that the
primary is unreachable and complete the turn with the configured DeepSeek
fallback. No active user configuration is modified.
"""

from __future__ import annotations

import os
from pathlib import Path

import pytest


LIVE = os.environ.get("HERMES_LIVE_TESTS") == "1"
MINIMAX_CN_KEY = os.environ.get("MINIMAX_CN_API_KEY", "")
DEEPSEEK_KEY = os.environ.get("DEEPSEEK_API_KEY", "")
PRIMARY_MODEL = "MiniMax-M3"
FALLBACK_MODEL = "deepseek-v4-flash"
UNREACHABLE_PRIMARY = "http://127.0.0.1:9/anthropic"
CONTRACT_PATH = Path(__file__).resolve().parents[2] / "docs" / "p3-m1-provider-config.yaml"

pytestmark = [
    pytest.mark.skipif(not LIVE, reason="live-only: set HERMES_LIVE_TESTS=1"),
    pytest.mark.skipif(
        not MINIMAX_CN_KEY or not DEEPSEEK_KEY,
        reason="MINIMAX_CN_API_KEY and DEEPSEEK_API_KEY are required",
    ),
]


def test_unreachable_minimax_cn_falls_back_to_live_deepseek(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    (tmp_path / "config.yaml").write_text(
        CONTRACT_PATH.read_text(encoding="utf-8"),
        encoding="utf-8",
    )
    monkeypatch.setenv("HERMES_HOME", str(tmp_path))
    monkeypatch.setenv("MINIMAX_CN_API_KEY", MINIMAX_CN_KEY)
    monkeypatch.setenv("DEEPSEEK_API_KEY", DEEPSEEK_KEY)

    from hermes_cli import config as config_module

    config_module._LOAD_CONFIG_CACHE.clear()
    config_module._RAW_CONFIG_CACHE.clear()

    from hermes_cli.config import load_config
    from hermes_cli.fallback_config import get_fallback_chain
    from hermes_cli.runtime_provider import resolve_runtime_provider
    from run_agent import AIAgent

    runtime = resolve_runtime_provider(
        requested="minimax-cn",
        explicit_api_key=MINIMAX_CN_KEY,
        explicit_base_url=UNREACHABLE_PRIMARY,
        target_model=PRIMARY_MODEL,
    )
    assert runtime["provider"] == "minimax-cn"
    assert runtime["api_mode"] == "anthropic_messages"
    assert runtime["base_url"] == UNREACHABLE_PRIMARY

    notices: list[tuple[str, str]] = []
    agent = AIAgent(
        api_key=runtime["api_key"],
        base_url=runtime["base_url"],
        provider=runtime["provider"],
        requested_provider=runtime.get("requested_provider"),
        api_mode=runtime["api_mode"],
        model=PRIMARY_MODEL,
        enabled_toolsets=[],
        quiet_mode=True,
        platform="cli",
        fallback_model=get_fallback_chain(load_config()),
        status_callback=lambda kind, message: notices.append((kind, message)),
        skip_context_files=True,
        skip_memory=True,
        skip_background_review=True,
    )
    # Keep the deliberate connection-failure gate fast while still exercising
    # the production retry and fallback control flow.
    agent._api_max_retries = 1

    try:
        result = agent.run_conversation(
            "Reply with exactly: fallback-ready. Do not call tools."
        )
    finally:
        agent.close()

    assert result["completed"] is True
    assert result["failed"] is False
    assert (result["final_response"] or "").strip()
    assert result["provider"] == "deepseek"
    assert result["model"] == FALLBACK_MODEL
    assert result["base_url"].rstrip("/") == "https://api.deepseek.com/v1"
    assert agent._fallback_activated is True
    assert any(
        kind == "lifecycle"
        and "Switched to fallback model" in message
        and FALLBACK_MODEL in message
        and "deepseek" in message
        for kind, message in notices
    )
