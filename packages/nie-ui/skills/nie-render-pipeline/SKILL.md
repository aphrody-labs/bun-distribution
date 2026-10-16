---
name: nie-render-pipeline
description: "NIE (IEVR) render surface in the IECODE workspace: aphrody-nie-render3d (GLB, CPU, wgpu, web), aphrody-nie-render (bounded RGBA8), aphrody-nie-model-serve. Invariants and gates. Use for NIE rendering; for Aphrody OS rendering use render-pipeline."
---

# nie-render-pipeline

Follow [IECODE scope and execution](../../references/workflow.md).

Keep deterministic headless rendering in `aphrody-nie-render3d`, bounded RGBA8 composition in `aphrody-nie-render`, and GLB HTTP/cache adapters in `aphrody-nie-model-serve`. Validate dimensions, multiplication and budgets before allocation; normalize VFS paths. WASM exports expose no secrets, absolute paths or system access.

Read [render invariants and scoped gates](references/details.md) before changing an owner. Shared CPU/GPU camera constants define comparable projection; independent game fidelity requires reference evidence. Run only selected-owner tests and strict Clippy through the repository's serialized build owner.
