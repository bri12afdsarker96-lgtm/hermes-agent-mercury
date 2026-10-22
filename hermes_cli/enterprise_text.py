"""Owned text policy around SessionDB and the existing Responses consumer.

No agent, RPC framing, scheduler, transcript store, or event-consumption loop.
Only non-secret request facts persist; drafts stay in the existing live session.
"""
import hashlib
import hmac
import json
import re
import threading
import time
import uuid
from contextlib import contextmanager

PREFIX = "enterprise-text-"
NAMESPACE = "_enterprise_text"
MAX_OBSERVATION_SECONDS = 70


def is_reserved_session(row):
    config = row.get("model_config")
    if isinstance(config, str):
        try:
            config = json.loads(config)
        except (ValueError, TypeError):
            raise TextBoundaryError("LOCAL_TEXT_SESSION_INVALID") from None
    return (str(row.get("id") or "").lower().startswith(PREFIX)
            or str(row.get("parent_session_id") or "").lower().startswith(PREFIX)
            or row.get("source") == "enterprise_text"
            or isinstance(config, dict) and NAMESPACE in config)


def assert_importable_database(path):
    """Inspect staged SQLite before generic archive publication; no mutation."""
    import sqlite3
    deadline = time.monotonic() + 5
    try:
        with sqlite3.connect(path.resolve().as_uri() + "?mode=ro&immutable=1", uri=True) as conn:
            conn.set_progress_handler(lambda: int(time.monotonic() >= deadline), 1000)
            columns = {row[1] for row in conn.execute("PRAGMA table_info(sessions)")}
            if not columns:
                return
            fields = [name if name in columns else "NULL AS " + name
                      for name in ("id", "source", "parent_session_id", "model_config")]
            conn.row_factory = sqlite3.Row
            for row in conn.execute("SELECT " + ",".join(fields) + " FROM sessions"):
                if is_reserved_session(dict(row)):
                    raise ValueError()
    except Exception:
        raise ValueError("Owned runtime state cannot be imported") from None


class TextBoundaryError(Exception):
    def __init__(self, code="LOCAL_TEXT_UNAVAILABLE"):
        self.code = code
        super().__init__(code)


def opaque(value, limit=96):
    if not isinstance(value, str) or not re.fullmatch(r"[A-Za-z0-9_-]{1,%d}" % limit, value):
        raise TextBoundaryError("LOCAL_TEXT_ASSOCIATION_INVALID")
    return value


def digest(value):
    return hashlib.sha256(value.encode()).hexdigest()


@contextmanager
def database(profile):
    from hermes_cli.auth import siwc_auth_path
    from hermes_state import SessionDB
    db = SessionDB(db_path=siwc_auth_path(profile).parent / "state.db")
    try:
        yield db
    finally:
        db.close()


def _metadata(conn, entry):
    row = conn.execute("SELECT source, model_config FROM sessions WHERE id=?", (entry["db_session_id"],)).fetchone()
    if row is None or row[0] != "enterprise_text":
        raise TextBoundaryError("LOCAL_TEXT_SESSION_CHANGED")
    metadata = json.loads(row[1] or "{}")
    data = metadata.get(NAMESPACE)
    if not isinstance(data, dict) or data.get("binding") != entry["binding"] or not isinstance(data.get("requests"), dict):
        raise TextBoundaryError("LOCAL_TEXT_SESSION_CHANGED")
    return metadata, data


def create(params, transport):
    from hermes_cli.auth import siwc_auth_path, siwc_status
    allowed = {"text_only", "profile", "owner", "owner_scope", "registration_id", "generation", "conversation_id", "prompt_hash"}
    if set(params) - allowed or params.get("text_only") is not True or transport is None:
        raise TextBoundaryError("LOCAL_TEXT_SESSION_INVALID")
    profile = params.get("profile")
    siwc_auth_path(profile)
    for key in ("owner", "owner_scope", "prompt_hash"):
        if not isinstance(params.get(key), str) or not re.fullmatch(r"[a-f0-9]{64}", params[key]):
            raise TextBoundaryError("LOCAL_TEXT_SESSION_INVALID")
    conversation = opaque(params.get("conversation_id"))
    status = siwc_status(profile)
    if (status.get("state") != "ready" or status.get("registration_id") != params.get("registration_id")
            or type(params.get("generation")) is not int or status.get("generation") != params["generation"]):
        raise TextBoundaryError("LOCAL_TEXT_ACCOUNT_CHANGED")
    binding = {key: params[key] for key in ("owner_scope", "registration_id", "generation", "prompt_hash")}
    binding.update(model="gpt-6-luna", reasoning_effort="medium")
    entry = {"text_only": True, "profile": profile, "owner": params["owner"], "binding": binding,
             "db_session_id": PREFIX + digest(params["owner_scope"] + ":" + conversation),
             "transport": transport, "created_at": time.time(), "last_active": time.time(),
             "agent": None, "history": [], "inflight_turn": None, "close_on_disconnect": True,
             "text_stop": threading.Event(), "text_stream": None, "text_draft": None,
             "text_cancelled": set(),
             "text_facts": {},
             "text_request_id": None, "text_lock": threading.Lock()}
    with database(profile) as db:
        db.create_session(entry["db_session_id"], source="enterprise_text", model="gpt-6-luna",
                          model_config={NAMESPACE: {"binding": binding, "requests": {}}})
        db._execute_write(lambda conn: _metadata(conn, entry))
    return PREFIX + "runtime-" + uuid.uuid4().hex, entry


def authorize(entry, params, transport):
    if (not entry or not entry.get("text_only") or transport is not entry.get("transport")
            or not isinstance(params.get("owner"), str)
            or not hmac.compare_digest(params["owner"], entry["owner"])):
        raise TextBoundaryError("LOCAL_TEXT_OWNER_CHANGED")
    request = opaque(params.get("request_id"))
    entry["last_active"] = time.time()
    return request


def fact(entry, request):
    with database(entry["profile"]) as db:
        return db._execute_write(lambda conn: dict(_metadata(conn, entry)[1]["requests"].get(request, {"state": "not_started"})))


def _write_fact(entry, request, update, *, claim=None):
    # The callback is retryable: SQL/serialization only, never external effects.
    with database(entry["profile"]) as db:
        def transaction(conn):
            metadata, data = _metadata(conn, entry)
            requests = data["requests"]
            if claim is not None:
                if request in requests:
                    if requests[request].get("input_hash") != claim:
                        raise TextBoundaryError("LOCAL_TEXT_REQUEST_CHANGED")
                    return False
                if len(requests) >= 128:
                    raise TextBoundaryError("LOCAL_TEXT_CONVERSATION_LIMIT")
                requests[request] = {"state": "unknown", "input_hash": claim}
            else:
                if request not in requests:
                    raise TextBoundaryError("LOCAL_TEXT_REQUEST_MISSING")
                requests[request].update(update)
            conn.execute("UPDATE sessions SET model_config=? WHERE id=? AND source='enterprise_text'",
                         (json.dumps(metadata, separators=(",", ":")), entry["db_session_id"]))
            return True
        return db._execute_write(transaction)


def result(entry, request):
    status = fact(entry, request)
    public = {key: status[key] for key in ("state", "reason", "response_id") if key in status}
    if (public["state"] == "received" and entry.get("text_request_id") == request
            and entry.get("text_draft") is not None):
        public["draft"] = entry["text_draft"]
    return public


def submit(entry, params):
    from hermes_cli.runtime_provider import resolve_owned_text_runtime
    from agent.codex_runtime import CodexTextProtocolError, run_siwc_text_response
    request = opaque(params.get("request_id"))
    instructions, text = params.get("instructions"), params.get("input")
    if (not isinstance(instructions, str) or not 1 <= len(instructions) <= 16000
            or not isinstance(text, str) or not 1 <= len(text) <= 26000
            or digest(instructions) != entry["binding"]["prompt_hash"]):
        raise TextBoundaryError("LOCAL_TEXT_CONTEXT_CHANGED")
    if not entry["text_lock"].acquire(blocking=False):
        return result(entry, request)
    try:
        if request in entry["text_cancelled"]:
            return {"state": "not_started", "reason": "LOCAL_TEXT_OBSERVATION_STOPPED"}
        if fact(entry, request)["state"] != "not_started":
            return result(entry, request)
        credentials = resolve_owned_text_runtime(entry["profile"], entry["binding"]["registration_id"], entry["binding"]["generation"])
        entry["text_stop"].clear()
        entry.update(text_request_id=request, text_draft=None)
        entry["text_facts"] = {"started": False, "delta_events": 0, "interrupt_requested": False}
        if request in entry["text_cancelled"]:
            return {"state": "not_started", "reason": "LOCAL_TEXT_OBSERVATION_STOPPED"}
        if not _write_fact(entry, request, {}, claim=digest(instructions + "\0" + text)):
            return result(entry, request)
        def observe(event):
            # Only bounded protocol facts; never draft/reasoning/input payloads.
            from agent.codex_runtime import _event_field
            kind = _event_field(event, "type", "")
            if kind == "response.created":
                response_id = _event_field(_event_field(event, "response"), "id")
                entry["text_facts"].update(started=True, response_id=response_id)
                _write_fact(entry, request, {"started": True, "response_id": response_id})
            elif kind == "response.output_text.delta":
                entry["text_facts"]["delta_events"] += 1
            elif kind in {"response.completed", "response.failed", "response.incomplete"}:
                entry["text_facts"]["observed_terminal_event"] = kind
        def attach(stream):
            entry["text_stream"] = stream
            if entry["text_stop"].is_set():
                stream.close()
        def deadline():
            try:
                stop(entry, request)
            except Exception:
                # Ending local observation never establishes remote cancel.
                entry["text_stop"].set()
        timer = threading.Timer(MAX_OBSERVATION_SECONDS, deadline)
        timer.daemon = True
        timer.start()
        try:
            response = run_siwc_text_response(credentials, instructions, text,
                interrupt_check=entry["text_stop"].is_set,
                on_event=observe,
                on_stream=attach)
            if response.status == "completed" and response.protocol_terminal_observed and not entry["text_stop"].is_set():
                entry["text_draft"] = response.output_text
                _write_fact(entry, request, {"state": "received", "response_id": response.id})
            elif response.protocol_terminal_observed and response.status in {"failed", "incomplete"}:
                _write_fact(entry, request, {"state": "failed", "reason": "LOCAL_TEXT_UPSTREAM_FAILED", "response_id": response.id})
        except CodexTextProtocolError as error:
            _write_fact(entry, request, {"reason": error.code})
        except Exception:
            # A model or persistence exception cannot establish non-execution.
            return {"state": "unknown", "reason": "LOCAL_TEXT_RESULT_UNKNOWN"}
        finally:
            timer.cancel()
            entry["text_stream"] = None
            try:
                _write_fact(entry, request, entry["text_facts"])
            except Exception:
                # Do not expose a draft after unconfirmed persistence.
                entry["text_draft"] = None
        return result(entry, request)
    finally:
        entry["text_lock"].release()


def stop(entry, request):
    if len(entry["text_cancelled"]) >= 128 and request not in entry["text_cancelled"]:
        raise TextBoundaryError("LOCAL_TEXT_CONVERSATION_LIMIT")
    entry["text_cancelled"].add(request)
    if entry.get("text_request_id") == request:
        entry["text_stop"].set()
        entry["text_facts"]["interrupt_requested"] = True
        stream = entry.get("text_stream")
        if stream is not None:
            try:
                stream.close()
            except Exception:
                pass
    return {"state": fact(entry, request)["state"], "local_observation_stopped": True}


def accept(entry, request):
    # Only the private main bridge calls this AFTER S's fresh/C4 acceptance.
    state = fact(entry, request)["state"]
    if state == "completed":
        return {"state": "completed"}
    if state != "received":
        raise TextBoundaryError("LOCAL_TEXT_RESULT_UNKNOWN")
    _write_fact(entry, request, {"state": "completed"})
    entry["text_draft"] = None
    return {"state": "completed"}
