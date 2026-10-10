# SPDX-License-Identifier: Apache-2.0
"""Exercise the SDK against a real child speaking adversarial app-server frames."""

import concurrent.futures
import sys
import threading

import pytest

from aphrody.agent import AgentClient, AgentError, TransportClosedError, _TurnQueue

SERVER = r"""
import json, sys, os
sys.stdout.reconfigure(encoding="utf-8")
def send(value):
    print(json.dumps(value, ensure_ascii=False), flush=True)
def event(method, tid, turn_id, **extra):
    send({"method": method, "params": {"threadId": tid, "turnId": turn_id, **extra}})
pending = None
for line in sys.stdin:
    msg = json.loads(line)
    method = msg.get("method")
    if "id" not in msg: continue
    rid = msg["id"]
    params = msg.get("params") or {}
    result = {}
    if method == "initialize":
        assert "jsonrpc" not in msg
        result = {"userAgent": "fixture/1.0", "cwd": os.getcwd()}
    elif method == "thread/start": result = {"thread": {"id": "thread-a"}}
    elif method == "turn/start":
        tid = params["threadId"]
        text = params["input"][0]["text"]
        event("item/agentMessage/delta", tid, "turn-a", delta="été 日本語")
        result = {"turn": {"id": "turn-a", "status": "inProgress"}}
        if text != "wait": event("turn/completed", tid, "turn-a", turn={"id": "turn-a", "status": "completed"})
    elif method == "turn/interrupt":
        event("turn/completed", params["threadId"], params["turnId"], turn={"id": params["turnId"], "status": "interrupted"})
    elif method == "pair":
        if pending is None:
            pending = msg
            continue
        send({"id": rid, "result": params})
        send({"id": pending["id"], "result": pending["params"]})
        pending = None
        continue
    elif method == "fail":
        send({"id": rid, "error": {"code": -32601, "message": "unsupported", "data": {"unsupported": True}}})
        continue
    elif method == "crash": sys.exit(3)
    elif method == "malformed":
        print("[]", flush=True)
        continue
    elif method == "hang": continue
    elif method in ("serverRequest", "serverHandled"):
        send({"id": "permission", "method": "item/commandExecution/requestApproval", "params": {}})
        answer = json.loads(sys.stdin.readline())
        result = ({"denied": answer["error"]["code"] == -32601}
                  if method == "serverRequest" else answer)
    elif method == "stderr":
        sys.stderr.write("x" * 200000)
        sys.stderr.flush()
    send({"id": rid, "result": result})
"""


def test_native_transport_buffer_retains_terminal_and_reports_loss():
    with AgentClient(
        sys.executable, args=("-u", "-c", SERVER), max_buffered_events=1
    ) as instance:
        instance.initialize()
        turn = instance.start_turn("thread-a", "finish")
        frames = list(turn.events(timeout=3))
        assert [frame["method"] for frame in frames] == ["turn/completed"]
        assert turn.dropped == 1


@pytest.mark.parametrize("cap", [0, -1, True, 1.5])
def test_invalid_native_transport_cap(cap):
    with pytest.raises(ValueError):
        AgentClient(max_buffered_events=cap)


def test_control_overflow_is_explicit_and_terminal_is_not_silently_lost():
    events = _TurnQueue(1)
    events.put({"method": "item/started", "params": {"item": {"type": "tool"}}})
    events.put({"method": "turn/completed"})
    failure = events.get_nowait()
    assert isinstance(failure, TransportClosedError)
    assert "control record" in str(failure)
    assert events.dropped == 0


def test_explicit_host_callback_runs_off_reader_and_can_be_removed(client):
    threads = []

    def handler(params):
        threads.append(threading.current_thread())
        return {"decision": "deny"}

    off = client.on_request("item/commandExecution/requestApproval", handler)
    assert client.request("serverHandled")["result"] == {"decision": "deny"}
    assert threads[0].name == "aphrody-host-callback"
    with pytest.raises(ValueError, match="already registered"):
        client.on_request("item/commandExecution/requestApproval", handler)
    off()
    assert client.request("serverRequest")["denied"]


def test_host_callback_exception_does_not_leak_its_payload(client):
    def handler(params):
        raise RuntimeError("synthetic secret fixture marker")

    client.on_request("item/commandExecution/requestApproval", handler)
    answer = client.request("serverHandled")
    assert answer["error"] == {"code": -32603, "message": "Host callback failed"}


@pytest.fixture
def client():
    with AgentClient(
        sys.executable, args=("-u", "-c", SERVER), request_timeout=3
    ) as instance:
        instance.initialize()
        yield instance


def test_stream_preserves_early_unicode_and_completion(client):
    thread = client.start_thread()["thread"]["id"]
    turn = client.start_turn(thread, "hello")
    events = list(turn.events(timeout=3))
    assert events[0]["params"]["delta"] == "été 日本語"
    assert events[-1]["method"] == "turn/completed"
    assert list(client.start_turn(thread, "again").events(timeout=3))


def test_interrupt_is_independent_of_pending_events(client):
    turn = client.start_turn("thread-a", "wait")
    assert turn.interrupt() == {}
    assert list(turn.events(timeout=3))[-1]["params"]["turn"]["status"] == "interrupted"


def test_concurrent_out_of_order_responses(client):
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
        first = pool.submit(client.request, "pair", {"value": 1})
        second = pool.submit(client.request, "pair", {"value": 2})
        assert first.result(timeout=5) == {"value": 1}
        assert second.result(timeout=5) == {"value": 2}


def test_structured_error_does_not_break_connection(client):
    with pytest.raises(AgentError) as caught:
        client.request("fail")
    assert caught.value.code == -32601
    assert caught.value.data == {"unsupported": True}
    assert client.start_thread()["thread"]["id"] == "thread-a"


@pytest.mark.parametrize("method", ["crash", "malformed"])
def test_transport_failure_wakes_request_and_turn(client, method):
    turn = client.start_turn("thread-a", "wait")
    with pytest.raises(TransportClosedError):
        client.request(method)
    with pytest.raises(TransportClosedError):
        list(turn.events(timeout=3))


def test_timeout_cleans_waiter_and_allows_next_request(client):
    client.request_timeout = 0.1
    with pytest.raises(TimeoutError):
        client.request("hang")
    client.request_timeout = 3
    assert client.start_thread()["thread"]["id"] == "thread-a"


def test_unsolicited_approval_is_rejected_without_blocking(client):
    assert client.request("serverRequest") == {"denied": True}


def test_stderr_drain_and_repeated_close(client):
    assert client.request("stderr") == {}
    client.close()
    client.close()
    with pytest.raises(TransportClosedError):
        client.request("thread/start")
