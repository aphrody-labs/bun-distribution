// SPDX-License-Identifier: Apache-2.0
// Regenerates src/animations.generated.ts from the canonical pet package of
// crates/ui/identity (assets/aphrody/animations.json): only the geometry and timing a
// renderer needs, so the 100 KB QA manifest never reaches a bundle. `src/pet.test.ts` fails when
// the generated file and the crate disagree.
//   bun scripts/generate.ts
import { join } from "node:path";
import { compactPet, renderModule } from "../src/compact";

const crate = join(import.meta.dir, "../../../../../crates/ui/identity/assets/aphrody/animations.json");
const out = join(import.meta.dir, "../src/animations.generated.ts");
const compact = compactPet(await Bun.file(crate).json());
await Bun.write(out, renderModule(compact));
console.log(`${out}: ${Object.keys(compact.tracks).length} tracks, ${compact.directions.length} directions`);
