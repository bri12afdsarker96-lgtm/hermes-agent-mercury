"""P3-M0 · Vendored copy of Hermes_AI `hermes_devices/ops/audit.py::strip_sources`.

**Purpose**:cross-repo import is not always available in fork CI;
this file mirrors the Hermes_AI baseline **verbatim** so the differential test
(`plugins/spike_p3_m0_strip/tests/test_strip_differential_vs_hermes_ai.py`) can
compare fork sanitizer output against it and lock the exact divergence.

**Source of truth**:
  Repo:  https://github.com/bri12afdsarker96-lgtm/Hermes_AI
  File:  `hermes_devices/ops/audit.py`
  Symbols mirrored: `_INLINE_RE`, `_LINE_RE`, `strip_sources`
  Baseline commit: PR #27 merge `aa5c3c4f4f862b6e7bf4a9bc97f5dfeb35489e55`
                   (P2-0.1 段① · charter C4)

**Sync discipline**:when the Hermes_AI baseline changes, this file MUST be
resynced in the same PR, and both repos' PR bodies must reference the drift.
The differential test's `test_baseline_regex_verbatim` byte-checks the strings.
"""
from __future__ import annotations

import re


# ── mirrored from Hermes_AI hermes_devices/ops/audit.py:74-91 (verbatim) ──

# Citation markers we strip from user-bound text. Deliberately conservative:
# only bracketed/labelled "source/来源" fragments — ordinary brackets survive.
# The body class excludes \n (an unclosed marker must NOT swallow following
# lines of real reply text — that falls through to _LINE_RE instead) and
# allows one nested bracket pair (来源：FAQ（2026版）) without leaving residue.
_INLINE_RE = re.compile(
    r"[\[【（(]\s*(?:source|来源)\s*[:：]"
    r"(?:[^\[\]【】（）()\n]|[（(][^（）()\n]*[）)]|[\[【][^\[\]【】\n]*[\]】])*"
    r"[\]】）)]",
    re.IGNORECASE,
)
_LINE_RE = re.compile(r"^[ \t]*(?:source|来源)\s*[:：].*$", re.IGNORECASE | re.MULTILINE)


def strip_sources(text: str) -> str:
    """Remove citation markers from a user-bound reply (charter C4)."""
    if not text:
        return text
    out = _INLINE_RE.sub("", text)
    out = _LINE_RE.sub("", out)
    out = re.sub(r"[ \t]+(?=\n|$)", "", out)      # trailing spaces left by removals
    out = re.sub(r"\n{3,}", "\n\n", out)
    return out.strip()


# Verbatim source strings — locked by test_baseline_regex_verbatim so any drift
# from the Hermes_AI baseline flips the differential test loudly.
BASELINE_INLINE_PATTERN = (
    r"[\[【（(]\s*(?:source|来源)\s*[:：]"
    r"(?:[^\[\]【】（）()\n]|[（(][^（）()\n]*[）)]|[\[【][^\[\]【】\n]*[\]】])*"
    r"[\]】）)]"
)
BASELINE_LINE_PATTERN = r"^[ \t]*(?:source|来源)\s*[:：].*$"
