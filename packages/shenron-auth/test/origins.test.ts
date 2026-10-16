// Source: packages/shenron/auth/test/origins.test.ts at 8172f535ce (preserved Git history).
import { describe, expect, test } from "bun:test";
import {
  SHENRON_ALLOWED_HOSTS,
  SHENRON_TRUSTED_ORIGINS,
  botTrustedOrigins as rootBotTrustedOrigins,
} from "../src/index";
import { VERCEL_PRODUCTION_ALIAS, botTrustedOrigins, siteAllowedHosts, siteTrustedOrigins } from "../src/origins";

const production = { production: true } as const;
const development = { production: false } as const;

const policies = {
  siteAllowedHosts,
  siteTrustedOrigins,
  botTrustedOrigins,
} as const;

describe("S2 — origin policy", () => {
  for (const [name, policy] of Object.entries(policies)) {
    test(`${name}: production has no wildcard and no localhost`, () => {
      const list = policy(production);
      expect(list.length).toBeGreaterThan(0);
      for (const entry of list) {
        expect(entry).not.toContain("*");
        expect(entry).not.toContain("localhost");
        expect(entry).not.toContain("127.0.0.1");
      }
    });

    test(`${name}: development keeps localhost on top of production`, () => {
      const dev = policy(development);
      expect(dev.some(entry => entry.includes("localhost"))).toBe(true);
      expect(dev.slice(0, policy(production).length)).toEqual(policy(production));
      for (const entry of dev) expect(entry).not.toContain("*");
    });

    test(`${name}: the named Vercel alias is still trusted`, () => {
      expect(policy(production).some(entry => entry.includes(VERCEL_PRODUCTION_ALIAS))).toBe(true);
    });

    test(`${name}: returns a fresh array on every call`, () => {
      const first = policy(production);
      first.push("https://evil.example");
      expect(policy(production)).not.toContain("https://evil.example");
    });
  }

  test("exact production lists (same entries as before minus *.vercel.app and localhost)", () => {
    expect(siteAllowedHosts(production)).toEqual(["dragonballfr.com", "www.dragonballfr.com", "dbfr.vercel.app"]);
    expect(siteTrustedOrigins(production)).toEqual([
      "https://dragonballfr.com",
      "https://www.dragonballfr.com",
      "https://dbfr.vercel.app",
    ]);
    expect(botTrustedOrigins(production)).toEqual([
      "https://dragonballfr.com",
      "https://www.dragonballfr.com",
      "https://bot.dragonballfr.com",
      "https://dbfr.vercel.app",
    ]);
  });

  test("exact development additions", () => {
    expect(siteAllowedHosts(development)).toContain("localhost:3000");
    expect(siteTrustedOrigins(development)).toContain("http://localhost:3000");
    expect(botTrustedOrigins(development)).toEqual([
      ...botTrustedOrigins(production),
      "http://localhost:3000",
      "http://localhost:5006",
    ]);
  });

  test("deprecated root constants are the production lists", () => {
    expect([...SHENRON_ALLOWED_HOSTS]).toEqual(siteAllowedHosts(production));
    expect([...SHENRON_TRUSTED_ORIGINS]).toEqual(botTrustedOrigins(production));
    expect(SHENRON_ALLOWED_HOSTS).not.toContain("*.vercel.app");
    expect(Object.isFrozen(SHENRON_ALLOWED_HOSTS)).toBe(true);
    expect(Object.isFrozen(SHENRON_TRUSTED_ORIGINS)).toBe(true);
    expect(rootBotTrustedOrigins).toBe(botTrustedOrigins);
  });
});
