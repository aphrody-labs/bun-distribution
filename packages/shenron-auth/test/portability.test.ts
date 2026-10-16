// Source: packages/shenron/auth/test/portability.test.ts at 8172f535ce (preserved Git history).
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { checkNoEscapingImports, checkPackageRuntimes, listExportEntries } from "@aphrody/bun-workspace/guards";

const pkgDir = fileURLToPath(new URL("..", import.meta.url));

// Native equivalents of the historical process-backed checks. Outputs remain
// in memory; no shared temp directory, subprocess backend or cleanup is used.
async function checkBrowserBundles(directory: string): Promise<string[]> {
  const errors: string[] = [];
  for (const entry of listExportEntries(directory)) {
    if (entry.runtime !== "pure" && entry.runtime !== "react") continue;
    const result = await Bun.build({ entrypoints: [entry.file], target: "browser", external: ["react", "react-dom"] });
    if (!result.success) {
      errors.push(`${entry.subpath}: ${result.logs.join("\n")}`);
      continue;
    }
    for (const output of result.outputs) {
      const match = /["'`](node|bun):[\w/]*["'`]/.exec(await output.text());
      if (match) errors.push(`${entry.subpath}: ${match[0]}`);
    }
  }
  return errors;
}

async function checkEmptyEnvImports(directory: string): Promise<string[]> {
  const errors: string[] = [];
  for (const entry of listExportEntries(directory)) {
    if (entry.declared === "json" || !/\.(?:m|c)?tsx?$/.test(entry.file)) continue;
    const child = Bun.spawn(
      [process.execPath, "-e", `await import(${JSON.stringify(pathToFileURL(entry.file).href)});`],
      {
        cwd: directory,
        env: {
          SystemRoot: process.env.SystemRoot,
          PATH: process.env.PATH,
          TEMP: process.env.TEMP,
          TMP: process.env.TMP,
        },
        stdout: "ignore",
        stderr: "pipe",
        timeout: 10000,
      },
    );
    const stderr = new Response(child.stderr).text();
    if ((await child.exited) !== 0) errors.push(`${entry.subpath}: ${(await stderr).slice(0, 200)}`);
    else await stderr;
  }
  return errors;
}

/** docs/STACK.md §3.3. */
const EXPECTED: Record<string, string> = {
  ".": "server",
  "./origins": "pure",
  "./a2a": "server",
  "./crypto": "server",
  "./tokens": "server",
  "./acting-user": "server",
  "./staff": "pure",
  "./ports": "pure",
  "./guards": "server",
  "./options": "server",
  "./policy": "pure",
  "./agent-keys": "server",
  "./next": "next",
  "./hono": "hono",
  "./client": "react",
  "./rate-limit": "bun",
};

const sources = () =>
  readdirSync(join(pkgDir, "src"))
    .filter(f => f.endsWith(".ts") && !f.endsWith(".test.ts"))
    .map(f => ({ file: f, code: readFileSync(join(pkgDir, "src", f), "utf8") }));

describe("@shenron/auth portability", () => {
  test("every subpath is exported with its runtime class", () => {
    const entries: Record<string, string | null> = Object.fromEntries(
      listExportEntries(pkgDir).map(e => [e.subpath, e.runtime]),
    );
    expect(entries).toEqual(EXPECTED);
  });

  test("runtime classes hold", async () => {
    expect(await checkPackageRuntimes(pkgDir)).toEqual([]);
  });

  test("no @/ alias, no escaping relative import, no env read at load", async () => {
    expect(await checkNoEscapingImports(pkgDir)).toEqual([]);
    expect(await checkEmptyEnvImports(pkgDir)).toEqual([]);
  });

  test("never imports @shenron/db, server-only or an app env module", () => {
    for (const { file, code } of sources()) {
      expect({ file, db: /["']@shenron\/db/.test(code) }).toEqual({ file, db: false });
      expect({ file, so: /["']server-only["']/.test(code) }).toEqual({ file, so: false });
      expect({ file, env: /["'](?:@|~)\/lib\/env["']/.test(code) }).toEqual({ file, env: false });
    }
  });

  test("pure and react subpaths bundle for the browser (./client, ./policy, ./staff, ./ports, ./origins)", async () => {
    expect(await checkBrowserBundles(pkgDir)).toEqual([]);
  }, 180_000);
});
