<!-- SPDX-License-Identifier: Apache-2.0 -->
# aphrody-kernel-client

Async NDJSON JSON-RPC client for a local Aphrody OS kernel endpoint. It owns
the cross-platform Unix socket / Windows named-pipe connection and the MCP
initialize, tool-list and tool-call exchange. Consumers supply the endpoint
and optional authentication token; token values are never included in debug
output or errors.

`KernelClient::call_method` sends a kernel RPC method after initialization;
the kernel still enforces authentication, policy and method validation. Prefer
`call_tool` for MCP tools.
