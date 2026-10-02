<!-- SPDX-License-Identifier: Apache-2.0 -->
# Shell sandbox host contract

Owner: `aphrody-shell-sandbox-host` (`crates/shell/aphrody-shell-sandbox-host`).

`SandboxHost` starts a `ShellSession`, transfers whole files by absolute byte path,
kills a session and reports its limits. A session accepts raw input bytes, returns
raw output bytes, resizes and reports its exit status. The host does not parse
terminal escape sequences. Browser clients use `aphrody-terminal-core` for VT
state and the existing `data_frame` / `resize_frame` wire format in
`aphrody-shell-web` for WebSocket control messages.

## Implementations

- `MockHost` shares a bounded `MemVfs` with its local shell sessions. Uploads
  become visible to `cat`, and files written by a session can be downloaded.
  It enforces session count, input frame size, output size and idle time.
- `LocalPtyHost` uses `aphrody-terminal-backend::PtySession`. Its transfer root
  is an existing host directory; uploads and downloads are restricted to paths
  below that root. A Tokio runtime is required to spawn the PTY. Its control
  channel is bounded and `ShellSession` methods remain nonblocking.
- `E2bHost` in `aphrody-shell-sandbox-host-e2b` maps provider file and PTY APIs
  to this contract. `spawn_with_id` returns a provider PID; `reattach` reconnects
  to that PTY. Dropping its host requests sandbox deletion.

`LocalPtyHost` is a native PTY adapter, not a process isolation boundary. A
remote provider must confine the process separately, for example through its
container or microVM boundary. `aphrody-sandbox` owns local command
confinement and is not replaced by this crate.

## Limits and lifecycle

Defaults match the exposed PTY server: eight sessions, a 1 MiB input frame,
8 MiB output per session and a 15 minute idle TTL. Providers can set stricter
limits. Input frames over the limit fail; output is capped when drained, and
idle expiry is checked on session access or polling. Dropping a local PTY session closes
its command channel and tears down the PTY. `kill` is idempotent.

`verify_host_contract` is the shared native conformance check. It uploads a
marker, downloads the same bytes, spawns a session, resizes it, reads that file
through the shell, and kills the session. It runs on both `MockHost` and
`LocalPtyHost`; provider adapters should run it behind a live credential flag.

## Current qualification

The mock and native PTY tests pass on Linux. The TS WebSocket transport passed
a live PTY round trip and a working-directory-preserving reconnect. The E2B
adapter passes local HTTP/Connect framing checks; real cloud conformance remains
a separate T12 gate requiring provider credentials.
