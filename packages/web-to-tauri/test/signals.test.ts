// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "bun:test";
import {
  detectApis,
  detectEmbeds,
  detectFrameworks,
  detectIdps,
  detectProxyPrefixes,
  extractOrigins,
  extractUrls,
  isChromiumOnly,
  parseSetCookies,
} from "../src/signals.ts";

describe("signals", () => {
  it("finds browser APIs and flags the Chromium-only ones", () => {
    const apis = detectApis(
      `navigator.serviceWorker.register("/sw.js"); new WebSocket("wss://x.test"); await window.showOpenFilePicker(); navigator.gpu.requestAdapter()`,
    );
    expect(apis).toEqual([
      "service-worker",
      "websocket",
      "file-system-access",
      "webgpu",
    ]);
    expect(isChromiumOnly("file-system-access")).toBe(true);
    expect(isChromiumOnly("websocket")).toBe(false);
  });

  it("does not report APIs that are only mentioned in prose", () => {
    expect(
      detectApis("Learn about service workers and WebSockets in this guide."),
    ).toEqual([]);
  });

  it("detects user-agent branching", () => {
    expect(detectApis(`if (/Chrome/.test(navigator.userAgent)) {}`)).toContain(
      "user-agent-sniffing",
    );
    expect(detectApis(`const ua = navigator.userAgent; log(ua)`)).not.toContain(
      "user-agent-sniffing",
    );
  });

  it("detects frameworks from markup and headers", () => {
    expect(
      detectFrameworks(`<script id="__NEXT_DATA__"></script>`, ""),
    ).toContain("next");
    expect(detectFrameworks(`<link href="/wp-content/x.css">`, "")).toContain(
      "wordpress",
    );
    expect(
      detectFrameworks("<html></html>", "x-powered-by: Next.js"),
    ).toContain("next");
    expect(detectFrameworks("<html></html>", "")).toEqual([]);
  });

  it("extracts origins of http, https and ws URLs", () => {
    expect(
      extractOrigins(
        `fetch("https://API.Example.com:8443/v1"); new WebSocket("wss://rt.example.com/s"); http://localhost:3000/x http://127.0.0.1:9`,
      ).toSorted(),
    ).toEqual([
      "http://127.0.0.1:9",
      "http://localhost:3000",
      "https://api.example.com:8443",
      "https://rt.example.com",
    ]);
  });

  it("extracts full URLs without trailing punctuation", () => {
    expect(
      extractUrls(
        `see https://a.example.com/x?y=1#z. and "wss://rt.example.com/s", <https://b.test/>`,
      ).toSorted(),
    ).toEqual([
      "https://a.example.com/x?y=1#z",
      "https://b.test/",
      "https://rt.example.com/s",
    ]);
  });

  it("counts a path-scoped provider only when the page points at that path", () => {
    expect(
      detectIdps([
        "https://github.com/aphrody-code",
        "https://github.com/login",
      ]),
    ).toEqual([]);
    expect(
      detectIdps(["https://github.com/login/oauth/authorize?client_id=1"]).map(
        (entry) => entry.id,
      ),
    ).toEqual(["github"]);
    expect(
      detectIdps(["https://www.facebook.com/v19.0/dialog/oauth"]).map(
        (entry) => entry.id,
      ),
    ).toEqual(["facebook"]);
    expect(detectIdps(["https://www.facebook.com/somepage"])).toEqual([]);
  });

  it("finds embed providers from frames and scripts, not from the hosts alone", () => {
    expect(
      detectEmbeds([
        "https://www.youtube.com/embed/abc",
        "https://js.stripe.com/v3/",
        "https://example.com/",
      ])
        .map((entry) => entry.id)
        .toSorted(),
    ).toEqual(["stripe-js", "youtube"]);
    expect(detectEmbeds(["not a url"])).toEqual([]);
  });

  it("identifies sign-in and payment providers from their origins", () => {
    const found = detectIdps([
      "https://accounts.google.com",
      "https://tenant.auth0.com",
      "https://checkout.stripe.com",
      "https://example.com",
    ]);
    expect(found.map((entry) => entry.id).toSorted()).toEqual([
      "auth0",
      "google",
      "stripe",
    ]);
    expect(found.find((entry) => entry.id === "stripe")?.kind).toBe("payment");
    expect(detectIdps(["https://accounts.google.com.evil.test"])).toEqual([]);
  });

  it("parses Set-Cookie attributes without keeping values", () => {
    const [session, host] = parseSetCookies([
      "sid=abc123; Path=/; Domain=example.com; Secure; HttpOnly; SameSite=None; Partitioned",
      "__Host-t=1; Secure; Path=/",
    ]);
    expect(session).toEqual({
      name: "sid",
      domain: "example.com",
      path: "/",
      secure: true,
      httpOnly: true,
      sameSite: "none",
      partitioned: true,
      prefixed: false,
    });
    expect(host?.prefixed).toBe(true);
    expect(JSON.stringify(session)).not.toContain("abc123");
  });

  it("finds backend route prefixes in bundled code", () => {
    expect(
      detectProxyPrefixes(
        `fetch("/api/users"); fetch('/graphql'); const u = \`/trpc/x\`; "/apixyz"; "/about"`,
      ),
    ).toEqual(["/api", "/graphql", "/trpc"]);
  });
});
