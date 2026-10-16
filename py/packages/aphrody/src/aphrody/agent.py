# SPDX-License-Identifier: Apache-2.0
# Portions derived from openai/codex sdk/python/src/openai_codex/{client,_message_router}.py
# Source revision: 78245b47af2a7aafcabe025828ceecca69db4df1 (Apache-2.0).
"""Dependency-free stdio client for the Aphrody app-server v2 protocol.

One stdout reader routes replies independently from turn notifications, as in
the upstream Codex SDK. Registering a turn before sending its request preserves
notifications emitted before the turn/start reply. This client owns its child
process; use it as a context manager or call close().
"""

from __future__ import annotations

import contextlib
import json
import os
import queue
import subprocess
import threading
import uuid
from collections.abc import Callable, Iterator, Mapping, Sequence
from typing import Any


class AgentError(RuntimeError):
    """A JSON-RPC error with its original code and optional data."""

    def __init__(self, code: int, message: str, data: Any = None) -> None:
        super().__init__(message)
        self.code = code
        self.data = data


class TransportClosedError(RuntimeError):
    """The child stopped, closed its stream, or emitted an invalid frame."""


class _TurnQueue(queue.Queue):
    """Nonblocking bounded unread notifications; terminal frames stay deliverable."""

    def __init__(self, limit: int) -> None:
        super().__init__()
        self.limit = limit
        self.dropped = 0
        self.terminal = False

    def put(self, item: Any, block: bool = True, timeout: float | None = None) -> None:
        with self.not_empty:
            if self.terminal:
                return
            if self._qsize() >= self.limit:
                oldest = self._get()
                if (
                    isinstance(oldest, dict)
                    and oldest.get("method") == "item/agentMessage/delta"
                ):
                    self.dropped += 1
                else:
                    # Control records are never silently lost. Fail this stream
                    # explicitly instead of pretending its incomplete history
                    # is usable; the stdout reader remains nonblocking.
                    while self._qsize():
                        self._get()
                    item = TransportClosedError(
                        "Native notification buffer overflow on a control record"
                    )
            self._put(item)
            self.terminal = isinstance(item, BaseException) or (
                isinstance(item, dict) and item.get("method") == "turn/completed"
            )
            self.not_empty.notify()


class AgentTurn:
    """A single-consumer turn stream, including its terminal notification."""

    def __init__(
        self,
        client: AgentClient,
        thread_id: str,
        result: dict,
        events: queue.Queue,
    ) -> None:
        self.client = client
        self.thread_id = thread_id
        self.turn = result["turn"]
        self.id = self.turn["id"]
        self._events = events
        self._consumed = False

    @property
    def dropped(self) -> int:
        """Unread native notifications discarded at the transport buffer cap."""
        return getattr(self._events, "dropped", 0)

    def events(self, timeout: float | None = None) -> Iterator[dict]:
        """Yield matching notifications; timeout is an optional idle bound."""
        if self._consumed:
            raise RuntimeError("Turn events already consumed")
        self._consumed = True
        try:
            while True:
                try:
                    event = self._events.get(timeout=timeout)
                except queue.Empty as exc:
                    raise TimeoutError(
                        "Timed out waiting for turn notification"
                    ) from exc
                if isinstance(event, BaseException):
                    raise event
                params = event.get("params") or {}
                turn_id = params.get("turnId") or (params.get("turn") or {}).get("id")
                if turn_id != self.id:
                    continue
                yield event
                if event["method"] == "turn/completed":
                    return
        finally:
            self.client._release_turn(self.thread_id, self._events)

    def interrupt(self) -> dict:
        """Request interruption without competing with the event reader."""
        return self.client.request(
            "turn/interrupt", {"threadId": self.thread_id, "turnId": self.id}
        )


class AgentClient:
    """Launch an Aphrody binary or explicit fixture command over stdio.

    The default command is ``aphrody app-server``. ``args=("session", "serve")``
    selects the legacy entry point when testing a compatible server there.
    Environment overrides are merged with the inherited environment. Requests
    have a finite timeout; turn streams have no artificial duration limit.
    """

    def __init__(
        self,
        executable: str = "aphrody",
        *,
        args: Sequence[str] = ("app-server",),
        cwd: str | None = None,
        env: Mapping[str, str] | None = None,
        request_timeout: float = 30,
        max_buffered_events: int = 100_000,
    ) -> None:
        self.command = [executable, *args]
        self.cwd = cwd
        self.env = dict(env or {})
        self.request_timeout = request_timeout
        if (
            not isinstance(max_buffered_events, int)
            or isinstance(max_buffered_events, bool)
            or max_buffered_events < 1
        ):
            raise ValueError("max_buffered_events must be a positive integer")
        self.max_buffered_events = max_buffered_events
        self._proc: subprocess.Popen[str] | None = None
        self._lock = threading.RLock()
        self._write_lock = threading.Lock()
        self._response_waiters: dict[str, queue.Queue] = {}
        self._turns: dict[str, queue.Queue] = {}
        self._failure: BaseException | None = None
        self._workers: list[threading.Thread] = []
        self._request_handlers: dict[str, Callable[[Any], Any]] = {}
        self._handler_slots = threading.BoundedSemaphore(16)
        self._server_calls: dict[str, threading.Event] = {}

    def __enter__(self) -> AgentClient:
        self.start()
        return self

    def __exit__(self, *_exc: object) -> None:
        self.close()

    def start(self) -> None:
        """Start the owned process once; initialize() performs the handshake."""
        with self._lock:
            if self._failure:
                raise self._failure
            if self._proc is not None:
                return
            self._proc = subprocess.Popen(
                self.command,
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                encoding="utf-8",
                bufsize=1,
                cwd=self.cwd,
                env={**os.environ, **self.env},
            )
            for target in (self._reader_loop, self._drain_stderr):
                worker = threading.Thread(target=target, daemon=True)
                self._workers.append(worker)
                worker.start()

    def initialize(self) -> dict:
        """Negotiate v2 and acknowledge initialization without cloud auth."""
        result = self.request(
            "initialize",
            {
                "clientInfo": {
                    "name": "aphrody_python_sdk",
                    "version": "0.1.0",
                },
                "capabilities": {"experimentalApi": True},
            },
        )
        self.notify("initialized")
        return result

    def start_thread(self, **params: Any) -> dict:
        """Create a thread with explicit server-supported provider options."""
        return self.request("thread/start", params)

    def start_turn(
        self, thread_id: str, text: str | Sequence[Mapping[str, Any]], **params: Any
    ) -> AgentTurn:
        """Start a turn with race-free notification capture for this thread."""
        if isinstance(text, str):
            content = [{"type": "text", "text": text}]
        else:
            content = [dict(part) for part in text]
            if not content:
                raise ValueError("Turn input must not be empty")
            for part in content:
                kind = part.get("type")
                field = "text" if kind == "text" else "url"
                if kind not in ("text", "image") or not isinstance(
                    part.get(field), str
                ):
                    raise ValueError("Expected native text or image input parts")
        events: queue.Queue = _TurnQueue(self.max_buffered_events)
        with self._lock:
            if thread_id in self._turns:
                raise RuntimeError("A turn stream already owns this thread")
            self._turns[thread_id] = events
        try:
            result = self.request(
                "turn/start",
                {
                    **params,
                    "threadId": thread_id,
                    "input": content,
                },
            )
            return AgentTurn(self, thread_id, result, events)
        except BaseException:
            self._release_turn(thread_id, events)
            raise

    def request(self, method: str, params: dict | None = None) -> Any:
        """Send a request, preserving concurrent replies and structured errors."""
        self.start()
        request_id = str(uuid.uuid4())
        waiter: queue.Queue = queue.Queue(maxsize=1)
        with self._lock:
            if self._failure:
                raise self._failure
            self._response_waiters[request_id] = waiter
        try:
            self._write_message({"id": request_id, "method": method, "params": params})
            try:
                result = waiter.get(timeout=self.request_timeout)
            except queue.Empty as exc:
                raise TimeoutError(f"Request timed out: {method}") from exc
            if isinstance(result, BaseException):
                raise result
            return result
        finally:
            with self._lock:
                self._response_waiters.pop(request_id, None)

    def notify(self, method: str, params: dict | None = None) -> None:
        """Send a notification with no request id and no response waiter."""
        self._write_message({"method": method, "params": params})

    def on_request(
        self, method: str, handler: Callable[[Any], Any]
    ) -> Callable[[], None]:
        """Register an explicit host callback, executed away from stdout routing.

        No tool is advertised or permission granted by registration alone.
        Unregistered requests continue to fail closed. At most 16 callbacks run
        concurrently; excess calls receive an explicit busy RPC refusal.
        """
        if not method or not callable(handler):
            raise ValueError("A method and callable handler are required")
        with self._lock:
            if method in self._request_handlers:
                raise ValueError("Handler already registered: " + method)
            self._request_handlers[method] = handler

        def off() -> None:
            with self._lock:
                if self._request_handlers.get(method) is handler:
                    self._request_handlers.pop(method)

        return off

    def _route_request(self, message: dict) -> None:
        with self._lock:
            handler = self._request_handlers.get(message["method"])
        error = None
        if handler is None:
            error = {"code": -32601, "message": "Interactive requests unavailable"}
        elif not self._handler_slots.acquire(blocking=False):
            error = {"code": -32000, "message": "Host callback concurrency exhausted"}
        if error is not None:
            self._write_message({"id": message["id"], "error": error})
            return
        request_id = str(message["id"])
        cancelled = threading.Event()
        with self._lock:
            self._server_calls[request_id] = cancelled

        def invoke() -> None:
            try:
                try:
                    assert handler is not None
                    value = handler(message.get("params"))
                    # Validate before writing; failures never expose exception
                    # strings, tracebacks or partially serialized secret data.
                    json.dumps(value)
                    answer = {"id": message["id"], "result": value}
                except Exception:
                    answer = {
                        "id": message["id"],
                        "error": {"code": -32603, "message": "Host callback failed"},
                    }
                if not cancelled.is_set():
                    with contextlib.suppress(OSError, TransportClosedError):
                        self._write_message(answer)
            finally:
                with self._lock:
                    self._server_calls.pop(request_id, None)
                self._handler_slots.release()

        threading.Thread(
            target=invoke, name="aphrody-host-callback", daemon=True
        ).start()

    def request_cancellation(self, request_id: str) -> threading.Event:
        """Get the cancellation flag for a currently executing host callback."""
        with self._lock:
            flag = self._server_calls.get(request_id)
        if flag is None:
            raise ValueError("No active host request: " + request_id)
        return flag

    def _write_message(self, payload: dict) -> None:
        with self._write_lock:
            if self._proc is None or self._proc.stdin is None or self._failure:
                raise TransportClosedError("Agent process is not running")
            self._proc.stdin.write(json.dumps(payload) + "\n")
            self._proc.stdin.flush()

    def _route_response(self, message: dict) -> None:
        # Adapted directly from upstream MessageRouter.route_response.
        with self._lock:
            waiter = self._response_waiters.pop(str(message.get("id")), None)
        if waiter is None:
            return
        if "error" in message:
            error = message["error"]
            if not isinstance(error, dict):
                waiter.put(TransportClosedError("Malformed JSON-RPC error"))
            else:
                waiter.put(
                    AgentError(
                        error.get("code", -32000),
                        error.get("message", "Unknown error"),
                        error.get("data"),
                    )
                )
            return
        waiter.put(message.get("result"))

    def _reader_loop(self) -> None:
        try:
            assert self._proc is not None and self._proc.stdout is not None
            for line in self._proc.stdout:
                message = json.loads(line)
                if not isinstance(message, dict):
                    raise TransportClosedError("Invalid JSON-RPC payload")
                if "method" in message and "id" in message:
                    self._route_request(message)
                elif "method" in message:
                    params = message.get("params") or {}
                    with self._lock:
                        if message["method"] == "tool/cancelled":
                            flag = self._server_calls.get(str(params.get("requestId")))
                            if flag is not None:
                                flag.set()
                        thread_id = params.get("threadId")
                        events = (
                            self._turns.get(thread_id)
                            if isinstance(thread_id, str)
                            else None
                        )
                    if events is not None:
                        events.put(message)
                else:
                    self._route_response(message)
            self._fail_all(TransportClosedError("Agent process closed stdout"))
        except Exception as exc:
            self._fail_all(
                TransportClosedError(f"Agent transport failed: {type(exc).__name__}")
            )

    def _drain_stderr(self) -> None:
        assert self._proc is not None and self._proc.stderr is not None
        while self._proc.stderr.read(4096):
            pass

    def _fail_all(self, error: BaseException) -> None:
        # Adapted from upstream MessageRouter.fail_all: wake every blocked caller.
        with self._lock:
            self._failure = self._failure or error
            waiters = list(self._response_waiters.values())
            self._response_waiters.clear()
            turns = list(self._turns.values())
            for flag in self._server_calls.values():
                flag.set()
        for waiter in waiters:
            waiter.put(error)
        for events in turns:
            events.put(error)

    def _release_turn(self, thread_id: str, events: queue.Queue) -> None:
        with self._lock:
            if self._turns.get(thread_id) is events:
                del self._turns[thread_id]

    def close(self) -> None:
        """Close stdin, allow graceful exit, then terminate and reap the child."""
        self._fail_all(TransportClosedError("Agent client closed"))
        proc = self._proc
        if proc is None:
            return
        with self._write_lock, contextlib.suppress(OSError):
            if proc.stdin:
                proc.stdin.close()
        try:
            proc.wait(timeout=2)
        except subprocess.TimeoutExpired:
            proc.terminate()
            try:
                proc.wait(timeout=2)
            except subprocess.TimeoutExpired:
                proc.kill()
                proc.wait(timeout=2)
        for worker in self._workers:
            worker.join(timeout=2)
        for stream in (proc.stdout, proc.stderr):
            if stream:
                stream.close()
