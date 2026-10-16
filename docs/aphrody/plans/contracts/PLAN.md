<!-- SPDX-License-Identifier: Apache-2.0 -->
# PLAN — aphrody-contracts

## 2026-09-26 — crates.io release set (prepared, not published)

Recorded preparation covers nine crates: `aphrody-a2a`, `a2a-pb`, `a2a-client`,
`a2a-server`, `a2a-grpc`, `a2a-coord`, `agent-proto`, `app-protocol`, `subsystem`
(all names use the `aphrody-` prefix). Historical dry runs passed; upload is not
established. The excluded SLIMRPC crate is not in this set. Newly added members,
including kernel-client, require their own packaging evidence.

Use current manifest versions and the [publish ladder](../../reference/ai/cargo/PUBLISH-LADDER.md).
Order: neutral types → protobuf → client/server → gRPC/coordination.
Keep `A2A_PB_REGEN` unset while packaging and check consumer compatibility.
For a publication task, run the ladder under [NHITL](../../reference/contracts/AGENTS.md) and record the
actual result; no additional maintainer confirmation. AI CLI distribution stays separate.
