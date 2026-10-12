// SPDX-License-Identifier: Apache-2.0
// Regenerates the pet modules from the canonical package of crates/ui/identity:
//   src/animations.generated.ts  from assets/aphrody/animations.json (geometry and timing for
//                                the React component; the 100 KB QA manifest never reaches a bundle)
//   @aphrody/web-source …/identity/src/web.generated.ts  from the web-source crate's
//                                assets/aphrody/web.json (Codex-composed tracks, states, gaze
//                                ring and sprite CSS for <aphrody-pet>; written by
//                                `aphrody identity pet web`); src/web.generated.ts re-exports it
// src/pet.test.ts and src/runtime.test.ts fail when a generated file and the crate disagree.
//   bun scripts/generate.ts
import { join } from "node:path";
import { compactPet, renderModule, renderWebModule } from "../src/compact";
import { webSourceTarget } from "./web-source";

const assets = join(import.meta.dir, "../../../../crates/ui/identity/assets/aphrody");
const src = join(import.meta.dir, "../src");

const compact = compactPet(await Bun.file(join(assets, "animations.json")).json());
await Bun.write(join(src, "animations.generated.ts"), renderModule(compact));
console.log(
  `animations.generated.ts: ${Object.keys(compact.tracks).length} tracks, ${compact.directions.length} directions`,
);

const target = webSourceTarget(src);
const web = await Bun.file(target.webJson).json();
await Bun.write(target.generated, renderWebModule(web, target.runtimeImport));
console.log(
  `web.generated.ts: ${Object.keys(web.tracks).length} tracks, ${web.directions.length} directions`,
);
