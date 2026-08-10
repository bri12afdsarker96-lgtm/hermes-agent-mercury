"""Opt-in MiniMax-M3 first-conversation smoke through Hermes wiring.

Run with:
    HERMES_LIVE_TESTS=1 MINIMAX_API_KEY=... \
      pytest tests/run_agent/test_minimax_m3_live.py -q

The key is captured at import time because the root test fixture removes
credential environment variables before each test body.
"""

from __future__ import annotations

import os

import pytest


LIVE = os.environ.get("HERMES_LIVE_TESTS") == "1"
MINIMAX_KEY = os.environ.get("MINIMAX_API_KEY", "")
MODEL = "MiniMax-M3"
BASE_URL = "https://api.minimax.io/v1"

pytestmark = [
    pytest.mark.skipif(not LIVE, reason="live-only: set HERMES_LIVE_TESTS=1"),
    pytest.mark.skipif(not MINIMAX_KEY, reason="MINIMAX_API_KEY not configured"),
]


def test_minimax_m3_first_conversation_through_hermes_transport() -> None:
    import model_tools  # noqa: F401 -- triggers bundled provider discovery
    import providers
    from openai import OpenAI

    from agent.transports.chat_completions import ChatCompletionsTransport
    from hermes_cli.runtime_provider import resolve_runtime_provider

    runtime = resolve_runtime_provider(
        requested="minimax",
        explicit_api_key=MINIMAX_KEY,
        explicit_base_url=BASE_URL,
        target_model=MODEL,
    )
    assert runtime["provider"] == "minimax"
    assert runtime["base_url"] == BASE_URL
    assert runtime["api_mode"] == "chat_completions"

    profile = providers.get_provider_profile("minimax")
    assert profile is not None
    kwargs = ChatCompletionsTransport().build_kwargs(
        model=MODEL,
        messages=[
            {
                "role": "user",
                "content": "Reply with exactly: provider-ready",
            }
        ],
        tools=None,
        provider_profile=profile,
        provider_name="minimax",
        base_url=runtime["base_url"],
        reasoning_config={"enabled": False},
    )
    kwargs["max_tokens"] = 128

    response = OpenAI(
        api_key=runtime["api_key"],
        base_url=runtime["base_url"],
        timeout=90,
    ).chat.completions.create(**kwargs)

    assert response.model == MODEL
    assert response.choices
    assert (response.choices[0].message.content or "").strip()
    assert response.usage is not None
    assert response.usage.prompt_tokens >= 0
    assert response.usage.completion_tokens >= 0
