// SPDX-License-Identifier: Apache-2.0
import { expect, test } from "bun:test";
import { routesToFetch } from "../src/api.ts";
import { pickEncoding, resolvePort } from "../src/server.ts";

test("compression respects exclusions, quality order and wildcard acceptance", () => {
  expect(pickEncoding("br;q=0, gzip;q=1")).toBe("gzip");
  expect(pickEncoding("gzip;q=0, br;q=0")).toBeUndefined();
  expect(pickEncoding("br;q=0.3, gzip;q=0.8")).toBe("gzip");
  expect(pickEncoding("br;q=0.8, gzip;q=0.3")).toBe("br");
  expect(pickEncoding("*;q=0.5, br;q=0")).toBe("gzip");
  expect(pickEncoding("br;q=invalid, gzip;q=2")).toBeUndefined();
});

test("route precedence favors the first static segment over deeper parameter routes", async () => {
  const handler = routesToFetch({
    "/api/:id/settings": () => new Response("parameter"),
    "/api/admin/:page": () => new Response("static"),
    "/api/*": () => new Response("wildcard"),
  });
  expect(await (await handler(new Request("http://m3.test/api/admin/settings")))!.text()).toBe(
    "static",
  );
  expect(await (await handler(new Request("http://m3.test/api/a/settings")))!.text()).toBe(
    "parameter",
  );
  expect(await (await handler(new Request("http://m3.test/api/other/page")))!.text()).toBe(
    "wildcard",
  );
});

test("malformed parameters return 400 and HEAD has no response body", async () => {
  const handler = routesToFetch({
    "/api/:id": () => new Response("body", { headers: { "x-contract": "kept" } }),
  });
  expect((await handler(new Request("http://m3.test/api/%ZZ")))!.status).toBe(400);
  const head = await handler(new Request("http://m3.test/api/item", { method: "HEAD" }));
  expect(head!.headers.get("x-contract")).toBe("kept");
  expect(await head!.text()).toBe("");
});

test("m3-bun ignores invalid environment ports and validates explicit ports", () => {
  const saved = Bun.env.PORT;
  try {
    for (const invalid of ["", " ", "65536", "-1", "1.5"]) {
      Bun.env.PORT = invalid;
      expect(resolvePort(4000)).toBe(4000);
    }
    expect(() => resolvePort(65536)).toThrow("invalid port");
  } finally {
    if (saved === undefined) delete Bun.env.PORT;
    else Bun.env.PORT = saved;
  }
});
