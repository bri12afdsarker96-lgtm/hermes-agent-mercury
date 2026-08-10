# P3-M1 Provider smoke: MiniMax M3 primary, DeepSeek fallback

This is the deployment and acceptance contract for the first P3-M1 model
conversation. It uses Hermes' bundled provider profiles; it does not add a
parallel provider implementation or modify the prompt.

## Configuration

Merge [`p3-m1-provider-config.yaml`](p3-m1-provider-config.yaml) into the active
profile's `$HERMES_HOME/config.yaml`. The primary route is deliberately the
MiniMax OpenAI-compatible endpoint because MiniMax-M3's `reasoning_split` and
`thinking` controls are implemented on that wire shape.

Credentials belong only in `$HERMES_HOME/.env` or the Desktop credential UI:

```dotenv
MINIMAX_API_KEY=<subscription-or-pay-as-you-go-key>
DEEPSEEK_API_KEY=<api-key>
```

Do not paste either key into `config.yaml`, test output, issue text, or a pull
request. MiniMax Subscription Keys and pay-as-you-go keys are both credentials;
the account-side billing behavior differs, but the Hermes secret name does not.

## Offline contract gate

```bash
scripts/run_tests.sh tests/hermes_cli/test_p3_m1_provider_contract.py \
  tests/plugins/model_providers/test_minimax_profile.py \
  tests/plugins/model_providers/test_deepseek_profile.py
```

This proves the checked-in config resolves to:

- primary: `minimax / MiniMax-M3 / https://api.minimax.io/v1 / chat_completions`;
- fallback: `deepseek / deepseek-v4-flash`;
- M3 requests carry `reasoning_split=true` and the requested thinking mode;
- no API-key value is persisted in the YAML contract.

## Opt-in live gate

The live smoke is skipped unless explicitly enabled and a key is present:

```bash
HERMES_LIVE_TESTS=1 \
MINIMAX_API_KEY='<redacted>' \
scripts/run_tests.sh tests/run_agent/test_minimax_m3_live.py -q
```

Pass criteria are a successful Hermes-resolved OpenAI-compatible request,
response model `MiniMax-M3`, non-empty assistant text, and non-negative token
usage. The test never prints the credential.

DeepSeek already has an opt-in live tool-call replay test:

```bash
HERMES_LIVE_TESTS=1 \
DEEPSEEK_API_KEY='<redacted>' \
scripts/run_tests.sh tests/run_agent/test_deepseek_v4_thinking_live.py -q
```

Do not simulate fallback by committing an invalid primary key. After both live
tests pass independently, exercise fallback in a disposable profile by making
the primary endpoint unreachable and confirming the runtime logs a provider
switch to `deepseek-v4-flash`; restore the primary configuration immediately.

## Sources checked for this contract

- MiniMax's current Hermes Agent guide selects the global endpoint and
  `MiniMax-M3`.
- MiniMax's current OpenAI SDK guide specifies `https://api.minimax.io/v1`,
  `MiniMax-M3`, `reasoning_split`, and `thinking.type=adaptive|disabled`.
- DeepSeek's current API catalog exposes `deepseek-v4-flash` and
  `deepseek-v4-pro` at `https://api.deepseek.com`.

Provider/model identifiers are an external compatibility surface. Re-check the
official provider docs before changing them.
