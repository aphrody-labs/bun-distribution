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
  const metadata = Bun.file(join(directory, "package.json"));
  if (await metadata.exists()) {
    const manifest = Bun.TOML.parse(await Bun.file(join(root, "crates/aphrody-webos-wasm/Cargo.toml")).text()) as {
      package?: { license?: string };
    };
    if (manifest.package?.license !== "Apache-2.0")
      throw new Error("WebOS source license must retain its Apache-2.0 declaration.");
    await Bun.write(
      metadata,
      JSON.stringify({ ...(await metadata.json()), license: manifest.package.license }, null, 2) + "\n",
    );
  }
}
if (import.meta.main) await stageWebOsNotices();
