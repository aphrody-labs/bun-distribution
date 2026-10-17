// SPDX-License-Identifier: MIT
import { suffix } from "bun:ffi";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { NativeTooling } from "@aphrody/runtime-sdk/tooling";

/** Qualify the host provider before embedding it; this never starts a compiler. */
export async function toolingAsset(root: string, path = process.env.YOLO_TOOLING_LIB) {
  const name = process.platform === "win32" ? "aphrody_ffi.dll" : `libaphrody_ffi.${suffix}`;
  const library = path ? resolve(root, path) : join(root, "target/runtime", name);
  if (!library || !existsSync(library)) {
    throw new Error("Missing native tooling provider: set YOLO_TOOLING_LIB to a qualified library");
  }
  const tooling = new NativeTooling({ path: library });
  try {
    const probe = tooling.probe();
    if (!probe.available) throw new Error(`Native tooling provider rejected: ${probe.error}`);
    // Verify the actual parser contract, not only exported symbol names.
    const analysis = tooling.analyzeModule("export const qualified = 1;", "qualification.ts");
    if (!analysis.exports.includes("qualified")) throw new Error("Native tooling parser rejected");
    const bytes = await Bun.file(library).arrayBuffer();
    return {
      flags: ["--asset", library],
      library,
      sha256: new Bun.CryptoHasher("sha256").update(bytes).digest("hex"),
      abi: probe.abi!,
    };
  } finally {
    tooling.close();
  }
}
