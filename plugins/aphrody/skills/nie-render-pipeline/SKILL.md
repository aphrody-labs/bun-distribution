---
name: nie-render-pipeline
description: "NIE (IEVR) render surface in the IECODE workspace: aphrody-nie-render3d (GLB, CPU, wgpu, web), aphrody-nie-render (bounded RGBA8), aphrody-nie-model-serve. Invariants and gates. Use for NIE rendering; for Aphrody OS rendering use render-pipeline."
---

# NIE render pipeline

> **Applies when:** the IECODE checkout (its root has a `iecode:crates/nie` directory) is the working directory; paths prefixed `iecode:` are relative to it.
> **Otherwise:** skip this skill for non-NIE rendering (use `render-pipeline`), and without the checkout state that the NIE render crates cannot be inspected.

## Canonical crates

- `iecode:crates/nie/aphrody-nie-render3d`: GLB, rastériseur CPU (`render.rs`), wgpu (`gpu.rs`) et viewer web (`web.rs`).
- `iecode:crates/nie/aphrody-nie-render`: limites communes (`Limits`) et composition bornée pour les hôtes natifs, GUI et WASM.
- `iecode:crates/nie/aphrody-nie-model-serve`: serveur HTTP d'assemblage GLB depuis les CPK (`/model-full/<code>.glb`, `/tex/...`, `/health`) avec cache disque.
- Le gateway public `nie-site` n'a plus de crate dans l'arbre IECODE (spec retenue : `iecode:docs/nie/SITE.md`).

## Invariants

- `aphrody_nie_render3d::render::render` reste déterministe et headless.
- Le cadrage CPU/GPU est partagé par `FOCALE`, `DISTANCE_CAMERA` et `TILT` (`render.rs`).
- Toute entrée image vérifie dimensions, multiplication et budget avant allocation (cf. `Limits`).
- Les chemins VFS passent par la normalisation de l'hôte ou les gardes de l'amont.
- Aucun secret, chemin absolu ou accès système ne traverse la surface WASM.

## Gates

```text
cargo fmt --all -- --check
cargo test -p aphrody-nie-render3d -p aphrody-nie-render -p aphrody-nie-model-serve --locked
cargo clippy -p aphrody-nie-render3d -p aphrody-nie-render -p aphrody-nie-model-serve --all-targets --locked -- -D warnings
```
