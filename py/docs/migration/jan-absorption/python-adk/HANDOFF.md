<!-- SPDX-License-Identifier: AGPL-3.0-only -->
# Jan Python / TypeScript ADK absorption

Source: Jan `14a720628f9592c8e60f7e081ef733076db8a6a9`, specifically
`adk/python/jan_adk/{runtime,session,install,_queue,_generated,errors}.py` and
`packages/adk/src/{index.js,index.d.ts,install.js,generated/rpc-types.d.ts}`.
Both ADK package manifests declare AGPL-3.0. The root Jan Apache-2.0 license
does not replace that package license. The Python semantic adapter and its
tests retain AGPL-3.0-only notices. The Python distribution now records the
included component expression `Apache-2.0 AND AGPL-3.0-only`, preserving
individual source headers. Package `LICENSE`, `NOTICE` and
`LICENSES/AGPL-3.0-only.txt` are explicitly declared for inclusion; no wheel
was built here.

`aphrody.client.AphrodyClient` is an existing OAuth HTTP API client, whereas
`aphrody.agent.AgentClient` owns the native app-server stdio protocol. Changes
extend the latter and `SessionDB`; `jan_adk.AphrodyADK` is a session view over
that client, with no process transport, history database or credentials store
of its own. Existing `client.py` behavior was left intact.

Implemented and scoped-tested: independent terminal result wait; notifications
before the start response; bounded unread queues and reported token loss;
explicit control-overflow failure; concurrent sessions; listener reentry and
removal; native text/image input; error method/code/data and retryability;
thread pagination/resume/fork/read/archive/close; steer/interrupt; borrowed-client
ownership; EOF/spawn failure and owned-client cleanup. Native close releases
the live actor; native archive changes durable visibility. These are distinct
operations rather than falsely claiming Jan archive wire compatibility.

Ephemeral/custom-prompt/no-builtins options now target the backend worker's
native `thread/start` fields. Custom prompts and `builtins=false` require
`ephemeral=true` until durable options replay is implemented. `subagents=false`
is accepted; enabled delegation remains unsupported. Synthetic image URL
tests verify framing only, not provider vision, media retention or image caps.

Canonical `AgentClient.on_request` allows an explicitly registered callback
away from the stdout reader, with a 16-handler concurrent limit. Unregistered
requests fail closed. Callback exceptions are sanitized; handler values are
JSON-validated before writing. Registration alone does not advertise tools
or approve permissions. Session declarations use `thread/tools/get,set` and
`thread/start.tools`. `tool/call` dispatches only a declared session handler;
`tool/cancelled` sets its cooperative cancellation flag synchronously in the
canonical reader. Late answers are suppressed; arbitrary handler side effects
cannot be forcibly rolled back. `permission/request` waits for a session
listener's explicit `allow_once` or `deny`, translated into native `allow/deny`.
`allow_always` is refused because remembered grants are not implemented.
Callbacks and notification draining run independently; their combined event
ordering is not claimed to match Jan's single dispatch thread. Control records
cannot be silently dropped by either event buffer. Host APIs fail closed when
the initialize response lacks the native `hostTools` capability.

Host results support text, text/image content parts, raw image bytes, base64
data URLs and explicit caller-selected image paths. These paths are read with
a local 16 MiB cap and are never copied to a persistent media store. Tests use
temporary synthetic files only. Native image wire uses `mime/data_base64` as
declared in the existing ToolImage contract. Host-only `details` is refused
rather than dropping data or accidentally sending it to a model.

Validation at this intermediate boundary: locked uv pytest on `test_agent.py`,
`test_jan_adk.py`, `test_session_db.py`: **47 passed**, 0 skipped, 0 failures.
Scoped Ruff and formatting pass; scoped Mypy passes on three sources.
These are synthetic stdio child processes and temporary databases, not an
installed runtime or authenticated provider test. No Cargo, heavy dependency
installation, model loading or deployment was performed.

Remaining cross-owner requirements: compile/install and runtime qualification
of the new host-tool RPCs, persistent permission grants, model/reset mutation,
host-only tool details, runtime event/exit observers, exact callback/notification
ordering, input-cap negotiation, install-artifact provenance across supported
platforms, standalone wheel import and real provider/runtime integration.
Use the existing Yolo/Infra installer rather than copying Jan's downloader as
a second runtime installer. Native wire is `thread/*`; Jan `session/*` aliases
are not claimed. This handoff is an intermediate implementation receipt, not
full Jan absorption closure. Parent review now remains Python-only: Rust and UI
workers were stopped at the owner's request. No new backend mutation or runtime
readiness is inferred from these Python fixtures. Current optional backend
source was read solely to confirm the wire targeted by this Python adapter.

## Python packaging audit — 2026-10-04

The AGPL text is an unmodified download from the
[GNU license source](https://www.gnu.org/licenses/agpl-3.0.txt), SHA-256
`0d96a4ff68ad6d4b6f1f30f713b18d5184912ba8dd389f86aa7710db079abcb0`.
Existing Apache license bytes and source notices are preserved. The new package
NOTICE records Jan's exact ADK source pin, the transport's existing Codex
provenance, and the distinct native math recipe. This reports component
metadata and preservation; it is not a legal certification or publication.

The qualifier previously compared `aphrody/*` source keys even though its
snapshot emits `src/aphrody/*`, so Python/resource comparisons were skipped.
It now translates the layout and verifies every source/typing/resource file
against **both** wheels and the sdist. It includes new first-party Python and
declared license files in explicit worktree snapshots while excluding untracked
runtime data. License bytes and `License-Expression`/`License-File` metadata
must match the source manifest. A `.pyi` stub cannot satisfy the compiled
extension presence check; duplicate wheel members/RECORD rows and duplicate
sdist members are rejected. The installed smoke also imports the ADK facade.

Executed gates: **35 tests pass** across the qualifier and existing backend
artifact/reproducibility tests, pytest 0.10 s; scoped Ruff/format pass; Mypy
passes on the qualifier and backend. These tests use synthetic archives and
the existing pinned native source recipe. No new wheel/sdist, Cargo build,
runtime installation, provider request or Yolo ABI qualification was executed.
The backend's existing verified source/delegation/SBOM logic did not need a
change. The parent owns lock refreshes, full-repository checks, commits and
any future native artifact qualification.
