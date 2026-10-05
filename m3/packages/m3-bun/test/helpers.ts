// SPDX-License-Identifier: Apache-2.0
import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const FIXTURE = join(import.meta.dir, "fixtures/app");

const made: string[] = [];

/** A throwaway directory, removed by `cleanup()` (call it in `afterAll`). */
export function tmp(prefix = "m3-bun-test-"): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  made.push(dir);
  return dir;
}

/** A copy of the fixture app inside the repository (so workspace packages resolve), removed by `cleanup()`. */
export function fixtureCopy(): string {
  const dir = mkdtempSync(join(import.meta.dir, "fixtures", ".copy-"));
  cpSync(FIXTURE, dir, { recursive: true, filter: (src) => !/\/(dist|bin|release|node_modules|\.copy-[^/]*)(\/|$)/.test(src) });
  made.push(dir);
  return dir;
}

export function cleanup(): void {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
}

/** A port that is free right now. */
export function freePort(): number {
  const server = Bun.serve({ port: 0, fetch: () => new Response("") });
  const { port } = server;
  void server.stop(true);
  return port as number;
}
