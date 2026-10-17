// SPDX-License-Identifier: Apache-2.0
// Regenerates the pet modules from the canonical package of crates/aphrody-identity:
//   src/animations.generated.ts  from assets/aphrody/animations.json (geometry and timing for
//                                the React component; the 100 KB QA manifest never reaches a bundle)
// Web tracks are imported directly from crates/aphrody-identity/assets/aphrody/web.json.
// This generator writes only its own package; Rust exports remain with their owner.
// src/pet.test.ts and src/runtime.test.ts fail when a generated file and the crate disagree.
//   bun scripts/generate.ts
import { join } from "node:path";
import { findWorkspaceRoot } from "@aphrody/paths";
import { compactPet, renderModule } from "../src/compact";

const assets = join(findWorkspaceRoot(import.meta.dir), "crates/aphrody-identity/assets/aphrody");
const src = join(import.meta.dir, "../src");

const compact = compactPet(await Bun.file(join(assets, "animations.json")).json());
await Bun.write(join(src, "animations.generated.ts"), renderModule(compact));
console.log(
  `animations.generated.ts: ${Object.keys(compact.tracks).length} tracks, ${compact.directions.length} directions`,
);
