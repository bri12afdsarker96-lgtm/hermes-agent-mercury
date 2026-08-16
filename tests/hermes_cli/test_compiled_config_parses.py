"""G2CA-09 · compiled provider patches parse through fork-native readers.

The Gate 2C-A compiler lives on the Hermes_AI side.  This fork-side test
therefore deliberately uses only the YAML shape it is required to emit, then
starts a fresh Python process to exercise the real fork configuration loader,
``runtime_provider._get_model_config`` and ``get_fallback_chain``.  There is
no test adapter or materializer in this path.
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
import textwrap
from pathlib import Path

import pytest
import yaml


REPO_ROOT = Path(__file__).resolve().parent.parent.parent


_COMPILED_PATCHES = {
    "m3": {
        "model": {
            "default": "MiniMax-M3",
            "provider": "minimax-cn",
            "base_url": "https://api.minimaxi.com/anthropic",
            "api_mode": "anthropic_messages",
        },
        "fallback_providers": [],
    },
    "deepseek": {
        "model": {
            "default": "deepseek-v4-flash",
            "provider": "deepseek",
            "base_url": "https://api.deepseek.com/v1",
            "api_mode": "chat_completions",
        },
        "fallback_providers": [],
    },
    "auto": {
        "model": {
            "default": "MiniMax-M3",
            "provider": "minimax-cn",
            "base_url": "https://api.minimaxi.com/anthropic",
            "api_mode": "anthropic_messages",
        },
        "fallback_providers": [
            {
                "provider": "deepseek",
                "model": "deepseek-v4-flash",
                "base_url": "https://api.deepseek.com/v1",
                "key_env": "DEEPSEEK_API_KEY",
            },
        ],
    },
}


def _parse_with_fork_readers(tmp_path: Path, patch: dict) -> dict:
    """Use a clean process so module and config caches cannot mask parsing."""
    home = tmp_path / "hermes_home"
    home.mkdir()
    (home / "config.yaml").write_text(
        yaml.safe_dump(patch, sort_keys=False, allow_unicode=True), encoding="utf-8",
    )
    result_path = tmp_path / "compiled_config_result.json"
    code = textwrap.dedent(
        """
        import json
        import os
        from pathlib import Path

        from hermes_cli.config import load_config
        from hermes_cli.fallback_config import get_fallback_chain
        from hermes_cli.runtime_provider import _get_model_config

        config = load_config()
        Path(os.environ["G2CA09_RESULT_PATH"]).write_text(json.dumps({
            "loaded_model": config.get("model"),
            "loaded_fallback_providers": config.get("fallback_providers"),
            "runtime_model": _get_model_config(),
            "fallback_chain": get_fallback_chain(config),
        }, sort_keys=True), encoding="utf-8")
        """
    )
    env = dict(os.environ)
    env.pop("PYTEST_CURRENT_TEST", None)
    env["HERMES_HOME"] = str(home)
    env["PYTHONPATH"] = str(REPO_ROOT)
    env["G2CA09_RESULT_PATH"] = str(result_path)
    proc = subprocess.run(
        [sys.executable, "-c", code],
        capture_output=True,
        text=True,
        cwd=str(tmp_path),
        env=env,
        timeout=120,
    )
    assert proc.returncode == 0, f"fork parser subprocess failed:\n{proc.stdout}\n{proc.stderr}"
    assert result_path.exists(), f"fork parser wrote no result:\n{proc.stdout}\n{proc.stderr}"
    return json.loads(result_path.read_text(encoding="utf-8"))


@pytest.mark.parametrize("pref", ["m3", "deepseek", "auto"])
def test_compiled_config_parses_without_adapter_or_silent_key_loss(tmp_path, pref):
    """Every compiler preference uses the fork's native config shape intact."""
    patch = _COMPILED_PATCHES[pref]
    parsed = _parse_with_fork_readers(tmp_path, patch)

    # ``load_config`` proves the YAML reached the fork loader.  The two
    # downstream readers must retain every compiler-owned key exactly.
    assert parsed["loaded_model"] == patch["model"]
    assert parsed["runtime_model"] == patch["model"]
    assert parsed["loaded_fallback_providers"] == patch["fallback_providers"]
    assert parsed["fallback_chain"] == patch["fallback_providers"]
