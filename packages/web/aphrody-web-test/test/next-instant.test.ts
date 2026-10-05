// SPDX-License-Identifier: Apache-2.0
import "./setup.ts";

/**
 * Unit tests for the Next.js instant navigation primitive in @aphrody/web-test/next.
 * Validates the cookie protocol over Aphrody's static CDP transport.
 */

import { afterEach, beforeEach, expect, test } from "bun:test";
import { WebCdpPage } from "../src/cdp.ts";
import {
  adaptPage,
  CdpCookieContext,
  type CdpSend,
  INSTANT_COOKIE,
  instant,
  setStepReporter,
  step,
} from "../src/next/index.ts";

const BASE = "http://localhost:3000";

let page: WebCdpPage;

beforeEach(async () => {
  page = await WebCdpPage.connect();
});

afterEach(async () => {
  await page.close();
});

function jar(p: WebCdpPage): CdpCookieContext {
  return new CdpCookieContext(p as unknown as CdpSend);
}

test("contract: the cookie name matches Next.js byte-for-byte", () => {
  expect(INSTANT_COOKIE).toBe("next-instant-navigation-testing");
});

test("acquires the lock cookie inside the scope, releases after", async () => {
  const pw = adaptPage({ url: () => BASE, _cdp: page as unknown as CdpSend });

  expect((await pw.context().cookies()).some((c) => c.name === INSTANT_COOKIE)).toBe(false);

  let sawInside = false;
  const ret = await instant(pw, async () => {
    const inside = await pw.context().cookies();
    sawInside = inside.some((c) => c.name === INSTANT_COOKIE);
    return 42;
  });

  expect(ret).toBe(42);
  expect(sawInside).toBe(true);
  expect((await pw.context().cookies()).some((c) => c.name === INSTANT_COOKIE)).toBe(false);
});

test("instant() works directly with Aphrody page-like target without manual adaptPage", async () => {
  const rawTarget = { url: () => BASE, _cdp: page as unknown as CdpSend };
  let sawInside = false;
  const res = await instant(rawTarget, async () => {
    const ctx = jar(page);
    const cookies = await ctx.cookies();
    sawInside = cookies.some((c) => c.name === INSTANT_COOKIE);
    return "ok";
  });
  expect(res).toBe("ok");
  expect(sawInside).toBe(true);
  const afterCookies = await jar(page).cookies();
  expect(afterCookies.some((c) => c.name === INSTANT_COOKIE)).toBe(false);
});

test("releases the lock even when the body throws", async () => {
  const pw = adaptPage({ url: () => BASE, _cdp: page as unknown as CdpSend });
  await expect(
    instant(pw, async () => {
      expect((await pw.context().cookies()).some((c) => c.name === INSTANT_COOKIE)).toBe(true);
      throw new Error("boom");
    }),
  ).rejects.toThrow("boom");
  expect((await pw.context().cookies()).some((c) => c.name === INSTANT_COOKIE)).toBe(false);
});

test("scopes the cookie to the resolved hostname", async () => {
  const pw = adaptPage({ url: () => BASE, _cdp: page as unknown as CdpSend });
  await instant(pw, async () => {
    const c = (await pw.context().cookies()).find((x) => x.name === INSTANT_COOKIE);
    expect(c?.domain).toBe("localhost");
    const parsed = JSON.parse(c?.value ?? "null");
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed[0]).toBe(0);
    expect(String(parsed[1]).startsWith("p")).toBe(true);
  });
});

test("rejects nested instant() scopes", async () => {
  const pw = adaptPage({ url: () => BASE, _cdp: page as unknown as CdpSend });
  await instant(pw, async () => {
    await expect(instant(pw, async () => undefined)).rejects.toThrow(
      "An instant() scope is already active",
    );
  });
  expect((await pw.context().cookies()).some((c) => c.name === INSTANT_COOKIE)).toBe(false);
});

test("uses baseURL when the page has no current URL", async () => {
  const pw = adaptPage({ url: () => "about:blank", _cdp: page as unknown as CdpSend });
  await instant(
    pw,
    async () => {
      const c = (await pw.context().cookies()).find((x) => x.name === INSTANT_COOKIE);
      expect(c?.domain).toBe("example.test");
    },
    { baseURL: "https://example.test/app" },
  );
});

test("throws a descriptive error on a fresh page with no baseURL", async () => {
  const pw = adaptPage({ url: () => "about:blank", _cdp: page as unknown as CdpSend });
  await expect(instant(pw, async () => undefined)).rejects.toThrow("Could not infer the base URL");
});

test("jar adapter clears by name via Network.deleteCookies", async () => {
  const ctx = jar(page);
  await ctx.addCookies([
    { name: "keep", value: "1", domain: "localhost", path: "/" },
    { name: INSTANT_COOKIE, value: "x", domain: "localhost", path: "/" },
  ]);
  expect((await ctx.cookies()).length).toBe(2);
  await ctx.clearCookies({ name: INSTANT_COOKIE });
  const after = await ctx.cookies();
  expect(after.some((c) => c.name === INSTANT_COOKIE)).toBe(false);
  expect(after.some((c) => c.name === "keep")).toBe(true);
});

test("step reporter logs title and restores previous reporter", async () => {
  const log: string[] = [];
  const prev = setStepReporter(async (title, body) => {
    log.push(`enter:${title}`);
    const result = await body();
    log.push(`exit:${title}`);
    return result;
  });

  try {
    const out = await step("Sample Step", async () => "result-42");
    expect(out).toBe("result-42");
    expect(log).toEqual(["enter:Sample Step", "exit:Sample Step"]);
  } finally {
    setStepReporter(prev);
  }
});
