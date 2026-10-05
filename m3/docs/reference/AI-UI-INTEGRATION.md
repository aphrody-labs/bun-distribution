<!-- SPDX-License-Identifier: Apache-2.0 -->
# AI and desktop UI boundary

This page replaces the former feature inventory, which described routes and adapters
that no longer exist. The desktop UI consumes AI through the resident app-server and
typed owners; it must not depend directly on AI implementation crates or run generic
shell commands.

The supported areas are Chat, Files, Models and Settings. Verify current behavior in
source and follow the [GUI contract](./GUI.md) and the cross-repository
[AI plan](https://github.com/aphrody-labs/aphrody/blob/main/docs/plans/ai/PLAN.md). Historical integration claims are not release
evidence.
