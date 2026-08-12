"""Opt-in MiniMax China M3 smoke through Hermes provider resolution.

Run with:
    HERMES_LIVE_TESTS=1 MINIMAX_CN_API_KEY=... \
      pytest tests/run_agent/test_minimax_cn_m3_live.py -q

The credential is captured at import time because the root test fixture removes
credential environment variables before each test body.
"""

from __future__ import annotations

import os
from pathlib import Path

import pytest


LIVE = os.environ.get("HERMES_LIVE_TESTS") == "1"
MINIMAX_CN_KEY = os.environ.get("MINIMAX_CN_API_KEY", "")
MODEL = "MiniMax-M3"
BASE_URL = "https://api.minimaxi.com/anthropic"
CONTRACT_PATH = Path(__file__).resolve().parents[2] / "docs" / "p3-m1-provider-config.yaml"

pytestmark = [
    pytest.mark.skipif(not LIVE, reason="live-only: set HERMES_LIVE_TESTS=1"),
    pytest.mark.skipif(
        not MINIMAX_CN_KEY,
        reason="MINIMAX_CN_API_KEY not configured",
    ),
]


def test_minimax_cn_m3_first_conversation_through_hermes_transport(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    (tmp_path / "config.yaml").write_text(
        CONTRACT_PATH.read_text(encoding="utf-8"),
        encoding="utf-8",
    )
    monkeypatch.setenv("HERMES_HOME", str(tmp_path))
    monkeypatch.setenv("MINIMAX_CN_API_KEY", MINIMAX_CN_KEY)

    from hermes_cli import config as config_module

    config_module._LOAD_CONFIG_CACHE.clear()
    config_module._RAW_CONFIG_CACHE.clear()

    from anthropic import Anthropic

    from agent.transports.anthropic import AnthropicTransport
    from hermes_cli.runtime_provider import resolve_runtime_provider

    runtime = resolve_runtime_provider(
        requested="minimax-cn",
        explicit_api_key=MINIMAX_CN_KEY,
        explicit_base_url=BASE_URL,
        target_model=MODEL,
    )
    assert runtime["provider"] == "minimax-cn"
    assert runtime["base_url"] == BASE_URL
    assert runtime["api_mode"] == "anthropic_messages"

    kwargs = AnthropicTransport().build_kwargs(
        model=MODEL,
        messages=[
            {
                "role": "user",
                "content": "Reply with exactly: provider-ready",
            }
        ],
        tools=None,
        base_url=runtime["base_url"],
        max_tokens=128,
        reasoning_config={"enabled": False},
    )

    response = Anthropic(
        api_key=runtime["api_key"],
        base_url=runtime["base_url"],
        timeout=90,
    ).messages.create(**kwargs)

    assert response.model == MODEL
    text = "".join(
        str(getattr(block, "text", "") or "")
        for block in response.content
        if getattr(block, "type", "") == "text"
    )
    assert text.strip()
    assert response.usage.input_tokens >= 0
    assert response.usage.output_tokens >= 0
