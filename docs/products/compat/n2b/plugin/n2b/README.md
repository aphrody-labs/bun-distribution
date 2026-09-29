# docs/ — Documentation et recherche

> Index des notes, études et rapports du workspace `rsbun`.

---

## research/ — Études de fond

| Fichier | Sujet | Taille |
|---|---|---|
| [`research/rust-starred-libs-2026.md`](../../../../../research/compat/n2b/plugin/n2b/research/rust-starred-libs-2026.md) | **Bible** des librairies Rust 2026 : 17 catégories, arbitrages, stack finale | 35 Ko |
| [`research/monorepo-architecture-2026.md`](../../../../../architecture/compat/n2b/plugin/n2b/research/monorepo-architecture-2026.md) | Architecture monorepo Rust (web/desktop partagé + mobile séparé) + UI Discord/VS Code-like | 27 Ko |
| [`research/rust-web-stack-2026.md`](../../../../../research/compat/n2b/plugin/n2b/research/rust-web-stack-2026.md) | Stack web Rust 2026 + app avec look desktop natif (Tauri + Leptos + Dioxus Native) | 14 Ko |
| [`research/wasm-bindgen-study.md`](../../../../../research/compat/n2b/plugin/n2b/research/wasm-bindgen-study.md) | Étude approfondie de wasm-bindgen (architecture, flow, patch Bun local) | 14 Ko |
| [`research/discord-stack-research.md`](../../../../../research/compat/n2b/plugin/n2b/research/discord-stack-research.md) | Stack complète Discord : Rust backend + React/RN frontend + design system | 8 Ko |

## bun/ — Notes Bun-spécifiques

| Fichier | Sujet |
|---|---|
| [`bun/bun-roadmap-159.md`](../../../../../plans/compat/n2b/plugin/n2b/bun/bun-roadmap-159.md) | Roadmap Bun issue #159 |
| [`bun/bun-roadmap-mapping.md`](../../../../../plans/compat/n2b/plugin/n2b/bun/bun-roadmap-mapping.md) | Mapping roadmap ↔ sources |

## Upstream Bun docs

The offline mirror of the upstream Bun docs lives in [`../../bun/`](../../bun/) (`docs/n2b/bun/`),
refreshed by `bun run docs:bun:update` (see [`../../README.md`](../../README.md)).

## Autres

- [`build-your-own-x.md`](../../../../../reference/compat/n2b/plugin/n2b/build-your-own-x.md) — référence externe

---

## Navigation rapide

### Par thème

**Rust 2026** : [`research/rust-starred-libs-2026.md`](../../../../../research/compat/n2b/plugin/n2b/research/rust-starred-libs-2026.md) → toutes catégories + arbitrages

**Architecture produit** : [`research/monorepo-architecture-2026.md`](../../../../../architecture/compat/n2b/plugin/n2b/research/monorepo-architecture-2026.md) → monorepo Dioxus/Tauri

**WebAssembly** : [`research/wasm-bindgen-study.md`](../../../../../research/compat/n2b/plugin/n2b/research/wasm-bindgen-study.md) → clone + patch Bun

**Design system** : [`research/discord-stack-research.md`](../../../../../research/compat/n2b/plugin/n2b/research/discord-stack-research.md) → Discord + Figma-like

### Par cas d'usage

**Je démarre un projet web Rust** → `research/rust-web-stack-2026.md`

**Je veux un monorepo Rust cross-plateforme** → `research/monorepo-architecture-2026.md`

**Je veux choisir une crate** → `research/rust-starred-libs-2026.md` section "Arbitrages"

**Je travaille sur WASM** → `research/wasm-bindgen-study.md` + `../wasm/WASM_BINDGEN_BUN_PATCH.md`

**Je bench Bun** → [`../bun/project/benchmarking.mdx`](../../../../../research/compat/n2b/bun/project/benchmarking.mdx)
