// SPDX-License-Identifier: Apache-2.0
import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { matcherToRegExp } from "../../src/app/runtime/matcher.ts";
import { fillPattern, findRoute, matchRoute, parsePattern, scanApp } from "../../src/app/scan.ts";

const FIXTURE = join(import.meta.dir, "../fixtures/app-router");

describe("scanApp", () => {
  const tree = scanApp(FIXTURE);

  test("finds pages, route handlers, metadata routes and the middleware", () => {
    expect(tree.routes.map(r => `${r.kind} ${r.pattern}`).toSorted()).toEqual([
      "page /",
      "page /blog/[slug]",
      "page /dash",
      "route /api/hello",
    ]);
    expect(tree.metadata.map(m => `${m.kind} ${m.pathname}`)).toEqual(["robots /robots.txt"]);
    expect(tree.middleware).toBe("proxy.ts");
    expect(tree.notFound).toBe("app/not-found.tsx");
    expect(tree.rootSegment.files.layout).toBe("app/layout.tsx");
  });

  test("a page carries its segments from the root layout", () => {
    const post = tree.routes.find(r => r.pattern === "/blog/[slug]")!;
    expect(post.file).toBe("app/blog/[slug]/page.tsx");
    expect(post.segments.at(0)?.files.layout).toBe("app/layout.tsx");
    expect(post.segments.at(-1)?.files.loading).toBe("app/blog/[slug]/loading.tsx");
  });

  test("findRoute extracts params and misses unknown paths", () => {
    expect(findRoute(tree.routes, "/blog/first")?.params).toEqual({ slug: "first" });
    expect(findRoute(tree.routes, "/api/hello")?.route.kind).toBe("route");
    expect(findRoute(tree.routes, "/missing/deep")).toBeUndefined();
  });
});

describe("patterns", () => {
  test("parsePattern recognises single, catch-all and optional catch-all params", () => {
    expect(parsePattern("/a/[b]/[...c]")).toEqual([
      { value: "a", kind: "static" },
      { value: "b", kind: "single" },
      { value: "c", kind: "catchall" },
    ]);
    expect(parsePattern("/[[...rest]]")).toEqual([{ value: "rest", kind: "optional" }]);
  });

  test("matchRoute and fillPattern round-trip", () => {
    const route = {
      kind: "page" as const,
      pattern: "/docs/[...path]",
      parts: parsePattern("/docs/[...path]"),
      file: "",
      segments: [],
    };
    const params = matchRoute(route, "/docs/a/b");
    expect(params).toEqual({ path: ["a", "b"] });
    expect(fillPattern(route, params!)).toBe("/docs/a/b");
    expect(matchRoute(route, "/docs")).toBeUndefined();
  });
});

describe("matcherToRegExp", () => {
  test.each([
    ["/about", "/about", true],
    ["/about", "/about/team", false],
    ["/blog/:slug", "/blog/x", true],
    ["/blog/:slug", "/blog/x/y", false],
    ["/docs/:path*", "/docs", true],
    ["/docs/:path*", "/docs/a/b", true],
    ["/docs/:path+", "/docs", false],
    ["/((?!api|_m3).*)", "/dash", true],
    ["/((?!api|_m3).*)", "/api/hello", false],
  ] as const)("%s on %s is %p", (pattern, pathname, expected) => {
    expect(matcherToRegExp(pattern).test(pathname)).toBe(expected);
  });
});
