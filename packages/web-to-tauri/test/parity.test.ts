// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "bun:test";
import {
  buildReport,
  compareSnapshots,
  normalizeText,
  textSimilarity,
  verifyPolicy,
  type PageSnapshot,
} from "../src/parity.ts";
import type { ConversionPlan } from "../src/types.ts";
import { planConversion } from "../src/plan.ts";

const snapshot = (overrides: Partial<PageSnapshot> = {}): PageSnapshot => ({
  url: "https://example.com/pricing",
  title: "Pricing",
  lang: "en",
  text: "Choose a plan that fits your team and start today with a free trial of every feature",
  tree: [
    {
      tag: "h1",
      role: "heading",
      name: "Pricing",
      id: null,
      testId: null,
      href: null,
      disabled: false,
    },
    {
      tag: "button",
      role: "button",
      name: "Start trial",
      id: null,
      testId: null,
      href: null,
      disabled: false,
    },
  ],
  resources: [
    { name: "https://example.com/api/plans?_=123", initiator: "fetch" },
    { name: "https://example.com/app.js", initiator: "script" },
  ],
  ...overrides,
});

describe("text similarity", () => {
  it("is 1 for equal and for empty texts, lower as words diverge", () => {
    expect(textSimilarity("a b c d", "a b c d")).toBe(1);
    expect(textSimilarity("", "")).toBe(1);
    expect(
      textSimilarity("one two three four five", "one two three nine ten"),
    ).toBeLessThan(0.5);
    expect(normalizeText("  Hello\n\nWORLD 12:01  ", [/\d\d:\d\d/])).toBe(
      "hello world",
    );
  });
});

describe("compareSnapshots", () => {
  it("passes identical renders, ignoring cache-buster query keys", () => {
    const wrapped = snapshot({
      resources: [
        { name: "https://example.com/api/plans?_=999", initiator: "fetch" },
        { name: "https://example.com/app.js", initiator: "script" },
      ],
    });
    const report = compareSnapshots("/pricing", snapshot(), wrapped);
    expect(report.status).toBe("pass");
    expect(report.textSimilarity).toBe(1);
  });

  it("fails when the app renders other text, loses a control or a title", () => {
    const wrapped = snapshot({
      title: "Error",
      text: "Something went wrong",
      tree: [],
    });
    const report = compareSnapshots("/pricing", snapshot(), wrapped);
    expect(report.status).toBe("fail");
    const checks = report.findings
      .filter((finding) => finding.severity === "regression")
      .map((finding) => finding.check);
    expect(checks).toEqual(expect.arrayContaining(["title", "text", "tree"]));
  });

  it("fails when an API request of the browser never happens in the app, but only notes a missing asset", () => {
    const wrapped = snapshot({
      resources: [
        { name: "https://example.com/other.js", initiator: "script" },
      ],
    });
    const report = compareSnapshots("/pricing", snapshot(), wrapped);
    const requests = report.findings.filter(
      (finding) => finding.check === "requests",
    );
    expect(
      requests.find((finding) => finding.message.includes("/api/plans"))
        ?.severity,
    ).toBe("regression");
    expect(
      requests.find((finding) => finding.message.includes("app.js"))?.severity,
    ).toBe("info");
  });

  it("maps the loopback origin of a bundle to the public origin", () => {
    const wrapped = snapshot({
      url: "http://127.0.0.1:4000/pricing",
      resources: [
        { name: "http://127.0.0.1:4000/api/plans", initiator: "fetch" },
        { name: "http://127.0.0.1:4000/app.js", initiator: "script" },
      ],
    });
    const report = compareSnapshots("/pricing", snapshot(), wrapped, {
      originMap: { "http://127.0.0.1:4000": "https://example.com" },
    });
    expect(report.status).toBe("pass");
  });

  it("flags a different final route", () => {
    const report = compareSnapshots(
      "/pricing",
      snapshot(),
      snapshot({ url: "https://example.com/login" }),
    );
    expect(report.findings.some((finding) => finding.check === "route")).toBe(
      true,
    );
  });
});

describe("buildReport", () => {
  it("is incomplete, never a pass, when nothing was captured", () => {
    const report = buildReport(
      [{ path: "/", status: "skipped", textSimilarity: null, findings: [] }],
      [],
      ["wrapped capture: no running app"],
    );
    expect(report.verdict).toBe("incomplete");
    expect(report.skipped).toHaveLength(1);
  });

  it("fails on a policy regression even when every capture passes", () => {
    const report = buildReport(
      [{ path: "/", status: "pass", textSimilarity: 1, findings: [] }],
      [{ severity: "regression", check: "policy", message: "x" }],
      [],
    );
    expect(report.verdict).toBe("fail");
  });
});

describe("verifyPolicy", () => {
  const probe = {
    kind: "site",
    input: "https://shop.example.com",
    finalUrl: "https://shop.example.com/",
    status: 200,
    redirects: [
      {
        url: "https://shop.example.com/",
        status: 302,
        location: "https://sso.example.org/login",
      },
    ],
    headers: {},
    cookies: [],
    title: "Shop",
    lang: "en",
    description: null,
    themeColor: null,
    icons: [],
    manifest: null,
    frameworks: [],
    origins: [
      "https://shop.example.com",
      "https://sso.example.org",
      "https://accounts.google.com",
    ],
    redirectOrigins: ["https://shop.example.com", "https://sso.example.org"],
    idps: [
      { id: "google", kind: "idp", origin: "https://accounts.google.com" },
    ],
    signals: [],
    links: ["/cart", "/help"],
    formOrigins: ["https://pay.example.net"],
    frameOrigins: [],
    embeds: [],
    popupLinks: 0,
    scriptsScanned: 0,
    warnings: [],
  } satisfies SiteProbe_;

  type SiteProbe_ = import("../src/types.ts").SiteProbe;

  it("accepts what the plan allows and reports a form that would leave the app", () => {
    const plan: ConversionPlan = planConversion(probe);
    const findings = verifyPolicy(plan);
    expect(
      findings.filter((finding) => finding.message.includes("redirect")),
    ).toEqual([]);
    expect(
      findings.filter((finding) => finding.message.includes("sign-in")),
    ).toEqual([]);
    expect(findings.map((finding) => finding.message).join("\n")).toContain(
      "form action https://pay.example.net/ would be sent to the system browser",
    );
  });

  it("passes once the origin is allowed", () => {
    expect(
      verifyPolicy(
        planConversion(probe, { allowOrigins: ["https://pay.example.net"] }),
      ),
    ).toEqual([]);
  });
});
