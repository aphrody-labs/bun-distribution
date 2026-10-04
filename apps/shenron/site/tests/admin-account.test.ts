// SPDX-License-Identifier: Apache-2.0
import { expect, mock, test } from "bun:test";

let admin = false;
let linked = true;
let reads = 0;
mock.module("@/lib/session", () => ({
  getCurrentUser: async () =>
    admin
      ? { discordId: "42", user: { roleAdmin: true, username: "fixture", avatar: null } }
      : null,
}));
mock.module("@/lib/auth", () => ({
  auth: {
    api: {
      listUserAccounts: async () =>
        linked ? [{ id: "private-account", providerId: "discord" }] : [],
      getAccessToken: async ({ body }: { body: { accountId: string } }) => {
        expect(body.accountId).toBe("private-account");
        return { accessToken: "private-oauth-token" };
      },
    },
  },
}));
mock.module("@/lib/bot-admin", () => ({
  botAdmin: { discord: { guild: async () => ({ guild: { id: "99" } }) } },
}));
mock.module("@aphrody/discord-kit/rest", () => ({
  DiscordRESTError: class extends Error {},
  discordFetch: async (_path: string, opts: { token: string }) => {
    reads++;
    expect(opts.token).toBe("private-oauth-token");
    return { data: { id: "42" } };
  },
}));
const { GET } = await import("../src/app/api/admin/account/[...path]/route");
const request = (path: string) =>
  GET(new Request("http://test/api/admin/account/" + path), {
    params: Promise.resolve({ path: path.split("/") }),
  });

test("account information stays behind the administrator session", async () => {
  expect((await request("discord/me")).status).toBe(403);
  expect(reads).toBe(0);
});
test("missing OAuth never falls back to a bot token or another user's account", async () => {
  admin = true;
  linked = false;
  expect((await request("discord/me")).status).toBe(401);
  expect(reads).toBe(0);
});
test("account reads disclose the profile without disclosing OAuth credentials", async () => {
  linked = true;
  const response = await request("discord/me");
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ user: { id: "42" } });
  expect(reads).toBe(1);
  expect((await request("discord/channels")).status).toBe(404);
  expect(reads).toBe(1);
});
