<!-- SPDX-License-Identifier: Apache-2.0 -->
# Unified native runtime

The current producer direction and delivery gates live in the root
[PLAN.md](../../PLAN.md). The cross-repository architecture lives in
[Aphrody PLAN.md](../../PLAN.md).

Yolo owns the precompiled Bun/Tauri/Obscura runtime and light SDK. Aphrody owns
application behavior and migrates one qualified consumer at a time. This is the
active design direction; implementation and performance gates remain open.

Read [repository instructions](../../AGENTS.md) and [current memory](../../MEMORY.md),
then the existing [vendoring](../../guides/workspace/VENDORING.md) and [tooling](../../guides/workspace/TOOLING.md) procedures.

## Slice status

The first R0 slice (versioned C ABI, precompiled library, light TypeScript consumer) is described
in [RUNTIME-ABI](RUNTIME-ABI.md), with its limits. It is a proof of the boundary on one existing
capability: the R0 gate with Aphrody (a light Aphrody consumer calling a capability) and every
later gate remain open.
