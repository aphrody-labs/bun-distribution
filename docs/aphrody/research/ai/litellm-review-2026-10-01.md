<!-- SPDX-License-Identifier: Apache-2.0 -->
# LiteLLM source and documentation review

Review date: 2026-10-01. This is an architecture and plan review, not a parity
claim or code port.

## Source reviewed

- Checkout: `.cache/upstream/litellm` (not in repo) (generated or machine-local artifact; presence depends on the build host) (outside the Aphrody repository).
- Upstream: <https://github.com/BerriAI/litellm>
- Branch and observed revision: `main`, `b4bb2a77a20231860d91220376a1ec2691481b8b`.
- Clone contains full Git history (not shallow); working tree was clean.
- Root license: MIT outside `enterprise/`; that directory has separate terms.
- Main architecture reference: `ARCHITECTURE.md` in the checkout.
- Rust workspace: `litellm-rust/`, with individual `AGENTS.md` and crate docs.
- Official documentation reviewed: [Getting Started](https://docs.litellm.ai/docs/),
  [Life of a Request](https://docs.litellm.ai/docs/proxy/architecture),
  [Router](https://docs.litellm.ai/docs/routing),
  [Virtual Keys](https://docs.litellm.ai/docs/proxy/virtual_keys), and
  [Rust AI Gateway (beta)](https://docs.litellm.ai/docs/proxy/rust_gateway).

## What the project contains

LiteLLM combines two related products. Its Python SDK translates provider
requests and responses into common interfaces. Its proxy adds HTTP endpoints,
authentication, budgets, rate limits, routing, callbacks, spend records and an
admin surface. The documented request path checks a virtual key and limits,
routes among deployments, translates and calls the provider, then records spend
and callbacks asynchronously. Redis and PostgreSQL back distributed caches,
limits, keys, teams and spend logs.

The repository also contains a growing Rust workspace, including provider
translation, HTTP, routing, auth, key management, cache, cost, tracing, MCP,
Python bridge and host crates. `litellm-rust/crates/router/README.md` describes
model-list lookup scaffolding; it explicitly leaves multi-deployment routing,
strategies, retries, cooldowns and fallbacks unimplemented there. The official
Rust gateway page calls the Rust path beta and opt-in, with a subset of
provider/endpoint coverage. It describes the Python proxy as still owning
auth, configuration, routing, logging, callbacks and spend tracking, with
automatic pre-call fallback to Python for unsupported requests. The standalone
Axum server is documented as covering fewer routes and features than the
Python proxy. Treat current Rust crate names and README statements as source
scope, not proof of production readiness or complete parity.

## Decisions for Aphrody

1. Keep Aphrody's canonical model-call abstraction in `aphrody-model-client`
   and its agent/runtime, model and OS owners as set out in
   [AI architecture](../../architecture/ai/ARCHITECTURE.md). LiteLLM is a
   reference and optional remote gateway endpoint, not a second in-process
   provider framework or model catalog.
2. A user-configured LiteLLM endpoint can use the existing OpenAI-compatible
   client path. Do not add a LiteLLM subprocess, Python dependency, Rust git
   dependency, or default service as part of this review. There is no current
   product requirement that justifies another gateway runtime.
3. Preserve the existing Aphrody gateway migration decision: its server API
   surface and CLI consumer still need an owner during migration. LiteLLM's
   Python proxy is a viable external service reference; its beta Rust gateway
   does not establish a replacement or compatibility target for Aphrody's
   local facade. Reassess only against a named deployment/use case and a route,
   streaming, tool, error, auth, policy and operational parity matrix.
4. Use the routing documentation as a gap checklist for the one canonical
   router: deployment groups, bounded retries, cross-group fallbacks, health
   and cooldown state, per-deployment concurrency and limits, and deterministic
   selection tests. Add only items required by measured local or remote-model
   workflows. Avoid a separate LiteLLM-shaped router implementation.
5. Keep provider authentication, agent/workspace authority and OS policy
   enforcement distinct. LiteLLM virtual keys, spend budgets and rate limits
   solve shared gateway tenancy; they do not replace Aphrody's local secret
   store, tool authorization, approval path or process/file enforcement.
6. Treat cost attribution and callback delivery as explicit outcomes: retain
   provider usage/cost metadata where available, make post-request telemetry
   bounded and observable, and never make completion depend on best-effort
   external logging. Durable agent rollout events remain governed by Aphrody's
   own persistence contract.
7. Do not copy source from `enterprise/`. Any future source import requires a
   scoped license/provenance review; the reference checkout itself remains
   outside the repository.

## Plan effects

These decisions refine D0/D1/D3/D4/D5/D6 in
[`docs/plans/ai/PLAN.md`](../../plans/ai/PLAN.md) and the gateway/router items
in [`native-integration-master.md`](../../plans/ai/native-integration-master.md):
external OpenAI-compatible gateway configuration is already the appropriate
integration boundary; local routing, policy, persistence and release claims
stay with their named Aphrody owners. No new implementation or qualification
is claimed by this review.
