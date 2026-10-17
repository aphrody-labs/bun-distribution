// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "bun:test";
import { OAUTH2_TOKEN_URLS, OvhClient, selectAuthMode, sha1, v2BaseUrl } from "../src/client.js";

describe("OvhClient pure Bun cryptographic signing", () => {
  it("computes accurate SHA-1 hex digest", () => {
    // SHA1("") = da39a3ee5e6b4b0d3255bfef95601890afd80709
    expect(sha1("")).toBe("da39a3ee5e6b4b0d3255bfef95601890afd80709");
    // SHA1("aphrody") = 1a9c55099105fe738f75ed2b220beaf809702dd8
    expect(sha1("aphrody")).toBe("1a9c55099105fe738f75ed2b220beaf809702dd8");
  });

  it("formats OVH signature adhering to $1$ + SHA1 spec", () => {
    const client = new OvhClient({
      applicationKey: "test_ak",
      applicationSecret: "test_as",
      consumerKey: "test_ck",
    });

    const method = "GET";
    const url = "https://eu.api.ovh.com/1.0/domain/zone";
    const bodyStr = "";
    const timestamp = 1700000000;

    // raw = "test_as+test_ck+GET+https://eu.api.ovh.com/1.0/domain/zone++1700000000"
    const raw = "test_as+test_ck+GET+https://eu.api.ovh.com/1.0/domain/zone++1700000000";
    const expectedSig = `$1$${sha1(raw)}`;

    const actualSig = client.sign(method, url, bodyStr, timestamp);
    expect(actualSig).toBe(expectedSig);
    expect(actualSig.startsWith("$1$")).toBe(true);
  });

  it("handles endpoint selection correctly", () => {
    const euClient = new OvhClient({
      applicationKey: "ak",
      applicationSecret: "as",
      consumerKey: "ck",
      endpoint: "ovh-eu",
    });
    expect(euClient.baseUrl).toBe("https://eu.api.ovh.com/1.0");

    const caClient = new OvhClient({
      applicationKey: "ak",
      applicationSecret: "as",
      consumerKey: "ck",
      endpoint: "ovh-ca",
    });
    expect(caClient.baseUrl).toBe("https://ca.api.ovh.com/1.0");

    const customClient = new OvhClient({
      applicationKey: "ak",
      applicationSecret: "as",
      consumerKey: "ck",
      endpoint: "https://custom.ovh.mock/1.0",
    });
    expect(customClient.baseUrl).toBe("https://custom.ovh.mock/1.0");
  });
});

it("dispatches bodyless signed GET and signed JSON POST to the actual HTTP boundary", async () => {
  const requests: {
    method: string;
    body: string;
    signature: string | null;
    timestamp: string | null;
    url: string;
  }[] = [];
  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    async fetch(request) {
      if (new URL(request.url).pathname === "/auth/time") return new Response(String(Math.floor(Date.now() / 1000)));
      requests.push({
        method: request.method,
        body: await request.text(),
        signature: request.headers.get("X-Ovh-Signature"),
        timestamp: request.headers.get("X-Ovh-Timestamp"),
        url: request.url,
      });
      return Response.json({ ok: true });
    },
  });
  try {
    const client = new OvhClient({
      applicationKey: "fixture",
      applicationSecret: "fixture",
      consumerKey: "fixture",
      endpoint: server.url.toString().replace(/\/$/, ""),
    });
    await expect(client.request("GET", "/zone", { invalid: true })).rejects.toThrow("cannot have a body");
    expect(requests).toHaveLength(0);
    await client.get("/zone", { search: "a & b" });
    await client.post("/zone", { fieldType: "A" });
    expect(requests[0]!.body).toBe("");
    expect(new URL(requests[0]!.url).searchParams.get("search")).toBe("a & b");
    expect(requests[1]!.body).toBe('{"fieldType":"A"}');
    for (const request of requests)
      expect(request.signature).toBe(client.sign(request.method, request.url, request.body, Number(request.timestamp)));
  } finally {
    server.stop(true);
  }
});

describe("OvhClient OAuth2 service account", () => {
  const TOKEN_PATH = "/auth/oauth2/token";

  function oauthServer(options: { expiresIn?: number; rejectFirstApiCall?: boolean } = {}) {
    const state = {
      tokens: 0,
      tokenForms: [] as string[],
      apiAuth: [] as (string | null)[],
    };
    let rejected = false;
    const server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      async fetch(request) {
        const url = new URL(request.url);
        if (url.pathname === TOKEN_PATH) {
          state.tokens += 1;
          state.tokenForms.push(await request.text());
          return Response.json({
            access_token: `token-${state.tokens}`,
            token_type: "Bearer",
            expires_in: options.expiresIn ?? 3599,
          });
        }
        state.apiAuth.push(request.headers.get("Authorization"));
        if (options.rejectFirstApiCall && !rejected) {
          rejected = true;
          return Response.json({ message: "token expired" }, { status: 401 });
        }
        return Response.json({
          path: url.pathname,
          signed: request.headers.has("X-Ovh-Signature"),
        });
      },
    });
    const base = server.url.toString().replace(/\/$/, "");
    return { server, state, base };
  }

  it("selects the mode: OAuth2 pair wins over the triplet", () => {
    expect(selectAuthMode({ clientId: "i", clientSecret: "s" })).toBe("oauth2");
    expect(
      selectAuthMode({
        clientId: "i",
        clientSecret: "s",
        applicationKey: "a",
        applicationSecret: "b",
        consumerKey: "c",
      }),
    ).toBe("oauth2");
    expect(
      selectAuthMode({
        applicationKey: "a",
        applicationSecret: "b",
        consumerKey: "c",
      }),
    ).toBe("application_key");
    expect(selectAuthMode({ clientId: "only-half" })).toBeNull();
    expect(() => new OvhClient({ clientId: "only-half" })).toThrow("missing credentials");
  });

  it("knows the official OAuth2 token URLs and derives the v2 base", () => {
    expect(OAUTH2_TOKEN_URLS["ovh-eu"]).toBe("https://www.ovh.com/auth/oauth2/token");
    expect(OAUTH2_TOKEN_URLS["ovh-ca"]).toBe("https://ca.ovh.com/auth/oauth2/token");
    expect(OAUTH2_TOKEN_URLS["ovh-us"]).toBe("https://us.ovhcloud.com/auth/oauth2/token");
    expect(v2BaseUrl("https://eu.api.ovh.com/1.0")).toBe("https://eu.api.ovh.com/v2");
    const client = new OvhClient({
      clientId: "i",
      clientSecret: "s",
      endpoint: "ovh-eu",
    });
    expect(client.authMode).toBe("oauth2");
    expect(client.baseUrl).toBe("https://eu.api.ovh.com/1.0");
    expect(client.baseUrlV2).toBe("https://eu.api.ovh.com/v2");
    expect(client.tokenUrl).toBe("https://www.ovh.com/auth/oauth2/token");
    // Custom endpoints need an explicit token URL.
    expect(
      () =>
        new OvhClient({
          clientId: "i",
          clientSecret: "s",
          endpoint: "https://x.test/1.0",
        }),
    ).toThrow("tokenUrl");
  });

  it("requests a client-credentials token, sends Bearer auth without X-Ovh signature and caches", async () => {
    const { server, state, base } = oauthServer();
    try {
      const client = new OvhClient({
        clientId: "fixture-id",
        clientSecret: "fixture-secret",
        endpoint: `${base}/1.0`,
        tokenUrl: `${base}${TOKEN_PATH}`,
      });
      const first = await client.get<{ path: string; signed: boolean }>("/me");
      await client.get("/me");
      expect(first).toEqual({ path: "/1.0/me", signed: false });
      expect(state.tokens).toBe(1);
      expect(state.apiAuth).toEqual(["Bearer token-1", "Bearer token-1"]);
      const form = new URLSearchParams(state.tokenForms[0]);
      expect(form.get("grant_type")).toBe("client_credentials");
      expect(form.get("scope")).toBe("all");
      expect(form.get("client_id")).toBe("fixture-id");
    } finally {
      server.stop(true);
    }
  });

  it("renews the token 60 s before expiry", async () => {
    const { server, state, base } = oauthServer({ expiresIn: 3600 });
    let nowMs = 1_000_000;
    try {
      const client = new OvhClient({
        clientId: "i",
        clientSecret: "s",
        endpoint: `${base}/1.0`,
        tokenUrl: `${base}${TOKEN_PATH}`,
        now: () => nowMs,
      });
      await client.get("/me");
      nowMs += (3600 - 61) * 1000;
      await client.get("/me");
      expect(state.tokens).toBe(1);
      nowMs += 2 * 1000; // 59 s left: inside the margin
      await client.get("/me");
      expect(state.tokens).toBe(2);
      expect(state.apiAuth.at(-1)).toBe("Bearer token-2");
    } finally {
      server.stop(true);
    }
  });

  it("fetches a new token once on HTTP 401", async () => {
    const { server, state, base } = oauthServer({ rejectFirstApiCall: true });
    try {
      const client = new OvhClient({
        clientId: "i",
        clientSecret: "s",
        endpoint: `${base}/1.0`,
        tokenUrl: `${base}${TOKEN_PATH}`,
      });
      await client.get("/me");
      expect(state.tokens).toBe(2);
      expect(state.apiAuth).toEqual(["Bearer token-1", "Bearer token-2"]);
    } finally {
      server.stop(true);
    }
  });

  it("serves the v2 base and never leaks secrets in errors or serialisation", async () => {
    const server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch(request) {
        const url = new URL(request.url);
        if (url.pathname === "/auth/oauth2/token")
          return Response.json(
            {
              error: "invalid_client",
              error_description: "echo-sentinel-secret",
            },
            { status: 401 },
          );
        return Response.json({ path: url.pathname });
      },
    });
    const base = server.url.toString().replace(/\/$/, "");
    try {
      const client = new OvhClient({
        clientId: "sentinel-id",
        clientSecret: "sentinel-secret",
        endpoint: `${base}/1.0`,
        tokenUrl: `${base}/auth/oauth2/token`,
      });
      let message = "";
      try {
        await client.getV2("/iam/policy");
      } catch (error) {
        message = String(error instanceof Error ? error.message : error);
      }
      expect(message).toContain("invalid_client");
      for (const secret of ["sentinel-secret", "echo-sentinel-secret"]) expect(message).not.toContain(secret);
      const serialised = JSON.stringify(client);
      expect(serialised).not.toContain("sentinel");
      expect(client.baseUrlV2).toBe(`${base}/v2`);

      const legacy = new OvhClient({
        applicationKey: "ak",
        applicationSecret: "as",
        consumerKey: "ck",
        endpoint: `${base}/1.0`,
      });
      const answer = await legacy.getV2<{ path: string }>("/iam/policy");
      expect(answer.path).toBe("/v2/iam/policy");
    } finally {
      server.stop(true);
    }
  });
});
