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

## Endpoint

`default_endpoint()` is the canonical endpoint rule; the kernel server's own
`default_endpoint` delegates to it, so server and clients cannot disagree:

1. `APHRODY_OS_SOCKET` (explicit, used verbatim; empty counts as unset);
2. Windows: the per-user named pipe `\\.\pipe\aphrody-os-<user>`;
3. elsewhere: `$XDG_RUNTIME_DIR/aphrody-os.sock`, else
   `/tmp/aphrody-os-<user>.sock`.

`<user>` is `USERNAME`, else `USER`, else `user`, reduced to ASCII letters,
digits, `-` and `_`. `endpoint_from(env, windows)` is the same rule over an
injected environment, for tests that must not mutate the process environment.
