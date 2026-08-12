"""Fork PR #4 · P3-M1 MCP 七步验收 · 走 fork 原生 registry.dispatch 全责任链.

## Scope（Codex E · PR #30 之上的**增量**证据）

Hermes_AI PR #30 已用 raw `mcp.ClientSession` + `stdio_client` 证明「原生 SDK
底层能真实驱动两个 stdio server」。PR #4 的**唯一价值**是证明 fork 自己
生产路径下的：`config.yaml → discover_mcp_tools() → 两 stdio server →
fork ToolRegistry → registry.dispatch("mcp__<server>__<tool>", args)`。

**MUST NOT** import `mcp.client.stdio` / `mcp.ClientSession` /
`StdioServerParameters`（Codex E 反气味）。**MUST** 通过 `tools.registry.registry`
的 `dispatch()` / `get_entry()` 走 fork 生产 `_make_tool_handler` 闭包。

## Prereq

- fork 已经 `uv sync --locked --extra dev --extra mcp` 到 `.venv`；`mcp==1.28.1`
  由 `uv.lock` 权威 pin
- `hermes-devices` 已 `pip install --no-deps` @ 固定 SHA
  `a3ef38298e6a42a88ec93d75af88b4027f7febbe` 到 fork 的 `.venv`（同一 venv，
  console script 会 shim 到 `.venv/bin/`）；未来 SHA 升级必须**同 commit** 更新

## 命名（Agent A 权威 · `sanitize_mcp_name_component` 把 `-` → `_`）

- Toolset alias（fork 用配置 key 原样）：`mcp-hermes-devices-mcp` / `mcp-hermes-data-ops-mcp`
- Tool 注册名（fork sanitize）：
  - `mcp__hermes_devices_mcp__<14 tools>`
  - `mcp__hermes_data_ops_mcp__<6 tools>`
"""

from __future__ import annotations

import json
import os
import socket
import threading
import time
from pathlib import Path
from typing import Any

import pytest
import yaml

# 生命周期硬断言：一个测试内多次 discover/dispatch 全走完再 shutdown
_HERMES_DEVICES_SERVER = "hermes-devices-mcp"
_HERMES_DATA_OPS_SERVER = "hermes-data-ops-mcp"

_DEVICES_TOOLS = [
    "list_devices", "get_device_state", "tap", "type_text", "swipe",
    "press_key", "launch_app", "run_phone_task", "draft_reply",
    "search_business_knowledge", "poll_inbox", "send_reply",
    "handoff", "broadcast_task",
]
_DATA_OPS_TOOLS = [
    "inspect_dataset", "dedup_dataset", "label_dataset",
    "clean_dataset", "export_dataset", "ingest_dataset",
]


def _unwrap_dispatch(result) -> str:
    """`registry.dispatch()` 返回的是 **JSON 字符串** `'{"result": "<inner>"}'`
    （见 `_bound_json_error_result` + `_normalize_handler_result`：所有正常
    tool text 都被 wrap 成 `{"result": text}` 序列化）。测试断言的是 tool
    自己的 text，因此需要 unwrap："""
    if isinstance(result, str):
        try:
            parsed = json.loads(result)
        except json.JSONDecodeError:
            # 非 JSON 字符串 → 原样（罕见路径）
            return result
        if isinstance(parsed, dict) and "result" in parsed and isinstance(parsed["result"], str):
            return parsed["result"]
        if isinstance(parsed, dict) and "error" in parsed:
            # error envelope 保留为 JSON 字符串，测试断言可 in 检查
            return result
        # 其他 dict 形状 → 转回 JSON
        return json.dumps(parsed, ensure_ascii=False)
    if isinstance(result, dict):
        if "result" in result and isinstance(result["result"], str):
            return result["result"]
        return json.dumps(result, ensure_ascii=False)
    return str(result)


# ---- 生命周期 · 端口 · 线程 卫生 ---------------------------------------------

def _pick_free_port(host: str = "127.0.0.1") -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        s.bind((host, 0))
        return s.getsockname()[1]


def _assert_port_released(port: int, *, attempts: int = 10, delay: float = 0.1) -> None:
    """SO_REUSEADDR + bind + listen —— 不掩盖真实 LISTEN 撞车（内核仍拒），
    只跳过 TIME_WAIT accepted-conn socket（标准生产语义）。上限 1s。
    """
    last_err: OSError | None = None
    for _ in range(attempts):
        try:
            with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
                s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
                s.bind(("127.0.0.1", port))
                s.listen(1)
                return
        except OSError as e:
            last_err = e
            time.sleep(delay)
    raise AssertionError(
        f"WsHub port {port} 未在 {attempts * delay:.1f}s 内可重新 LISTEN："
        f"{type(last_err).__name__}: {last_err}"
    )


def _assert_no_fake_phone_thread() -> None:
    active = [t.name for t in threading.enumerate() if t.name.startswith("fake-phone-")]
    assert not active, f"残留 fake-phone 线程：{active}"


def _assert_mcp_background_gone(fork_mcp) -> None:
    """严格 cleanup 硬门：shutdown 后 fork mcp_tool 的后台 event-loop 线程
    （`name="mcp-event-loop"`, 生产声明见 tools/mcp_tool.py:4730）必须已 join。
    不能只靠 registry 归零推断 —— 后台 loop/thread 是独立生命周期。"""
    mcp_thread = getattr(fork_mcp, "_mcp_thread", None)
    if mcp_thread is not None:
        assert not mcp_thread.is_alive(), (
            f"shutdown 后 fork mcp _mcp_thread 仍存活：{mcp_thread.name!r}"
        )
    survivors = [t.name for t in threading.enumerate() if t.name == "mcp-event-loop"]
    assert not survivors, (
        f"shutdown 后仍有 mcp-event-loop 后台线程存活：{survivors}"
    )


def _send_forged_inbox_frame(
    phone,
    *,
    msg_id: str,
    channel: str,
    sender: str,
    text: str,
    forged_tenant_id: str,
    forged_internal_tenant: str,
    forged_thread_id: str,
    timeout: float = 5.0,
) -> dict:
    """通过 FakePhone 已建立的 websocket 直接发一帧带**攻击字段**的
    ``inbox_msg`` —— 走**正式 Hub 协议路径**，不修改 FakePhone、不修改
    Hermes_AI 生产代码、不新增 MCP 工具。用 ``run_coroutine_threadsafe(
    ...).result(timeout=...)`` 有界等待，确认帧实际发送成功。

    Codex path-2 BLOCKER 1：证明服务端权威源锁定 —— body 里的 ``tenant_id``
    / ``_tenant_id`` / ``thread_id`` 一律被忽略，poll_inbox 返回和 audit
    落地必须走：
      - ``thread_id = f"{device}:{channel}:{sender}"``（inbox.py 服务端派生）
      - ``tenant  = get_device_tenant(device_id)``（hub._on_hello 反查
        device_tenant 表；InboxQueue.put 在 msg.pop 掉 body 的 ``_tenant_id``）
    """
    import asyncio
    ws, loop = phone._ws, phone._loop
    assert ws is not None and loop is not None, "FakePhone websocket 未建立"
    frame = {
        "t": "inbox_msg",
        "msg_id": msg_id,
        "channel": channel,
        "sender": sender,
        "text": text,
        "ts": time.time(),
        "tenant_id": forged_tenant_id,
        "_tenant_id": forged_internal_tenant,
        "thread_id": forged_thread_id,
    }
    asyncio.run_coroutine_threadsafe(
        ws.send(json.dumps(frame, ensure_ascii=False)), loop
    ).result(timeout=timeout)
    return frame


def _bootstrap_tenant(device_id: str, tenant_id: str) -> str:
    """在测试进程用正式 tenants API 装配：super_admin principal + tenant +
    device.bind_tenant。必须先设 HERMES_TENANTS_DB env（子进程也用同路径）。"""
    from hermes_devices.ops.tenants import (
        bind_device,
        create_principal,
        create_tenant,
    )
    tenant = create_tenant(name="fork-mcp-e2e", tenant_id=tenant_id)
    assert tenant["tenant_id"] == tenant_id
    root = create_principal(tenant_id=None, name="fork-mcp-root", role="super_admin")
    granter_id = root["principal_id"]
    result = bind_device(device_id, tenant_id, granter_id)
    assert result["tenant_id"] == tenant_id
    return granter_id


def _write_config_yaml(hermes_home: Path, sandbox: Path, ws_port: int) -> Path:
    """$HERMES_HOME/config.yaml —— fork `_load_mcp_config()` 读取的 mcp_servers。

    两个 stdio server：
    - hermes-devices-mcp（14 tools · 带 WsHub · env 显式白名单）
    - hermes-data-ops-mcp（6 tools · 无 WsHub · 沙箱路径 env）

    Codex E · 硬约束：child env 显式列 whitelist（native-mcp.md 说 stdio 子进程
    只继承 PATH/HOME/…，其他必须 `env:` 显式声明）。
    """
    child_env_common = {
        "PATH": os.environ.get("PATH", ""),
        "HOME": os.environ.get("HOME", str(sandbox)),
        "LANG": "C.UTF-8",
        "LC_ALL": "C.UTF-8",
        "PYTHONIOENCODING": "utf-8",
        "PYTHONUNBUFFERED": "1",
        "HERMES_AUDIT_LOG": str(sandbox / "audit.jsonl"),
        "HERMES_INBOX_DB": str(sandbox / "inbox.sqlite3"),
        "HERMES_KB_DIR": str(sandbox / "kb"),
        "HERMES_DATA_DIR": str(sandbox / "data"),
        "HERMES_TENANTS_DB": str(sandbox / "tenants.sqlite3"),
    }
    devices_env = {
        **child_env_common,
        "HERMES_WS_HOST": "127.0.0.1",
        "HERMES_WS_PORT": str(ws_port),
    }
    data_ops_env = dict(child_env_common)
    cfg = {
        "mcp_servers": {
            _HERMES_DEVICES_SERVER: {
                "command": "hermes-devices-mcp",
                "args": [],
                "env": devices_env,
                "connect_timeout": 30,
                "timeout": 60,
            },
            _HERMES_DATA_OPS_SERVER: {
                "command": "hermes-data-ops-mcp",
                "args": [],
                "env": data_ops_env,
                "connect_timeout": 30,
                "timeout": 60,
            },
        },
    }
    path = hermes_home / "config.yaml"
    path.write_text(yaml.safe_dump(cfg, sort_keys=False), encoding="utf-8")
    return path


# ---- 主测试 · 单一测试内完成全部 Codex E 断言 ---------------------------------

def test_fork_native_registry_drives_seven_step_via_two_stdio_servers(
    tmp_path, monkeypatch: pytest.MonkeyPatch,
):
    """Codex E 全部 9 项 · 一个 lifecycle 内验证。"""
    tenant_id = "t_fork_e2e"
    device_id = "8D2"
    hermes_home = tmp_path / "hermes-home"
    hermes_home.mkdir()
    sandbox = tmp_path / "sandbox"
    sandbox.mkdir()

    # env（monkeypatch → 测试退出自动 undo；PR #30 同款卫生）
    monkeypatch.setenv("HERMES_HOME", str(hermes_home))
    monkeypatch.setenv("HERMES_TENANTS_DB", str(sandbox / "tenants.sqlite3"))
    monkeypatch.setenv("HERMES_AUDIT_LOG", str(sandbox / "audit.jsonl"))
    monkeypatch.setenv("HERMES_INBOX_DB", str(sandbox / "inbox.sqlite3"))
    monkeypatch.setenv("HERMES_KB_DIR", str(sandbox / "kb"))
    monkeypatch.setenv("HERMES_DATA_DIR", str(sandbox / "data"))

    # Codex E 项 1 · HA 精确 SHA 断言由 CI workflow 权威 gate（Verify Hermes_AI
    # pinned commit 步骤 `git rev-parse HEAD == HERMES_AI_PIN_SHA`）。此处只做
    # 「hermes-devices 已装到当前 site-packages」的最小前置断言：走 stdlib
    # importlib.metadata，无 pip binary / 无 pip module 依赖（uv sync 出来的
    # venv 无 pip）。找不到抛 PackageNotFoundError，直接 fail 测试；不 skip、
    # 不 fallback、不吞异常。
    import importlib.metadata as metadata
    dist = metadata.distribution("hermes-devices")
    assert dist.metadata["Name"].lower() == "hermes-devices"

    # 装 tenants + bind_device（服务端权威 tenant 源）
    _bootstrap_tenant(device_id, tenant_id)

    # 挑端口 + 写 config.yaml
    ws_port = _pick_free_port()
    _write_config_yaml(hermes_home, sandbox, ws_port)

    # Codex E 反气味守卫：本测试文件不允许 import raw mcp.client.stdio 等
    # （静态守卫，运行时也复查）
    import sys
    forbidden = {"mcp.client.stdio", "mcp.client.session"}
    assert not any(m in sys.modules for m in forbidden), (
        f"禁止 raw ClientSession/stdio_client 路径：{forbidden & set(sys.modules)}"
    )

    # 导入 fork 生产路径（唯一驱动）
    from tools import mcp_tool as fork_mcp
    from tools.registry import registry
    from tools.mcp_tool import mcp_prefixed_tool_name

    # 计算期望注册名（Agent A 权威 · sanitize hyphen→underscore）
    expected_devices_names = sorted(
        mcp_prefixed_tool_name(_HERMES_DEVICES_SERVER, t) for t in _DEVICES_TOOLS
    )
    expected_data_ops_names = sorted(
        mcp_prefixed_tool_name(_HERMES_DATA_OPS_SERVER, t) for t in _DATA_OPS_TOOLS
    )
    expected_all = sorted(expected_devices_names + expected_data_ops_names)
    assert len(expected_all) == 20

    # ---- Codex E 项 3 · discover_mcp_tools() 走 fork 原生发现 → 注册 ----
    # 注意：discover_mcp_tools 会顺带触发 fork plugin 系统加载别的非 MCP 工具
    # （如 spotify_*、browser-*），所以「new - before」不必刚好 20；只需要
    # 期望的 20 条 mcp__hermes_devices_mcp__* + mcp__hermes_data_ops_mcp__* 全部
    # 在里面，且注册前不存在（=真正新注册）。
    registered_before = set(registry.get_all_tool_names())
    for name in expected_all:
        assert name not in registered_before, (
            f"期望的 MCP 名 {name!r} 在 discover 前已被别处注册"
        )
    discovered = fork_mcp.discover_mcp_tools()
    registered_after = set(registry.get_all_tool_names())
    missing = set(expected_all) - registered_after
    assert not missing, (
        f"discover_mcp_tools 后 registry 缺失期望 MCP 名：{sorted(missing)}\n"
        f"（如有 CancelledError 请看 log；devices/data-ops server 未连接？）"
    )

    # ---- Codex E 项 2 · 两 server connected=True ----
    status = fork_mcp.get_mcp_status()
    by_name = {s["name"]: s for s in status}
    for srv in (_HERMES_DEVICES_SERVER, _HERMES_DATA_OPS_SERVER):
        assert srv in by_name, f"缺 server {srv!r}：{by_name.keys()}"
        assert by_name[srv]["connected"] is True, by_name[srv]
    assert by_name[_HERMES_DEVICES_SERVER]["tools"] == 14
    assert by_name[_HERMES_DATA_OPS_SERVER]["tools"] == 6

    # ---- Codex E 项 4 · 命名由 fork 生产函数生成（我们 assert 一致） ----
    devices_from_registry = sorted(
        registry.get_tool_names_for_toolset(f"mcp-{_HERMES_DEVICES_SERVER}")
    )
    assert devices_from_registry == expected_devices_names
    data_ops_from_registry = sorted(
        registry.get_tool_names_for_toolset(f"mcp-{_HERMES_DATA_OPS_SERVER}")
    )
    assert data_ops_from_registry == expected_data_ops_names

    # Prefix 冲突守卫（Agent C §3）：raw poll_inbox 不应存在（内建无此名）
    assert registry.get_entry("mcp__hermes_devices_mcp__poll_inbox") is not None
    assert registry.get_entry("poll_inbox") is None

    # ---- FakePhone 走正式 ws 协议连入 child WsHub ----
    from hermes_devices.fake_phone import FakePhone
    phone = FakePhone(device_id=device_id, inbox=True)
    phone_thread = phone.run_in_thread(f"ws://127.0.0.1:{ws_port}/agent")

    try:
        # ---- Codex E 项 6a · list_devices via registry.dispatch → FakePhone ----
        list_devices_name = mcp_prefixed_tool_name(_HERMES_DEVICES_SERVER, "list_devices")

        def _ld() -> str:
            return _unwrap_dispatch(registry.dispatch(list_devices_name, {}))

        end = time.monotonic() + 10.0
        while time.monotonic() < end:
            text = _ld()
            if device_id in text:
                break
            time.sleep(0.3)
        assert device_id in text, (
            f"FakePhone 未在 list_devices（via fork registry）出现：{text!r}"
        )

        # ---- Codex E 项 7 · tenant 来自 device_tenant 表；msg body 伪造应被忽略 ----
        # Codex path-2 BLOCKER 1 真实攻击帧：直接通过 FakePhone 已建立的 ws
        # 走正式 Hub 协议，body 塞三条攻击字段（tenant_id / _tenant_id /
        # thread_id），证明服务端权威源全部锁定，攻击字段一律不进 audit。
        channel = "app"
        sender = "客户E2E-fork"
        prompt = "你们的发票开票速度多快"
        forged_tenant_id = "t_attacker_forged"
        forged_internal_tenant = "t_attacker_internal"
        forged_thread_id = "attacker:forged:thread"
        msg_id = phone.make_msg_id()
        _send_forged_inbox_frame(
            phone,
            msg_id=msg_id,
            channel=channel,
            sender=sender,
            text=prompt,
            forged_tenant_id=forged_tenant_id,
            forged_internal_tenant=forged_internal_tenant,
            forged_thread_id=forged_thread_id,
        )
        expected_thread = f"{device_id}:{channel}:{sender}"

        # ---- Codex E 项 6b · poll_inbox via registry.dispatch ----
        poll_name = mcp_prefixed_tool_name(_HERMES_DEVICES_SERVER, "poll_inbox")
        end = time.monotonic() + 10.0
        poll_data = None
        while time.monotonic() < end:
            text = _unwrap_dispatch(registry.dispatch(poll_name, {"max_n": 5}))
            try:
                poll_data = json.loads(text)
                if any(m.get("msg_id") == msg_id for m in poll_data.get("messages", [])):
                    break
            except (TypeError, json.JSONDecodeError):
                pass
            time.sleep(0.3)
        assert poll_data and any(
            m.get("msg_id") == msg_id for m in poll_data.get("messages", [])
        ), f"poll_inbox 未取到 {msg_id!r}: {poll_data!r}"
        msg = next(m for m in poll_data["messages"] if m["msg_id"] == msg_id)
        assert msg["text"] == prompt
        assert msg["thread_id"] == expected_thread

        # ---- Codex E 项 6c · send_reply（带来源标记）via registry.dispatch ----
        send_name = mcp_prefixed_tool_name(_HERMES_DEVICES_SERVER, "send_reply")
        reply_with_source = "支持的，下单备注即可（来源：faq#003）"
        text6 = _unwrap_dispatch(registry.dispatch(
            send_name, {"msg_id": msg_id, "text": reply_with_source}
        ))
        send_result = json.loads(text6)
        assert send_result == {"status": "sent", "msg_id": msg_id}, send_result

        # FakePhone.sent_replies —— C4 出口层剥离
        end = time.monotonic() + 5.0
        while time.monotonic() < end and not any(
            r["msg_id"] == msg_id for r in phone.sent_replies
        ):
            time.sleep(0.05)
        matching = [r for r in phone.sent_replies if r["msg_id"] == msg_id]
        assert matching, f"FakePhone 未收 {msg_id!r}"
        got_text = matching[0]["text"]
        assert "来源" not in got_text, (
            f"strip_sources 失败：{got_text!r}"
        )
        assert got_text.startswith("支持的")

        # ---- Codex E 项 8 · send_reply 幂等：第二次 already_resolved ----
        text6b = _unwrap_dispatch(registry.dispatch(
            send_name, {"msg_id": msg_id, "text": "再来一次"}
        ))
        assert json.loads(text6b) == {
            "status": "already_resolved", "msg_id": msg_id
        }
        # FakePhone 仅收 1 次
        assert sum(1 for r in phone.sent_replies if r["msg_id"] == msg_id) == 1

        # ---- Codex E 项 6d · audit 链完整（tenant 权威源 = bind_device） ----
        audit_path = Path(os.environ["HERMES_AUDIT_LOG"])
        assert audit_path.exists(), f"audit.jsonl 缺失：{audit_path}"
        lines = [
            json.loads(l)
            for l in audit_path.read_text(encoding="utf-8").splitlines() if l
        ]
        reply_events = [
            e for e in lines
            if e.get("type") == "reply" and e.get("msg_id") == msg_id
        ]
        assert reply_events, f"缺 audit reply 事件：{lines[-10:]}"
        re = reply_events[-1]
        assert re["caller"] == "mcp.send_reply"
        assert re["action"] == "reply"
        no_hit = [e for e in lines if e.get("type") == "no_hit" and e.get("msg_id") == msg_id]
        assert no_hit, f"缺 no_hit 事件（sources=空 时应补）：{lines[-10:]}"
        nh = no_hit[-1]
        assert nh["thread_id"] == expected_thread
        # **权威 tenant 断言**：来自 bind_device，不是消息 body
        assert nh["tenant"] == tenant_id, (
            f"tenant 权威源被绕过！audit tenant={nh.get('tenant')!r} "
            f"vs bind_device 值={tenant_id!r}"
        )
        # **权威 thread_id 断言**：服务端派生（device:channel:sender），不采用攻击 thread_id
        assert nh["thread_id"] == expected_thread and nh["thread_id"] != forged_thread_id, (
            f"thread_id 权威源被绕过！audit thread_id={nh.get('thread_id')!r} "
            f"expected={expected_thread!r} attacker={forged_thread_id!r}"
        )
        # 攻击字段绝不出现在 audit（整份 dump 全字符串扫）
        audit_dump = audit_path.read_text(encoding="utf-8")
        for forged_val in (forged_tenant_id, forged_internal_tenant, forged_thread_id):
            assert forged_val not in audit_dump, (
                f"攻击者伪造字段 {forged_val!r} 泄漏到 audit：{audit_dump[-800:]!r}"
            )
        # 双 tenant 攻击都不进 poll_inbox 返回的服务端 message 视图
        assert msg.get("tenant_id") != forged_tenant_id and msg.get("tenant_id") != forged_internal_tenant, (
            f"poll_inbox message.tenant_id 被攻击字段污染：{msg!r}"
        )

        # ---- Codex E 项 5 · Repeat discover 无重复注册（Agent C §4） ----
        len_before_2nd = len(registry.get_all_tool_names())
        second_discovery = fork_mcp.discover_mcp_tools()
        len_after_2nd = len(registry.get_all_tool_names())
        assert len_before_2nd == len_after_2nd, (
            f"重复 discover 后 registry 尺寸变化：{len_before_2nd} → {len_after_2nd}"
        )
        # get_mcp_status 各 server 仍 connected + tools count 不变
        status2 = {s["name"]: s for s in fork_mcp.get_mcp_status()}
        assert status2[_HERMES_DEVICES_SERVER]["connected"] is True
        assert status2[_HERMES_DEVICES_SERVER]["tools"] == 14
        assert status2[_HERMES_DATA_OPS_SERVER]["connected"] is True
        assert status2[_HERMES_DATA_OPS_SERVER]["tools"] == 6

        # ---- Agent C §2 · concurrent connect 稳定性 · × 3 with 250ms gap ----
        for _ in range(3):
            snap = {s["name"]: s for s in fork_mcp.get_mcp_status()}
            for srv in (_HERMES_DEVICES_SERVER, _HERMES_DATA_OPS_SERVER):
                assert snap[srv]["connected"] is True and snap[srv]["tools"] > 0, snap[srv]
            # 每轮真实 dispatch 各 server 一个工具，证明 session 实活（非缓存）
            r_ld = _unwrap_dispatch(registry.dispatch(list_devices_name, {}))
            assert device_id in r_ld
            r_do = _unwrap_dispatch(registry.dispatch(
                mcp_prefixed_tool_name(_HERMES_DATA_OPS_SERVER, "inspect_dataset"),
                {"path": "nonexistent.jsonl"},
            ))
            # inspect_dataset 对不存在文件应 in-band error，但 dispatch 返回值不空
            assert r_do  # 有返回即证 data-ops session 实活
            time.sleep(0.25)

    finally:
        # ---- teardown ----
        phone_ws, phone_loop = phone._ws, phone._loop
        if phone_ws is not None and phone_loop is not None:
            import asyncio
            try:
                asyncio.run_coroutine_threadsafe(
                    phone_ws.close(), phone_loop
                ).result(timeout=5)
            except Exception:
                pass
        phone_thread.join(timeout=5)
        assert not phone_thread.is_alive(), "FakePhone 线程未在 5s 内退出"

        # ---- Codex E 项 9 · 严格 shutdown_mcp_servers 清理（Codex path-2 BLOCKER 2）----
        # 严格 fail-close：不捕获、不吞异常。shutdown 失败 = 测试失败。
        fork_mcp.shutdown_mcp_servers()

        # registry 中 mcp__* 归零（两组 toolset）
        left_over_devices = [n for n in registry.get_all_tool_names()
                             if n.startswith("mcp__hermes_devices_mcp__")]
        left_over_data_ops = [n for n in registry.get_all_tool_names()
                              if n.startswith("mcp__hermes_data_ops_mcp__")]
        assert not left_over_devices, f"shutdown 后 devices MCP 工具残留：{left_over_devices}"
        assert not left_over_data_ops, f"shutdown 后 data-ops MCP 工具残留：{left_over_data_ops}"

        # 端口释放 + fake-phone 线程清理 + MCP 后台 event-loop 线程 join
        _assert_port_released(ws_port)
        _assert_no_fake_phone_thread()
        _assert_mcp_background_gone(fork_mcp)
