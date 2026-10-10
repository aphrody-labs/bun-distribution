// SPDX-License-Identifier: Apache-2.0

/**
 * @module @aphrody/web-test/sites
 *
 * Canonical site testing presets and helpers:
 * - Rose Griffon (`rosegriffon.fr` presets, auth headers, CSRF/session cookies, API health check)
 * - Aphrody UI / Next.js (M3 design token audit, RSC hydration checks, instant() navigation benchmark)
 */

export * from "./rosegriffon.ts";
export * from "./aphrody-ui.ts";
