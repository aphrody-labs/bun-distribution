<!-- SPDX-License-Identifier: Apache-2.0 -->
# Jan UI absorption: stable source batch

Pinned upstream: `14a720628f9592c8e60f7e081ef733076db8a6a9`, existing
`aphrody-py/vendor/jan/web-app/src`. [FEATURES.json](FEATURES.json) records
behavioral coverage and precise remaining gaps. Full UI absorption and product
activation remain unproved.

This takeover preserved and completed the interrupted worker's canonical model
hub, history, settings and store edits. Model inventories retain independent
errors, cancel waits for acknowledgement, model deletion and update installation
use M3 confirmations, actual version replaces a fabricated version, favorites
persist, catalog file/license details and installed search are exposed. Archived
history restores through existing RPC and synthetic conversations are removed.
Agent settings now inspect profile-isolated MCP configuration through existing
`mcpServerStatus/list`; unknown status remains unverified. Binary selection records
a path without claiming that execution succeeded.

Native Studio tool discovery previously returned four hard-coded examples and
claimed MCP-UI parity. It now calls `tools/list` through the existing
`AppServerBroker`, gates the main window, maps the actual flattened
`ToolDefinition::to_openai_function` shape, rejects owner errors/malformed data,
and supplies no invented UI resources. No second connection or registry exists.

## Evidence and parent gates

From `design/aphrody-m3/packages/app-ui`, `bun test --preload ../../bun/test-dom/src/index.ts src`
passed **153 tests, 675 assertions, 19 files, 622 ms**. `bun run typecheck` passed.
Scoped oxlint with `--deny-warnings` passed on all 11 touched TS/TSX files;
oxfmt passed. The canonical DOM preload is necessary before Base UI evaluates
browser availability. The previous source test demanding a fabricated
`Aphrody 2.0` was corrected; real updater interactions prove current version,
failure handling, confirmation and install-before-restart behavior.

`rustfmt --edition 2024 crates/ui/app/src/studio.rs` passed. Two Rust tests were
added for owner-derived tool inventory and error/malformed rejection, **not run**
by this worker. Package is **`aphrody-app`**, library **`aphrody_app_lib`**.
Integrator must run scoped serialized owner gates:

```sh
scripts/build/rust/cargo-serial.sh check -p aphrody-app --lib
scripts/build/rust/cargo-serial.sh test -p aphrody-app --lib tool_inventory_tests
scripts/build/rust/cargo-serial.sh clippy -p aphrody-app --lib --tests --no-deps -- -D warnings
```

Use the configured authorized factory; VPS is execution-only. Local source tests
cannot establish packaging, installation, live MCP auth, runtime tool discovery,
real model transfer, signed update or web/desktop activation. No shared manifest
or dependency changes are required by this batch.

## Next concrete integration batch

The ledger identifies missing canonical mutations: MCP server CRUD/OAuth/router
approval, provider credential/endpoint provisioning, assistant/project metadata,
goal lifecycle/skill installation, API server configuration and redacted logs,
privacy/extensions/search/proxy/custom CLI controls, persistent artifacts and
advanced inference/hardware controls. UI cannot safely invent corresponding
commands; backend/credential/store owners must expose typed contracts first.
Existing appearance/shortcuts/attachments are partial capabilities, not automatic
semantic Jan parity. Continue these batches rather than closing absorption.

No Cargo, agent spawning, Git staging/commit/push, deployment, toolchain
installation, protected data or live weights were used by this worker.
