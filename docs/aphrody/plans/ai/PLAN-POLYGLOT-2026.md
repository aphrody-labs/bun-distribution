<!-- SPDX-License-Identifier: Apache-2.0 -->
# Rust, Bun and Python integration

The active integration plan is [PLAN.md](./PLAN.md#capability-integration).
[ARCHITECTURE.md](../../architecture/ai/ARCHITECTURE.md) defines process, language and repository
boundaries; the [latency budgets](./PLAN.md#latency-budgets) define what must be
measured before making performance claims.

Rust owns the agent and typed backend integration. Bun packages provide their
existing client and tooling surfaces. Python workers handle their declared
training and data workloads. The UI consumes persistent backend contracts;
adding a language bridge alone does not connect a capability to a user flow.

The previous plan's machine-specific settings, fixed resource budgets and
aggregate test counts are historical. Read the
[original at bb46076](https://github.com/aphrody-labs/aphrody/blob/bb46076ce7ab57ea3af96486dbefc66392ef3562/docs/PLAN-POLYGLOT-2026.md)
for provenance. It is superseded and does not authorize deployment or define
current hosts, ports, platform support or performance.
