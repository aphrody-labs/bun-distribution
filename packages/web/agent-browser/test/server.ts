// SPDX-License-Identifier: Apache-2.0
// Kept for the existing `import "./server.ts"` call sites: the engine itself is owned by
// `src/engine.ts`, and the package `bunfig.toml` preload stops it after the last test file.
import { ensureTestEngine } from "../src/engine.ts";

await ensureTestEngine();
