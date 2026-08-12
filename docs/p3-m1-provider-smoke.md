# P3-M1 Provider smoke: MiniMax China M3 primary, DeepSeek fallback

This is the deployment and acceptance contract for the first P3-M1 model
conversation. It uses Hermes' bundled provider profiles; it does not add a
parallel provider implementation or modify the prompt.

## Configuration

Merge [`p3-m1-provider-config.yaml`](p3-m1-provider-config.yaml) into the active
profile's `$HERMES_HOME/config.yaml`. The primary route uses MiniMax's mainland
China Anthropic-compatible endpoint because the deployment account is a China
Token Plan subscription and its credentials are region-scoped.

Credentials belong only in `$HERMES_HOME/.env` or the Desktop credential UI:

```dotenv
MINIMAX_CN_API_KEY=<china-token-plan-key>
DEEPSEEK_API_KEY=<api-key>
```

Do not paste either key into `config.yaml`, test output, issue text, or a pull
request. MiniMax international and China credentials are not interchangeable;
Hermes deliberately uses the separate `MINIMAX_CN_API_KEY` secret name for the
mainland China route.

## Offline contract gate

```bash
scripts/run_tests.sh tests/hermes_cli/test_p3_m1_provider_contract.py \
  tests/plugins/model_providers/test_minimax_profile.py \
  tests/plugins/model_providers/test_deepseek_profile.py
```

This proves the checked-in config resolves to:

- primary: `minimax-cn / MiniMax-M3 / https://api.minimaxi.com/anthropic / anthropic_messages`;
- fallback: `deepseek / deepseek-v4-flash`;
- the primary request is built by Hermes' Anthropic Messages transport;
- no API-key value is persisted in the YAML contract.

## Opt-in live gate

The live smoke is skipped unless explicitly enabled and a key is present:

```bash
HERMES_LIVE_TESTS=1 \
MINIMAX_CN_API_KEY='<redacted>' \
scripts/run_tests.sh tests/run_agent/test_minimax_cn_m3_live.py -q
```

Pass criteria are a successful Hermes-resolved Anthropic-compatible request,
response model `MiniMax-M3`, non-empty assistant text, and non-negative token
usage. The test never prints the credential or response text.

DeepSeek already has an opt-in live tool-call replay test:

```bash
HERMES_LIVE_TESTS=1 \
DEEPSEEK_API_KEY='<redacted>' \
scripts/run_tests.sh tests/run_agent/test_deepseek_v4_thinking_live.py -q
```

Do not simulate fallback by committing an invalid primary key. After both live
tests pass independently, run the disposable forced-fallback gate:

```bash
HERMES_LIVE_TESTS=1 \
MINIMAX_CN_API_KEY='<redacted>' \
DEEPSEEK_API_KEY='<redacted>' \
scripts/run_tests.sh tests/run_agent/test_p3_m1_provider_fallback_live.py -q
```

The test sends the primary to a loopback port with no listener, then drives the
real `AIAgent.run_conversation()` retry/fallback loop. It passes only when the
final runtime is `deepseek / deepseek-v4-flash`, the reply is non-empty, and a
provider-switch lifecycle notice was emitted. It does not modify the active
profile.

## Sources checked for this contract

- The deployment's China Token Plan exposes `MiniMax-M3`; this contract keeps
  the mainland China route while selecting that newer model.
- MiniMax's Anthropic-compatible API guide specifies
  `https://api.minimaxi.com/anthropic` for mainland China accounts.
- DeepSeek's current API catalog exposes `deepseek-v4-flash` and
  `deepseek-v4-pro` at `https://api.deepseek.com`.

Provider/model identifiers are an external compatibility surface. Re-check the
official provider docs before changing them.
