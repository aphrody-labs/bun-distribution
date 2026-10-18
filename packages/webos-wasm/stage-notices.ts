// SPDX-License-Identifier: Apache-2.0
import { join, resolve } from "node:path";

/** Preserve the imported owner's existing license in its generated distribution. */
export async function stageWebOsNotices(directory = join(import.meta.dir, "wasm")) {
  const root = resolve(import.meta.dir, "../..");
  const source = Bun.file(join(root, "LICENSE-APACHE"));
  if (!(await source.exists())) throw new Error("The canonical Apache-2.0 license is missing.");
  const wasm = Bun.file(join(directory, "aphrody_webos_wasm_bg.wasm"));
  if (!(await wasm.exists())) throw new Error("Build the WebOS WASM artifact before staging its notices.");
  await Bun.write(join(directory, "LICENSE-APACHE"), source);
}
if (import.meta.main) await stageWebOsNotices();
