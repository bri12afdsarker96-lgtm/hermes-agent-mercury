"""Platform account maintenance and a content-free governance audit projection."""
from __future__ import annotations

import json

from ..ops import audit, auth, tenants


def _tenant(repo, ctx, tenant_id):
    auth.require_role(ctx, "super_admin")
    if not isinstance(tenant_id, str) or not tenant_id:
        raise ValueError("请选择企业")
    if ctx.tenant_id and ctx.tenant_id != tenant_id:
        raise PermissionError("当前企业视角不允许跨企业操作")
    tenant = repo.get_tenant(tenant_id)
    if not tenant or tenant.get("status") == "deleted":
        raise ValueError("企业不存在")
    return tenant


def administrators(repo, ctx, tenant_id):
    _tenant(repo, ctx, tenant_id)
    fields = ("principal_id", "tenant_id", "name", "login_name", "role", "status")
    return {"principals": [
        {key: row.get(key) for key in fields}
        for row in repo.list_principals(tenant_id=tenant_id, role="tenant_admin")
        if row.get("tenant_id") == tenant_id and row.get("role") == "tenant_admin"
    ]}


def reset_administrator(repo, ctx, body):
    tenant_id = body.get("tenant_id")
    tenant = _tenant(repo, ctx, tenant_id)
    if tenant.get("status") != "active":
        raise ValueError("请先启用企业，再重置管理员密码")
    if body.get("confirmed") is not True:
        raise ValueError("请确认管理员密码重置")
    principal_id = body.get("principal_id")
    if not isinstance(principal_id, str) or not principal_id:
        raise ValueError("请选择企业管理员")
    principal = repo.get_principal(principal_id)
    if (not principal or principal.get("tenant_id") != tenant_id
            or principal.get("role") != "tenant_admin" or principal.get("status") != "active"):
        raise ValueError("企业管理员账号不存在或不可用")
    password = tenants._new_temporary_password()
    if not repo.operator_reset_password(principal_id, password):
        raise ValueError("账号状态已变化，请刷新后重试")
    audit.audit_event("platform.admin_password_reset", tenant_id=tenant_id,
                      principal_id=principal_id, by_principal_id=ctx.principal.principal_id)
    return {"principal_id": principal_id, "name": principal.get("name"),
            "login_name": principal.get("login_name") or principal.get("name"),
            "temporary_password": password, "must_change_password": True}


def recent_activity(ctx):
    auth.require_role(ctx, "super_admin")
    allowed = {"tenant.created", "tenant.status_changed", "tenant.operator_seat_limit_updated",
               "tenant.ai_config_platform_assisted", "platform.admin_password_reset"}
    fields = {"ts", "type", "tenant_id", "by_principal_id", "principal_id", "new_status", "new_limit"}
    path = audit._audit_path()
    try:
        with path.open("rb") as stream:
            size = stream.seek(0, 2)
            offset = max(0, size - 1024 * 1024)
            stream.seek(offset)
            if offset:
                stream.readline()  # omit a partial first record
            data = stream.read(1024 * 1024)
    except FileNotFoundError:
        return {"events": [], "window": "recent_log_tail"}
    events = []
    for line in reversed(data.splitlines()):
        try:
            event = json.loads(line)
        except (ValueError, UnicodeDecodeError):
            continue
        if not isinstance(event, dict) or event.get("type") not in allowed:
            continue
        if ctx.tenant_id and event.get("tenant_id") != ctx.tenant_id:
            continue
        events.append({key: value for key, value in event.items()
                       if key in fields and isinstance(value, (str, int, float, type(None)))})
        if len(events) == 100:
            break
    return {"events": events, "window": "recent_log_tail"}
