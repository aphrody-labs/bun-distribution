// SPDX-License-Identifier: Apache-2.0
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AgentBrowser } from "../src/client.ts";
import {
  DISCOVERY_SCHEMA,
  DOM_SNAPSHOT_SCRIPT,
  TauriBridge,
  listTauriApps,
  parseDiscovery,
  tauriDebugDir,
} from "../src/tauri.ts";

const TOKEN = "t".repeat(48);
let dir: string;
let server: ReturnType<typeof Bun.serve>;
let seenCommands: string[] = [];

function discovery(overrides: Record<string, unknown> = {}) {
  return {
    schema: DISCOVERY_SCHEMA,
    pid: process.pid,
    exe: "model-view",
    ws: `ws://127.0.0.1:${server.port}`,
    host: "127.0.0.1",
    port: server.port,
    token: TOKEN,
    startedAtMs: 10,
    tauri: "3.0.0-alpha.3",
    bridge: "test",
    ...overrides,
  };
}

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "aphrody-tauri-debug-"));
  server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request, srv) {
      const url = new URL(request.url);
      if (url.searchParams.get("token") !== TOKEN)
        return new Response("forbidden", { status: 403 });
      return srv.upgrade(request, { data: undefined })
        ? undefined
        : new Response("upgrade required", { status: 426 });
    },
    websocket: {
      message(socket, raw) {
        const request = JSON.parse(String(raw)) as {
          id: string;
          command: string;
          args: Record<string, unknown>;
        };
        seenCommands.push(request.command);
        const ok = (data: unknown) =>
          socket.send(JSON.stringify({ id: request.id, success: true, data }));
        if (request.command === "list_windows")
          ok([
            {
              label: "main",
              title: "aphrody model",
              url: "tauri://localhost/",
              focused: true,
              visible: true,
              isMain: true,
            },
          ]);
        else if (request.command === "execute_js")
          ok(request.args.script === "boom" ? undefined : { echoed: request.args.script });
        else if (request.command === "slow") return;
        else
          socket.send(
            JSON.stringify({
              id: request.id,
              success: false,
              error: `unsupported ${request.command}`,
            }),
          );
      },
    },
  });
});

afterAll(() => {
  server.stop(true);
  rmSync(dir, { recursive: true, force: true });
});

describe("tauri debug discovery", () => {
  test("directory honours APHRODY_HOME and falls back to ~/.aphrody", () => {
    expect(tauriDebugDir({ APHRODY_HOME: "/data/aph" }, "/home/u")).toBe(
      "/data/aph/web/tauri-debug",
    );
    expect(tauriDebugDir({}, "/home/u")).toBe("/home/u/.aphrody/web/tauri-debug");
  });

  test("parseDiscovery accepts only the documented loopback schema", () => {
    expect(parseDiscovery(discovery(), "f")?.port).toBe(server.port);
    expect(parseDiscovery({ ...discovery(), schema: "other" }, "f")).toBeNull();
    expect(parseDiscovery({ ...discovery(), host: "10.0.0.5" }, "f")).toBeNull();
    expect(parseDiscovery({ ...discovery(), token: 5 }, "f")).toBeNull();
    expect(parseDiscovery(null, "f")).toBeNull();
  });

  test("listTauriApps skips dead processes, junk files and temp files, newest first", () => {
    writeFileSync(join(dir, "a-1.json"), JSON.stringify(discovery({ pid: 1, startedAtMs: 5 })));
    writeFileSync(join(dir, "b-2.json"), JSON.stringify(discovery({ pid: 2, startedAtMs: 9 })));
    writeFileSync(join(dir, "dead-3.json"), JSON.stringify(discovery({ pid: 3, startedAtMs: 99 })));
    writeFileSync(join(dir, "junk.json"), "not json");
    writeFileSync(join(dir, ".tmp-4.json"), JSON.stringify(discovery({ pid: 4 })));
    const apps = listTauriApps({ dir, alive: (pid) => pid !== 3 });
    expect(apps.map((app) => app.pid)).toEqual([2, 1]);
    expect(listTauriApps({ dir: join(dir, "missing") })).toEqual([]);
  });
});

describe("TauriBridge against a fake bridge", () => {
  test("lists windows and evaluates scripts with the token in the URL", async () => {
    const app = parseDiscovery(discovery(), "f")!;
    const bridge = await TauriBridge.connect(app);
    try {
      const windows = await bridge.listWindows();
      expect(windows[0]).toMatchObject({ label: "main", isMain: true });
      expect(await bridge.evaluate<{ echoed: string }>("1 + 1")).toEqual({ echoed: "1 + 1" });
      await expect(bridge.request("nope")).rejects.toThrow(/unsupported nope/);
      await expect(bridge.request("slow", {}, 80)).rejects.toThrow(/timed out/);
      expect(seenCommands).toContain("execute_js");
    } finally {
      bridge.close();
    }
  });

  test("a wrong token and a non-loopback URL are refused", async () => {
    await expect(
      TauriBridge.connect(`ws://127.0.0.1:${server.port}/?token=wrong`, 2_000),
    ).rejects.toThrow(/unavailable|rejected/);
    await expect(TauriBridge.connect("ws://example.com:9/?token=x")).rejects.toThrow(
      /non-loopback/,
    );
  });
});

describe("DOM snapshot script", () => {
  test("runs in the aphrody-web engine and reports roles, names and test ids", async () => {
    const fixture = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: () =>
        new Response(
          `<!doctype html><html lang="fr"><head><title>Tauri fixture</title></head><body><header><nav aria-label="Principal"><a href="/a">Accueil</a></nav></header><main><h1>Titre</h1><button data-testid="go">Go</button><input aria-label="Nom"></main></body></html>`,
          { headers: { "content-type": "text/html" } },
        ),
    });
    const page = await AgentBrowser.open(`http://127.0.0.1:${fixture.port}/`);
    try {
      const snapshot = await page.evaluate<{
        title: string;
        lang: string;
        tree: { role: string | null; name: string; testId: string | null }[];
      }>(
        `(() => { ${DOM_SNAPSHOT_SCRIPT.replace(/^\s*/, "").replace(/\breturn \{/, "return {")} })()`,
      );
      expect(snapshot.title).toBe("Tauri fixture");
      expect(snapshot.lang).toBe("fr");
      const roles = snapshot.tree.map((node) => `${node.role}:${node.name}`);
      expect(roles).toContain("navigation:Principal");
      expect(roles).toContain("link:Accueil");
      expect(roles).toContain("heading:Titre");
      expect(roles).toContain("textbox:Nom");
      expect(snapshot.tree.find((node) => node.testId === "go")?.role).toBe("button");
    } finally {
      await page.close();
      fixture.stop(true);
    }
  });
});
