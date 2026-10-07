# SPDX-License-Identifier: Apache-2.0
"""Bounded SSH bridge to the canonical DBFR Aphrody MCP; never emit credentials."""

import base64
import json
import pathlib
import sys
import urllib.parse
import urllib.request


def decode_rpc(raw):
    if raw.lstrip().startswith("{"):
        return json.loads(raw)
    for line in raw.splitlines():
        if line.startswith("data: ") and line[6:].startswith("{"):
            message = json.loads(line[6:])
            if "id" in message:
                return message
    raise ValueError("MCP response missing")


def call(tool, arguments):
    if tool not in {"aphrody_shenron_rag_search", "aphrody_shenron_llm_chat"}:
        raise ValueError("Tool outside debate scope")
    env = {}
    for line in (
        pathlib.Path("/etc/aphrody/shenron-compute.env").read_text().splitlines()
    ):
        if "=" in line and not line.startswith("#"):
            key, value = line.split("=", 1)
            env[key] = value.strip().strip("\"'")
    headers = {
        "Authorization": "Bearer " + env["APHRODY_MCP_HTTP_TOKEN"],
        "Content-Type": "application/json",
        "Accept": "application/json, text/event-stream",
    }

    def rpc(method, params, request_id=None):
        body = {"jsonrpc": "2.0", "method": method, "params": params}
        if request_id is not None:
            body["id"] = request_id
        request = urllib.request.Request(
            "http://127.0.0.1:8789/mcp", data=json.dumps(body).encode(), headers=headers
        )
        with urllib.request.urlopen(request, timeout=55) as response:
            session = response.headers.get("mcp-session-id")
            if session:
                headers["Mcp-Session-Id"] = session
            raw = response.read(2 * 1024 * 1024 + 1).decode()
            if len(raw.encode()) > 2 * 1024 * 1024:
                raise ValueError("MCP response too large")
            return decode_rpc(raw) if request_id is not None else None

    try:
        initialized = rpc(
            "initialize",
            {
                "protocolVersion": "2025-03-26",
                "capabilities": {},
                "clientInfo": {"name": "aphrody-discord-debate", "version": "1"},
            },
            1,
        )
        if "error" in initialized:
            raise ValueError("MCP initialization rejected")
        headers["MCP-Protocol-Version"] = initialized["result"]["protocolVersion"]
        rpc("notifications/initialized", {})
        result = rpc("tools/call", {"name": tool, "arguments": arguments}, 2)
        if "error" in result or result["result"].get("isError"):
            raise ValueError("MCP tool failed")
        payload = result["result"].get("structuredContent")
        if payload is None:
            texts = [
                x["text"]
                for x in result["result"].get("content", [])
                if x["type"] == "text"
            ]
            payload = json.loads("\n".join(texts))
        if (
            isinstance(payload, dict)
            and "error" in payload
            and tool == "aphrody_shenron_rag_search"
        ):
            # Demonstrated MCP database gap: reuse Shenron's existing public VFS RAG.
            # No new index, SQL connection, corpus copy, OCR or editorial write.
            query = arguments.get("q", "")
            if not isinstance(query, str) or not 1 <= len(query.encode()) <= 512:
                raise ValueError("Invalid search query")
            params = {
                key: value
                for key, value in arguments.items()
                if key in {"q", "limit", "lang", "kind", "sourceId", "entity"}
                and value is not None
            }
            url = (
                "http://127.0.0.1:5011/api/public/rag/search?"
                + urllib.parse.urlencode(params)
            )
            with urllib.request.urlopen(url, timeout=20) as response:
                payload = json.loads(response.read(2 * 1024 * 1024))
            payload["retrievalOwner"] = "shenron-public-vfs"
        if not isinstance(payload, dict) or "error" in payload:
            raise ValueError("Backend unavailable")
        return payload
    finally:
        if "Mcp-Session-Id" in headers:
            try:
                with urllib.request.urlopen(
                    urllib.request.Request(
                        "http://127.0.0.1:8789/mcp", method="DELETE", headers=headers
                    ),
                    timeout=5,
                ):
                    pass
            except (OSError, TimeoutError):
                print("MCP session close unavailable", file=sys.stderr)


if __name__ == "__main__":
    try:
        if len(sys.argv) != 2 or len(sys.argv[1]) > 65536:
            raise ValueError("Bounded request required")
        request = json.loads(base64.b64decode(sys.argv[1], validate=True))
        print(
            json.dumps(call(request["tool"], request["arguments"]), ensure_ascii=False)
        )
    except (OSError, ValueError, KeyError, TypeError, TimeoutError) as error:
        print(json.dumps({"error": type(error).__name__}))
        sys.exit(1)
