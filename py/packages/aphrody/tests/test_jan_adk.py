# SPDX-License-Identifier: AGPL-3.0-only
"""Real stdio framing against a deterministic process, no provider qualification."""

import sys
import threading

import pytest

from aphrody.agent import AgentClient, TransportClosedError
from aphrody.jan_adk import (
    ADKRequestError,
    AphrodyADK,
    HostTool,
    UnsupportedCapability,
    normalize_image,
    normalize_result,
)

# Native app-server shapes, deliberately not Jan session/* shapes. A process
# exercises the canonical reader, request waiters, EOF, and pre-reply events.
SERVER = r"""
import json, sys
active = {}
seq = 0
turns = 0
tool_threads = {}
tool_results = []
declared_tools = {}
permission_threads = {}

def send(frame):
    print(json.dumps(frame), flush=True)

def event(thread, turn_id, method, **params):
    send({'method': method, 'params': {'threadId': thread, 'turnId': turn_id, **params}})

def complete(thread, status='completed'):
    turn = active.pop(thread)
    event(thread, turn, 'turn/completed', turn={'id': turn, 'status': status, 'error': None})

for line in sys.stdin:
    req = json.loads(line)
    if 'id' in req and 'method' not in req:
        tool_results.append(req)
        if req['id'] in permission_threads:
            thread = permission_threads.pop(req['id'])
            if req.get('result', {}).get('decision') == 'allow':
                request_id = 'call-' + active[thread]
                tool_threads[request_id] = thread
                send({'id': request_id, 'method': 'tool/call', 'params': {
                    'threadId': thread, 'requestId': request_id,
                    'name': 'fixture', 'arguments': {'value': 'synthetic'},
                }})
            else:
                complete(thread)
        else:
            complete(tool_threads.pop(req['id']))
        continue
    if 'id' not in req:
        continue
    method, p = req['method'], req.get('params') or {}
    result = {}
    if method == 'initialize':
        result = {'serverInfo': {'name': 'fixture', 'version': '1'},
                  'capabilities': {'threads': True, 'turns': True, 'hostTools': True}}
    elif method == 'thread/start':
        if p.get('systemPrompt') is not None or p.get('builtins') is False:
            assert p['ephemeral'] is True
            assert p.get('subagents') is False
        seq += 1
        if p.get('tools'):
            assert p['tools'][0]['name'] == 'fixture'
        declared_tools[str(seq)] = p.get('tools', [])
        result = {'thread': {'id': str(seq), 'model': p.get('model', 'fixture')},
                  'model': p.get('model', 'fixture')}
    elif method == 'thread/resume':
        result = {'thread': {'id': p['threadId'], 'model': 'fixture'}}
    elif method == 'thread/fork':
        result = {'thread': {'id': 'fork-' + p['threadId'], 'model': 'fixture'}}
    elif method == 'thread/list':
        result = {'data': [{'id': '2' if p.get('cursor') else '1'}],
                  'nextCursor': None if p.get('cursor') else 'page2'}
    elif method == 'turn/start':
        assert isinstance(p['input'], list)
        text = p['input'][0]['text']
        if len(p['input']) > 1:
            assert p['input'][1] == {'type': 'image', 'url': 'data:image/png;base64,AA=='}
        thread = p['threadId']
        turns += 1
        turn = thread + '-turn-' + str(turns)
        active[thread] = turn
        result = {'turn': {'id': turn}}
        if text == 'crash':
            sys.exit(7)
        for i in range(8):
            event(thread, turn, 'item/agentMessage/delta', delta=str(i))
        if text == 'permission':
            request_id = 'permission-' + turn
            permission_threads[request_id] = thread
            send({'id': request_id, 'method': 'permission/request', 'params': {
                'threadId': thread, 'requestId': request_id,
                'name': 'fixture', 'arguments': {'value': 'synthetic'},
            }})
        elif text in ('host', 'cancel-host'):
            request_id = 'call-' + turn
            tool_threads[request_id] = thread
            send({'id': request_id, 'method': 'tool/call', 'params': {
                'threadId': thread, 'requestId': request_id,
                'name': 'fixture', 'arguments': {'value': 'synthetic'},
            }})
        elif text != 'park':
            complete(thread)
    elif method == 'turn/steer':
        assert p['expectedTurnId'] == active[p['threadId']]
        event(p['threadId'], active[p['threadId']], 'item/agentMessage/delta',
              delta=p['input'][0]['text'])
    elif method == 'turn/interrupt':
        assert p['turnId'] == active[p['threadId']]
        for request_id, thread in list(tool_threads.items()):
            if thread == p['threadId']:
                send({'method': 'tool/cancelled', 'params': {
                    'threadId': thread, 'requestId': request_id,
                }})
                del tool_threads[request_id]
        complete(p['threadId'], 'interrupted')
    elif method == 'fixture/calls':
        result = {'calls': tool_results}
    elif method == 'thread/tools/get':
        result = {'tools': declared_tools[p['threadId']], 'toolSpecs': []}
    elif method == 'thread/tools/set':
        declared_tools[p['threadId']] = p['tools']
        result = {'tools': p['tools'], 'toolSpecs': []}
    elif method == 'thread/archive':
        result = {'archived': True}
    elif method == 'thread/close':
        result = {'threadId': p['threadId'], 'status': 'closed'}
    elif method == 'thread/read':
        result = {'thread': {'id': p['threadId'], 'turns': []}}
    else:
        send({'id': req['id'], 'error': {'code': -32601, 'message': 'missing',
                                        'data': {'retryable': True}}})
        continue
    send({'id': req['id'], 'result': result})
"""


@pytest.fixture
def runtime():
    with AphrodyADK.start(
        executable=sys.executable,
        args=("-u", "-c", SERVER),
        request_timeout=2,
        max_buffered_events=3,
    ) as instance:
        yield instance


def test_pre_reply_completion_result_only_and_bounded_events(runtime):
    session = runtime.create_session(model="fixture")
    turn = session.prompt({"text": "finish"})
    assert turn.result(2).stop_reason == "completed"
    assert turn.result(0) == turn.result(0)
    assert list(turn) == [{"type": "token", "text": str(i)} for i in (5, 6, 7)]
    assert turn.dropped == 5
    with pytest.raises(RuntimeError, match="consumed"):
        list(turn)
    # Terminal delivery also releases native stream ownership before result().
    assert session.prompt("again").result(2).stop_reason == "completed"


def test_isolated_sessions_steer_interrupt_and_listener_reentry(runtime):
    a = runtime.create_session()
    b = runtime.create_session()
    heard = threading.Event()
    values = []

    def listen(event):
        values.append(event)
        # Callback executes away from the canonical stdout reader.
        runtime.request("thread/list", {})
        heard.set()

    off = a.on("token", listen)
    first = a.prompt("park")
    second = b.prompt("finish")
    assert second.result(2).stop_reason == "completed"
    assert heard.wait(2)
    a.steer({"text": "steered"})
    first.interrupt()
    assert first.result(2).stop_reason == "interrupted"
    assert all(e["text"] != "steered" for e in second)
    assert list(first)[-1] == {"type": "token", "text": "steered"}
    off()
    size = len(values)
    a.prompt("finish").result(2)
    assert len(values) == size


def test_native_resume_fork_archive_list_and_error(runtime):
    session = runtime.create_session()
    assert runtime.resume_session(session.id) is session
    assert session.fork().id == "fork-" + session.id
    assert [s["id"] for s in runtime.list_sessions()] == ["1", "2"]
    with pytest.raises(ADKRequestError) as caught:
        runtime.request("missing")
    assert caught.value.code == -32601
    assert caught.value.method == "missing"
    assert caught.value.retryable
    session.archive()
    with pytest.raises(TransportClosedError, match="closed"):
        session.prompt("no")


@pytest.mark.parametrize(
    "option,value",
    [
        ("builtins", False),
        ("subagents", True),
        ("system_prompt", "exact"),
        ("permissions", "unsupported"),
    ],
)
def test_unproven_guarantees_refused_before_native_session_start(
    runtime, option, value
):
    with pytest.raises(UnsupportedCapability, match=option):
        runtime.create_session(**{option: value})
    assert runtime.create_session().id == "1"


def test_session_gaps_are_explicit(runtime):
    session = runtime.create_session()
    for operation in (
        session.reset,
        lambda: session.set_model("other"),
        lambda: session.respond_permission("r", "allow_always"),
        lambda: session.fork([object()]),
    ):
        with pytest.raises(UnsupportedCapability):
            operation()
    assert session.prompt("finish").result(2).stop_reason == "completed"


def test_close_settles_owned_turn_and_crash_is_channel_failure(runtime):
    session = runtime.create_session()
    turn = session.prompt("park")
    with pytest.raises(TimeoutError):
        turn.result(0)
    runtime.close()
    runtime.close()
    with pytest.raises(TransportClosedError):
        turn.result(2)
    with pytest.raises(TransportClosedError):
        runtime.request("thread/list")


def test_crash_and_failed_spawn():
    with pytest.raises(FileNotFoundError):
        AphrodyADK.start(executable="/nonexistent/aphrody-adk-fixture")
    with AphrodyADK.start(executable=sys.executable, args=("-u", "-c", SERVER)) as rt:
        with pytest.raises(TransportClosedError):
            rt.create_session().prompt("crash")


def test_borrowed_client_is_not_closed():
    with AgentClient(sys.executable, args=("-u", "-c", SERVER)) as client:
        client.initialize()
        adk = AphrodyADK(client)
        adk.close()
        assert client.request("thread/list")["data"] == [{"id": "1"}]


@pytest.mark.parametrize("cap", [0, -1, True])
def test_invalid_buffer_cap(cap):
    with pytest.raises(ValueError):
        AphrodyADK(AgentClient(), max_buffered_events=cap)


def test_ephemeral_native_options_and_image_content(runtime):
    session = runtime.create_session(
        ephemeral=True,
        system_prompt=" exact host prompt ",
        builtins=False,
        subagents=False,
    )
    turn = session.prompt(
        {
            "content": [
                {"type": "text", "text": "vision"},
                {
                    "type": "image_url",
                    "image_url": {"url": "data:image/png;base64,AA=="},
                },
            ]
        }
    )
    assert turn.result(2).stop_reason == "completed"
    assert session.read()["thread"]["id"] == session.id
    session.close()
    with pytest.raises(TransportClosedError):
        session.prompt("closed")


@pytest.mark.parametrize(
    "content", [[], {}, [{"type": "audio"}], [{"type": "image_url", "image_url": {}}]]
)
def test_invalid_content_does_not_start_turn(runtime, content):
    session = runtime.create_session()
    with pytest.raises((TypeError, UnsupportedCapability)):
        session.prompt(content)
    assert session.prompt("finish").result(2).stop_reason == "completed"


def test_host_declarations_use_native_owner_without_handler_serialization(runtime):
    tool = HostTool("fixture", lambda args, call: "ok", capability="read")
    session = runtime.create_session(permissions="host", tools=[tool])
    assert session.id == "1"
    assert "handler" not in tool.declaration()
    assert session._tools["fixture"] is tool
    assert session.get_tools()["tools"] == [tool.declaration()]
    assert session.set_tools([])["tools"] == []
    assert session._tools == {}


def test_host_callback_reentry_response_and_cancelled_late_result(runtime):
    runtime.max_buffered_events = 64
    flags = []
    started = threading.Event()
    finished = threading.Event()

    def handler(args, call):
        assert args == {"value": "synthetic"}
        assert runtime.request("thread/list")["data"] == [{"id": "1"}]
        flags.append(call.aborted)
        if len(flags) == 2:
            started.set()
            assert call.aborted.wait(2)
            finished.set()
        return {"text": "fixture result"}

    session = runtime.create_session(
        permissions="host", tools=[HostTool("fixture", handler, capability="read")]
    )
    assert session.prompt("host").result(2).stop_reason == "completed"
    calls = runtime.request("fixture/calls")["calls"]
    assert calls[0]["result"] == {"content": "fixture result", "isError": False}
    turn = session.prompt("cancel-host")
    assert started.wait(2)
    turn.interrupt()
    assert turn.result(2).stop_reason == "interrupted"
    assert finished.wait(2)
    assert len(runtime.request("fixture/calls")["calls"]) == 1


@pytest.mark.parametrize("decision,expected_calls", [("allow_once", 1), ("deny", 0)])
def test_permission_callback_requires_explicit_decision_before_tool_runs(
    runtime, decision, expected_calls
):
    runtime.max_buffered_events = 64
    handled = []
    session = runtime.create_session(
        permissions="jan",
        tools=[HostTool("fixture", lambda args, call: handled.append(args) or "done")],
    )
    observed = []

    def on_permission(event):
        observed.append(event)
        assert handled == []
        session.respond_permission(event["request_id"], decision)

    session.on("permission_request", on_permission)
    turn = session.prompt("permission")
    assert turn.result(2).stop_reason == "completed"
    assert len(handled) == expected_calls
    assert len(observed) == 1
    events = list(turn)
    assert any(event["type"] == "permission_request" for event in events)
    with pytest.raises(ValueError, match="no longer pending"):
        session.respond_permission(observed[0]["request_id"], decision)


def test_host_image_and_result_normalization_uses_no_persistent_media_store(tmp_path):
    path = tmp_path / "fixture.png"
    path.write_bytes(b"synthetic image bytes")
    expected = {"mime": "image/png", "data_base64": "c3ludGhldGljIGltYWdlIGJ5dGVz"}
    assert normalize_image(path) == expected
    assert (
        normalize_image({"data": path.read_bytes(), "mimeType": "image/png"})
        == expected
    )
    data_url = "data:image/png;base64," + expected["data_base64"]
    assert normalize_image(data_url) == expected
    assert normalize_result(
        {
            "text": "prefix",
            "parts": [
                {"type": "text", "text": "suffix"},
                {"type": "image_url", "image_url": {"url": data_url}},
            ],
        }
    ) == {"content": "prefix\nsuffix", "isError": False, "images": [expected]}
    assert normalize_result({"error": "synthetic refusal"}) == {
        "content": "synthetic refusal",
        "isError": True,
    }
    with pytest.raises(UnsupportedCapability, match="details"):
        normalize_result({"details": {"fixture": True}})
    with pytest.raises(UnsupportedCapability, match="remote"):
        normalize_image("https://example.invalid/image.png")
    with pytest.raises(ValueError, match="16 MiB"):
        normalize_image({"data": b"x" * (16 * 1024 * 1024 + 1)})


def test_host_tools_preserve_permission_owner_and_require_unique_names(runtime):
    tool = HostTool("fixture", lambda args, call: "ok")
    with pytest.raises(ValueError, match="unique"):
        runtime.create_session(permissions="host", tools=[tool, tool])
    assert runtime.create_session(permissions="jan", tools=[tool]).id == "1"


def test_host_tools_fail_closed_without_negotiated_capability(runtime):
    runtime.capabilities = {"threads": True, "turns": True}
    tool = HostTool("fixture", lambda args, call: "ok")
    with pytest.raises(UnsupportedCapability, match="not negotiated"):
        runtime.create_session(permissions="host", tools=[tool])
    assert runtime.create_session().id == "1"
