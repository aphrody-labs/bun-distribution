// SPDX-License-Identifier: Apache-2.0

/**
 * @module @aphrody/web-test/next
 *
 * Next.js instant navigation testing (`instant()`, a port of `@next/playwright`) for `@aphrody/web-test` pages.
 * The implementation lives in `@aphrody/next-bun/testing` (aphrody-labs/bun, packages/bun-next/testing); it drives the
 * `next-instant-navigation-testing` cookie over a Playwright context or a CDP-backed page (`_cdp` / `_send`).
 */

export * from "@aphrody/next-bun/testing";
