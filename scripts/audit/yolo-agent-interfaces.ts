// SPDX-License-Identifier: Apache-2.0
// Consumer qualification against an explicitly selected existing Yolo checkout.
// Synthetic fixtures only: this probe never reads a protected store or real token.
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
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
  const insideSymbol = "aphrodyInsideAuditSentinel";
  await writeFile(join(fixture, "outside.ts"), `export function ${symbol}() { return 1; }\n`);
  await writeFile(join(root, "inside.ts"), `export function ${insideSymbol}() { return 1; }\n`);
  await symlink(join(fixture, "outside.ts"), join(root, "linked.ts"));
  const server = api.createApiServer({ port: 0, rootDir: root });
  try {
    const cases = [
      { id: "inside_control", path: "inside.ts", sentinel: insideSymbol },
      { id: "parent_traversal", path: "../outside.ts", sentinel: symbol },
      { id: "symlink_escape", path: "linked.ts", sentinel: symbol },
      {
        id: "external_origin",
        path: "inside.ts",
        sentinel: insideSymbol,
        origin: "https://example.invalid",
      },
      {
        id: "authority_confusion",
        path: "inside.ts",
        sentinel: insideSymbol,
        origin: "http://localhost:1234@example.invalid",
      },
    ];
    const checks = await Promise.all(
      cases.map(async (probe) => {
        const response = await fetch(`http://127.0.0.1:${server.port}/api/parse`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(probe.origin ? { Origin: probe.origin } : {}),
          },
          body: JSON.stringify({ path: probe.path }),
        });
        const content = await response.text();
        return {
          id: probe.id,
          httpStatus: response.status,
          sentinelReturned: response.ok && content.includes(probe.sentinel),
          allowOrigin: response.headers.get("Access-Control-Allow-Origin"),
        };
      }),
    );
    if (!checks[0]?.sentinelReturned) throw new Error("inside_control_failed");
    const findings = checks.flatMap((check) => {
      if (check.id === "inside_control") return [];
      if (check.id === "parent_traversal" || check.id === "symlink_escape") {
        return check.sentinelReturned
          ? [{ code: "OUTSIDE_ROOT_METADATA_ACCESS", check: check.id }]
          : [];
      }
      return check.sentinelReturned && check.allowOrigin
        ? [
            {
              code:
                check.id === "authority_confusion"
                  ? "MALFORMED_ORIGIN_REFLECTED"
                  : "ARBITRARY_BROWSER_ORIGIN_ALLOWED",
              check: check.id,
            },
          ]
        : [];
    });
    return {
      schemaVersion: 1,
      scope:
        "synthetic HTTP parse positive control, parent traversal, symlink and origin fixtures; no protected data or live browser used; not full protocol conformance",
      success: findings.length === 0,
      elapsedMs: performance.now() - started,
      checks,
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
