"""Collection guard for tests/native_mcp/.

The seven-step registry test needs the Hermes_AI stdio MCP servers
installed (package `hermes-devices`). Only the dedicated CI workflow
`.github/workflows/p3-m1-mcp-seven-step.yml` provisions that. Every
other pytest invocation (umbrella tests.yml, ad-hoc local runs) must
not attempt to run the file — otherwise it fails during collection or
in the test body before pytest can even reach a skip decision.

Two layers, precisely scoped to `test_seven_step_via_registry.py`
(any new native_mcp test must opt in explicitly):

1. `collect_ignore` — names the exact file to skip during normal
   directory-walk collection (umbrella pytest tests/, IDE test
   discovery, ad-hoc `pytest tests/native_mcp/`).

2. `pytest_collection_modifyitems` — removes the same file's items
   AFTER collection but BEFORE execution. This layer catches the case
   where the umbrella slice runner passes explicit nodeids
   (`pytest tests/native_mcp/test_seven_step_via_registry.py::test_...`)
   which bypass `collect_ignore` entirely. Removed items are simply
   not run — they do NOT count as `skipped` in any JUnit report.

No `collect_ignore_glob=["*.py"]` (would blanket every future test).
Only `PackageNotFoundError` caught; no bare `except`. No
`pytest.skip` / `pytest.importorskip` / skip markers. When
hermes-devices IS installed, both layers are inert and the test
runs normally.
"""
from importlib.metadata import PackageNotFoundError, distribution

_GUARDED_BASENAME = "test_seven_step_via_registry.py"


def _hermes_devices_installed() -> bool:
    try:
        distribution("hermes-devices")
        return True
    except PackageNotFoundError:
        return False


collect_ignore: list[str] = []
if not _hermes_devices_installed():
    collect_ignore = [_GUARDED_BASENAME]


def pytest_collection_modifyitems(config, items):
    # Second-layer guard: strip the guarded file from items even when
    # the caller passed an explicit nodeid on the command line
    # (umbrella slice runner does exactly that, bypassing
    # `collect_ignore`). Removed items are not executed and produce
    # no `skipped` outcome in the JUnit report.
    if _hermes_devices_installed():
        return
    items[:] = [
        item for item in items
        if _GUARDED_BASENAME not in str(getattr(item, "fspath", ""))
    ]
