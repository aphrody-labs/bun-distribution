/**
 * @license
 * Copyright 2026 Rose Griffon
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from "bun:test";
import { WebCdpPage } from "../../lib/web-cdp";

async function browserAvailable(): Promise<boolean> {
  try {
    const page = await WebCdpPage.connect();
    await page.close();
    return true;
  } catch {
    return false;
  }
}

const hasCdp = await browserAvailable();
if (!hasCdp) console.warn("[Aphrody Web CDP] Serveur CDP absent — test navigateur sauté.");

describe("Aphrody Web CDP integration", () => {
  it.skipIf(!hasCdp)(
    "navigates to example.com and returns rendered HTML",
    async () => {
      const page = await WebCdpPage.connect();
      try {
        await page.goto("https://example.com");
        expect(await page.title()).toBe("Example Domain");
        expect(await page.content()).toContain("Example Domain");
      } finally {
        await page.close().catch(() => undefined);
      }
    },
    60_000,
  );
});
