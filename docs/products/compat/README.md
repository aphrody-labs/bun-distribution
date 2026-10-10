<!-- SPDX-License-Identifier: Apache-2.0 -->

# Aphrody Compat

Offline Bun documentation and shared Bun/uv/Nushell toolchain discovery. Node-to-Bun migration
(`n2b`) lives in the Bun fork; see [N2B.md](../../reference/compat/N2B.md). The `aphrody-bun` Rust crate and `@aphrody/bun` package belong
to `aphrody-ui`.

## Layout

| Path                       | Role                                                      |
| -------------------------- | --------------------------------------------------------- |
| `crates/compat/toolchains` | Runtime discovery, repository pins and launch environment |
| `crates/compat/bun-docs`   | Offline documentation kernel subsystem                    |

The documentation subsystem uses Contracts.
No AI dependency. Exact membership and dependencies come from Cargo.toml.

## Start and references

Use the pinned Rust/Bun toolchains and `RUSTC_WRAPPER=`. [AGENTS.md](../../reference/compat/AGENTS.md) owns NHITL and gates.

- [Documentation index](./_source/README.md), [Bun rules](../../reference/compat/BUN.md)
- [Publication scope](../../plans/compat/PLAN.md), [publish ladder](../../reference/ai/cargo/PUBLISH-LADDER.md)
- [n2b and the Oxc bridge](../../reference/compat/N2B.md)

Apache-2.0.

## Automatisation transversale

`bun run docs:bun:update` (ou `yolo ops bun-upstream-docs`) épingle dans `docs/reference/upstream-bun/SOURCE.json` le commit de `docs/` du fork Bun (lu en place, sans copie) et copie son `LICENSE.md` ; `bun run docs:bun:check` vérifie que le pin est à jour.
