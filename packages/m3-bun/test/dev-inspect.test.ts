// SPDX-License-Identifier: Apache-2.0
import { afterAll, describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  launchInspected,
  serveInspectorFrontend,
  type M3ConsoleEntry,
  type M3InspectedException,
} from "../src/dev-inspect.ts";
import { failingApi, loadDevApi } from "../src/dev-error.ts";
import { cleanup, tmp } from "./helpers.ts";

afterAll(cleanup);

const resolvable = (specifier: string): boolean => {
  try {
    Bun.resolveSync(specifier, import.meta.dir);
    return true;
  } catch {
    return false;
  }
};
const hasInspector =
  resolvable("@aphrody/bun-inspector-protocol") &&
  resolvable("@aphrody/bun-debug-adapter-protocol");

const src = (file: string) =>
  JSON.stringify(join(import.meta.dir, "..", "src", file));

describe.skipIf(!hasInspector)(
  "m3-bun dev --inspect (bun-inspector-protocol, bun-debug-adapter-protocol)",
  () => {
    test("the child's console and its uncaught exception are relayed through the inspector", async () => {
      const dir = tmp();
      const program = join(dir, "server.ts");
      writeFileSync(
        program,
        [
          'console.log("ready", { port: 0 }, [1, 2]);',
          'console.warn("careful");',
          'setTimeout(() => { throw new TypeError("kaboom"); }, 1);',
        ].join("\n"),
      );
      const entries: M3ConsoleEntry[] = [];
      const thrown = Promise.withResolvers<M3InspectedException>();
      const inspected = await launchInspected({
        cmd: [process.execPath, program],
        cwd: dir,
        stdio: "ignore",
        onConsole: (entry) => void entries.push(entry),
        onException: (exception) => thrown.resolve(exception),
      });
      try {
        expect(inspected.inspectorUrl).toMatch(
          /^ws:\/\/127\.0\.0\.1:\d+\/\w+$/,
        );
        await inspected.attached;
        const exception = await thrown.promise;
        expect(exception.name).toBe("TypeError");
        expect(exception.message).toBe("kaboom");
        expect(exception.frames[0]).toMatch(/server\.ts:\d+:\d+$/);
        expect(entries.slice(0, 2)).toEqual([
          {
            level: "log",
            text: expect.stringMatching(/^ready .*port.*0.*1.*2/),
          },
          { level: "warning", text: "careful" },
        ]);
        expect(await inspected.child.exited).not.toBe(0);
      } finally {
        await inspected.stop();
      }
    });
  },
);

describe.skipIf(!resolvable("@aphrody/web-inspector-bun"))(
  "Web Inspector frontend (@aphrody/web-inspector-bun)",
  () => {
    test("the WebKit Web Inspector is served on a free port, pointed at the inspector", async () => {
      const frontend = serveInspectorFrontend({
        ws: "ws://127.0.0.1:6499/abc",
      });
      try {
        const url = new URL(frontend.url);
        expect(url.hostname).toBe("127.0.0.1");
        expect(url.pathname).toBe("/index.html");
        expect(url.searchParams.get("ws")).toBe("127.0.0.1:6499/abc");
        const page = await fetch(frontend.url);
        expect(page.status).toBe(200);
        expect(page.headers.get("content-security-policy")).toBeNull();
        expect(await page.text()).toContain("<!DOCTYPE html>");
        const host = await fetch(
          new URL("/Base/BrowserInspectorFrontendHost.js", url),
        );
        expect(await host.text()).toContain('"ws" in queryParams');
      } finally {
        await frontend.stop();
      }
    });
  },
);

describe("API errors in dev go to Bun's error overlay (bun-error)", () => {
  test("an API module that fails to load: the dev server starts and its routes render the overlay", async () => {
    // In a child: inside `bun test`, an error that a dev server reports also fails the running test.
    const dir = tmp();
    writeFileSync(
      join(dir, "api.ts"),
      'throw new Error("api.ts: database url missing");\nexport default {};',
    );
    writeFileSync(
      join(dir, "index.html"),
      "<!doctype html><html><body>ui</body></html>",
    );
    writeFileSync(
      join(dir, "dev.ts"),
      `import { loadDevApi } from ${src("dev-error.ts")};
import { startM3Server } from ${src("server.ts")};
import index from "./index.html";
const api = await loadDevApi(${JSON.stringify(join(dir, "api.ts"))});
const server = startM3Server({ port: 0, hostname: "127.0.0.1", index, api, hmr: false });
const ui = await (await fetch(server.url)).text();
const res = await fetch(new URL("/api/notes", server.url));
console.log(JSON.stringify({ ui, status: res.status, overlay: await res.text() }));
await server.stop(true);
process.exit(0); // a reported handler error would otherwise set exit code 1
`,
    );
    await using child = Bun.spawn([process.execPath, "dev.ts"], {
      windowsHide: true,
      cwd: dir,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, code] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    const result = JSON.parse(stdout.trim().split("\n").at(-1)!) as {
      ui: string;
      status: number;
      overlay: string;
    };
    expect(result.ui).toContain("ui");
    expect(result.status).toBe(500);
    expect(result.overlay).toContain("__bunfallback");
    expect(result.overlay).toContain("Bun__renderFallbackError");
    expect(stderr).toContain("api.ts: database url missing");
    expect(code).toBe(0);
  });

  test("a module that loads is returned as is; failingApi covers the prefix", async () => {
    const dir = tmp();
    const ok = join(dir, "api.ts");
    writeFileSync(ok, 'export default { "/api/a": () => new Response("a") };');
    expect(Object.keys((await loadDevApi(ok)) as object)).toEqual(["/api/a"]);
    const api = failingApi(new Error("x"), "/rpc/") as {
      routes: Record<string, () => never>;
    };
    expect(Object.keys(api.routes)).toEqual(["/rpc", "/rpc/*"]);
    expect(() => api.routes["/rpc"]!()).toThrow("x");
  });
});
