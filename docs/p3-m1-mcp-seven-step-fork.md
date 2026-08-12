# P3-M1 MCP 七步验收 · fork PR #4（fork 原生 registry 路径）

## Scope 与 Hermes_AI PR #30 的边界

**Hermes_AI PR #30**（`bri12afdsarker96-lgtm/Hermes_AI` @
`ad44bd11b4962932fdca4eab427c25f158688a98`）已用 raw `mcp.ClientSession` +
`mcp.client.stdio.stdio_client` 从 Hermes_AI 侧证明「原生 SDK 底层能真实
驱动两个 stdio server 完成七步」，两组六宫格 CI 均 GREEN。

**本 fork PR #4 的唯一价值**：证明 fork 自己生产路径 ——
`config.yaml → tools.mcp_tool.discover_mcp_tools() → 两 stdio server →
tools.registry.registry → registry.dispatch("mcp__<server>__<tool>", args)`
—— 走 fork 自己注册的 handler 闭包（`_make_tool_handler` → 通过
`_run_on_mcp_loop` → `server.session.call_tool`）完成同一条七步链路，含
trust-gate、circuit-breaker、命名规范、provenance mapping。

**边界**：不改 fork core 生产代码，不改 fork production dependencies，不改
`uv.lock`/`pyproject.toml`，不加新 MCP bridge，不加新模型工具，不改
Hermes_AI 生产代码。

## 命名规范（fork 权威）

- Toolset alias（fork 用 config key 原样，不 sanitize）：
  - `mcp-hermes-devices-mcp`
  - `mcp-hermes-data-ops-mcp`
- Tool 注册名（fork `sanitize_mcp_name_component` 把 `-` → `_`）：
  - `mcp__hermes_devices_mcp__list_devices` … 共 **14** 条
  - `mcp__hermes_data_ops_mcp__inspect_dataset` … 共 **6** 条
  - 合计恰好 **20** 条（章程 C6② 满槽）

## Codex E 九项证据（`tests/native_mcp/test_seven_step_via_registry.py`）

| # | 断言 | 生产路径 |
|---|---|---|
| 1 | `hermes-devices` 装到 fork venv 且 SHA = `ad44bd11...`（CI 前置 `pip show grep` gate） | `pip install --no-deps git+...@<sha>` |
| 2 | 两个 server 在同一 `get_mcp_status()` snapshot 里 `connected: True` + `tools == 14/6` | `tools.mcp_tool.get_mcp_status` |
| 3 | `discover_mcp_tools()` 后 registry 恰好新增 20 个 `mcp__hermes_devices_mcp__*` + `mcp__hermes_data_ops_mcp__*` | `discover_mcp_tools()` + `registry.get_all_tool_names()` |
| 4 | 完整工具名由 fork 命名函数生成（不复制另一套 sanitizer） | `mcp_prefixed_tool_name` + `sanitize_mcp_name_component` |
| 5 | 第二次 `discover_mcp_tools()` 不重复注册；registry 尺寸不变；两 server 仍 connected + tools count 不变 | idempotent guard L6656-6674 |
| 6 | 七步全走 registry.dispatch：initialize → 聚合 tools/list=20 → list_devices → 端侧协议注入 → poll_inbox → send_reply → strip_sources → audit 完整链 | `registry.dispatch()` |
| 7 | tenant 只来自 tenants DB + device_tenant binding；伪造 msg body `tenant_id` 被忽略；audit 记权威 tenant | `hub._on_hello` → `get_device_tenant` |
| 8 | send_reply 第二次 `already_resolved`；FakePhone 只收 1 次 | `queue.mark_sending` `BEGIN IMMEDIATE` |
| 9 | teardown 后：`shutdown_mcp_servers()` 清 MCP session；registry `mcp__*` 归零；FakePhone 线程 join；WsHub 端口释放（SO_REUSEADDR bind+listen）；无临时目录/DB 泄漏 | `shutdown_mcp_servers`, `_assert_port_released` |

## Concurrent-connect 加固（Agent C §2）

`get_mcp_status()` × 3 · 250ms 间隔；每轮 both server `connected=True` +
`tools>0`；每轮真实 dispatch 各 server 一个 tool（`list_devices` + `inspect_dataset`）
—— 证明两条 session 同时活着（不是 sequential cycle 制造的假象）。

## Prefix 冲突守卫（Agent C §3）

断言 `registry.get_entry("mcp__hermes_devices_mcp__poll_inbox")` 存在 且
`registry.get_entry("poll_inbox")` is None —— 证明 fork 前缀纪律，raw 名字
不会被 MCP 影子污染。

## 反气味守卫（Agent C §8）

测试文件顶部运行时守卫：`assert "mcp.client.stdio" not in sys.modules` 且
`assert "mcp.client.session" not in sys.modules`。测试文件源码不允许 import
raw `stdio_client` / `ClientSession` / `StdioServerParameters` —— 那是 PR #30
的作用域，本 PR 必须完全经过 fork 生产 registry。

## CI（`.github/workflows/p3-m1-mcp-seven-step.yml`）

- `permissions: contents: read` · 无 `pull_request_target` · 无 Provider key
- `uv sync --locked --extra dev --extra mcp` 不动 `uv.lock`
- `pip install --no-deps hermes-devices @ git+...@<sha>` + 单独装 HA 的两条运行时依赖
  （`websockets>=12.0` + `httpx>=0.24`）—— 不进 uv.lock
- Sanity `grep <sha>` 阻断漂移
- pytest `--junitxml` + no-skip / no-empty-run 双闸；pytest / no-skip enforce
  **不 continue-on-error**（Codex F）
- artifact upload 允许 `continue-on-error` 副作用（配额与 gate 不耦合）
- 不设 `PYTHONUTF8=1`；`PYTHONIOENCODING=utf-8` 传子进程
- Linux-only（fork tests.yml house 惯例；Windows 由 HA PR #30 六宫格覆盖）

## 关联 PR 堆叠

- base: `feature/p3-m1-provider` @ `89f81710839e22f34df7b635cbbffb8e66bf5ce1`（fork PR #3 GREEN HEAD）
- head: `feature/p3-m1-mcp-seven-step`（新分支，从 base 建）
- 上游 PR #2 rebrand：`feature/p3-m1-baseline` @ `024a2aaf`（未动）
- 关联 Hermes_AI PR #30：`claude/p3-m1-mcp-seven-step` @ `ad44bd11`（CI 权威 pin）
- 上游 NousResearch/hermes-agent main 参考 SHA：`ee472a7f`（不同步）

## 边界（明确不做）

- 不加 `plugins/hermes_desktop_bridge` 或自建 MCP bridge
- 不加新 MCP 工具（devices 14 + data-ops 6 = 20 保持不动）
- 不改现有工具名字/语义 / prompt / system prompt / tool schema
- 不加 fork 生产 dependencies；`mcp==1.28.1` 已在 fork uv.lock（多处 pin）
- 不改 Provider / MiniMax / DeepSeek / cache / budget / strip plugin
- 不改 Hermes_AI 生产代码
- Draft，不 Ready、不 merge
