#!/usr/bin/env bun
// SPDX-License-Identifier: Apache-2.0
// Deprecated 2026-10-07: compatibility entrypoint; Yolo owns the implementation.
import { runForge } from "@aphrody/yolo-cli/forge";
export { runForge };
if (import.meta.main) {
  const compiled = Bun.main.startsWith("/$bunfs/") || Bun.main.startsWith("B:/~BUN/");
  const command = compiled ? process.execPath : `${Bun.which("bun") ?? "bun"} ${Bun.main}`;
  process.exitCode = await runForge(Bun.argv.slice(2), command);
}
