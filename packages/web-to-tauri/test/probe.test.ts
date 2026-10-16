// SPDX-License-Identifier: Apache-2.0
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { rm } from "node:fs/promises";
import {
  normalizeTarget,
  probeDirectory,
  probeUrl,
  ProbeError,
} from "../src/probe.ts";
import { startSite, tempDir, writeTree, type Site } from "./fixtures.ts";

describe("probeUrl", () => {
  let site: Site;
  beforeAll(() => {
    site = startSite();
  });
  afterAll(() => site.stop());

  it("follows the redirect chain and records every hop", async () => {
    const probe = await probeUrl(`${site.a}/start`);
    expect(probe.finalUrl).toBe(`${site.a}/home`);
    expect(probe.redirects.map((hop) => hop.status)).toEqual([302, 302]);
    expect(probe.redirectOrigins).toContain(site.b);
    expect(probe.redirectOrigins).toContain(site.a);
  });

  it("reads page facts, manifest and icons", async () => {
    const probe = await probeUrl(`${site.a}/home`);
    expect(probe.title).toBe("Demo Site");
    expect(probe.lang).toBe("fr");
    expect(probe.themeColor).toBe("#336699");
    expect(probe.manifest?.name).toBe("Demo App");
    expect(probe.manifest?.display).toBe("standalone");
    expect(probe.icons[0]?.href).toBe(`${site.a}/icon-512.png`);
    expect(probe.frameworks).toContain("next");
  });

  it("scans the page and its same-site scripts for browser APIs", async () => {
    const probe = await probeUrl(`${site.a}/home`);
    const ids = probe.signals.map((signal) => signal.id);
    expect(ids).toContain("service-worker");
    expect(ids).toContain("websocket");
    expect(ids).toContain("window-open");
    expect(ids).toContain("user-agent-sniffing");
    expect(probe.scriptsScanned).toBe(1);
    expect(probe.origins).toContain("https://api.demo.test");
  });

  it("collects same-origin links only, without assets or fragments", async () => {
    const probe = await probeUrl(`${site.a}/home`);
    expect(probe.links.toSorted()).toEqual(["/about", "/pricing?x=1"]);
    expect(probe.popupLinks).toBe(1);
  });

  it("detects sign-in providers and cross-origin form posts", async () => {
    const probe = await probeUrl(`${site.a}/home`);
    expect(probe.idps.map((idp) => idp.id)).toEqual(["google"]);
    expect(probe.formOrigins).toEqual([site.b]);
  });

  it("does not take an ordinary link to a provider for a sign-in or an embed", async () => {
    const probe = await probeUrl(`${site.a}/footer`);
    expect(probe.idps).toEqual([]);
    expect(probe.embeds).toEqual([]);
  });

  it("detects third-party frames and their providers", async () => {
    const probe = await probeUrl(`${site.a}/home`);
    expect(probe.frameOrigins).toEqual(["https://www.youtube.com"]);
    expect(probe.embeds.map((embed) => embed.id)).toEqual(["youtube"]);
  });

  it("describes cookies without their values", async () => {
    const probe = await probeUrl(`${site.a}/home`);
    expect(probe.cookies.map((cookie) => cookie.name)).toEqual([
      "sid",
      "__Host-t",
    ]);
    expect(probe.cookies[0]).toMatchObject({
      secure: true,
      httpOnly: true,
      sameSite: "none",
    });
    expect(JSON.stringify(probe)).not.toContain("abc123");
  });

  it("reports a 404 start page as a warning, not a crash", async () => {
    const probe = await probeUrl(`${site.a}/missing`);
    expect(probe.status).toBe(404);
    expect(probe.warnings.join(" ")).toContain("HTTP 404");
  });

  it("rejects unreachable hosts and non-http targets", async () => {
    await expect(
      probeUrl("http://127.0.0.1:1/", { timeoutMs: 2000 }),
    ).rejects.toBeInstanceOf(ProbeError);
    expect(() => normalizeTarget("ftp://example.com")).toThrow(ProbeError);
    expect(normalizeTarget("example.com").href).toBe("https://example.com/");
  });
});

describe("probeDirectory", () => {
  const dirs: string[] = [];
  afterAll(async () => {
    await Promise.all(
      dirs.map((dir) => rm(dir, { recursive: true, force: true })),
    );
  });

  it("recognises a static bundle, its API prefixes and its backend", async () => {
    const dir = await tempDir("w2t-static-");
    dirs.push(dir);
    await writeTree(dir, {
      "package.json": JSON.stringify({
        name: "@acme/shop",
        dependencies: { react: "^19", vite: "^6" },
      }),
      "dist/index.html": `<script src="/assets/app.js"></script>`,
      "dist/assets/app.js": `fetch("/api/products"); fetch("/graphql"); const u = "https://api.acme.test/v1"; navigator.serviceWorker.register("/sw.js")`,
      ".env.production": `VITE_API_URL=https://api.acme.test\nSECRET_TOKEN=abc\nDB_URL=https://user:pass@db.acme.test`,
    });
    const probe = await probeDirectory(dir);
    expect(probe.name).toBe("shop");
    expect(probe.frameworks).toEqual(expect.arrayContaining(["vite", "react"]));
    expect(probe.staticDir).toBe("dist");
    expect(probe.htmlPages).toBe(1);
    expect(probe.proxyPrefixes).toEqual(["/api", "/graphql"]);
    expect(probe.backends).toEqual(["https://api.acme.test"]);
    expect(probe.signals.map((signal) => signal.id)).toContain(
      "service-worker",
    );
  });

  it("never records credentials from .env files", async () => {
    const dir = await tempDir("w2t-env-");
    dirs.push(dir);
    await writeTree(dir, {
      "index.html": "<html></html>",
      ".env": `DB_URL=https://user:pass@db.acme.test`,
    });
    const probe = await probeDirectory(dir);
    expect(JSON.stringify(probe)).not.toContain("pass");
    expect(probe.backends).toEqual([]);
  });

  it("recognises a server project with API routes", async () => {
    const dir = await tempDir("w2t-server-");
    dirs.push(dir);
    await writeTree(dir, {
      "package.json": JSON.stringify({
        name: "portal",
        dependencies: { next: "16" },
      }),
      "next.config.ts": `export default { output: "standalone" };`,
      "app/api/users/route.ts": "export const GET = () => new Response('ok')",
      "app/api/orders/route.ts": "export const GET = () => new Response('ok')",
      "server.ts":
        "Bun.serve({ port: Number(process.env.PORT), fetch: () => new Response('ok') })",
    });
    const probe = await probeDirectory(dir);
    expect(probe.frameworks).toContain("next");
    expect(probe.nextOutput).toBe("standalone");
    expect(probe.apiRoutes).toBe(2);
    expect(probe.serverEntry).toBe("server.ts");
    expect(probe.staticDir).toBeNull();
  });

  it("fails clearly on a missing directory", async () => {
    await expect(probeDirectory("/nonexistent/w2t")).rejects.toBeInstanceOf(
      ProbeError,
    );
  });
});
