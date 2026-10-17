# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: 2026 aphrody contributors
"""Python client for the Aphrody Web Browser kernel subsystem.

The kernel owns web authority. This client only speaks its newline-delimited
MCP JSON-RPC protocol over stdio, shared with the Bun client.
"""

from __future__ import annotations

import json
import math
import os
import queue
import subprocess
import threading
import time
from typing import Any, Protocol

from aphrody._version import __version__


class WebBrowserError(RuntimeError):
    """The kernel or a web tool could not complete a request."""


class WebBrowserTransport(Protocol):
    """MCP transport with bounded receives; injected instances remain caller-owned."""

    def send(self, message: dict[str, Any]) -> None:
        """Write a single JSON-RPC message."""
        ...

    def receive(self, *, timeout: float) -> dict[str, Any]:
        """Read a message within timeout seconds, raising WebBrowserError on failure."""
        ...

    def close(self) -> None:
        """Release the transport's resources."""
        ...


class _StdioTransport:
    def __init__(self, binary: str | os.PathLike[str], timeout: float) -> None:
        try:
            self.process = subprocess.Popen(
                [os.fspath(binary), "mcp"],
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=subprocess.DEVNULL,
                text=True,
                encoding="utf-8",
                bufsize=1,
            )
        except OSError as exc:
            raise WebBrowserError(
                f"Could not start Aphrody Web Browser kernel: {exc.strerror}"
            ) from exc
        self.timeout = timeout
        self.incoming: queue.Queue[str | None] = queue.Queue()
        self._reader = threading.Thread(target=self._read, daemon=True)
        self._reader.start()

    def _read(self) -> None:
        assert self.process.stdout is not None
        try:
            for line in self.process.stdout:
                self.incoming.put(line)
        except (OSError, ValueError):
            pass  # Closing the process may interrupt the reader.
        finally:
            self.incoming.put(None)

    def send(self, message: dict[str, Any]) -> None:
        if self.process.stdin is None:
            raise WebBrowserError("Aphrody Web Browser kernel input is unavailable")
        try:
            self.process.stdin.write(json.dumps(message, separators=(",", ":")) + "\n")
            self.process.stdin.flush()
        except (OSError, ValueError) as exc:
            raise WebBrowserError(
                "Aphrody Web Browser kernel connection closed"
            ) from exc

    def receive(self, *, timeout: float) -> dict[str, Any]:
        try:
            line = self.incoming.get(timeout=timeout)
        except queue.Empty as exc:
            raise WebBrowserError(
                f"Aphrody Web Browser kernel timed out after {self.timeout:g}s"
            ) from exc
        if line is None:
            raise WebBrowserError("Aphrody Web Browser kernel connection closed")
        try:
            message = json.loads(line)
        except json.JSONDecodeError as exc:
            raise WebBrowserError(
                "Aphrody Web Browser kernel sent invalid JSON"
            ) from exc
        if not isinstance(message, dict):
            raise WebBrowserError("Aphrody Web Browser kernel sent an invalid message")
        return message

    def close(self) -> None:
        if self.process.poll() is None:
            self.process.terminate()
            try:
                self.process.wait(timeout=2)
            except subprocess.TimeoutExpired:
                self.process.kill()
                self.process.wait(timeout=2)
        if self.process.stdin is not None:
            self.process.stdin.close()
        self._reader.join(timeout=2)
        if self.process.stdout is not None:
            self.process.stdout.close()


class WebBrowserClient:
    """Call Aphrody Web Browser tools through the local kernel.

    Use as a context manager to release the MCP stdio process. A running
    kernel is reused by ``aphrody-mcp``; otherwise it hosts one locally.
    """

    def __init__(
        self,
        *,
        kernel_bin: str | os.PathLike[str] = "aphrody-kernel",
        timeout: float = 60,
        transport: WebBrowserTransport | None = None,
        _transport: Any = None,
    ) -> None:
        if not math.isfinite(timeout) or timeout <= 0:
            raise ValueError("timeout must be positive and finite")
        if transport is not None and _transport is not None:
            raise ValueError("provide only one transport")
        self._timeout = timeout
        self._closed = False
        self._owns_transport = transport is None
        self._transport = (
            transport
            if transport is not None
            else (
                _transport
                if _transport is not None
                else _StdioTransport(kernel_bin, timeout)
            )
        )
        self._next_id = 1
        self._lock = threading.Lock()
        try:
            self._request(
                "initialize",
                {
                    "protocolVersion": "2025-06-18",
                    "capabilities": {},
                    "clientInfo": {
                        "name": "aphrody-python",
                        "version": __version__,
                    },
                },
            )
            self._transport.send(
                {
                    "jsonrpc": "2.0",
                    "method": "notifications/initialized",
                    "params": {},
                }
            )
        except BaseException:
            self.close()
            raise

    def _request(self, method: str, params: dict[str, Any]) -> Any:
        with self._lock:
            self._ensure_open()
            try:
                return self._request_locked(method, params)
            except BaseException:
                self._close_locked()
                raise

    def _request_locked(self, method: str, params: dict[str, Any]) -> Any:
        deadline = time.monotonic() + self._timeout
        request_id = self._next_id
        self._next_id += 1
        self._transport.send(
            {
                "jsonrpc": "2.0",
                "id": request_id,
                "method": method,
                "params": params,
            }
        )
        while True:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise WebBrowserError(
                    f"Aphrody Web Browser kernel timed out after {self._timeout:g}s"
                )
            message = self._transport.receive(timeout=remaining)
            if "method" in message and "id" not in message:
                continue  # Kernel event notification.
            if message.get("id") != request_id:
                raise WebBrowserError(
                    "Aphrody Web Browser kernel sent an unexpected response"
                )
            if "error" in message:
                error = message["error"]
                code = (
                    error.get("code", "unknown")
                    if isinstance(error, dict)
                    else "unknown"
                )
                raise WebBrowserError(
                    f"Aphrody Web Browser kernel request failed (code {code})"
                )
            if "result" not in message:
                raise WebBrowserError(
                    "Aphrody Web Browser kernel response has no result"
                )
            return message["result"]

    def call_tool(self, name: str, arguments: dict[str, Any] | None = None) -> Any:
        """Call any kernel tool, returning structured content when available."""
        result = self._request(
            "tools/call", {"name": name, "arguments": arguments or {}}
        )
        if not isinstance(result, dict):
            raise WebBrowserError("Aphrody Web Browser tool returned an invalid result")
        if result.get("isError"):
            raise WebBrowserError(f"Aphrody Web Browser tool {name!r} failed")
        if "structuredContent" in result:
            content = result["structuredContent"]
            if isinstance(content, dict) and set(content) == {"result"}:
                return content["result"]
            return content
        parts = result.get("content", [])
        if not isinstance(parts, list):
            raise WebBrowserError("Aphrody Web Browser tool returned invalid content")
        text = "\n".join(
            part.get("text", "") for part in parts if isinstance(part, dict)
        )
        try:
            return json.loads(text)
        except json.JSONDecodeError:
            return text

    def fetch(self, url: str, *, profile: str = "http", force: bool = False) -> Any:
        """Fetch through the unified web subsystem; ``render`` uses Obscura."""
        if not url.startswith(("https://", "http://")):
            raise ValueError("url must start with http:// or https://")
        if profile not in {
            "http",
            "static",
            "render",
            "fast",
            "stealth",
            "max",
        }:
            raise ValueError("unknown web profile")
        return self.call_tool(
            "web_browser_fetch",
            {"url": url, "profile": profile, "force": force},
        )

    def crawl(
        self,
        seeds: list[str] | None = None,
        *,
        max_requests: int = 16,
        goal: str | None = None,
    ) -> Any:
        """Launch one bounded, resumable crawl pass."""
        options: dict[str, Any] = {"maxRequests": max_requests}
        if seeds is not None:
            options["seeds"] = seeds
        if goal is not None:
            options["goal"] = goal
        return self.call_tool("web_browser_crawl", options)

    def autopilot_start(
        self,
        seeds: list[str] | None = None,
        *,
        max_requests: int = 16,
        interval_ms: int = 300_000,
    ) -> Any:
        """Start periodic, budgeted Web Browser missions in the kernel provider."""
        options: dict[str, Any] = {
            "maxRequests": max_requests,
            "intervalMs": interval_ms,
        }
        if seeds is not None:
            options["seeds"] = seeds
        return self.call_tool("web_browser_autopilot_start", options)

    def mission_status(self) -> Any:
        """Read the active mission and durable frontier/index counts."""
        return self.call_tool("web_browser_mission_status")

    def mission_stop(self) -> Any:
        """Stop the active mission after current work settles."""
        return self.call_tool("web_browser_mission_stop")

    def search_index(self, query: str, *, limit: int = 10) -> Any:
        """Retrieve citable passages from the local Web index."""
        return self.call_tool(
            "web_browser_index_search", {"query": query, "limit": limit}
        )

    def mirror(
        self,
        url: str,
        out_dir: str,
        *,
        max_pages: int = 16,
        max_total_bytes: int = 20_000_000,
    ) -> Any:
        """Mirror a site with robot and resource budgets."""
        return self.call_tool(
            "web_browser_mirror",
            {
                "url": url,
                "outDir": out_dir,
                "maxPages": max_pages,
                "maxTotalBytes": max_total_bytes,
            },
        )

    def research(self, query: str, *, max_results: int = 3) -> Any:
        """Run the RAG Web Browser research actor."""
        return self.call_tool(
            "web_browser_rag_research",
            {"query": query, "maxResults": max_results},
        )

    def site_to_api(self, url: str, *, max_pages: int = 10, max_depth: int = 2) -> Any:
        """Run the site-to-API actor and return its structured output."""
        return self.call_tool(
            "web_browser_site_to_api",
            {"url": url, "maxPages": max_pages, "maxDepth": max_depth},
        )

    def close(self) -> None:
        """Close this client and release its owned MCP connection once."""
        with self._lock:
            self._close_locked()

    def _close_locked(self) -> None:
        if self._closed:
            return
        self._closed = True
        if self._owns_transport:
            self._transport.close()

    def _ensure_open(self) -> None:
        if self._closed:
            raise WebBrowserError("WebBrowserClient is closed")

    def __enter__(self) -> WebBrowserClient:
        self._ensure_open()
        return self

    def __exit__(self, *_exc: object) -> None:
        self.close()
