// SPDX-License-Identifier: Apache-2.0

/**
 * @module @aphrody/web-test/next/instant
 *
 * Aphrody port of Next.js's `@next/playwright` (`instant()`) navigation-testing
 * primitive for Aphrody's CDP-backed test runner. Within an `instant()` scope,
 * Next.js serves only cached / prefetched content (Cache Components), driven
 * entirely by the `next-instant-navigation-testing` cookie.
 *
 * The cookie protocol, the nesting guard, `resolveURL`, and the acquire/release
 * `finally` semantics match the Next.js runtime contract byte-for-byte.
 *
 * Usage with `@aphrody/web-test`:
 *
 * ```ts
 * import { test, expect } from "@aphrody/web-test";
 * import { instant } from "@aphrody/web-test/next";
 *
 * test("instant navigation", async ({ page }) => {
 *   await page.goto("http://localhost:3000/");
 *   await instant(page, async () => {
 *     await page.getByRole("link", { name: "Dashboard" }).click();
 *     await expect(page.getByRole("heading")).toHaveText("Dashboard");
 *   });
 * });
 * ```
 */

import { adaptPage, type WebPageLike, type PlaywrightPage } from "./context.ts";
import { step } from "./step.ts";

export {
  adaptPage,
  CdpCookieContext,
  type WebPageLike,
  type CdpSend,
  type PlaywrightBrowserContext,
  type PlaywrightPage,
  type PwCookie,
  type PwCookieParam,
} from "./context.ts";
export { setStepReporter, step, type Step } from "./step.ts";

/**
 * The load-bearing cookie name. Next.js reads this (CookieStore change event ->
 * `navigation-testing-lock.ts`) to acquire/release the in-memory navigation
 * lock. Must match the Next.js runtime byte-for-byte — do not rename.
 */
export const INSTANT_COOKIE = "next-instant-navigation-testing";

/**
 * Type guard to check if an object is already a structural PlaywrightPage.
 */
function isPlaywrightPage(target: unknown): target is PlaywrightPage {
  return (
    typeof target === "object" &&
    target !== null &&
    "context" in target &&
    typeof (target as { context: unknown }).context === "function"
  );
}

/**
 * Runs a function with instant navigation enabled. Within this scope,
 * navigations render the prefetched UI immediately and wait for the callback to
 * complete before streaming in dynamic data.
 *
 * Uses the cookie-based protocol: setting the cookie acquires the navigation
 * lock (via the CookieStore change event), and clearing it releases the lock.
 *
 * If the page is already loaded, the URL is inferred automatically. For a fresh
 * page (before any navigation), pass `baseURL` so the cookie can be scoped to
 * the correct domain:
 *
 * ```ts
 * await instant(page, async () => {
 *   await page.goto(url);
 *   // ...
 * }, { baseURL: "http://localhost:3000" });
 * ```
 */
export async function instant<T>(
  page: PlaywrightPage | WebPageLike,
  fn: () => Promise<T>,
  options?: { baseURL?: string },
): Promise<T> {
  const pw: PlaywrightPage = isPlaywrightPage(page) ? page : adaptPage(page as WebPageLike);

  // Check for nested instant() calls. The cookie is scoped to the browser
  // context, so we can detect nesting by checking if it's already set.
  const existingCookies = await pw.context().cookies();
  if (existingCookies.some((c) => c.name === INSTANT_COOKIE)) {
    throw new Error(
      "An instant() scope is already active. Nesting instant() " +
        "calls is not supported. Did you forget to await the " +
        "previous instant() call?",
    );
  }

  // Acquire the lock by setting the cookie via the browser context. This
  // ensures the cookie is present even on the very first navigation. The
  // cookie triggers the CookieStore change event in navigation-testing-lock.ts,
  // which acquires the in-memory navigation lock.
  const { hostname } = new URL(resolveURL(pw, options));
  await step("Acquire Instant Lock", () =>
    pw.context().addCookies([
      {
        name: INSTANT_COOKIE,
        value: JSON.stringify([0, `p${Math.random()}`]),
        domain: hostname,
        path: "/",
      },
    ]),
  );
  try {
    return await fn();
  } finally {
    // Release the lock by clearing the cookie. Next.js may have updated the
    // cookie value (e.g. from [0] to [1,null]) during the lock scope. We
    // clear by name to remove the cookie regardless of its current value or
    // which domain variant it was stored under.
    await step("Release Instant Lock", () => pw.context().clearCookies({ name: INSTANT_COOKIE }));
  }
}

/**
 * Resolves the URL to scope the instant navigation cookie to. Prefers an
 * explicit `baseURL` option, then falls back to the page's current URL. Throws
 * a descriptive error if neither is available (e.g. fresh page before any
 * navigation).
 */
export function resolveURL(page: PlaywrightPage, options?: { baseURL?: string }): string {
  const url = options?.baseURL ?? page.url();
  if (url && url !== "about:blank") {
    return url;
  }
  const error = new Error(
    `Could not infer the base URL of the application.

instant() needs to know the base URL so it can configure the
browser before the first page load. If the page is already
loaded, the base URL is detected automatically.
Otherwise, you can fix this in one of two ways:

1. Pass a baseURL option:

  await instant(page, async () => {
    await page.goto('http://localhost:3000')
    // ...
  }, { baseURL: 'http://localhost:3000' })

  Tip: If you use baseURL in your Playwright config, you can
  get it from the test fixture:

    test('my test', async ({ page, baseURL }) => {
      await instant(page, async () => {
        // ...
      }, { baseURL })
    })

2. Navigate to a page before calling instant():

  await page.goto('http://localhost:3000')
  await instant(page, async () => {
    // ...
  })`,
  );
  // Remove resolveURL and instant from the stack trace so the error points at
  // the caller's code. (V8/Bun expose captureStackTrace; guard for safety.)
  Error.captureStackTrace?.(error, instant);
  throw error;
}
