// SPDX-License-Identifier: Apache-2.0

/**
 * @module @aphrody/web-test/config
 *
 * `defineConfig` — a `playwright.config.ts`-shaped options object. The fields
 * `use.baseURL`, `use.testIdAttribute`, and `use.cdpUrl` configure the page
 * fixture. Bun owns runner settings such as workers and retries.
 */

import type { TestPageOptions } from "./page.ts";

/** Per-test `use` block, mirroring Playwright's `use` fixture overrides. */
export interface UseOptions extends TestPageOptions {
  /** Default navigation/locator timeout in ms. */
  actionTimeout?: number;
}

/** `expect` block — default assertion timeout. */
export interface ExpectConfig {
  /** Default web-first assertion timeout in ms. */
  timeout?: number;
}

/** The full config shape, a typed subset of Playwright's `PlaywrightTestConfig`. */
export interface WebTestConfig {
  /** Per-test fixtures / overrides. */
  use?: UseOptions;
  /** Global per-test timeout (informational; Bun owns the hard timeout). */
  timeout?: number;
  /** Web-first assertion config. */
  expect?: ExpectConfig;
  /** Retry count (delegated to Bun's runner). */
  retries?: number;
  /** Worker count (delegated to Bun's runner). */
  workers?: number;
}

/**
 * Identity helper that gives a config object full type-checking and inference,
 * exactly like Playwright's `defineConfig`.
 */
export function defineConfig(config: WebTestConfig): WebTestConfig {
  return config;
}
