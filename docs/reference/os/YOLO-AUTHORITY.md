<!-- SPDX-License-Identifier: Apache-2.0 -->
# YOLO execution authority and kernel trust boundary

The `APHRODY_YOLO`, `APHRODY_NHITL`, `APHRODY_AGENT_AUTHENTICATED`, and
`APHRODY_AUTHORITY_SCOPE` environment markers describe the **agent workflow** authorized by
its launcher. They are not credentials and the kernel does not read or verify them. An MCP
`clientInfo.name`, A2A `sourceAgent`, or remote subsystem name is also self-declared metadata.

## Current kernel boundary

The kernel's local socket or named pipe is a **single OS-user trust domain** by default. A
production kernel started with `--auth-file <absolute-policy-path>` (or
`APHRODY_KERNEL_AUTH_FILE`) loads named principals and requires a token at MCP initialization.
It filters tool inventory, calls, skills, A2A calls, subsystem registration and event publication
according to the server-assigned scope. Clients supply a token through `APHRODY_OS_AUTH_TOKEN`.
Tokens never appear in status APIs. Unix endpoints use mode 0600; Windows named pipes reject
remote network clients. Neither control separates agents running under the same OS account.
The stdio MCP path inherits the trust of the process that launched it, including its option to
start an in-process kernel.

Do not expose the endpoint to another user or network, run a shared kernel elevated, or
describe an `APHRODY_AUTHORITY_SCOPE` value as a kernel-enforced permission. Isolate agents
with different authority by OS account and endpoint. Elevation, when required, is scoped to
the native `sudo.exe` invocation of that operation. The kernel does not grant permanent
elevation or a Windows driver.

`aphrody-execpolicy` evaluates command argv for callers that opt into it. It is not a
universal filter around kernel tool dispatch, and no local filesystem or network confinement
library sits in that path either. Tool-specific validation,
host permissions, and the caller's own authority remain in effect.

The JSON policy must use an absolute path and a non-empty `principals` array. Each principal has
an `id`, secret `token`, `toolPrefixes`, `registerSubsystems`, and `publishEvents`. Store it with
host-local protections and issue separate least-privilege tokens per production client. Without
an auth file the kernel retains the development-compatible single-user boundary, which is not
suitable for mutually untrusted local clients.
