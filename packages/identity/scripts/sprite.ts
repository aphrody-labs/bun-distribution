// SPDX-License-Identifier: Apache-2.0
// Copies the canonical pet atlas from crates/ui/identity into the gitignored dist/ that the package ships.
import { join } from "node:path";
import { findWorkspaceRoot } from "@aphrody/paths";

const root = join(import.meta.dir, "..");
const source = join(
  findWorkspaceRoot(),
  "crates/ui/identity/assets/aphrody/sprites/spritesheet.webp",
);
const dest = join(root, "dist/spritesheet.webp");
await Bun.write(dest, Bun.file(source));
console.log(dest);
