"""Collection guard for tests/native_mcp/.

The seven-step registry test needs the Hermes_AI stdio MCP servers
installed (package `hermes-devices`). Only the dedicated CI workflow
`.github/workflows/p3-m1-mcp-seven-step.yml` provisions that. Every
other pytest invocation (umbrella tests.yml, ad-hoc local runs) must
not attempt to collect the file — otherwise it fails during collection
before pytest can even reach a skip decision.

`collect_ignore` names the exact file to skip collection (not
`collect_ignore_glob=["*.py"]`, which would blanket-ignore every
present and future test in the directory). Any new native_mcp test
must opt in by adding its basename here.

Catches only `PackageNotFoundError`; no bare `except`. No
`pytest.skip` / `pytest.importorskip` / skip markers — the guarded
file is simply not collected, so no `skipped` outcome appears in the
JUnit report. When hermes-devices IS installed, collection proceeds
normally and the test runs.
"""
from importlib.metadata import PackageNotFoundError, distribution

collect_ignore: list[str] = []
try:
    distribution("hermes-devices")
except PackageNotFoundError:
    collect_ignore = ["test_seven_step_via_registry.py"]
