// SPDX-License-Identifier: Apache-2.0
import { describe, expect, test } from "bun:test";
import { NextRequest } from "next/server";
import { createM3Proxy } from "../src/theme-proxy";

const request = (cookie?: string) =>
  new NextRequest(
    "http://localhost/docs",
    cookie === undefined ? {} : { headers: { cookie } },
  );

describe("createM3Proxy", () => {
  const proxy = createM3Proxy();

  test("a request with a valid theme cookie passes through untouched", () => {
    const response = proxy(request("m3-theme=dark"));
    expect(response.headers.get("x-middleware-next")).toBe("1");
    expect(response.cookies.get("m3-theme")).toBeUndefined();
    expect(response.headers.get("x-middleware-request-cookie")).toBeNull();
  });

  test("a request without the cookie is forwarded with the default and sets it for the next one", () => {
    const response = proxy(request("a=1; b=2"));
    expect(response.headers.get("x-middleware-request-cookie")).toBe(
      "a=1; b=2; m3-theme=system",
    );
    const set = response.cookies.get("m3-theme");
    expect(set?.value).toBe("system");
    expect(set?.path).toBe("/");
    expect(set?.maxAge).toBe(31536000);
    expect(set?.sameSite).toBe("lax");
  });

  test("an invalid value is replaced, not appended", () => {
    const response = proxy(request("m3-theme=purple; a=1"));
    expect(response.headers.get("x-middleware-request-cookie")).toBe(
      "a=1; m3-theme=system",
    );
    expect(response.cookies.get("m3-theme")?.value).toBe("system");
  });

  test("no cookie header at all", () => {
    const response = proxy(request());
    expect(response.headers.get("x-middleware-request-cookie")).toBe(
      "m3-theme=system",
    );
  });

  test("a custom cookie name and default mode", () => {
    const custom = createM3Proxy({
      cookieName: "app-theme",
      defaultMode: "light",
    });
    const response = custom(request("m3-theme=dark"));
    expect(response.headers.get("x-middleware-request-cookie")).toBe(
      "m3-theme=dark; app-theme=light",
    );
    expect(response.cookies.get("app-theme")?.value).toBe("light");
  });
});
