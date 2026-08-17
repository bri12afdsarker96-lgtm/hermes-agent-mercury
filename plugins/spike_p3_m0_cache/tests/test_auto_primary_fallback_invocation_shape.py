"""Gate 2C-A G2CA-16: real AUTO primary-to-fallback invocation shape.

This is deliberately an integration test around the existing conversation
driver and ``agent.chat_completion_helpers.try_activate_fallback`` seam.  It
does not reimplement provider selection or modify any ``agent/*`` source.
"""
from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock

import yaml

import run_agent


_ROOT = Path(__file__).resolve().parents[3]
_CONTRACT = _ROOT / "docs" / "p3-m1-provider-config.yaml"


class _RateLimitError(Exception):
    status_code = 429

    def __str__(self) -> str:
        return "Error code: 429 - synthetic primary rate limit"


def _chat_response(text: str) -> SimpleNamespace:
    """Minimal OpenAI chat-completions response for the real loop."""
    return SimpleNamespace(
        choices=[
            SimpleNamespace(
                message=SimpleNamespace(content=text, tool_calls=None),
                finish_reason="stop",
            )
        ],
        model="deepseek-v4-flash",
        usage=SimpleNamespace(prompt_tokens=5, completion_tokens=3),
    )


def test_auto_route_observes_real_primary_then_fallback_triplets(monkeypatch, tmp_path):
    """The live seam must switch MiniMax M3's wire mode before DeepSeek runs.

    ``seen`` is populated by the outer conversation-loop middleware call, so
    neither triplet is fabricated by this test.  The only test doubles are the
    provider transport's first 429 and the fallback's successful response.
    """
    contract = yaml.safe_load(_CONTRACT.read_text(encoding="utf-8"))
    primary = contract["model"]
    fallback = contract["fallback_providers"]
    assert primary == {
        "default": "MiniMax-M3",
        "provider": "minimax-cn",
        "base_url": "https://api.minimaxi.com/anthropic",
        "api_mode": "anthropic_messages",
    }
    assert fallback == [{"provider": "deepseek", "model": "deepseek-v4-flash"}]

    # The discovered plugins are the authority for each provider profile.
    import model_tools  # noqa: F401 -- performs bundled profile discovery
    import providers

    minimax_profile = providers.get_provider_profile("minimax-cn")
    deepseek_profile = providers.get_provider_profile("deepseek")
    assert minimax_profile is not None
    assert minimax_profile.api_mode == "anthropic_messages"
    assert minimax_profile.base_url == primary["base_url"]
    assert deepseek_profile is not None
    assert deepseek_profile.api_mode == "chat_completions"
    assert deepseek_profile.base_url == "https://api.deepseek.com/v1"

    # Isolate Hermes' config caches and avoid reading any user's credentials.
    monkeypatch.setenv("HERMES_HOME", str(tmp_path))
    monkeypatch.setattr(run_agent, "get_tool_definitions", lambda **_kwargs: [])
    monkeypatch.setattr(run_agent, "check_toolset_requirements", lambda: {})
    monkeypatch.setattr(
        "agent.anthropic_adapter.build_anthropic_client", lambda *_args, **_kwargs: MagicMock()
    )

    agent = run_agent.AIAgent(
        api_key="synthetic-minimax-key",
        base_url=primary["base_url"],
        provider=primary["provider"],
        requested_provider="auto",
        api_mode=primary["api_mode"],
        model=primary["default"],
        fallback_model=fallback,
        quiet_mode=True,
        max_iterations=2,
        skip_context_files=True,
        skip_memory=True,
        skip_background_review=True,
    )
    agent._api_max_retries = 1
    assert agent.requested_provider == "auto"
    agent._persist_session = lambda *_args, **_kwargs: None
    agent._save_trajectory = lambda *_args, **_kwargs: None
    agent._cleanup_task_resources = lambda *_args, **_kwargs: None
    # The contract concerns provider switching, not streaming.  Keeping this
    # deterministic routes both wires through the normal non-streaming relay.
    agent._disable_streaming = True

    fallback_client = MagicMock()
    fallback_client.api_key = "synthetic-deepseek-key"
    fallback_client.base_url = deepseek_profile.base_url
    monkeypatch.setattr(
        "agent.auxiliary_client.resolve_provider_client",
        lambda *_args, **_kwargs: (fallback_client, "deepseek-v4-flash"),
    )
    monkeypatch.setattr(
        "agent.chat_completion_helpers._fallback_entry_unavailable_without_network",
        lambda *_args, **_kwargs: None,
    )
    monkeypatch.setattr(
        "hermes_cli.model_normalize.normalize_model_for_provider",
        lambda model, _provider: model,
    )

    seen: list[tuple[str, str, str]] = []
    seam_reasons = []
    actual_seam = __import__("agent.chat_completion_helpers", fromlist=["try_activate_fallback"])
    real_try_activate_fallback = actual_seam.try_activate_fallback

    def observe_real_seam(active_agent, reason=None):
        seam_reasons.append(reason)
        return real_try_activate_fallback(active_agent, reason)

    def observe_outer_driver(request, next_call, **context):
        seen.append((context["provider"], context["model"], context["api_mode"]))
        return next_call(request)

    calls = {"primary": 0, "fallback": 0}

    def transport(_request):
        if agent.provider == "minimax-cn":
            calls["primary"] += 1
            raise _RateLimitError()
        assert agent.provider == "deepseek"
        calls["fallback"] += 1
        return _chat_response("fallback-ready")

    monkeypatch.setattr(actual_seam, "try_activate_fallback", observe_real_seam)
    monkeypatch.setattr(
        "hermes_cli.middleware.run_llm_execution_middleware", observe_outer_driver
    )
    monkeypatch.setattr(agent, "_interruptible_api_call", transport)

    result = agent.run_conversation("Return fallback-ready without tools.")

    assert result["completed"] is True
    assert result["final_response"] == "fallback-ready"
    assert calls == {"primary": 1, "fallback": 1}
    assert seen == [
        ("minimax-cn", "MiniMax-M3", "anthropic_messages"),
        ("deepseek", "deepseek-v4-flash", "chat_completions"),
    ]
    assert seam_reasons
    assert agent._fallback_activated is True
