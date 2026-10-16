// Source: packages/shenron/auth/test/options.test.ts at 8172f535ce (preserved Git history).
import { describe, expect, test } from "bun:test";
import { mapDiscordProfileEmail, sharedAdvancedOptions } from "../src/index";
import {
  advancedOptions,
  discordProvider,
  drizzleDebugLogs,
  loggingOptions,
  SESSION_COOKIE_CACHE,
} from "../src/options";

describe("discordProvider", () => {
  const p = discordProvider({
    clientId: "cid",
    clientSecret: "csecret",
    extraScopes: ["identify", "email", "guilds"],
  });

  test("implicit scopes stripped, prompt consent", () => {
    expect(p.scope).toEqual(["guilds"]);
    expect(p.prompt).toBe("consent");
    expect(p.clientId).toBe("cid");
    expect(p.clientSecret).toBe("csecret");
    expect(
      discordProvider({
        clientId: "a",
        clientSecret: "b",
        extraScopes: ["guilds", "guilds.members.read", "guilds"],
      }).scope,
    ).toEqual(["guilds", "guilds.members.read"]);
    expect(discordProvider({ clientId: "a", clientSecret: "b" }).scope).toEqual([]);
  });

  test("placeholder e-mail is byte-identical to mapDiscordProfileEmail", async () => {
    const noMail = { id: "123456789012345678", email: null };
    const mapped = await p.mapProfileToUser(noMail as never);
    expect(mapped).toEqual(mapDiscordProfileEmail(noMail));
    expect(mapped).toEqual({ email: "123456789012345678@discord.placeholder.local" });
    const withMail = { id: "1", email: "a@b.c" };
    expect(await p.mapProfileToUser(withMail as never)).toEqual({ email: "a@b.c" });
  });
});

describe("logging, cookie cache, advanced", () => {
  test("logging", () => {
    expect(loggingOptions("production")).toEqual({ logger: { level: "warn" } });
    expect(loggingOptions("development")).toEqual({ logger: { level: "debug" } });
    expect(loggingOptions(undefined)).toEqual({ logger: { level: "debug" } });
    expect(drizzleDebugLogs("production")).toBe(false);
    expect(drizzleDebugLogs("test")).toBe(true);
  });

  test("cookie cache 300 s", () => {
    expect(SESSION_COOKIE_CACHE).toEqual({ enabled: true, maxAge: 300 });
    expect(Object.isFrozen(SESSION_COOKIE_CACHE)).toBe(true);
  });

  test("advancedOptions equals the legacy sharedAdvancedOptions", () => {
    expect(advancedOptions({ production: true, cookiePrefix: "shenron_ba" }) as unknown).toEqual(
      sharedAdvancedOptions("production", "shenron_ba"),
    );
    expect(advancedOptions({ production: false }) as unknown).toEqual(sharedAdvancedOptions("development"));
    expect(advancedOptions({ production: true, trustedProxies: ["10.0.0.1"] }).ipAddress.trustedProxies).toEqual([
      "10.0.0.1",
    ]);
  });
});
