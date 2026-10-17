// SPDX-License-Identifier: Apache-2.0
import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { launch, runtimeSdkPath, smoke } from "../src/runtime.ts";
import { cleanup, freePort, tmp } from "./helpers.ts";

afterAll(cleanup);

const SERVER = `const port = Number(Bun.env.PORT);
Bun.serve({ port, fetch: (req) => new URL(req.url).pathname === "/healthz" ? Response.json({ ok: true }) : new Response("<html></html>", { headers: { "content-type": "text/html" } }) });
setInterval(() => {}, 1 << 30);
`;

function script(): string {
  const file = join(tmp(), "server.ts");
  writeFileSync(file, SERVER);
  return file;
}

describe("runtimeSdkPath", () => {
  test("resolves the SDK from the selected Bun checkout", () => {
    expect(runtimeSdkPath("/definitely/not/bun")).toBeUndefined();
    const root = tmp();
    const source = join(root, "packages/bun-runtime-sdk/src");
    mkdirSync(source, { recursive: true });
    const entry = join(source, "index.ts");
    writeFileSync(entry, "export const Runtime = {};\n");
    expect(runtimeSdkPath(root)).toBe(entry);
    const sdk = runtimeSdkPath();
    if (sdk) expect(sdk.endsWith("index.ts") || sdk.endsWith("runtime-sdk.ts")).toBe(true);
  });
});

describe("launch", () => {
  test("starts a process, waits for its HTTP port, stops it, and says how", async () => {
    const port = freePort();
    const child = await launch(process.execPath, {
      args: [script()],
      port,
      env: { PORT: String(port) },
    });
    try {
      expect(["buv-runtime", "bun-spawn"]).toContain(child.via);
      expect(child.readyStatus).toBe(200);
      expect(child.pid).toBeGreaterThan(0);
      expect((await fetch(`http://127.0.0.1:${port}/healthz`)).status).toBe(200);
    } finally {
      const stopped = await child.stop();
      expect(stopped).toHaveProperty("exitCode");
    }
    await expect(fetch(`http://127.0.0.1:${port}/healthz`)).rejects.toBeDefined();
  }, 30_000);

  test("a process that never listens fails within the timeout and does not linger", async () => {
    const file = join(tmp(), "idle.ts");
    writeFileSync(file, "setInterval(() => {}, 1 << 30);\n");
    const started = Date.now();
    await expect(
      launch(process.execPath, {
        args: [file],
        port: freePort(),
        timeoutMs: 600,
      }),
    ).rejects.toBeDefined();
    expect(Date.now() - started).toBeLessThan(5000);
  }, 30_000);
});

describe("smoke", () => {
  test("GETs each path, checks status and content type, reports ok", async () => {
    const port = freePort();
    // `launch` runs the program with the given args; a tiny wrapper script makes a runnable "executable".
    const wrapper = join(tmp(), process.platform === "win32" ? "run.exe" : "run.sh");
    if (process.platform === "win32") {
      const compiled = Bun.spawnSync([process.execPath, "build", "--compile", script(), "--outfile", wrapper], {
        windowsHide: true,
        stdout: "pipe",
        stderr: "pipe",
      });
      expect(compiled.stderr.toString()).not.toContain("error");
    } else {
      writeFileSync(wrapper, `#!/bin/sh\nexec ${process.execPath} ${script()}\n`, { mode: 0o755 });
    }
    const report = await smoke(wrapper, port, ["/", "/healthz"], {
      "/": "text/html",
      "/healthz": "application/json",
    });
    expect(report.ok).toBe(true);
    expect(report.checks.map(c => [c.path, c.status])).toEqual([
      ["/", 200],
      ["/healthz", 200],
    ]);
    const wrong = await smoke(wrapper, freePort(), ["/"], {
      "/": "application/json",
    });
    expect(wrong.ok).toBe(false);
  }, 30_000);
});
