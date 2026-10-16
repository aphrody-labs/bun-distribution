// SPDX-License-Identifier: Apache-2.0
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { M3CssConfig } from "../src/native.ts";

/** The aphrody-m3 checkout: `packages/m3-fonts/fonts/upstream` holds the pinned fonts
 * (`bun scripts/fonts-sync.ts`, run by this package's `test` script), so the suite runs the same in
 * a standalone, aphrody, yolo or iecode checkout. */
export const REPO_ROOT = resolve(import.meta.dir, "../../..");
/** The fixture application. */
export const FIXTURE = join(import.meta.dir, "fixtures/app");

/** Deterministic stand-in for `m3Css`: echoes its input as a custom property, records calls. */
export function fakeCss() {
  const calls: M3CssConfig[] = [];
  const css = (config: M3CssConfig) => {
    calls.push(config);
    return `:root { --fixture-primary: #123456; --fixture-config: ${JSON.stringify(JSON.stringify(config))}; }\n`;
  };
  return { css, calls };
}

/** A fresh temporary directory, removed by the returned disposer. */
export async function tempDir(
  prefix = "m3-test-",
): Promise<{ dir: string; [Symbol.asyncDispose](): Promise<void> }> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  return {
    dir,
    [Symbol.asyncDispose]: () => rm(dir, { recursive: true, force: true }),
  };
}
