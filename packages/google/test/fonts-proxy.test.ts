import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fontsRoute, gstaticId, requestedFamilies, staticFile, staticFromRoots } from "../src/fonts-proxy.ts";

test("the CDN release tree is served with its type, cache and CORS headers", async () => {
  const root = await mkdtemp(join(tmpdir(), "cdn-release-"));
  try {
    await mkdir(join(root, "h"), { recursive: true });
    await mkdir(join(root, "s/aphrody/brand"), { recursive: true });
    await Bun.write(join(root, "h/0123456789abcdef.ico"), "ico");
    await Bun.write(join(root, "h/0123456789abcdef.woff2"), "woff2");
    await Bun.write(join(root, "s/aphrody/brand/aphrody-fonts.css"), "css");
    await Bun.write(join(root, "s/manifest.json"), "{}");

    const ico = await staticFile(root, "/h/0123456789abcdef.ico");
    expect(ico?.headers.get("content-type")).toBe("image/x-icon");
    expect(ico?.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
    expect(ico?.headers.get("access-control-allow-origin")).toBe("*");
    expect(await ico?.text()).toBe("ico");
    const font = await staticFile(root, "/h/0123456789abcdef.woff2");
    expect(font?.headers.get("content-type")).toBe("font/woff2");
    const css = await staticFile(root, "/s/aphrody/brand/aphrody-fonts.css");
    expect(css?.headers.get("content-type")).toBe("text/css; charset=utf-8");
    expect(css?.headers.get("cache-control")).toStartWith("public, max-age=3600");
    const manifest = await staticFile(root, "/s/manifest.json");
    expect(manifest?.headers.get("cache-control")).toBe("public, max-age=60, must-revalidate");

    expect(await staticFile(root, "/s/aphrody/brand")).toBeNull();
    expect(await staticFile(root, "/s/robotoflex/v30/abc.woff2")).toBeNull();
    expect(await staticFile(root, "/s/../h/0123456789abcdef.ico")).toBeNull();
    expect(await staticFile(root, "/favicon.ico")).toBeNull();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("several release roots are tried in order", async () => {
  const base = await mkdtemp(join(tmpdir(), "cdn-roots-"));
  try {
    const catalog = join(base, "current");
    const symbols = join(base, "symbols");
    await mkdir(join(catalog, "h"), { recursive: true });
    await mkdir(join(symbols, "h"), { recursive: true });
    await mkdir(join(symbols, "s/symbols"), { recursive: true });
    await Bun.write(join(catalog, "h/aaaaaaaaaaaaaaaa.css"), "catalog");
    await Bun.write(join(symbols, "h/aaaaaaaaaaaaaaaa.css"), "symbols");
    await Bun.write(join(symbols, "h/bbbbbbbbbbbbbbbb.ttf"), "ttf");
    await Bun.write(join(symbols, "s/symbols/material-symbols.css"), "css");
    const roots = [join(base, "missing"), catalog, symbols];

    expect(await (await staticFromRoots(roots, "/h/aaaaaaaaaaaaaaaa.css"))?.text()).toBe("catalog");
    const ttf = await staticFromRoots(roots, "/h/bbbbbbbbbbbbbbbb.ttf");
    expect(ttf?.headers.get("content-type")).toBe("font/ttf");
    expect(ttf?.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
    expect(await (await staticFromRoots(roots, "/s/symbols/material-symbols.css"))?.text()).toBe("css");
    expect(await staticFromRoots(roots, "/h/cccccccccccccccc.woff2")).toBeNull();
    expect(await staticFromRoots([], "/h/aaaaaaaaaaaaaaaa.css")).toBeNull();
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

const opts = { cacheDir: "/tmp/unused", origin: "https://cdn.aphrody.com/" };
const route = (path: string, families?: string[] | null) =>
  fontsRoute(new URL(`https://cdn.aphrody.com${path}`), { ...opts, families });

test("family names from css2 and css v1 queries", () => {
  expect(
    requestedFamilies(new URLSearchParams("family=Roboto+Flex:opsz,wght@8..144,100..1000&family=Noto+Sans+JP")),
  ).toEqual(["Roboto Flex", "Noto Sans JP"]);
  expect(requestedFamilies(new URLSearchParams("family=Roboto+Mono:400,700|M+PLUS+1+Code"))).toEqual([
    "Roboto Mono",
    "M PLUS 1 Code",
  ]);
  expect(gstaticId("M PLUS 1 Code")).toBe("mplus1code");
});

test("css2 for M3 families goes to fonts.googleapis.com and rewrites gstatic", () => {
  const r = route("/css2?family=Google+Sans+Flex:wght@400;700&display=swap");
  if (!r || r instanceof Response) throw new Error("expected a route");
  expect(r.upstream.origin).toBe("https://fonts.googleapis.com");
  expect(r.upstream.pathname).toBe("/css2");
  expect(r.kind).toBe("text");
  expect(r.cacheKey).toMatch(/^css\/css2\/[0-9a-f]{32}\.css$/);
  expect(r.headers?.["user-agent"]).toContain("Chrome/");
  expect(r.transform!("src: url(https://fonts.gstatic.com/s/googlesansflex/v1/a.woff2)")).toBe(
    "src: url(https://cdn.aphrody.com/s/googlesansflex/v1/a.woff2)",
  );
});

test("non-M3 families are refused unless every family is allowed", () => {
  expect((route("/css2?family=Lobster") as Response).status).toBe(403);
  expect((route("/s/lobster/v30/abc.woff2") as Response).status).toBe(403);
  const open = route("/css2?family=Lobster", null);
  expect(open && !(open instanceof Response)).toBe(true);
  expect((route("/css2") as Response).status).toBe(400);
});

test("gstatic font files and Material Symbols SVGs map to the same path", () => {
  const font = route("/s/robotoflex/v30/abcDEF_-12.woff2");
  if (!font || font instanceof Response) throw new Error("expected a route");
  expect(font.upstream.href).toBe("https://fonts.gstatic.com/s/robotoflex/v30/abcDEF_-12.woff2");
  expect(font.kind).toBe("immutable");
  const svg = route("/s/i/short-term/release/materialsymbolsoutlined/home/wght300fill1/24px.svg");
  if (!svg || svg instanceof Response) throw new Error("expected a route");
  expect(svg.cacheKey).toBe("s/i/short-term/release/materialsymbolsoutlined/home/wght300fill1/24px.svg");
  expect((route("/s/i/materialicons/home/v12/24px.svg") as Response).status).toBe(403);
  expect(route("/s/robotoflex/../../etc/passwd")).toBeNull();
  expect(route("/favicon.ico")).toBeNull();
});
