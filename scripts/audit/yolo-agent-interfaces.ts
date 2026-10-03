// SPDX-License-Identifier: Apache-2.0
// Consumer qualification against an explicitly selected existing Yolo checkout.
// Synthetic fixtures only: this probe never reads a protected store or real token.
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

interface ApiModule {
  createApiServer(options: { port: number; rootDir: string }): Bun.Server<unknown>;
}

export async function audit(yoloRoot: string) {
  const started = performance.now();
  const api = (await import(
    pathToFileURL(join(yoloRoot, "apps/cli/src/api.ts")).href
  )) as ApiModule;
  const fixture = await mkdtemp(join(tmpdir(), "aphrody-yolo-interface-"));
  const root = join(fixture, "allowed");
  await mkdir(root);
  const symbol = "aphrodyOutsideAuditSentinel";
  await writeFile(join(fixture, "outside.ts"), `export function ${symbol}() { return 1; }\n`);
  const server = api.createApiServer({ port: 0, rootDir: root });
  try {
    const response = await fetch(`http://127.0.0.1:${server.port}/api/parse`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "https://example.invalid" },
      body: JSON.stringify({ path: "../outside.ts" }),
    });
    const content = await response.text();
    const findings = [];
    if (response.ok && content.includes(symbol)) {
      findings.push({
        code: "OUTSIDE_ROOT_METADATA_ACCESS",
        source: "apps/cli/src/mcp.ts",
        operation: "yolo_parse",
      });
    }
    if (response.headers.get("Access-Control-Allow-Origin") === "*") {
      findings.push({
        code: "ARBITRARY_BROWSER_ORIGIN_ALLOWED",
        source: "apps/cli/src/api.ts",
        origin: "https://example.invalid",
      });
    }
    return {
      schemaVersion: 1,
      scope: "synthetic HTTP parse fixture; no protected data or live browser used",
      success: findings.length === 0,
      elapsedMs: performance.now() - started,
      httpStatus: response.status,
      findings,
    };
  } finally {
    server.stop(true);
    await rm(fixture, { recursive: true, force: true });
  }
}

if (import.meta.main) {
  try {
    const yoloRoot = process.argv[2];
    if (!yoloRoot) {
      console.log(
        JSON.stringify({
          schemaVersion: 1,
          success: false,
          error: "missing_yolo_root",
          usage: "bun scripts/audit/yolo-agent-interfaces.ts <existing-yolo-root>",
        }),
      );
      process.exitCode = 2;
    } else {
      const result = await audit(resolve(yoloRoot));
      console.log(JSON.stringify(result, null, 2));
      process.exitCode = result.success ? 0 : 1;
    }
  } catch {
    console.log(JSON.stringify({ schemaVersion: 1, success: false, error: "audit_failed" }));
    process.exitCode = 2;
  }
}
