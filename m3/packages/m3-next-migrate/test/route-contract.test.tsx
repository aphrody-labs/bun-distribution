// SPDX-License-Identifier: Apache-2.0
import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { buildRouteHierarchy, generateAppRouterCode, matchRoutePath } from "../src/layout";
import { useParams } from "../src/shims/navigation";
import { NextMigrateProvider, RouteParamsProvider } from "../src/shims/provider";

function RouteParamProbe() {
  return <span>{JSON.stringify(useParams())}</span>;
}

describe("migrated App Router contract", () => {
  test("src/app and route groups keep their layout ownership without changing URLs", () => {
    const tree = buildRouteHierarchy([
      "src/app/layout.tsx",
      "src/app/(account)/layout.tsx",
      "src/app/(account)/settings/page.tsx",
      "src/app/(account)/settings/layout.tsx",
      "src/app/_private/page.tsx",
    ]);
    expect(tree.rootLayout).toBe("src/app/layout.tsx");
    expect(tree.routes).toHaveLength(1);
    expect(tree.routes[0]?.routePath).toBe("/settings");
    expect(tree.routes[0]?.layouts).toEqual([
      "src/app/layout.tsx",
      "src/app/(account)/layout.tsx",
      "src/app/(account)/settings/layout.tsx",
    ]);
  });

  test("catch-all and optional catch-all produce decoded arrays under the original param name", () => {
    const tree = buildRouteHierarchy([
      "app/docs/[...slug]/page.tsx",
      "app/shop/[[...segments]]/page.tsx",
    ]);
    expect(tree.routes.map((route) => route.routePath)).toEqual([
      "/docs/:slug*",
      "/shop/:segments*?",
    ]);
    expect(matchRoutePath("/docs/:slug*", "/docs/first/hello%20world/")).toEqual({
      slug: ["first", "hello world"],
    });
    expect(matchRoutePath("/docs/:slug*", "/docs")).toBeNull();
    expect(matchRoutePath("/shop/:segments*?", "/shop")).toEqual({});
    expect(matchRoutePath("/shop/:segments*?", "/shop/a/b")).toEqual({ segments: ["a", "b"] });
    expect(matchRoutePath("/docs/:slug*", "/docs/%E0%A4")).toBeNull();
  });

  test("static segments win at each route level and regex punctuation stays literal", () => {
    const tree = buildRouteHierarchy([
      "app/[id]/[tab]/page.tsx",
      "app/[id]/settings/page.tsx",
      "app/posts/[id]/page.tsx",
      "app/posts/new/page.tsx",
    ]);
    expect(tree.routes.findIndex((route) => route.routePath === "/posts/new")).toBeLessThan(
      tree.routes.findIndex((route) => route.routePath === "/posts/:id"),
    );
    expect(tree.routes.findIndex((route) => route.routePath === "/:id/settings")).toBeLessThan(
      tree.routes.findIndex((route) => route.routePath === "/:id/:tab"),
    );
    expect(matchRoutePath("/v1.0/:id", "/v1X0/42")).toBeNull();
    expect(matchRoutePath("/v1.0/:id", "/v1.0/a%2Fb")).toEqual({ id: "a/b" });
  });

  test("generated router passes params to hooks and search parameters to page props", () => {
    const markup = renderToStaticMarkup(
      <NextMigrateProvider initialPath="/docs/a/b" mode="browser">
        <RouteParamsProvider params={{ slug: ["a", "b"] }}>
          <RouteParamProbe />
        </RouteParamsProvider>
      </NextMigrateProvider>,
    );
    expect(markup).toContain("slug");
    expect(markup).toContain("a");
    expect(markup).toContain("b");
    const code = generateAppRouterCode(buildRouteHierarchy(["app/docs/[...slug]/page.tsx"]));
    expect(code).toContain('matchRoutePath("/docs/:slug*", cleanPath)');
    expect(code).toContain("<RouteParamsProvider params={routeParams}>");
    expect(code).toContain("{ params: routeParams, searchParams }");
    expect(code).toContain("query.getAll(key)");
    expect(() => new Bun.Transpiler({ loader: "tsx" }).transformSync(code)).not.toThrow();
  });

  test("a missing host adapter for intercepted or parallel routes fails before generating wrong routes", () => {
    expect(() => buildRouteHierarchy(["app/@modal/photo/page.tsx"])).toThrow("host adapter");
    expect(() => buildRouteHierarchy(["app/(.)photo/page.tsx"])).toThrow("host adapter");
  });
});
