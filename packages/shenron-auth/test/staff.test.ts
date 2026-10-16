// Source: packages/shenron/auth/test/staff.test.ts at 8172f535ce (preserved Git history).
import { describe, expect, test } from "bun:test";
import { createStaffPolicy, parseSnowflakeCsv, staffPolicyFromEnv } from "../src/staff";

const OWNER = "100000000000000001";
const OWNER2 = "100000000000000002";
const DEV = "100000000000000003";
const ALLOWED = "100000000000000004";
const STRANGER = "100000000000000009";

const env = {
  OWNER_ID: OWNER,
  OWNER_IDS: `${OWNER2}, `,
  BOT_DEV_ID: DEV,
  OAUTH_ALLOWED_USERS: ` ${ALLOWED} ,,`,
};

describe("parseSnowflakeCsv", () => {
  test("drops blanks and non-snowflakes, trims, dedupes", () => {
    expect(parseSnowflakeCsv(undefined)).toEqual([]);
    expect(parseSnowflakeCsv("")).toEqual([]);
    expect(parseSnowflakeCsv(` ${OWNER} ,, abc, 123, ${OWNER}, ${DEV}`)).toEqual([OWNER, DEV]);
    expect(parseSnowflakeCsv("123456789012345678901")).toEqual([]);
  });
});

describe("staff policy", () => {
  test("bot and site scopes differ exactly on OWNER_IDS and BOT_DEV_ID", () => {
    const bot = staffPolicyFromEnv(env, "bot");
    const site = staffPolicyFromEnv(env, "site");
    expect([...bot.ids].toSorted()).toEqual([OWNER, OWNER2, DEV, ALLOWED].toSorted());
    expect([...site.ids].toSorted()).toEqual([OWNER, ALLOWED].toSorted());
    const diff = [...bot.ids].filter(id => !site.ids.has(id)).toSorted();
    expect(diff).toEqual([OWNER2, DEV].toSorted());
    expect([...site.ids].every(id => bot.ids.has(id))).toBe(true);
  });

  test("isStaff", () => {
    const bot = staffPolicyFromEnv(env, "bot");
    expect(bot.isStaff(DEV)).toBe(true);
    expect(bot.isStaff(STRANGER)).toBe(false);
    expect(bot.isStaff(null)).toBe(false);
    expect(bot.isStaff(undefined)).toBe(false);
    expect(bot.isStaff("")).toBe(false);
    expect(staffPolicyFromEnv({}, "site").ids.size).toBe(0);
    expect(createStaffPolicy({ ownerIds: ["nope", OWNER] }).ids).toEqual(new Set([OWNER]));
  });
});
