// Source: packages/shenron/db/test/accounts-repo.test.ts at 8172f535ce (preserved Git history).
// SPDX-License-Identifier: Apache-2.0
// Parity with apps/shenron/site/src/lib/session.ts (ba_account, provider discord → accountId).
import { describe, expect, test } from "bun:test";
import { and, eq } from "drizzle-orm";
import { drizzle as bunSqlDrizzle } from "drizzle-orm/bun-sql";
import { drizzle } from "drizzle-orm/postgres-js";
import { fullSchema } from "../src/full-schema";
import { createDiscordAccountLookup, discordAccountQuery } from "../src/repos/accounts";
import { baAccount, users } from "../src/schema";
import type { ShenronPgDatabase } from "../src/types";

const db = drizzle.mock({ schema: fullSchema });

describe("discord account lookup", () => {
  test("same table and predicates as the site session join", () => {
    const repo = discordAccountQuery(db as unknown as ShenronPgDatabase, "u1").toSQL();
    const site = db
      .select({ account: baAccount, user: users })
      .from(baAccount)
      .leftJoin(users, eq(users.discordId, baAccount.accountId))
      .where(and(eq(baAccount.userId, "u1"), eq(baAccount.providerId, "discord")))
      .limit(1)
      .toSQL();
    const where = (s: string) => s.slice(s.indexOf(" where "));
    expect(repo.sql).toBe(
      'select "accountId" from "ba_account" where ("ba_account"."userId" = $1 and "ba_account"."providerId" = $2) limit $3',
    );
    expect(where(repo.sql)).toBe(where(site.sql));
    expect(repo.params).toEqual(site.params);
    const bun = discordAccountQuery(
      bunSqlDrizzle.mock({ schema: fullSchema }) as unknown as ShenronPgDatabase,
      "u1",
    ).toSQL();
    expect(bun).toEqual(repo);
  });

  test("maps the row to the Discord id or null", async () => {
    const fakeDb = (rows: unknown[]) =>
      ({
        select: () => ({ from: () => ({ where: () => ({ limit: async () => rows }) }) }),
      }) as unknown as ShenronPgDatabase;
    expect(await createDiscordAccountLookup(fakeDb([{ accountId: "123" }])).discordIdForUser("u1")).toBe("123");
    expect(await createDiscordAccountLookup(fakeDb([])).discordIdForUser("u1")).toBeNull();
    expect(await createDiscordAccountLookup(fakeDb([{ accountId: "" }])).discordIdForUser("u1")).toBeNull();
  });
});
