// SPDX-License-Identifier: Apache-2.0
/**
 * `bun test` preload shared by the web packages: starts (or attaches to) one engine for the whole
 * run, exports its endpoint as `APHRODY_BROWSER_CDP_URL`, and stops it after the last test file.
 * Registered through `[test] preload` in each package's `bunfig.toml`.
 */
import { afterAll } from "bun:test";
import { ensureTestEngine, stopAllEngines } from "./engine.ts";

// Grace shorter than bun's 5 s hook timeout, so a slow shutdown ends in SIGKILL, not a failed hook.
await ensureTestEngine({ shutdownGraceMs: 2_000 });
afterAll(async () => {
  await stopAllEngines();
});
