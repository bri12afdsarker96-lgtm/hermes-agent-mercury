"""G2CA-10 · compiled fallback identities round-trip through fork routing.

The Gate 2C-A compiler writes provider/model routes, but it must not become a
second provider registry.  These tests use the fork's real fallback parser,
provider-profile registry, model normalizer and auxiliary-client factory.  No
HTTP request is made: creating an OpenAI/Anthropic client is deliberately a
local configuration operation only.
"""
from __future__ import annotations

import pytest


_FALLBACK_ROUTES = (
    {
        "provider": "deepseek",
        "model": "deepseek-v4-flash",
        "base_url": "https://api.deepseek.com/v1",
        "key_env": "DEEPSEEK_API_KEY",
        "api_mode": "chat_completions",
    },
)


@pytest.mark.parametrize(
    ("declared_provider", "canonical_provider", "model", "key_env"),
    [
        ("minimax-cn", "minimax-cn", "MiniMax-M3", "MINIMAX_CN_API_KEY"),
        ("minimax-china", "minimax-cn", "MiniMax-M3", "MINIMAX_CN_API_KEY"),
        ("minimax_cn", "minimax-cn", "MiniMax-M3", "MINIMAX_CN_API_KEY"),
        ("deepseek", "deepseek", "deepseek-v4-flash", "DEEPSEEK_API_KEY"),
        ("deepseek-chat", "deepseek", "deepseek-chat", "DEEPSEEK_API_KEY"),
    ],
)
def test_provider_and_model_aliases_round_trip_to_registered_profile(
    declared_provider, canonical_provider, model, key_env
):
    """A compiled provider identity resolves to its own registered profile."""
    import model_tools  # noqa: F401 -- triggers fork plugin discovery
    import providers
    from hermes_cli.auth import PROVIDER_REGISTRY, resolve_provider
    from hermes_cli.model_normalize import normalize_model_for_provider

    assert resolve_provider(declared_provider) == canonical_provider
    assert canonical_provider in PROVIDER_REGISTRY

    profile = providers.get_provider_profile(declared_provider)
    assert profile is not None
    assert profile.name == canonical_provider
    assert key_env in profile.env_vars

    normalized_model = normalize_model_for_provider(model, canonical_provider)
    if canonical_provider == "minimax-cn":
        from plugins.model_providers.minimax import _is_minimax_m3

        assert _is_minimax_m3(normalized_model)
        assert profile.default_aux_model == "MiniMax-M3"
    else:
        from plugins.model_providers.deepseek import _model_supports_thinking

        assert normalized_model in profile.fallback_models
        assert _model_supports_thinking(normalized_model)


def test_compiled_fallback_route_round_trips_to_a_real_client_factory(monkeypatch):
    """The fork's fallback parser and factory accept the compiler's route.

    The temporary env value proves ``key_env`` is resolved by the fork's own
    secret-aware route.  It is intentionally synthetic and no request is sent.
    """
    from agent.auxiliary_client import _resolve_fallback_entry
    from hermes_cli.fallback_config import get_fallback_chain

    monkeypatch.setenv("DEEPSEEK_API_KEY", "synthetic-g2ca10-deepseek-key")
    chain = get_fallback_chain({"fallback_providers": list(_FALLBACK_ROUTES)})
    assert chain == list(_FALLBACK_ROUTES)

    client, resolved_model = _resolve_fallback_entry(chain[0])
    assert client is not None
    assert resolved_model == "deepseek-v4-flash"
    # A real client object exposes the normal completion surface; no network
    # interaction is made merely by reading this attribute.
    assert getattr(getattr(client, "chat", None), "completions", None) is not None


@pytest.mark.parametrize(
    ("provider", "model", "base_url", "api_mode", "key_env"),
    [
        (
            "minimax-cn",
            "MiniMax-M3",
            "https://api.minimaxi.com/anthropic",
            "anthropic_messages",
            "MINIMAX_CN_API_KEY",
        ),
        (
            "deepseek",
            "deepseek-v4-flash",
            "https://api.deepseek.com/v1",
            "chat_completions",
            "DEEPSEEK_API_KEY",
        ),
    ],
)
def test_primary_identity_reads_its_own_profile_env_not_model_key_env(
    monkeypatch, provider, model, base_url, api_mode, key_env
):
    """Top-level ``model`` has no ``key_env``; profile credential lookup wins."""
    from agent.auxiliary_client import resolve_provider_client

    monkeypatch.setenv(key_env, f"synthetic-g2ca10-{provider}-key")
    client, resolved_model = resolve_provider_client(
        provider,
        model=model,
        explicit_base_url=base_url,
        api_mode=api_mode,
    )
    assert client is not None
    assert resolved_model == model
