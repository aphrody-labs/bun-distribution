import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { existsSync } from "node:fs";
import { BrowserRuntime } from "../packages/runtime/src/browser";
import { defaultLibraryPath, Runtime, Status } from "../packages/runtime/src/index";

const required = process.env["YOLO_REQUIRE_BROWSER"] === "1";
let available = false;
if (existsSync(defaultLibraryPath())) {
  using runtime = Runtime.load();
  available = runtime.capabilities().includes("browser.contexts");
}

describe("browser extension capability negotiation", () => {
  it("requires a browser-enabled artifact when qualification is requested", () => {
    if (required) expect(available).toBe(true);
  });
  it("refuses an existing core artifact before binding optional symbols", () => {
    if (existsSync(defaultLibraryPath()) && !available) {
      expect(() => BrowserRuntime.load()).toThrow(/does not provide browser capabilities/);
    }
  });
});

const suite = available ? describe : describe.skip;
suite("precompiled native browser", () => {
  let server: ReturnType<typeof Bun.serve>;
  let denied: ReturnType<typeof Bun.serve>;
  let origin = "";
  let deniedOrigin = "";
  let deniedHits = 0;

  beforeAll(() => {
    denied = Bun.serve({
      port: 0,
      fetch: () => {
        deniedHits++;
        return new Response("outside the allowed context");
      },
    });
    deniedOrigin = `http://127.0.0.1:${denied.port}`;
    server = Bun.serve({
      port: 0,
      async fetch(request) {
        const path = new URL(request.url).pathname;
        if (path === "/slow") {
          await Bun.sleep(1000);
          return new Response("<body>late</body>", { headers: { "content-type": "text/html" } });
        }
        if (path === "/redirect")
          return new Response(null, { status: 302, headers: { location: deniedOrigin } });
        if (path === "/cookie")
          return new Response(request.headers.get("cookie") ?? "", {
            headers: { "content-type": "text/html" },
          });
        return new Response(
          '<!doctype html><html><head><title>Fixture</title><style>body{background:#f00}main{color:#fff}</style></head><body><main id="message">before</main><script>document.getElementById("message").textContent="rendered";globalThis.realmMarker=42;</script></body></html>',
          { headers: { "content-type": "text/html" } },
        );
      },
    });
    origin = `http://127.0.0.1:${server.port}`;
  });
  afterAll(async () => {
    await server.stop(true);
    await denied.stop(true);
  });

  function context(runtime: BrowserRuntime) {
    return runtime.createContext({
      allowedOrigins: [origin],
      allowPrivateNetwork: true,
      width: 320,
      height: 240,
      timeoutMs: 2000,
    });
  }

  it("renders JavaScript, extracts the live DOM and captures a real PNG", async () => {
    using runtime = BrowserRuntime.load();
    using page = context(runtime);
    expect(await page.navigate(origin)).toMatchObject({ url: origin + "/", title: "Fixture" });
    expect((await page.snapshot()).text).toContain("rendered");
    expect(await page.extract("#message")).toEqual(["rendered"]);
    expect(await page.content()).toContain(">rendered</main>");
    const png = await page.screenshot();
    expect(Array.from(png.subarray(0, 8))).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
    expect(view.getUint32(16)).toBe(320);
    expect(view.getUint32(20)).toBe(240);
    expect(png.length).toBeGreaterThan(100);
    const receiptDir = process.env["YOLO_BROWSER_RECEIPT_DIR"];
    if (receiptDir) await Bun.write(receiptDir + "/browser-fixture.png", png);
  });

  it("keeps cookie jars and JavaScript realms isolated", async () => {
    using runtime = BrowserRuntime.load();
    using first = context(runtime);
    using second = context(runtime);
    await first.setCookie(origin, "fixture=first; Path=/");
    expect(await first.cookies(origin)).toBe("fixture=first");
    expect(await second.cookies(origin)).toBe("");
    await first.navigate(origin);
    await second.navigate(origin);
    await first.evaluate("globalThis.realmMarker = 99");
    expect(await second.evaluate<number>("globalThis.realmMarker")).toBe(42);
    await first.navigate(origin + "/cookie");
    expect((await first.snapshot()).text).toContain("fixture=first");
    await second.navigate(origin + "/cookie");
    expect((await second.snapshot()).text).not.toContain("fixture=first");
    await first.clearCookies();
    expect(await first.cookies(origin)).toBe("");
  });

  it("enforces origins natively for caller navigation, redirects and page fetches", async () => {
    using runtime = BrowserRuntime.load();
    using page = context(runtime);
    const hits = deniedHits;
    await expect(page.navigate(deniedOrigin)).rejects.toMatchObject({
      status: Status.InvalidArgument,
    });
    await expect(page.navigate("file:///etc/passwd")).rejects.toMatchObject({
      status: Status.InvalidArgument,
    });
    await expect(page.navigate(origin + "/redirect")).rejects.toThrow(
      /navigation failed or was denied/,
    );
    await page.navigate(origin);
    expect(
      await page.evaluate<string>(
        `fetch(${JSON.stringify(deniedOrigin)}).then(() => "leaked").catch(() => "blocked")`,
      ),
    ).toBe("blocked");
    expect(
      await page.evaluate<string>(
        `fetch(${JSON.stringify(deniedOrigin)}, {method:"POST",headers:{"X-Fixture":"preflight"}}).then(() => "leaked").catch(() => "blocked")`,
      ),
    ).toBe("blocked");
    expect(
      await page.evaluate<string>(
        `fetch(${JSON.stringify(origin + "/redirect")}).then(() => "leaked").catch(() => "blocked")`,
      ),
    ).toBe("blocked");
    expect(
      await page.evaluate<string>(
        `new Promise(resolve => { const xhr = new XMLHttpRequest(); xhr.open("GET", ${JSON.stringify(deniedOrigin)}); xhr.onload = () => resolve("leaked"); xhr.onerror = () => resolve("blocked"); xhr.send(); })`,
      ),
    ).toBe("blocked");
    await expect(
      page.evaluate<string>(`location.href = ${JSON.stringify(deniedOrigin)}`),
    ).rejects.toThrow(/outside this context/);
    expect(deniedHits).toBe(hits);
    expect(
      await page.evaluate<string>(
        "JSON.stringify([typeof Bun,typeof process,typeof require,typeof __TAURI_INTERNALS__])",
      ),
    ).toBe('["undefined","undefined","undefined","undefined"]');
  });

  it("bounds synchronous V8 work and restores a usable context afterward", async () => {
    using runtime = BrowserRuntime.load();
    using page = runtime.createContext({
      allowedOrigins: [origin],
      allowPrivateNetwork: true,
      timeoutMs: 200,
    });
    await page.navigate(origin);
    await expect(page.evaluate<string>("while (true) {}")).rejects.toThrow(/deadline|timed out/);
    expect(await page.evaluate<number>("1+1")).toBe(2);
  });

  it("refuses private-network access without its explicit native opt-in", async () => {
    using runtime = BrowserRuntime.load();
    using page = runtime.createContext({ allowedOrigins: [origin], timeoutMs: 1000 });
    await expect(page.navigate(origin)).rejects.toThrow(
      /outside this context|navigation failed or was denied/,
    );
  });

  it("cancels in-flight navigation and permits the next operation", async () => {
    using runtime = BrowserRuntime.load();
    using page = context(runtime);
    const controller = new AbortController();
    const pending = page.navigate(origin + "/slow", { signal: controller.signal });
    setTimeout(() => controller.abort(new Error("fixture abort")), 20);
    await expect(pending).rejects.toThrow("fixture abort");
    expect((await page.navigate(origin)).title).toBe("Fixture");
    await expect(
      page.navigate(origin, { signal: AbortSignal.abort(new Error("already aborted")) }),
    ).rejects.toThrow("already aborted");
  });

  it("rejects concurrent operations instead of creating an unbounded queue", async () => {
    using runtime = BrowserRuntime.load();
    using page = context(runtime);
    const pending = page.navigate(origin + "/slow");
    await expect(page.snapshot()).rejects.toMatchObject({ status: Status.Busy });
    await pending;
  });

  it("enforces result budgets without silent truncation and propagates JS failures", async () => {
    using runtime = BrowserRuntime.load();
    using page = runtime.createContext({
      allowedOrigins: [origin],
      allowPrivateNetwork: true,
      maxResultBytes: 128,
    });
    await page.navigate(origin);
    await expect(page.evaluate<string>("'x'.repeat(1000)")).rejects.toThrow(/byte budget/);
    await expect(page.evaluate<string>("throw new Error('fixture')")).rejects.toThrow(
      /JavaScript threw or rejected/,
    );
    expect(await page.evaluate<number>("1+1")).toBe(2);
  });

  it("joins contexts on close and rejects handles after owner destruction", async () => {
    const runtime = BrowserRuntime.load();
    const page = context(runtime);
    const pending = page.navigate(origin + "/slow");
    page.close();
    await expect(pending).rejects.toThrow();
    expect(page.closed).toBe(true);
    await expect(page.snapshot()).rejects.toThrow(/closed/);
    const other = context(runtime);
    await other.navigate(origin);
    runtime.close();
    expect(other.closed).toBe(true);
    await expect(other.extract("main")).rejects.toThrow(/closed/);
    other.close();
    runtime.close();
  });
});
