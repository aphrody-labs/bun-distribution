// SPDX-License-Identifier: Apache-2.0

/**
 * @module @aphrody/web-test
 *
 * Playwright-compatible browser/site test package for Bun, backed by Aphrody's
 * shared Rust Obscura CDP server and the `bun:test` runner.
 *
 * Drop-in usage (mirrors `@playwright/test`):
 *
 * ```ts
 * import { test, expect } from "@aphrody/web-test";
 *
 * test("homepage", async ({ page }) => {
 *   await page.goto("http://localhost:3000/");
 *   await expect(page.getByRole("heading")).toHaveText("Welcome");
 *   await expect(page.getByTestId("cart")).toHaveCount(1);
 * });
 * ```
 *
 */

export {
  test,
  createTest,
  describe,
  it,
  beforeAll,
  afterAll,
  beforeEach,
  afterEach,
  mock,
  type WebTest,
  type WebFixtures,
  type FixtureBody,
} from "./runner.ts";

export { expect, type LocatorMatchers, type MatcherOptions } from "./expect.ts";

export { TestPage, type TestPageOptions } from "./page.ts";

export {
  collectPageDiagnostics,
  type DiagnosticsOptions,
  type PageDiagnostics,
} from "./diagnostics.ts";

export { WebLocator, type CdpPage, type FilterOptions } from "./locator.ts";

export { defineConfig, type WebTestConfig, type UseOptions, type ExpectConfig } from "./config.ts";

export { type ByRoleOptions, type ResolvedQuery, type TextMatcher } from "./selectors.ts";
