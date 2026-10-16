# SPDX-License-Identifier: AGPL-3.0-only
# SPDX-FileCopyrightText: 2026 aphrody contributors
# Semantic adapter informed by Jan ADK at 14a720628f9592c8e60f7e081ef733076db8a6a9.
# Jan ADK package manifests declare AGPL-3.0; see migration provenance.
"""Bounded ADK session views over the existing Aphrody AgentClient.

This is an Aphrody protocol adapter, not a Jan RPC implementation. Unsupported
Jan guarantees raise UnsupportedCapability before a request is written. Runtime
history remains with the native app-server; this module never opens SessionDB.
"""

from __future__ import annotations

import base64
import mimetypes
import threading
import time
from collections import deque
from collections.abc import Callable, Iterator, Mapping, Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from aphrody.agent import AgentClient, AgentError, AgentTurn, TransportClosedError


class UnsupportedCapability(NotImplementedError):
    """A Jan guarantee needs a canonical owner extension (see HANDOFF.md)."""


class ADKRequestError(AgentError):
    """An answered RPC refusal, retaining the original method/code/data."""

    def __init__(self, method: str, error: AgentError) -> None:
        super().__init__(error.code, str(error), error.data)
        self.method = method

    @property
    def retryable(self) -> bool:
        return isinstance(self.data, dict) and self.data.get("retryable") is True


@dataclass(frozen=True)
class TurnResult:
    stop_reason: str
    usage: Any = None
    error: Any = None


@dataclass(frozen=True)
class HostToolCall:
    request_id: str
    tool_name: str
    session: ADKSession
    aborted: threading.Event
    run_id: str | None = None


@dataclass(frozen=True)
class HostTool:
    name: str
    handler: Callable[[Any, HostToolCall], Any]
    description: str = ""
    parameters: Mapping[str, Any] | None = None
    capability: str = "actuator"

    def declaration(self) -> dict[str, Any]:
        if not self.name or not callable(self.handler):
            raise ValueError("Host tool requires a name and callable handler")
        if self.capability not in ("read", "actuator"):
            raise ValueError("Host tool capability must be read or actuator")
        return {
            "name": self.name,
            "description": self.description,
            "parameters": dict(self.parameters or {"type": "object"}),
            "capability": self.capability,
        }


class ADKTurn:
    """Single-consumer events with an independently waitable terminal result.

    The canonical transport is drained even when only result() is called.
    Both queues drop only unread token deltas at their independent caps;
    overflow involving control records fails explicitly.
    """

    def __init__(self, session: ADKSession, turn: AgentTurn) -> None:
        self.session = session
        self.id = turn.id
        self._turn = turn
        self._condition = threading.Condition()
        self._events: deque[dict[str, Any]] = deque()
        self._result: TurnResult | None = None
        self._failure: BaseException | None = None
        self._consumed = False
        self._dropped = 0
        self._worker = threading.Thread(target=self._drain, daemon=True)

    def _drain(self) -> None:
        try:
            terminal: TurnResult | None = None
            for frame in self._turn.events():
                params = frame.get("params") or {}
                method = frame["method"]
                if method == "turn/completed":
                    record = params["turn"]
                    terminal = TurnResult(
                        record["status"], record.get("usage"), record.get("error")
                    )
                    continue
                if method == "item/agentMessage/delta":
                    event = {"type": "token", "text": params["delta"]}
                elif method == "tool/cancelled":
                    event = {
                        "type": "tool_request_cancelled",
                        "request_id": params["requestId"],
                    }
                else:
                    # Never invent Jan events for native items that lack a
                    # semantic equivalent. Consumers can inspect the raw wire.
                    event = {"type": "native_notification", "frame": frame}
                self._push(event)
            if terminal is None:
                raise TransportClosedError(
                    "Turn stream ended without a terminal record"
                )
            self.session._finished(self)
            with self._condition:
                self._result = terminal
                self._condition.notify_all()
        except BaseException as error:
            with self._condition:
                self._failure = error
                self._condition.notify_all()
        finally:
            self.session._finished(self)

    def _push(self, event: dict[str, Any]) -> None:
        with self._condition:
            if len(self._events) == self.session.max_buffered_events:
                oldest = self._events.popleft()
                if oldest["type"] != "token":
                    self._failure = TransportClosedError(
                        "ADK notification buffer overflow on a control record"
                    )
                    self._condition.notify_all()
                    raise self._failure
                self._dropped += 1
            self._events.append(event)
            self._condition.notify_all()
        self.session._emit(event)

    def result(self, timeout: float | None = None) -> TurnResult:
        with self._condition:
            if not self._condition.wait_for(
                lambda: self._result is not None or self._failure is not None, timeout
            ):
                raise TimeoutError("Turn result timed out")
            if self._failure is not None:
                raise self._failure
            assert self._result is not None
            return self._result

    @property
    def dropped(self) -> int:
        return self._dropped + self._turn.dropped

    def __iter__(self) -> Iterator[dict[str, Any]]:
        with self._condition:
            if self._consumed:
                raise RuntimeError("Turn events already consumed")
            self._consumed = True
        while True:
            with self._condition:
                self._condition.wait_for(
                    lambda: (
                        bool(self._events)
                        or self._result is not None
                        or self._failure is not None
                    )
                )
                if self._events:
                    event = self._events.popleft()
                elif self._failure is not None:
                    raise self._failure
                else:
                    return
            yield event

    def interrupt(self) -> Any:
        return self.session.runtime.request(
            "turn/interrupt", {"threadId": self.session.id, "turnId": self.id}
        )


class ADKSession:
    """A native thread view. No local history or tool declarations are stored."""

    def __init__(self, runtime: AphrodyADK, view: dict[str, Any]) -> None:
        self.runtime = runtime
        self.id: str = view["thread"]["id"]
        self.model = view.get("model", view["thread"].get("model"))
        self.max_buffered_events = runtime.max_buffered_events
        self._lock = threading.RLock()
        self._active: ADKTurn | None = None
        self._closed = False
        self._listeners: dict[str, list[Callable[[dict[str, Any]], None]]] = {}
        self._tools: dict[str, HostTool] = {}
        self._calls: dict[str, threading.Event] = {}
        self._permissions: dict[str, tuple[threading.Event, dict[str, str]]] = {}

    def on(
        self, kind: str, listener: Callable[[dict[str, Any]], None]
    ) -> Callable[[], None]:
        with self._lock:
            self._listeners.setdefault(kind, []).append(listener)

        def off() -> None:
            with self._lock:
                entries = self._listeners.get(kind, [])
                self._listeners[kind] = [
                    item for item in entries if item is not listener
                ]

        return off

    def _emit(self, event: dict[str, Any]) -> None:
        with self._lock:
            listeners = [
                listener
                for kind in ("event", "*", event["type"])
                for listener in self._listeners.get(kind, [])
            ]
        for listener in listeners:
            try:
                listener(event)
            except Exception:
                # Observers cannot prevent delivery of the terminal result.
                continue

    def _finished(self, turn: ADKTurn) -> None:
        with self._lock:
            if self._active is turn:
                self._active = None

    def prompt(self, content: Any) -> ADKTurn:
        content = normalize_input(content)
        with self._lock:
            if self._closed:
                raise TransportClosedError("Session is closed")
            if self._active is not None:
                raise RuntimeError("Session already has an active turn")
            native = self.runtime.client.start_turn(self.id, content)
            turn = ADKTurn(self, native)
            self._active = turn
            turn._worker.start()
            return turn

    def steer(self, content: Any) -> Any:
        if isinstance(content, Mapping):
            content = content.get("text")
        if not isinstance(content, str):
            raise TypeError("steer takes text or a {text} record")
        with self._lock:
            if self._active is None:
                raise RuntimeError("Session has no active turn")
            turn_id = self._active.id
        return self.runtime.request(
            "turn/steer",
            {
                "threadId": self.id,
                "expectedTurnId": turn_id,
                "input": [{"type": "text", "text": content}],
            },
        )

    def interrupt(self) -> Any:
        with self._lock:
            turn = self._active
        if turn is None:
            raise RuntimeError("Session has no active turn")
        return turn.interrupt()

    def fork(self, tools: Sequence[Any] = ()) -> ADKSession:
        return self.runtime.fork_session(self.id, tools=tools)

    def archive(self) -> None:
        self.runtime.request("thread/archive", {"threadId": self.id})
        with self._lock:
            self._closed = True
            self._listeners.clear()
            for flag in self._calls.values():
                flag.set()
        self.runtime._release(self)

    def close(self) -> None:
        """Drop the live native thread, preserving its durable transcript.

        This corresponds to Jan's session/archive lifetime behavior; native
        thread/archive separately changes persisted visibility.
        """
        self.runtime.request("thread/close", {"threadId": self.id})
        with self._lock:
            self._closed = True
            self._listeners.clear()
            for flag in self._calls.values():
                flag.set()
        self.runtime._release(self)

    def read(self, *, include_turns: bool = True) -> dict[str, Any]:
        return self.runtime.request(
            "thread/read", {"threadId": self.id, "includeTurns": include_turns}
        )

    def reset(self) -> None:
        raise UnsupportedCapability("Native thread history reset is unavailable")

    def set_model(self, model: str) -> str:
        raise UnsupportedCapability("Native in-place model replacement is unavailable")

    def get_tools(self) -> dict[str, Any]:
        self.runtime._require_host_tools()
        return self.runtime.request("thread/tools/get", {"threadId": self.id})

    def set_tools(self, tools: Sequence[Any]) -> dict[str, Any]:
        self.runtime._require_host_tools()
        if any(not isinstance(tool, HostTool) for tool in tools):
            raise TypeError("tools must contain HostTool declarations")
        if len({tool.name for tool in tools}) != len(tools):
            raise ValueError("Host tool names must be unique")
        with self._lock:
            if self._closed:
                raise TransportClosedError("Session is closed")
            if self._active is not None:
                raise RuntimeError("Cannot replace tools during an active turn")
            result = self.runtime.request(
                "thread/tools/set",
                {"threadId": self.id, "tools": [tool.declaration() for tool in tools]},
            )
            self._tools = {tool.name: tool for tool in tools}
            return result

    def respond_permission(self, request_id: str, decision: str) -> None:
        if decision == "allow_always":
            raise UnsupportedCapability("Native persistent host grants are unavailable")
        if decision not in ("allow_once", "deny"):
            raise ValueError("Permission decision must be allow_once or deny")
        with self._lock:
            pending = self._permissions.get(request_id)
            if pending is None or pending[0].is_set():
                raise ValueError("Permission request is no longer pending")
            pending[1]["decision"] = "allow" if decision == "allow_once" else "deny"
            pending[0].set()


class AphrodyADK:
    """Own or borrow the canonical client. start() completes native initialization.

    Native defaults are retained, including permissions and built-in tools.
    This class deliberately does not claim Jan-compatible permission defaults.
    """

    def __init__(
        self,
        client: AgentClient,
        *,
        owns_client: bool = False,
        max_buffered_events: int = 100_000,
    ) -> None:
        if (
            not isinstance(max_buffered_events, int)
            or isinstance(max_buffered_events, bool)
            or max_buffered_events < 1
        ):
            raise ValueError("max_buffered_events must be positive")
        self.client = client
        self._owns_client = owns_client
        self.max_buffered_events = max_buffered_events
        self._sessions: dict[str, ADKSession] = {}
        self._lock = threading.RLock()
        self._closed = False
        self.server_info: Any = None
        self.capabilities: Any = None
        # Native initialize does not negotiate the Jan protocol or content caps.
        self.protocol_version = None
        self.limits = None
        self._off_tools = client.on_request("tool/call", self._call_tool)
        try:
            self._off_permissions = client.on_request(
                "permission/request", self._call_permission
            )
        except BaseException:
            self._off_tools()
            raise

    def _call_permission(self, params: Any) -> dict[str, str]:
        if not isinstance(params, Mapping):
            raise TypeError("Permission request must be a record")
        thread_id, request_id = params.get("threadId"), params.get("requestId")
        if not isinstance(thread_id, str) or not isinstance(request_id, str):
            raise TypeError("Permission threadId/requestId must be text")
        with self._lock:
            session = self._sessions.get(thread_id)
        if session is None:
            raise ValueError("Unknown permission thread")
        flag = self.client.request_cancellation(request_id)
        ready = threading.Event()
        answer: dict[str, str] = {}
        event = {
            "type": "permission_request",
            "request_id": request_id,
            "tool_name": params.get("name"),
            "args": params.get("arguments"),
        }
        with session._lock:
            if session._closed or flag.is_set():
                return {"decision": "deny"}
            session._permissions[request_id] = (ready, answer)
            session._calls[request_id] = flag
            turn = session._active
        try:
            if turn is None:
                session._emit(event)
            else:
                turn._push(event)
            deadline = time.monotonic() + 120
            while not ready.wait(0.05):
                if flag.is_set() or time.monotonic() >= deadline:
                    return {"decision": "deny"}
            return answer
        finally:
            with session._lock:
                session._permissions.pop(request_id, None)
                session._calls.pop(request_id, None)

    def _call_tool(self, params: Any) -> dict[str, Any]:
        if not isinstance(params, Mapping):
            raise TypeError("Host tool request must be a record")
        for field in ("threadId", "name", "requestId"):
            if not isinstance(params.get(field), str):
                raise TypeError(field + " must be text")
        with self._lock:
            session = self._sessions.get(params["threadId"])
        if session is None:
            raise ValueError("Unknown host tool thread")
        with session._lock:
            tool = session._tools.get(params["name"])
            if session._closed or tool is None:
                raise ValueError("Undeclared host tool")
        request_id = params["requestId"]
        flag = self.client.request_cancellation(request_id)
        if flag.is_set():
            raise TransportClosedError("Host request cancelled")
        call = HostToolCall(request_id, tool.name, session, flag)
        with session._lock:
            session._calls[request_id] = flag
            turn = session._active
        try:
            event = {
                "type": "tool_request",
                "request_id": request_id,
                "tool_name": tool.name,
                "args": params.get("arguments"),
            }
            if turn is None:
                session._emit(event)
            else:
                turn._push(event)
            return normalize_result(tool.handler(params.get("arguments"), call))
        finally:
            with session._lock:
                session._calls.pop(request_id, None)

    @classmethod
    def start(cls, *, max_buffered_events: int = 100_000, **options: Any) -> AphrodyADK:
        client = AgentClient(**options)
        try:
            runtime = cls(
                client, owns_client=True, max_buffered_events=max_buffered_events
            )
            result = client.initialize()
            if not isinstance(result, dict) or not isinstance(
                result.get("capabilities"), dict
            ):
                raise TransportClosedError("Malformed native initialize response")
            runtime.server_info = result.get("serverInfo")
            runtime.capabilities = result["capabilities"]
            if not runtime.capabilities.get("threads") or not runtime.capabilities.get(
                "turns"
            ):
                raise UnsupportedCapability(
                    "Native threads/turns capabilities unavailable"
                )
            return runtime
        except BaseException:
            client.close()
            raise

    def __enter__(self) -> AphrodyADK:
        self._ensure_open()
        return self

    def __exit__(self, *_exc: object) -> None:
        self.close()

    def _ensure_open(self) -> None:
        if self._closed:
            raise TransportClosedError("ADK is closed")

    def _require_host_tools(self) -> None:
        if (
            not isinstance(self.capabilities, Mapping)
            or self.capabilities.get("hostTools") is not True
        ):
            raise UnsupportedCapability("Native hostTools capability is not negotiated")

    def request(self, method: str, params: dict | None = None) -> Any:
        """Canonical native method escape hatch; never silently translates Jan RPC."""
        self._ensure_open()
        try:
            return self.client.request(method, params)
        except AgentError as error:
            raise ADKRequestError(method, error) from error

    def _session(self, view: dict[str, Any]) -> ADKSession:
        with self._lock:
            session_id = view["thread"]["id"]
            if session_id not in self._sessions:
                self._sessions[session_id] = ADKSession(self, view)
            return self._sessions[session_id]

    def create_session(
        self,
        *,
        cwd: str | None = None,
        model: str | None = None,
        ephemeral: bool | None = None,
        builtins: bool | None = None,
        subagents: bool | None = None,
        system_prompt: str | None = None,
        permissions: str | None = None,
        tools: Sequence[Any] = (),
    ) -> ADKSession:
        self._ensure_open()
        if tools or permissions is not None:
            self._require_host_tools()
        if any(not isinstance(tool, HostTool) for tool in tools):
            raise TypeError("tools must contain HostTool declarations")
        if len({tool.name for tool in tools}) != len(tools):
            raise ValueError("Host tool names must be unique")
        for name, value in {
            "ephemeral": ephemeral,
            "builtins": builtins,
            "subagents": subagents,
        }.items():
            if value is not None and not isinstance(value, bool):
                raise TypeError(name + " must be boolean")
        unsupported: dict[str, Any] = {}
        if permissions not in (None, "host", "jan", "aphrody"):
            unsupported["permissions"] = permissions
        if subagents is True:
            unsupported["subagents"] = subagents
        names = [name for name, value in unsupported.items() if value is not None]
        if names:
            raise UnsupportedCapability(
                "Unproven native Jan guarantees: " + ", ".join(names)
            )
        if (system_prompt is not None or builtins is False) and ephemeral is not True:
            raise UnsupportedCapability(
                "system_prompt/builtins overrides require ephemeral=True; "
                "durable native option replay is unavailable"
            )
        if system_prompt is not None and not system_prompt.strip():
            raise ValueError("system_prompt must not be blank")
        params = {
            key: value
            for key, value in {
                "cwd": cwd,
                "model": model,
                "ephemeral": ephemeral,
                "builtins": builtins,
                "subagents": subagents,
                "systemPrompt": system_prompt,
                "permissions": permissions,
                "tools": [tool.declaration() for tool in tools] if tools else None,
            }.items()
            if value is not None
        }
        session = self._session(self.request("thread/start", params))
        session._tools = {tool.name: tool for tool in tools}
        return session

    def list_sessions(self) -> list[dict[str, Any]]:
        """Native summaries, including persisted threads; not Jan live-session counts."""
        result: list[dict[str, Any]] = []
        cursor: str | None = None
        seen: set[str] = set()
        while True:
            page = self.request("thread/list", {"cursor": cursor})
            result.extend(page["data"])
            cursor = page.get("nextCursor")
            if cursor is None:
                return result
            if not isinstance(cursor, str) or cursor in seen:
                raise TransportClosedError("Invalid native thread/list cursor")
            seen.add(cursor)

    def resume_session(self, session_id: str) -> ADKSession:
        return self._session(self.request("thread/resume", {"threadId": session_id}))

    def fork_session(self, session_id: str, tools: Sequence[Any] = ()) -> ADKSession:
        if tools:
            raise UnsupportedCapability("Native host-tool declarations are unavailable")
        return self._session(self.request("thread/fork", {"threadId": session_id}))

    def _release(self, session: ADKSession) -> None:
        with self._lock:
            self._sessions.pop(session.id, None)

    def close(self) -> None:
        with self._lock:
            if self._closed:
                return
            self._closed = True
            sessions = list(self._sessions.values())
            self._sessions.clear()
        for session in sessions:
            with session._lock:
                session._closed = True
                session._listeners.clear()
                for flag in session._calls.values():
                    flag.set()
        self._off_tools()
        self._off_permissions()
        if self._owns_client:
            self.client.close()
        # Borrowed clients and their active native turns remain caller-owned.


def normalize_input(content: Any) -> str | list[dict[str, Any]]:
    """Translate supported Jan/OpenAI content into the existing native wire.

    No image files are opened, downloaded or persisted here. Native runtime
    validation governs URL/media budgets; their limits are not negotiated by
    this adapter, and vision-provider support needs separate qualification.
    """
    if isinstance(content, Mapping):
        if isinstance(content.get("text"), str):
            return content["text"]
        content = content.get("content")
    if isinstance(content, str):
        return content
    if not isinstance(content, list) or not content:
        raise TypeError("prompt takes text or nonempty content parts")
    parts = []
    for part in content:
        if not isinstance(part, Mapping):
            raise TypeError("Content parts must be records")
        kind = part.get("type")
        if kind == "text" and isinstance(part.get("text"), str):
            parts.append({"type": "text", "text": part["text"]})
        elif kind == "image_url" and isinstance(part.get("image_url"), Mapping):
            url = part["image_url"].get("url")
            if not isinstance(url, str):
                raise TypeError("image_url.url must be text")
            parts.append({"type": "image", "url": url})
        elif kind == "image" and isinstance(part.get("url"), str):
            parts.append({"type": "image", "url": part["url"]})
        else:
            raise UnsupportedCapability("Unsupported native content part: " + str(kind))
    return parts


def normalize_result(result: Any) -> dict[str, Any]:
    """Shape Jan host output for the canonical native tool result."""
    if result is None:
        return {"content": ""}
    if isinstance(result, str):
        return {"content": result}
    if not isinstance(result, Mapping):
        return {"content": str(result)}
    if result.get("details") is not None:
        raise UnsupportedCapability("Native host-only tool details are unavailable")
    text = str(result.get("text", result.get("content", "")))
    images = [normalize_image(image) for image in (result.get("images") or [])]
    parts = result.get("parts", result.get("content"))
    if isinstance(parts, list):
        text_parts = [str(result["text"])] if result.get("text") is not None else []
        for part in parts:
            if not isinstance(part, Mapping):
                raise TypeError("Host result parts must be records")
            if part.get("type") == "text" and isinstance(part.get("text"), str):
                text_parts.append(part["text"])
            elif part.get("type") == "image_url":
                images.append(normalize_image(part.get("image_url")))
            else:
                raise UnsupportedCapability(
                    "Unsupported native host result content part"
                )
        text = "\n".join(text_parts)
    output = {
        "content": text,
        "isError": result.get("isError") is True,
    }
    if isinstance(result.get("error"), str):
        output["content"] = result["error"]
        output["isError"] = True
    if images:
        output["images"] = images
    return output


def normalize_image(image: Any) -> dict[str, str]:
    """Convert an explicit host image without a downloader or persistent store.

    File reads are caller-selected, capped at 16 MiB. This local adapter budget
    does not claim Jan's negotiated limits or provider vision qualification.
    """
    mime = "image/png"
    payload = None
    explicit_mime = False
    if isinstance(image, Mapping):
        explicit_mime = "mimeType" in image or "mime" in image
        mime = image.get("mimeType", image.get("mime", mime))
        if "data_base64" in image:
            payload = image["data_base64"]
        elif "dataBase64" in image:
            payload = image["dataBase64"]
        elif "data" in image:
            payload = image["data"]
        elif "url" in image:
            image = image["url"]
        elif "path" in image:
            image = Path(image["path"])
    if isinstance(image, str) and image.startswith("data:"):
        metadata, separator, payload = image.partition(",")
        if not separator or not metadata.endswith(";base64"):
            raise TypeError("Expected a base64 image data URL")
        mime = metadata[5:-7]
    elif payload is None and isinstance(image, (str, Path)):
        if isinstance(image, str) and "://" in image:
            raise UnsupportedCapability("Host images cannot download remote URLs")
        path = Path(image)
        if not explicit_mime:
            mime = mimetypes.guess_type(str(path))[0] or mime
        with path.open("rb") as stream:
            payload = stream.read(16 * 1024 * 1024 + 1)
    if not isinstance(mime, str) or not mime.startswith("image/"):
        raise TypeError("Host image MIME must be an image type")
    if isinstance(payload, (bytes, bytearray, memoryview)):
        raw = bytes(payload)
    elif isinstance(payload, str):
        if len(payload) > 24 * 1024 * 1024:
            raise ValueError("Encoded host image exceeds adapter budget")
        raw = base64.b64decode(payload, validate=True)
    else:
        raise TypeError("Host image requires bytes, base64, data URL, or path")
    if len(raw) > 16 * 1024 * 1024:
        raise ValueError("Host image exceeds 16 MiB adapter budget")
    return {"mime": mime, "data_base64": base64.b64encode(raw).decode("ascii")}
