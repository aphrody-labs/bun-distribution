<!-- SPDX-License-Identifier: Apache-2.0 -->
# Material ownership and Aphrody integration

Owner decision, 2026-10-13: Material is the canonical source owner for the
shared Material 3 framework. Aphrody owns product-specific integration and
consumes Material's pinned package and crate interfaces.

| Capability | Source owner | Aphrody boundary |
| --- | --- | --- |
| Tokens, themes and `libm3` adapters | Material | Consume the pinned `aphrody-m3-tokens` crate and Material exports. |
| Shared controls and `@aphrody/app-ui` | Material | Depend on `@aphrody/app-ui` from the selected sibling Material checkout. |
| Native app and product UI integration | Aphrody | `crates/ui/app`, `crates/ui/drive`, `crates/ui/identity`, `crates/ui/render`, `packages/infra/product`. |
| Runtime and system UI/SDK integration | Bun | Use Bun's runtime and SDK interfaces; framework source stays with its capability owner. |

The root Cargo manifest pins `aphrody-m3-tokens` to the Material Git repository
at revision `229a767493818a5dd9f92451b4a99699894a1865`. The Bun workspace
resolves `@aphrody/app-ui` through `../material/packages/app-ui`. Checkout paths
are selected from the current workspace or explicit configuration.

The local `m3/` directory is not a Git submodule and contains no canonical
Material source. Its only current file is the generated Bun catalog at
`m3/packages/app-ui/src/generated/bun-catalog.ts`; preserve it until its
generator and consumers are reconciled. Do not add framework changes there.

Material's `AGENTS.md`, `PLAN.md` and `MEMORY.md` own framework placement,
integration and dated qualification evidence. Source presence and a pinned
dependency do not by themselves qualify package publication, a displayed UI or
deployment.
