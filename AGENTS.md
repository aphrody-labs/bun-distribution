<!-- SPDX-License-Identifier: Apache-2.0 -->
# Aphrody M3 instructions

Read [GOAL.md](GOAL.md), [PLAN.md](PLAN.md) and [MEMORY.md](MEMORY.md) before changes.
When embedded in Aphrody, its [repository instructions](../AGENTS.md) and
[architecture plan](../PLAN.md) also apply.

This private repository owns the Material 3 framework and its web adapters.
Aphrody owns product behavior, native UI crates and installed application hosts;
Yolo owns the runtime and SDK. Preserve fork provenance and protected stores.

Inspect both local `.coord/claims` and the enclosing repository's claims. Reserve
disjoint paths and preserve existing edits. Keep a bounded TODO under the owned
coordination run. Workers never start Cargo; native builds belong to the integrating
agent and the declared factory.

Use existing native MCP capabilities or the owner CLI with live help. The Yolo
entrypoint is `$YOLO_ROOT/bin/yolo`, not a TypeScript interpreter invocation of
that shell script. Resolve framework gates from the selected checkout's manifest.

Follow the scoped gates and actual limitations in [PLAN.md](PLAN.md). Successful
DOM tests, viewport presets or cross-compilation do not establish installed host
support. Commit only completed owned changes as `aphrody-dev <contact@aphrody.com>`;
push normally to an existing authorized private remote. Publication requires
explicit owner authority.
