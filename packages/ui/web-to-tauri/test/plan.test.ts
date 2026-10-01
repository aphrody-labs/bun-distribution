// SPDX-License-Identifier: Apache-2.0
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { rm } from "node:fs/promises";
import { assessRisks, planConversion, PlanError, registrableDomain } from "../src/plan.ts";
import { probeDirectory, probeUrl } from "../src/probe.ts";
import type { DirectoryProbe, SiteProbe } from "../src/types.ts";
import { startSite, tempDir, writeTree, type Site } from "./fixtures.ts";

describe("registrableDomain", () => {
  it("keeps the registrable part and refuses public suffixes", () => {
    expect(registrableDomain("app.example.com")).toBe("example.com");
    expect(registrableDomain("a.b.example.co.uk")).toBe("example.co.uk");
    expect(registrableDomain("foo.github.io")).toBe("foo.github.io");
    expect(registrableDomain("127.0.0.1")).toBe("127.0.0.1");
    expect(registrableDomain("localhost")).toBe("localhost");
  });
});

describe("planConversion of a site", () => {
  let site: Site;
  let probe: SiteProbe;
  beforeAll(async () => {
    site = startSite();
    probe = await probeUrl(`${site.a}/start`);
  });
  afterAll(() => site.stop());

  it("wraps a URL in remote mode and starts at the requested page", () => {
    const plan = planConversion(probe);
    expect(plan.config.mode).toBe("remote");
    expect(plan.config.start).toBe(`${site.a}/start`);
    expect(plan.config.name).toBe("Demo App");
    expect(plan.config.window.title).toBeNull();
    expect(plan.config.window.dragDrop).toBe(false);
    expect(plan.config.bundle).toBeNull();
    expect(plan.config.sidecar).toBeNull();
  });

  it("keeps every origin of the redirect chain in the app and the sign-in origin out of it", () => {
    const plan = planConversion(probe);
    expect(plan.config.origins.app).toContain(site.a);
    expect(plan.config.origins.app).toContain(site.b);
    expect(plan.config.origins.auth).toContain("https://accounts.google.com");
    expect(plan.config.origins.external).toBe("system");
  });

  it("allows third-party frames in-app so they are not mistaken for links that leave it", () => {
    const plan = planConversion(probe);
    expect(plan.config.origins.embeds).toEqual(
      expect.arrayContaining(["https://www.youtube.com", "https://youtube.com"]),
    );
    expect(plan.risks.find((risk) => risk.id === "frame-navigation")?.mitigation.kind).toBe(
      "applied",
    );
  });

  it("applies requested origins, user agent and external policy", () => {
    const plan = planConversion(probe, {
      allowOrigins: ["https://*.cdn.test"],
      userAgent: "X/1",
      external: "inapp",
      name: "Mine",
    });
    expect(plan.config.origins.app).toContain("https://*.cdn.test");
    expect(plan.config.userAgent).toBe("X/1");
    expect(plan.config.origins.external).toBe("inapp");
    expect(plan.config.name).toBe("Mine");
    expect(plan.risks.find((risk) => risk.id === "user-agent-sniffing")?.mitigation.kind).toBe(
      "applied",
    );
  });

  it("derives a valid identifier and the parity paths", () => {
    const plan = planConversion(probe);
    expect(plan.config.identifier).toMatch(/^io\.aphrody\.wrapped\.[a-z][a-z0-9-]*$/);
    expect(plan.parityPaths[0]).toBe("/");
    expect(plan.parityPaths).toEqual(expect.arrayContaining(["/about", "/pricing?x=1"]));
    expect(planConversion(probe, { maxParityPaths: 2 }).parityPaths).toHaveLength(2);
  });

  it("lists the risks that remain, with what the plan does about each", () => {
    const plan = planConversion(probe);
    const byId = new Map(plan.risks.map((risk) => [risk.id, risk]));
    expect(byId.get("api-and-backend")?.mitigation.kind).toBe("applied");
    expect(byId.get("service-worker")).toMatchObject({
      severity: "medium",
      mitigation: { kind: "manual" },
    });
    expect(byId.get("sign-in-providers")?.mitigation.kind).toBe("applied");
    // The fixture posts to the origin it redirects through, which is already in the app.
    expect(byId.get("form-cross-origin")).toBeUndefined();
    expect(byId.get("third-party-cookies")?.severity).toBe("medium");
    expect(byId.get("network-required")).toBeDefined();
    expect(plan.verdict).toBe("faithful");
  });

  it("flags a form that posts to an origin outside the allowlist, until it is allowed", () => {
    const external: SiteProbe = { ...probe, formOrigins: ["https://pay.example.net"] };
    expect(
      planConversion(external).risks.find((risk) => risk.id === "form-cross-origin"),
    ).toMatchObject({ severity: "medium", mitigation: { kind: "flag" } });
    const allowed = planConversion(external, { allowOrigins: ["https://pay.example.net"] });
    expect(allowed.risks.find((risk) => risk.id === "form-cross-origin")).toBeUndefined();
  });

  it("refuses options the runtime would refuse at startup", () => {
    expect(() => planConversion(probe, { allowOrigins: ["example.com"] })).toThrow(
      "--allow-origin",
    );
    expect(() => planConversion(probe, { allowOrigins: ["ftp://example.com"] })).toThrow(PlanError);
    expect(() => planConversion(probe, { backend: "ftp://api.test" })).toThrow("--backend");
    expect(() => planConversion(probe, { port: 70_000 })).toThrow("--port");
    expect(() =>
      planConversion(probe, { allowOrigins: ["https://*.cdn.test/assets/*"], port: 0 }),
    ).not.toThrow();
  });

  it("refuses bundle and sidecar for a URL", () => {
    expect(() => planConversion(probe, { mode: "bundle" })).toThrow(PlanError);
    expect(() => planConversion(probe, { mode: "sidecar" })).toThrow("project directory");
  });

  it("selects Chromium when the page needs a Chromium-only API, and asks for review when it is forced off", () => {
    const needy: SiteProbe = {
      ...probe,
      signals: [...probe.signals, { id: "web-usb", where: "app.js" }],
    };
    const auto = planConversion(needy);
    expect(auto.config.engine).toBe("cef");
    expect(auto.risks.find((risk) => risk.id === "chromium-only-apis")?.mitigation.kind).toBe(
      "applied",
    );
    const forced = planConversion(needy, { engine: "wry" });
    expect(forced.verdict).toBe("needs-review");
    expect(forced.risks.find((risk) => risk.id === "chromium-only-apis")?.severity).toBe("high");
  });
});

describe("planConversion of a directory", () => {
  const dirs: string[] = [];
  afterAll(async () => {
    await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })));
  });

  async function project(files: Record<string, string>): Promise<DirectoryProbe> {
    const dir = await tempDir("w2t-plan-");
    dirs.push(dir);
    await writeTree(dir, files);
    return probeDirectory(dir);
  }

  it("serves a static bundle and proxies its API to the backend", async () => {
    const probe = await project({
      "dist/index.html": "<html></html>",
      "dist/app.js": `fetch("/api/items"); fetch("https://api.acme.test/v1")`,
      ".env": "VITE_API_URL=https://api.acme.test",
    });
    const plan = planConversion(probe);
    expect(plan.config.mode).toBe("bundle");
    expect(plan.config.start).toBe("/");
    expect(plan.config.bundle).toEqual({
      dir: "../dist",
      backend: "https://api.acme.test",
      proxy: ["/api"],
      spaFallback: true,
    });
    expect(plan.config.origins.app).toContain("https://api.acme.test");
    expect(plan.risks.find((risk) => risk.id === "backend-proxy")?.mitigation.kind).toBe("applied");
  });

  it("flags the missing backend of a bundle that calls an API", async () => {
    const probe = await project({
      "dist/index.html": "<html></html>",
      "dist/app.js": `fetch("/api/items")`,
    });
    const plan = planConversion(probe);
    expect(plan.config.bundle?.backend).toBeNull();
    expect(plan.risks.find((risk) => risk.id === "backend-unset")).toMatchObject({
      severity: "high",
      mitigation: { kind: "flag" },
    });
    expect(plan.verdict).toBe("needs-review");
    expect(planConversion(probe, { backend: "https://api.example.test" }).verdict).toBe("faithful");
  });

  it("runs a server project as a sidecar so its API routes keep answering", async () => {
    const probe = await project({
      "package.json": JSON.stringify({ name: "portal", dependencies: { next: "16" } }),
      "next.config.ts": `export default { output: "standalone" };`,
      "app/api/users/route.ts": "export const GET = () => new Response('ok')",
      "server.ts": "Bun.serve({ fetch: () => new Response('ok') })",
    });
    const plan = planConversion(probe, { port: 4317 });
    expect(plan.config.mode).toBe("sidecar");
    expect(plan.config.sidecar).toMatchObject({ program: "server", port: 4317 });
    expect(plan.verdict).toBe("faithful");
    expect(
      planConversion(probe).risks.find((risk) => risk.id === "sidecar-random-port")?.mitigation
        .kind,
    ).toBe("flag");
  });

  it("blocks a static bundle that has API routes of its own", async () => {
    const probe = await project({
      "dist/index.html": "<html></html>",
      "app/api/users/route.ts": "export const GET = () => new Response('ok')",
    });
    const plan = planConversion(probe, { mode: "bundle" });
    expect(plan.risks.find((risk) => risk.id === "api-routes-without-server")?.severity).toBe(
      "blocker",
    );
    expect(plan.verdict).toBe("needs-review");
  });

  it("warns that sign-in callbacks do not follow a loopback origin", async () => {
    const probe = await project({ "dist/index.html": "<html></html>" });
    const risks = assessRisks(probe, planConversion(probe).config);
    expect(risks.find((risk) => risk.id === "origin-change")).toBeDefined();
  });

  it("rejects a directory with nothing to wrap, and remote mode for a directory", async () => {
    const empty = await project({ "README.md": "x" });
    expect(() => planConversion(empty)).toThrow("build the project first");
    expect(() => planConversion(empty, { mode: "remote" })).toThrow("needs a URL");
  });
});
