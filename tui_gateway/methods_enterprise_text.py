"""Narrow owned-text handlers; framing and execution use the existing gateway."""
from .method_ctx import HandlerRegistry

_registry = HandlerRegistry()


@_registry.method("enterprise_text.capabilities")
def capabilities(rid, params):
    return _ok(rid, {"protocol_version": 1, "model": "gpt-6-luna", "reasoning_effort": "medium"})


@_registry.method("enterprise_text.submit")
def submit(rid, params):
    from hermes_cli import enterprise_text
    try:
        entry = _sessions.get(params.get("session_id"))
        enterprise_text.authorize(entry, params, current_transport())
        return _ok(rid, enterprise_text.submit(entry, params))
    except Exception:
        return _err(rid, 403, "LOCAL_TEXT_UNAVAILABLE")


@_registry.method("enterprise_text.status")
def status(rid, params):
    from hermes_cli import enterprise_text
    try:
        entry = _sessions.get(params.get("session_id"))
        request = enterprise_text.authorize(entry, params, current_transport())
        return _ok(rid, enterprise_text.result(entry, request))
    except Exception:
        return _err(rid, 403, "LOCAL_TEXT_UNAVAILABLE")


@_registry.method("enterprise_text.stop")
def stop(rid, params):
    from hermes_cli import enterprise_text
    try:
        entry = _sessions.get(params.get("session_id"))
        request = enterprise_text.authorize(entry, params, current_transport())
        return _ok(rid, enterprise_text.stop(entry, request))
    except Exception:
        return _err(rid, 403, "LOCAL_TEXT_UNAVAILABLE")


@_registry.method("enterprise_text.accept")
def accept(rid, params):
    from hermes_cli import enterprise_text
    try:
        entry = _sessions.get(params.get("session_id"))
        request = enterprise_text.authorize(entry, params, current_transport())
        return _ok(rid, enterprise_text.accept(entry, request))
    except Exception:
        return _err(rid, 403, "LOCAL_TEXT_UNAVAILABLE")


def register(server):
    _registry.install(server)
