// SPDX-License-Identifier: Apache-2.0
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  createHandler,
  formatSize,
  renderIndex,
  resolveFile,
  resolveSiteFile,
  serverOptions,
  siteOptions,
} from "@aphrody/product/downloads";

test("cloud ingress and relocated downloads honor configuration and reject invalid ports", () => {
  expect(
    serverOptions({ DOWNLOADS_ROOT: tmpdir(), PORT: "8080", HOST: "0.0.0.0" }),
  ).toEqual({
    root: tmpdir(),
    port: 8080,
    hostname: "0.0.0.0",
  });
  expect(serverOptions({ DOWNLOADS_PORT: "0", PORT: "8080" }).port).toBe(0);
  for (const PORT of ["-1", "65536", "NaN", "80oops"])
    expect(() => serverOptions({ PORT })).toThrow("integer");
});

let root: string;
let published: string;
let outside: string;
const payload = "0123456789abcdef";

beforeAll(() => {
  published = mkdtempSync(join(tmpdir(), "downloads-"));
  root = join(published, "current");
  mkdirSync(join(published, "releases", "r1"), { recursive: true });
  symlinkSync(join(published, "releases", "r1"), root);
  outside = mkdtempSync(join(tmpdir(), "downloads-outside-"));
  mkdirSync(join(root, "files"));
  writeFileSync(join(root, "files", "tool-1.0.0.tar.gz"), payload);
  writeFileSync(
    join(root, "files", "tool-1.0.0.tar.gz.sha256"),
    "abc  tool-1.0.0.tar.gz\n",
  );
  writeFileSync(join(outside, "secret.txt"), "secret");
  symlinkSync(join(outside, "secret.txt"), join(root, "files", "escape"));
  writeFileSync(join(root, "install.sh"), "#!/bin/sh\n");
  writeFileSync(join(root, "install.ps1"), "Write-Output pinned\n");
  writeFileSync(join(root, "SHA256SUMS"), "abc  tool-1.0.0.tar.gz\n");
  writeFileSync(join(root, "files", "credentials.json"), "private");
  symlinkSync(join(outside, "secret.txt"), join(root, "icon.svg"));
  symlinkSync(outside, join(published, "releases", "escape"));
  symlinkSync(
    join(published, "releases", "r1"),
    join(published, "releases", "alias"),
  );
  mkdirSync(join(published, "releases", "r2", "files"), { recursive: true });
  writeFileSync(
    join(published, "releases", "r2", "files", "tool-1.0.0.tar.gz"),
    "replacement",
  );
  writeFileSync(
    join(published, "releases", "r2", "latest.json"),
    JSON.stringify({ schemaVersion: 1, release: { id: "r2" }, artifacts: [] }),
  );
  writeFileSync(
    join(published, "releases", "r2", "manifest.json"),
    JSON.stringify({ release: { id: "r2" } }),
  );
  writeFileSync(
    join(root, "latest.json"),
    JSON.stringify({
      schemaVersion: 1,
      generatedAt: "2026-10-06T00:00:00Z",
      release: { id: "r1", commit: "0123456789abcdef" },
      baseUrl: "https://example.test",
      artifacts: [
        {
          name: "tool",
          version: "1.0.0",
          platform: "linux-x86_64",
          url: "https://example.test/files/tool-1.0.0.tar.gz",
          sha256: "abc",
          size: 16,
        },
      ],
    }),
  );
});

afterAll(() => {
  rmSync(published, { recursive: true, force: true });
  rmSync(outside, { recursive: true, force: true });
});

const get = (path: string, init?: RequestInit) =>
  createHandler(root)(new Request(`http://local${path}`, init));

describe("download server", () => {
  test("serves the manifest, installer and index", async () => {
    expect((await get("/latest.json")).status).toBe(200);
    expect(await (await get("/install.sh")).text()).toContain("#!/bin/sh");
    const index = await (await get("/")).text();
    expect(index).toContain("https://example.test/install.sh");
  });

  test("health reflects the published manifest", async () => {
    const ok = await get("/health");
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({
      ok: true,
      release: "r1",
      artifacts: 1,
    });
    const empty = await createHandler(join(root, "missing"))(
      new Request("http://local/healthz"),
    );
    expect(empty.status).toBe(503);
  });

  test("serves files with ranges and refuses traversal and symlink escapes", async () => {
    const full = await get("/files/tool-1.0.0.tar.gz");
    expect(await full.text()).toBe(payload);
    expect(full.headers.get("content-length")).toBe("16");
    const part = await get("/files/tool-1.0.0.tar.gz", {
      headers: { range: "bytes=4-7" },
    });
    expect(part.status).toBe(206);
    expect(await part.text()).toBe("4567");
    expect(part.headers.get("content-range")).toBe("bytes 4-7/16");
    const tail = await get("/files/tool-1.0.0.tar.gz", {
      headers: { range: "bytes=-4" },
    });
    expect(await tail.text()).toBe("cdef");
    expect(
      (
        await get("/files/tool-1.0.0.tar.gz", {
          headers: { range: "bytes=99-" },
        })
      ).status,
    ).toBe(416);
    expect((await get("/files/..%2Finstall.sh")).status).toBe(404);
    expect((await get("/files/escape")).status).toBe(404);
    expect(resolveFile(root, "../install.sh")).toBeNull();
    expect(resolveFile(root, ".hidden")).toBeNull();
  });

  test("pins manifest, checksums, installers and ranged artifacts across current flips", async () => {
    const pinned = "/releases/r1";
    expect((await (await get(`${pinned}/latest.json`)).json()).release.id).toBe(
      "r1",
    );
    expect(
      (await get(`${pinned}/latest.json`)).headers.get("cache-control"),
    ).toContain("immutable");
    expect(await (await get(`${pinned}/SHA256SUMS`)).text()).toContain("abc");
    expect(await (await get(`${pinned}/install.ps1`)).text()).toContain(
      "pinned",
    );
    expect((await get("/install.ps1")).status).toBe(200);
    expect((await get(`${pinned}/manifest.json`)).status).toBe(404);
    expect(
      (await (await get("/releases/r2/manifest.json")).json()).release.id,
    ).toBe("r2");
    const part = await get(`${pinned}/files/tool-1.0.0.tar.gz`, {
      headers: { range: "bytes=2-5" },
    });
    expect(part.status).toBe(206);
    expect(await part.text()).toBe("2345");
    const head = await get(`${pinned}/files/tool-1.0.0.tar.gz`, {
      method: "HEAD",
    });
    expect(head.headers.get("content-length")).toBe("16");
    expect(await head.text()).toBe("");
    rmSync(root);
    symlinkSync(join(published, "releases", "r2"), root);
    try {
      expect((await (await get("/latest.json")).json()).release.id).toBe("r2");
      expect(await (await get("/files/tool-1.0.0.tar.gz")).text()).toBe(
        "replacement",
      );
      expect(
        await (await get(`${pinned}/files/tool-1.0.0.tar.gz`)).text(),
      ).toBe(payload);
    } finally {
      rmSync(root);
      symlinkSync(join(published, "releases", "r1"), root);
    }
  });

  test("rejects unsafe release IDs, hidden files, credentials and all symlink escapes", async () => {
    const forbidden = [
      "/releases/escape/latest.json",
      "/releases/alias/latest.json",
      "/releases/missing/latest.json",
      "/releases/%2e%2e%2foutside/latest.json",
      "/releases/r1%5cescape/latest.json",
      `/releases/${"r".repeat(129)}/latest.json`,
      "/releases/r1/files/..%2finstall.sh",
      "/releases/r1/files/.env",
      "/releases/r1/files/credentials.json",
      "/releases/r1/files/escape",
      "/releases/r1/icon.svg",
      "/icon.svg",
    ];
    const responses = await Promise.all(forbidden.map((path) => get(path)));
    expect(responses.every((response) => response.status === 404)).toBe(true);
    expect((await get("/releases/%FF/latest.json")).status).toBe(400);
    expect((await get("/releases/r1/files/%FF")).status).toBe(400);
    const escapedFiles = join(published, "releases", "escaped-files");
    mkdirSync(escapedFiles);
    symlinkSync(outside, join(escapedFiles, "files"));
    expect((await get("/releases/escaped-files/files/secret.txt")).status).toBe(
      404,
    );
  });

  test("is read only", async () => {
    const response = await get("/files/tool-1.0.0.tar.gz", {
      method: "POST",
      body: "x",
    });
    expect(response.status).toBe(405);
    expect(
      (await get("/files/tool-1.0.0.tar.gz", { method: "HEAD" })).status,
    ).toBe(200);
  });

  test("renders without a release and escapes names", () => {
    expect(renderIndex(null)).toContain("install.ps1");
    expect(formatSize(1536)).toBe("1.5 KiB");
    const html = renderIndex({
      schemaVersion: 1,
      generatedAt: "x",
      release: { id: "<script>" },
      baseUrl: "",
      artifacts: [],
    });
    expect(html).not.toContain("<script>x");
  });
});

describe("site hosts", () => {
  let siteBase: string;
  let site: ReturnType<typeof siteOptions>;
  beforeAll(() => {
    siteBase = mkdtempSync(join(tmpdir(), "site-"));
    const tree = join(siteBase, "releases", "s1");
    mkdirSync(join(tree, "docs", "runtime"), { recursive: true });
    writeFileSync(join(tree, "index.html"), "<h1>home</h1>");
    writeFileSync(join(tree, "404.html"), "<h1>missing</h1>");
    writeFileSync(join(tree, "install"), "#!/usr/bin/env bash\necho bun\n");
    writeFileSync(join(tree, "docs", "index.html"), "<h1>docs</h1>");
    writeFileSync(
      join(tree, "docs", "runtime", "index.html"),
      "<h1>runtime</h1>",
    );
    writeFileSync(join(tree, "docs", "quickstart.html"), "<h1>quickstart</h1>");
    writeFileSync(join(tree, "docs", "quickstart.md"), "# Quickstart\n");
    writeFileSync(join(tree, "llms.txt"), "# Bun\n");
    writeFileSync(join(tree, "site.webmanifest"), "{}");
    writeFileSync(
      join(tree, "llms.txt.gz"),
      Bun.gzipSync(Buffer.from("# Bun\n")),
    );
    symlinkSync(join(outside, "secret.txt"), join(tree, "leak.txt"));
    symlinkSync(tree, join(siteBase, "current"));
    site = siteOptions(root, {
      SITE_ROOT: join(siteBase, "current"),
      SITE_HOSTS: "aphrody.test",
    });
  });
  afterAll(() => rmSync(siteBase, { recursive: true, force: true }));

  const at = (host: string, path: string, init?: RequestInit) =>
    createHandler(root, site)(new Request(`http://${host}${path}`, init));

  test("defaults next to the download tree", () => {
    const options = siteOptions("/home/ubuntu/apps/downloads/current", {});
    expect(options.root).toBe(
      resolve("/home/ubuntu/apps/downloads/site/current"),
    );
    expect([...options.hosts]).toEqual(["aphrody.com", "www.aphrody.com"]);
  });

  test("serves pages, markdown, installers and precompressed text on site hosts", async () => {
    expect(await (await at("aphrody.test", "/")).text()).toBe("<h1>home</h1>");
    expect(await (await at("aphrody.test", "/docs")).text()).toBe(
      "<h1>docs</h1>",
    );
    expect(await (await at("aphrody.test", "/docs/runtime/")).text()).toBe(
      "<h1>runtime</h1>",
    );
    expect(await (await at("aphrody.test", "/docs/quickstart")).text()).toBe(
      "<h1>quickstart</h1>",
    );
    const md = await at("aphrody.test", "/docs/quickstart.md");
    expect(md.headers.get("content-type")).toContain("text/markdown");
    const install = await at("aphrody.test", "/install");
    expect(install.headers.get("content-type")).toContain("text/plain");
    expect(await install.text()).toContain("echo bun");
    const gz = await at("aphrody.test", "/llms.txt", {
      headers: { "accept-encoding": "gzip, br" },
    });
    expect(gz.headers.get("content-encoding")).toBe("gzip");
    expect((await at("aphrody.test", "/docs", { method: "HEAD" })).status).toBe(
      200,
    );
  });

  test("web app manifest type and a CSP that admits the brand CDN", async () => {
    const manifest = await at("aphrody.test", "/site.webmanifest");
    expect(manifest.headers.get("content-type")).toBe(
      "application/manifest+json",
    );
    const csp = (await at("aphrody.test", "/")).headers.get(
      "content-security-policy",
    );
    expect(csp).toContain(
      "style-src 'self' 'unsafe-inline' https://cdn.aphrody.com;",
    );
    expect(csp).toContain(
      "font-src 'self' https://cdn.aphrody.com https://assets.aphrody.app;",
    );
    expect(csp).toContain(
      "connect-src 'self' https://api.github.com https://assets.aphrody.app;",
    );
  });

  test("falls back to downloads, then to the site 404, and keeps other hosts untouched", async () => {
    expect(
      (await (await at("aphrody.test", "/latest.json")).json()).release.id,
    ).toBe("r1");
    expect(
      await (await at("aphrody.test", "/files/tool-1.0.0.tar.gz")).text(),
    ).toBe(payload);
    const missing = await at("aphrody.test", "/nope");
    expect(missing.status).toBe(404);
    expect(await missing.text()).toBe("<h1>missing</h1>");
    expect(await (await at("downloads.test", "/")).text()).toContain(
      "https://example.test/install.sh",
    );
    expect((await at("aphrody.test", "/health")).status).toBe(200);
  });

  test("refuses traversal, hidden paths and symlink escapes", async () => {
    const paths = [
      "/..%2f..%2fetc%2fpasswd",
      "/.git/config",
      "/leak.txt",
      "/docs/%5c..%5cindex.html",
    ];
    const statuses = await Promise.all(
      paths.map(async (path) => (await at("aphrody.test", path)).status),
    );
    expect(statuses).toEqual([404, 404, 404, 404]);
    expect(resolveSiteFile(site.root, "/%FF")).toBeNull();
  });
});
