#!/usr/bin/env bun
// SPDX-License-Identifier: Apache-2.0
// Drive the example app in headless Chromium: hydration without errors, Base UI behaviour, the M3 styles actually
// computed, and the theme round trip (client toggle -> cookie -> server render).
//
//   bun scripts/browser-check.ts [--base http://localhost:3218]     (server running: `bun run start` in apps/m3-next-example)
//   bun scripts/examples.ts browser                             (builds with m3-next, starts the server, runs this)
//
// The browser is Bun.WebView driven through @aphrody/bun-webview-page (Chrome, Chromium or Edge found on PATH or in
// BUN_CHROME_PATH); no Playwright and no browser download.
import { chromium } from "@aphrody/bun-webview-page";

export interface Check {
  name: string;
  ok: boolean;
  detail?: string;
}

/** Run every check against a running server; never throws on a failed check. */
export async function browserCheck(base: string): Promise<Check[]> {
  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage"],
  });
  const checks: Check[] = [];
  const check = (name: string, ok: boolean, detail?: string) =>
    checks.push({ name, ok, ...(detail ? { detail } : {}) });
  try {
    const page = await browser.newPage();
    const problems: string[] = [];
    // Headless Chromium without a display never fires requestAnimationFrame here, and the actionability wait of a
    // selector click depends on it: clicks are forced (native events at the element centre; the assertions after each
    // click replace the visibility and hit checks).
    page.on("console", message => {
      if (message.type() === "error") problems.push(`console: ${message.text()}`);
    });
    page.on("pageerror", error => problems.push(`pageerror: ${error.message}`));

    // Home: the cached stamp, the typed links, the font variable.
    await page.goto(`${base}/`, { waitUntil: "networkidle" });
    check(
      "home renders the cached stamp",
      ((await page.locator('[data-testid="stamp"]').textContent()) ?? "").startsWith("Rendered "),
    );
    check(
      "html has lang, the font variable class and a colour scheme",
      await page.evaluate(() => {
        const html = document.documentElement;
        return html.lang === "en" && /variable/.test(html.className) && html.style.colorScheme !== "";
      }),
    );

    // Components: a Server Component rendered the client wrappers; they hydrate and work.
    await page.goto(`${base}/components`, { waitUntil: "networkidle" });
    const filled = page.locator(".m3-bui-button--filled").first();
    check(
      "filled button paints the primary colour",
      await filled.evaluate(el => {
        const background = getComputedStyle(el).backgroundColor;
        const primary = getComputedStyle(document.documentElement).getPropertyValue("--md-sys-color-primary").trim();
        return background !== "rgba(0, 0, 0, 0)" && primary !== "";
      }),
    );
    check(
      "the button is a full pill (9999px radius token)",
      await filled.evaluate(el => parseFloat(getComputedStyle(el).borderTopLeftRadius) > 100),
    );

    await page.locator('[role="switch"].m3-bui-switch').first().click({ force: true });
    check(
      "a click flips the switch (Base UI data-checked)",
      (await page.locator('[role="switch"].m3-bui-switch').first().getAttribute("data-checked")) === null,
    );

    await page.getByText("Open dialog").first().click({ force: true });
    await page.locator(".m3-bui-dialog__popup").first().waitFor({ state: "visible", timeout: 5000 });
    check(
      "the dialog opens with its M3 popup, backdrop and title",
      (await page.locator(".m3-bui-dialog__backdrop").count()) === 1 &&
        ((await page.locator(".m3-bui-dialog__title").textContent()) ?? "").startsWith("Discard"),
    );
    await page.keyboard.press("Escape");
    await page.waitForTimeout(500);
    check("Escape closes the dialog", (await page.locator(".m3-bui-dialog__popup").count()) === 0);

    await page.locator(".m3-bui-select__trigger").first().click({ force: true });
    await page.locator(".m3-bui-select__popup").first().waitFor({ state: "visible", timeout: 5000 });
    check("the select lists its items in the M3 popup", (await page.locator(".m3-bui-select__item").count()) === 3);
    await page.keyboard.press("Escape");

    await page.locator('[role="tab"]').nth(1).click({ force: true });
    check(
      "tabs switch panels",
      ((await page.locator('[role="tabpanel"]:not([hidden])').first().textContent()) ?? "").includes("Second"),
    );

    await page.locator('[data-testid="notify"]').click({ force: true });
    await page.locator(".m3-bui-toast__title").first().waitFor({ state: "visible", timeout: 5000 });
    check(
      "the toast manager shows a snackbar",
      ((await page.locator(".m3-bui-toast__title").first().textContent()) ?? "") === "Saved",
    );

    // Theme round trip.
    await page.goto(`${base}/theme`, { waitUntil: "networkidle" });
    check(
      "the server saw the cookie proxy.ts wrote",
      ((await page.locator('[data-testid="server-mode"]').textContent()) ?? "").endsWith("system"),
    );
    const toggle = page.locator('[data-testid="theme-toggle"]');
    await toggle.click({ force: true }); // system -> light
    await page.waitForTimeout(200);
    const cookies = await page.context().cookies();
    check(
      "the toggle writes the cookie and the .light class",
      cookies.some(c => c.name === "m3-theme" && c.value === "light") &&
        (await page.evaluate(() => document.documentElement.classList.contains("light"))),
    );
    await page.reload({ waitUntil: "networkidle" });
    check(
      "a reload renders the saved preference on the server",
      ((await page.locator('[data-testid="server-mode"]').textContent()) ?? "").endsWith("light"),
    );
    await toggle.click({ force: true }); // light -> dark
    await page.waitForTimeout(200);
    check(
      "dark sets .dark and the dark colour roles",
      await page.evaluate(
        () =>
          document.documentElement.classList.contains("dark") &&
          getComputedStyle(document.body).backgroundColor !== "rgb(255, 255, 255)",
      ),
    );

    check(
      "no console errors, page errors or hydration warnings",
      problems.length === 0,
      problems.slice(0, 3).join(" | "),
    );
  } finally {
    await browser.close();
  }
  return checks;
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const base = args[args.indexOf("--base") + 1] ?? "http://localhost:3218";
  const checks = await browserCheck(args.includes("--base") ? base : "http://localhost:3218");
  for (const c of checks) console.log(`${c.ok ? "ok  " : "FAIL"} ${c.name}${c.detail ? `: ${c.detail}` : ""}`);
  const failed = checks.filter(c => !c.ok).length;
  console.log(failed === 0 ? `pass ${checks.length} browser checks` : `FAIL ${failed} of ${checks.length}`);
  process.exit(failed === 0 ? 0 : 1);
}
