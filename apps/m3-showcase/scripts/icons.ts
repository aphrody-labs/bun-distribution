// SPDX-License-Identifier: Apache-2.0
import { resolve } from "node:path";

export const SHOWCASE_ROOT = resolve(import.meta.dir, "..");
export const APHRODY_ROOT = resolve(SHOWCASE_ROOT, "../..");
export const TAURI_ROOT = resolve(APHRODY_ROOT, "apps/aphrody-app");
/** Canonical Aphrody artwork stays in its protected identity owner; generated icons are ignored. */
export const ICON_SOURCE = resolve(APHRODY_ROOT, "crates/aphrody-identity/assets/brand/icon.svg");

export function iconCommand(root = TAURI_ROOT, executable = Bun.which("tauri")): string[] {
  if (!executable)
    throw new Error(
      "The installed Tauri CLI is missing. Qualify the declared Aphrody/Yolo toolchain before generating icons.",
    );
  return [executable, "icon", ICON_SOURCE, "--output", resolve(root, "icons"), "--ios-color", "#6750a4"];
}

export async function generateIcons(args: string[] = [], root = TAURI_ROOT): Promise<void> {
  if (!(await Bun.file(ICON_SOURCE).exists())) throw new Error(`Canonical Aphrody icon is missing: ${ICON_SOURCE}`);
  const command = iconCommand(root);
  if (args.includes("--plan")) {
    console.log(JSON.stringify({ command, source: ICON_SOURCE, output: resolve(root, "icons") }, null, 2));
    return;
  }
  const process = Bun.spawn(command, {
    cwd: root,
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });
  const code = await process.exited;
  if (code !== 0) throw new Error(`Tauri icon generation failed with exit ${code}`);
}

if (import.meta.main) {
  try {
    await generateIcons(Bun.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
