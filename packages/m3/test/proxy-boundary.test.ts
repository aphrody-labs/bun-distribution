// SPDX-License-Identifier: Apache-2.0
import { expect, test } from "bun:test";
import { createProxy, resolvePort } from "../src/server.ts";

test("a protocol-relative request path cannot replace the configured proxy host", async () => {
  await using upstream = Bun.serve({
    port: 0,
    fetch: (request) =>
      Response.json({ upstream: true, path: new URL(request.url).pathname }),
  });
  await using other = Bun.serve({
    port: 0,
    fetch: () => Response.json({ upstream: false }),
  });
  const request = new Request(
    `http://m3.test//127.0.0.1:${other.port}/secret?x=1`,
  );
  const response = await createProxy(upstream.url.href)(request);
  const body = await response.json();
  expect(body.upstream).toBe(true);
  // Bun normalizes duplicate leading slashes when receiving HTTP requests.
  expect(body.path).toContain(`127.0.0.1:${other.port}/secret`);
});

test("proxy strips connection-specific headers and forwards cancellation", async () => {
  let requests = 0;
  await using upstream = Bun.serve({
    port: 0,
    fetch: (request) => {
      requests++;
      return Response.json({
        private: request.headers.get("x-private-hop"),
        custom: request.headers.get("x-custom"),
      });
    },
  });
  const proxy = createProxy(upstream.url.href);
  const response = await proxy(
    new Request("http://m3.test/api", {
      headers: {
        connection: "x-private-hop",
        "x-private-hop": "remove",
        "x-custom": "keep",
      },
    }),
  );
  expect(await response.json()).toEqual({ private: null, custom: "keep" });
  const controller = new AbortController();
  controller.abort();
  expect(
    (
      await proxy(
        new Request("http://m3.test/api", { signal: controller.signal }),
      )
    ).status,
  ).toBe(502);
  expect(requests).toBe(1);
  expect(() => createProxy("file:///private")).toThrow("HTTP or HTTPS");
});

test("server ports reject invalid explicit values and ignore empty or out-of-range environment values", () => {
  const saved = Bun.env.PORT;
  try {
    for (const invalid of ["", " ", "65536", "-1", "2.5"]) {
      Bun.env.PORT = invalid;
      expect(resolvePort()).toBe(3000);
    }
    expect(resolvePort(0)).toBe(0);
    expect(() => resolvePort(65536)).toThrow("invalid port");
  } finally {
    if (saved === undefined) delete Bun.env.PORT;
    else Bun.env.PORT = saved;
  }
});
