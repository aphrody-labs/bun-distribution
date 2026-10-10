// SPDX-License-Identifier: Apache-2.0
import { expect, test } from "bun:test";
import { discordFetch, DiscordRESTError } from "../src/rest";

test("REST authenticates with the requested identity and refuses credential redirects", async () => {
  const fetcher = ((url: string, init: RequestInit) => {
    expect(url).toBe("https://discord.com/api/v10/users/@me");
    expect(new Headers(init.headers).get("authorization")).toBe("Bearer fixture");
    expect(init.redirect).toBe("error");
    return Promise.resolve(
      Response.json({ id: "42" }, { headers: { "X-RateLimit-Remaining": "9" } }),
    );
  }) as typeof fetch;
  const result = await discordFetch<{ id: string }>("/users/@me", {
    mode: "Bearer",
    token: "fixture",
    fetch: fetcher,
  });
  expect(result.data.id).toBe("42");
  expect(result.rateLimit.remaining).toBe(9);
});

test("REST retries rate limiting once and preserves the final Discord error", async () => {
  let calls = 0;
  const fetcher = (() => {
    calls++;
    return Promise.resolve(
      Response.json({ message: "limited", code: 20028, retry_after: 0 }, { status: 429 }),
    );
  }) as typeof fetch;
  try {
    await discordFetch("/channels/42", { mode: "Bot", token: "fixture", fetch: fetcher });
    throw new Error("request must fail");
  } catch (error) {
    expect(error).toBeInstanceOf(DiscordRESTError);
    expect((error as DiscordRESTError).status).toBe(429);
  }
  expect(calls).toBe(2);
});

test("REST rejects a missing identity before making a request", async () => {
  let called = false;
  await expect(
    discordFetch("/users/@me", {
      mode: "Bearer",
      token: "",
      fetch: (() => {
        called = true;
        throw new Error("unreachable");
      }) as typeof fetch,
    }),
  ).rejects.toThrow("access_token requis");
  expect(called).toBe(false);
});
