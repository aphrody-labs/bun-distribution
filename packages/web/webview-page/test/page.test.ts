// SPDX-License-Identifier: Apache-2.0
import { beforeEach, describe, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { browserFrom, globToRegExp, Page, type WebViewLike } from "../src/index.ts";

const HTML = `
<a href="#/overview" data-testid="nav-overview" aria-current="page">Overview</a>
<a href="#/forms" data-testid="nav-forms">Forms</a>
<main>
  <h1>Forms page</h1>
  <label for="name">Display name *</label><input id="name" type="text" />
  <label><input type="checkbox" id="ok" /> These are local sample values</label>
  <select aria-label="Colour mode"><option value="light">Light</option><option value="dark">Dark</option></select>
  <button type="button" id="send">Send</button>
  <button type="button" id="stop" disabled>Stop</button>
  <table role="grid"><tbody>
    <tr><td>Material notes.md</td><td><button>Unstar</button></td></tr>
    <tr><td>People</td><td><button>Star</button></td></tr>
  </tbody></table>
  <p role="status">Ready</p>
  <div aria-hidden="true"><button>Hidden</button></div>
</main>
<aside>Hello Ada</aside>`;

class FakeView extends EventTarget implements WebViewLike {
  url = "";
  title = "Forms";
  window = new Window({ url: "http://localhost/" });
  calls: [string, unknown][] = [];
  clicked: string[] = [];
  pressed: string[] = [];
  constructor() {
    super();
    this.window.document.body.innerHTML = HTML;
    this.window.document.querySelector("#send")!.addEventListener("click", () => {
      this.window.document.querySelector("p")!.textContent = "Sent";
    });
  }
  async navigate(url: string) {
    this.url = url;
  }
  async reload() {}
  async evaluate(script: string) {
    const run = new Function("document", "window", `return (${script});`);
    return await run(this.window.document, this.window);
  }
  async screenshot() {
    return new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
  }
  async click(selector: string | number) {
    this.clicked.push(String(selector));
    (this.window.document.querySelector(String(selector)) as unknown as HTMLElement).click();
  }
  async press(key: string) {
    this.pressed.push(key);
  }
  async resize() {}
  async cdp(method: string, params?: Record<string, unknown>) {
    this.calls.push([method, params]);
    if (method === "Browser.getVersion") return { product: "HeadlessChrome/0" };
    if (method === "Network.getCookies") return { cookies: [{ name: "m3-theme", value: "light" }] };
    return {};
  }
  close() {}
  emit(type: string, data: unknown) {
    const event = new Event(type) as Event & { data: unknown };
    event.data = data;
    this.dispatchEvent(event);
  }
}

let view: FakeView;
let page: Page;
beforeEach(async () => {
  view = new FakeView();
  page = new Page(view, {
    colorScheme: "dark",
    reducedMotion: "reduce",
    locale: "en-US",
    timezoneId: "UTC",
  });
  page.setDefaultTimeout(300);
  await page.init();
});

describe("locators", () => {
  test("test id, role with name, text, label and counts", async () => {
    expect(await page.getByTestId("nav-forms").getAttribute("href")).toBe("#/forms");
    expect(await page.getByTestId("nav-overview").getAttribute("aria-current")).toBe("page");
    expect(await page.getByRole("button", { name: "Send", exact: true }).count()).toBe(1);
    expect(await page.getByRole("button", { name: "Hidden" }).count()).toBe(0); // aria-hidden subtree
    expect(await page.getByRole("button", { name: /^Un/ }).count()).toBe(1);
    expect(await page.getByRole("link", { name: "overview" }).count()).toBe(1); // case-insensitive substring
    expect(await page.getByRole("link", { name: "overview", exact: true }).count()).toBe(0);
    expect(await page.getByText("Enter a name", { exact: true }).count()).toBe(0);
    expect(await page.getByText("Hello Ada").count()).toBe(1);
    expect(await page.locator("h1").count()).toBe(1);
    expect(await page.locator("main h1").innerText()).toMatch(/Forms page/);
  });

  test("labels, checkboxes, inputs and selects", async () => {
    const name = page.getByLabel(/Display name/);
    await name.fill("Ada");
    expect(await name.inputValue()).toBe("Ada");
    const ok = page.getByLabel("These are local sample values");
    expect(await ok.isChecked()).toBe(false);
    await ok.check();
    expect(await ok.isChecked()).toBe(true);
    await ok.uncheck();
    expect(await ok.isChecked()).toBe(false);
    const mode = page.getByRole("combobox", { name: "Colour mode", exact: true });
    await mode.selectOption("dark");
    expect(await mode.inputValue()).toBe("dark");
  });

  test("filter, scoping, first/nth and enabled state", async () => {
    const row = page.getByRole("row").filter({ hasText: "Material notes.md" });
    expect(await row.count()).toBe(1);
    expect(await row.getByRole("button", { name: "Unstar", exact: true }).count()).toBe(1);
    expect(await row.getByRole("button", { name: "Star", exact: true }).count()).toBe(0);
    expect(await page.getByRole("row").nth(1).textContent()).toContain("People");
    expect(
      await page
        .getByRole("button")
        .first()
        .evaluate((el) => el.tagName),
    ).toBe("BUTTON");
    expect(await page.getByRole("button", { name: "Send", exact: true }).isEnabled()).toBe(true);
    expect(await page.getByRole("button", { name: "Stop", exact: true }).isEnabled()).toBe(false);
  });

  test("click goes through the view with a temporary target marker", async () => {
    await page.getByRole("button", { name: "Send", exact: true }).click();
    expect(view.clicked).toHaveLength(1);
    expect(view.clicked[0]).toMatch(/^\[data-wvp-target="/);
    expect(await page.locator("p").textContent()).toBe("Sent");
    expect(view.window.document.querySelector("[data-wvp-target]")).toBeNull();
  });

  test("waitFor attached/detached/visible/hidden and timeouts", async () => {
    await page.getByRole("button", { name: "Send", exact: true }).waitFor({ state: "attached" });
    await page.getByRole("button", { name: "Missing", exact: true }).waitFor({ state: "detached" });
    await page.getByRole("button", { name: "Missing" }).waitFor({ state: "hidden" });
    await expect(
      page.getByRole("button", { name: "Missing" }).waitFor({ timeout: 80 }),
    ).rejects.toThrow("Timeout 80ms");
    await expect(
      page.getByRole("button", { name: "Missing" }).click({ timeout: 80 }),
    ).rejects.toThrow("Timeout");
  });
});

describe("page", () => {
  test("evaluate, waitForFunction with arguments and title", async () => {
    expect(await page.evaluate(() => document.querySelectorAll("h1").length)).toBe(1);
    expect(await page.evaluate((id: string) => document.getElementById(id)?.tagName, "send")).toBe(
      "BUTTON",
    );
    await page.waitForFunction(
      ({ selector, text }: { selector: string; text: string }) =>
        document.querySelector(selector)?.textContent?.includes(text),
      { selector: "aside", text: "Ada" },
    );
    await expect(page.waitForFunction(() => false, undefined, { timeout: 60 })).rejects.toThrow(
      "Timeout 60ms",
    );
    expect(await page.title()).toBe("");
  });

  test("emulation is applied once through CDP", () => {
    const methods = view.calls.map(([method]) => method);
    expect(methods).toEqual(
      expect.arrayContaining([
        "Network.enable",
        "Runtime.enable",
        "Emulation.setEmulatedMedia",
        "Emulation.setLocaleOverride",
        "Emulation.setTimezoneOverride",
      ]),
    );
    const media = view.calls.find(([method]) => method === "Emulation.setEmulatedMedia")![1] as {
      features: { name: string; value: string }[];
    };
    expect(media.features).toEqual([
      { name: "prefers-color-scheme", value: "dark" },
      { name: "prefers-reduced-motion", value: "reduce" },
    ]);
  });

  test("keyboard maps a space character to the Space key", async () => {
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press(" ");
    expect(view.pressed).toEqual(["ArrowRight", "Space"]);
  });

  test("goto waits for network idle", async () => {
    const started = Date.now();
    const done = page.goto("http://localhost:3300/", { waitUntil: "networkidle", timeout: 3000 });
    view.emit("Network.requestWillBeSent", { requestId: "1" });
    setTimeout(() => view.emit("Network.loadingFinished", { requestId: "1" }), 100);
    await done;
    expect(Date.now() - started).toBeGreaterThanOrEqual(550);
    expect(page.url()).toBe("http://localhost:3300/");
  });

  test("console, pageerror and response events", () => {
    const seen: string[] = [];
    page.on("console", (message) => seen.push(`${message.type()}:${message.text()}`));
    page.on("pageerror", (error) => seen.push(`error:${error.message}`));
    page.on("response", (response) => seen.push(`${response.status()} ${response.url()}`));
    page.emitConsole("error", "boom");
    view.emit("Runtime.exceptionThrown", {
      exceptionDetails: { text: "Uncaught", exception: { description: "TypeError: x\n    at y" } },
    });
    view.emit("Network.responseReceived", { response: { status: 404, url: "http://localhost/x" } });
    expect(seen).toEqual(["error:boom", "error:TypeError: x", "404 http://localhost/x"]);
  });

  test("routes continue same-origin requests and abort external ones", async () => {
    const external: string[] = [];
    await page.route("**/*", async (route) => {
      const url = new URL(route.request().url());
      if (url.origin === "http://localhost:3300") await route.continue();
      else {
        external.push(url.origin);
        await route.abort();
      }
    });
    view.emit("Fetch.requestPaused", {
      requestId: "a",
      request: { url: "http://localhost:3300/app.js", method: "GET" },
    });
    view.emit("Fetch.requestPaused", {
      requestId: "b",
      request: { url: "https://cdn.example/x.js", method: "GET" },
    });
    await Bun.sleep(30);
    expect(view.calls.filter(([method]) => method.startsWith("Fetch."))).toEqual([
      ["Fetch.enable", { patterns: [{ urlPattern: "*" }] }],
      ["Fetch.continueRequest", { requestId: "a" }],
      ["Fetch.failRequest", { requestId: "b", errorReason: "BlockedByClient" }],
    ]);
    expect(external).toEqual(["https://cdn.example"]);
  });

  test("unhandled paused requests are continued", async () => {
    await page.route("**/never", () => undefined);
    view.emit("Fetch.requestPaused", {
      requestId: "c",
      request: { url: "http://localhost/other", method: "GET" },
    });
    await Bun.sleep(30);
    expect(view.calls.at(-1)).toEqual(["Fetch.continueRequest", { requestId: "c" }]);
  });

  test("screenshot writes the file and returns the bytes", async () => {
    const path = `${import.meta.dir}/.shot.png`;
    const bytes = await page.screenshot({ path, animations: "disabled", caret: "hide" });
    expect([...bytes]).toEqual([0x89, 0x50, 0x4e, 0x47]);
    expect(await Bun.file(path).exists()).toBe(true);
    await Bun.file(path).delete();
    expect(view.window.document.querySelector("style[data-wvp-screenshot]")?.textContent).toContain(
      "animation:none",
    );
  });

  test("cookies through the context", async () => {
    expect(await page.context().cookies()).toEqual([{ name: "m3-theme", value: "light" }]);
  });
});

describe("browser", () => {
  test("contexts route existing and future pages", async () => {
    const views: FakeView[] = [];
    const browser = browserFrom(() => {
      const created = new FakeView();
      views.push(created);
      return created;
    }, "HeadlessChrome/test");
    expect(browser.version()).toBe("HeadlessChrome/test");
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const first = await context.newPage();
    await context.route("**/*", () => undefined);
    const second = await context.newPage();
    for (const created of views) {
      expect(created.calls.some(([method]) => method === "Fetch.enable")).toBe(true);
    }
    expect(first).not.toBe(second);
    await context.close();
  });

  test("glob patterns", () => {
    expect(globToRegExp("**/*").test("http://a/b/c.js")).toBe(true);
    expect(globToRegExp("http://a/*.js").test("http://a/x.js")).toBe(true);
    expect(globToRegExp("http://a/*.js").test("http://a/x/y.js")).toBe(false);
  });
});
