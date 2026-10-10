// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "bun:test";
import { Runtime } from "@aphrody/runtime-sdk";
import { RuntimeWebSession } from "../src/runtime";

let available = false;
try {
  using runtime = Runtime.load();
  available = runtime.capabilities().includes("browser.contexts");
} catch {
  // Ordinary client suites can run without an installed native runtime.
}

it("requires the native browser provider for an explicitly requested product qualification", () => {
  if (process.env.YOLO_REQUIRE_BROWSER === "1") expect(available).toBe(true);
});

const suite = available ? describe : describe.skip;
suite("Aphrody product consumes the precompiled native browser", () => {
  it("navigates, extracts rendered text, captures and preserves per-page sessions", async () => {
    const server = Bun.serve({
      port: 0,
      fetch(request) {
        const cookie = request.headers.get("cookie") ?? "";
        return new Response(
          `<!doctype html><title>Product fixture</title><main id="result">initial</main><div id="cookie">${cookie}</div><script>document.getElementById("result").textContent="Product rendered";</script>`,
          { headers: { "content-type": "text/html" } },
        );
      },
    });
    const origin = `http://127.0.0.1:${server.port}`;
    try {
      using session = RuntimeWebSession.load();
      using accountA = await session.openPage(origin, {
        allowPrivateNetwork: true,
        width: 256,
        height: 128,
      });
      using accountB = await session.openPage(origin, { allowPrivateNetwork: true });
      expect(accountA.url()).toBe(origin + "/");
      expect((await accountA.snapshot()).title).toBe("Product fixture");
      expect(await accountA.extract("#result")).toEqual(["Product rendered"]);
      expect(await accountA.content()).toContain("Product rendered");
      expect(Array.from((await accountA.capture()).subarray(0, 8))).toEqual([
        137, 80, 78, 71, 13, 10, 26, 10,
      ]);
      await accountA.setCookie(origin, "productSession=A; Path=/");
      await accountA.navigate(origin);
      await accountB.navigate(origin);
      expect(await accountA.extract("#cookie")).toEqual(["productSession=A"]);
      expect(await accountB.extract("#cookie")).toEqual([""]);
      await expect(accountA.navigate("https://outside.test")).rejects.toThrow(
        /outside this context/,
      );
      expect(await accountB.cookies(origin)).toBe("");
    } finally {
      await server.stop(true);
    }
  });

  it("recovers after cancellation and closes all pages on session destruction", async () => {
    const server = Bun.serve({
      port: 0,
      async fetch(request) {
        if (new URL(request.url).pathname === "/slow") await Bun.sleep(1000);
        return new Response("<title>Recovered</title><body>ready</body>", {
          headers: { "content-type": "text/html" },
        });
      },
    });
    const origin = `http://127.0.0.1:${server.port}`;
    const session = RuntimeWebSession.load();
    try {
      const abort = new AbortController();
      const loading = session.openPage(origin + "/slow", {
        allowPrivateNetwork: true,
        signal: abort.signal,
      });
      setTimeout(() => abort.abort(new Error("product cancellation")), 20);
      await expect(loading).rejects.toThrow("product cancellation");
      const page = await session.openPage(origin, { allowPrivateNetwork: true });
      expect((await page.snapshot()).text).toContain("ready");
      session.close();
      expect(session.closed).toBe(true);
      expect(page.closed).toBe(true);
      await expect(page.capture()).rejects.toThrow(/closed/);
      page.close();
    } finally {
      session.close();
      await server.stop(true);
    }
  });
});
