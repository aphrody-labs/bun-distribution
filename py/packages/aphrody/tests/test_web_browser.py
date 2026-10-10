"""Public Python web client against a simulated kernel JSON-RPC transport."""

import pytest

from aphrody.web_browser import WebBrowserClient, WebBrowserError


class FakeTransport:
    def __init__(self):
        self.sent = []
        self.closed = False
        self.fail_tool = False

    def send(self, message):
        self.sent.append(message)

    def receive(self, *, timeout):
        request = self.sent[-1]
        if request["method"] == "initialize":
            result = {"protocolVersion": "2025-06-18"}
        elif self.fail_tool:
            result = {
                "isError": True,
                "content": [{"type": "text", "text": "secret-value"}],
            }
        else:
            result = {
                "isError": False,
                "structuredContent": {
                    "profileUsed": "http",
                    "url": "https://example.com",
                },
            }
        return {"jsonrpc": "2.0", "id": request["id"], "result": result}

    def close(self):
        self.closed = True


def test_fetch_uses_kernel_web_tool_and_structured_result():
    transport = FakeTransport()
    with WebBrowserClient(_transport=transport) as client:
        result = client.fetch("https://example.com", profile="http")
    assert result["profileUsed"] == "http"
    assert transport.sent[0]["method"] == "initialize"
    assert transport.sent[1]["method"] == "notifications/initialized"
    assert transport.sent[2]["params"] == {
        "name": "web_browser_fetch",
        "arguments": {
            "url": "https://example.com",
            "profile": "http",
            "force": False,
        },
    }
    assert transport.closed


def test_tool_error_does_not_echo_child_content():
    transport = FakeTransport()
    with WebBrowserClient(_transport=transport) as client:
        transport.fail_tool = True
        with pytest.raises(WebBrowserError, match="failed") as failure:
            client.fetch("https://example.com")
    assert "secret-value" not in str(failure.value)


def test_programmatic_mission_and_actor_routes_share_kernel_contract():
    transport = FakeTransport()
    with WebBrowserClient(_transport=transport) as client:
        client.crawl(["https://example.com"], max_requests=3, goal="research")
        client.autopilot_start(interval_ms=10_000)
        client.mission_status()
        client.search_index("source provenance", limit=4)
        client.research("source provenance", max_results=2)
        client.site_to_api("https://example.com", max_pages=3)
        client.mission_stop()
    calls = [
        message["params"]
        for message in transport.sent
        if message.get("method") == "tools/call"
    ]
    assert [call["name"] for call in calls] == [
        "web_browser_crawl",
        "web_browser_autopilot_start",
        "web_browser_mission_status",
        "web_browser_index_search",
        "web_browser_rag_research",
        "web_browser_site_to_api",
        "web_browser_mission_stop",
    ]
    assert calls[0]["arguments"] == {
        "maxRequests": 3,
        "seeds": ["https://example.com"],
        "goal": "research",
    }


def test_close_is_terminal_and_idempotent():
    transport = FakeTransport()
    client = WebBrowserClient(_transport=transport)
    client.close()
    sent = len(transport.sent)
    client.close()
    with pytest.raises(WebBrowserError, match="closed"):
        client.fetch("https://example.com")
    with pytest.raises(WebBrowserError, match="closed"):
        client.__enter__()
    assert len(transport.sent) == sent


def test_public_injected_transport_remains_caller_owned():
    transport = FakeTransport()
    with WebBrowserClient(transport=transport) as client:
        client.fetch("https://example.com")
    assert not transport.closed


@pytest.mark.parametrize("timeout", [0, -1, float("inf"), float("nan")])
def test_invalid_timeout_rejected_before_starting_transport(timeout):
    with pytest.raises(ValueError, match="positive and finite"):
        WebBrowserClient(timeout=timeout, kernel_bin="does-not-exist")


def test_notifications_do_not_extend_total_request_deadline(monkeypatch):
    transport = FakeTransport()
    client = WebBrowserClient(_transport=transport, timeout=0.1)
    ticks = iter([0, 0.02, 0.08, 0.12])
    monkeypatch.setattr("aphrody.web_browser.time.monotonic", lambda: next(ticks))
    budgets = []

    def receive(*, timeout):
        budgets.append(timeout)
        return {"jsonrpc": "2.0", "method": "notifications/progress"}

    monkeypatch.setattr(transport, "receive", receive)
    with pytest.raises(WebBrowserError, match="timed out"):
        client.fetch("https://example.com")
    assert budgets == pytest.approx([0.08, 0.02])
    assert transport.closed
    with pytest.raises(WebBrowserError, match="closed"):
        client.fetch("https://example.com")


def test_initialize_failure_closes_owned_transport():
    class InvalidTransport(FakeTransport):
        def receive(self, *, timeout):
            return {"id": -1, "result": {}}

    transport = InvalidTransport()
    with pytest.raises(WebBrowserError, match="unexpected response"):
        WebBrowserClient(_transport=transport)
    assert transport.closed
