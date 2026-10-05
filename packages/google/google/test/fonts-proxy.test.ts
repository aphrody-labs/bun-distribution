import { expect, test } from "bun:test";
import { fontsRoute, gstaticId, requestedFamilies } from "../src/fonts-proxy.ts";

const opts = { cacheDir: "/tmp/unused", origin: "https://cdn.aphrody.com/" };
const route = (path: string, families?: string[] | null) =>
  fontsRoute(new URL(`https://cdn.aphrody.com${path}`), { ...opts, families });

test("family names from css2 and css v1 queries", () => {
  expect(
    requestedFamilies(
      new URLSearchParams("family=Roboto+Flex:opsz,wght@8..144,100..1000&family=Noto+Sans+JP"),
    ),
  ).toEqual(["Roboto Flex", "Noto Sans JP"]);
  expect(
    requestedFamilies(new URLSearchParams("family=Roboto+Mono:400,700|M+PLUS+1+Code")),
  ).toEqual(["Roboto Mono", "M PLUS 1 Code"]);
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
  expect(svg.cacheKey).toBe(
    "s/i/short-term/release/materialsymbolsoutlined/home/wght300fill1/24px.svg",
  );
  expect((route("/s/i/materialicons/home/v12/24px.svg") as Response).status).toBe(403);
  expect(route("/s/robotoflex/../../etc/passwd")).toBeNull();
  expect(route("/favicon.ico")).toBeNull();
});
