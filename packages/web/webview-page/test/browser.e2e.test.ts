// SPDX-License-Identifier: Apache-2.0
// Real Chrome through Bun.WebView; runs only when BUN_CHROME_PATH points at a Chrome-family executable.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { chromium, type Browser, type Page } from "../src/index.ts";

const chrome = process.env.BUN_CHROME_PATH;
const PAGE = `<!doctype html><html lang="en"><head><title>Forms demo</title>
<script>console.error("boom"); setTimeout(() => { throw new Error("late failure"); }, 50);</script></head>
<body><a href="#/forms" data-testid="nav-forms">Forms</a>
<main><h1>Forms page</h1>
<label for="name">Display name</label><input id="name" />
<label><input type="checkbox" id="ok" /> Sample values</label>
<select aria-label="Colour mode"><option value="light">Light</option><option value="dark">Dark</option></select>
<button id="send" type="button" onclick="document.querySelector('[role=status]').textContent='Sent'">Send</button>
<p role="status">Ready</p>
<img src="https://external.invalid/x.png" alt="external">
</main></body></html>`;

describe.skipIf(!chrome)("webview-page against real Chrome", () => {
  let server: ReturnType<typeof Bun.serve>;
  let browser: Browser;
  let page: Page;
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  const external: string[] = [];
  const statuses: number[] = [];

  beforeAll(async () => {
    server = Bun.serve({
      port: 0,
      fetch: (request) =>
        new URL(request.url).pathname === "/missing"
          ? new Response("nope", { status: 404 })
          : new Response(PAGE, { headers: { "content-type": "text/html" } }),
    });
    browser = await chromium.launch({
      executablePath: chrome,
      args: ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage"],
    });
    const context = await browser.newContext({
      viewport: { width: 1000, height: 700 },
      colorScheme: "dark",
      reducedMotion: "reduce",
      locale: "en-US",
      timezoneId: "UTC",
    });
    page = await context.newPage();
    page.setDefaultTimeout(8000);
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });
    page.on("pageerror", (error) => pageErrors.push(error.message));
    page.on("response", (response) => statuses.push(response.status()));
    await context.route("**/*", async (route) => {
      const url = new URL(route.request().url());
      if (url.origin === server.url.origin) await route.continue();
      else {
        external.push(url.origin);
        await route.abort();
      }
    });
    await page.goto(`${server.url.origin}/`, { waitUntil: "networkidle" });
  }, 60_000);

  afterAll(async () => {
    await browser?.close();
    server?.stop(true);
  });

  test("browser reports its product and the page loads", async () => {
    expect(browser.version()).toMatch(/Chrome/);
    expect(await page.title()).toBe("Forms demo");
    expect(page.url()).toBe(`${server.url.origin}/`);
  });

  test("emulation, console, page errors, routing and responses", async () => {
    await page.waitForFunction(() => matchMedia("(prefers-color-scheme: dark)").matches);
    expect(await page.evaluate(() => matchMedia("(prefers-reduced-motion: reduce)").matches)).toBe(
      true,
    );
    expect(await page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone)).toBe("UTC");
    expect(consoleErrors).toContain("boom");
    await page.waitForFunction(() => true);
    await Bun.sleep(150);
    expect(pageErrors.some((message) => message.includes("late failure"))).toBe(true);
    expect(external).toContain("https://external.invalid");
    expect(statuses).toContain(200);
  });

  test("locators: role, label, text, test id, fill, check, select, click", async () => {
    expect(await page.getByTestId("nav-forms").getAttribute("href")).toBe("#/forms");
    expect(await page.locator("h1").count()).toBe(1);
    const name = page.getByLabel("Display name");
    await name.fill("Ada");
    expect(await name.inputValue()).toBe("Ada");
    const ok = page.getByLabel("Sample values");
    await ok.check();
    expect(await ok.isChecked()).toBe(true);
    const mode = page.getByRole("combobox", { name: "Colour mode", exact: true });
    await mode.selectOption("dark");
    expect(await mode.inputValue()).toBe("dark");
    await page.getByRole("button", { name: "Send", exact: true }).click({ force: true });
    expect(await page.getByRole("status").innerText()).toBe("Sent");
    await page.getByText("Sent", { exact: true }).waitFor();
  });

  test("selector click, keyboard, viewport, reload, cookies and screenshot", async () => {
    await page.evaluate(() => {
      document.querySelector("[role=status]")!.textContent = "Ready";
    });
    await page.getByRole("button", { name: "Send", exact: true }).click();
    expect(await page.getByRole("status").textContent()).toBe("Sent");
    await page.getByLabel("Display name").focus();
    await page.keyboard.press("Tab");
    expect(await page.evaluate(() => document.activeElement?.id)).toBe("ok");
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForFunction(() => innerWidth === 390);
    await page.reload({ waitUntil: "networkidle" });
    expect(await page.getByLabel("Display name").inputValue()).toBe("");
    expect(Array.isArray(await page.cookies())).toBe(true);
    const png = await page.screenshot({ animations: "disabled", caret: "hide" });
    expect(Array.from(png.slice(0, 4))).toEqual([0x89, 0x50, 0x4e, 0x47]);
  });
});
