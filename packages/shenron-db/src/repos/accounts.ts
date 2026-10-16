// Source: packages/shenron/db/src/repos/accounts.ts at 8172f535ce (preserved Git history).
// SPDX-License-Identifier: Apache-2.0
/**
 * Discord account lookup over Better Auth's `ba_account` (provider `discord`).
 * Structurally satisfies `DiscordAccountLookup` of `@shenron/auth`.
 * Runtime class: `pure`.
 */
import { and, eq } from "drizzle-orm";
import { baAccount } from "../schema";
import type { ShenronPgDatabase } from "../types";

// oxlint-disable-next-line no-explicit-any -- repositories accept any Drizzle PG schema
type AnyDb = ShenronPgDatabase<any>;

export const DISCORD_PROVIDER_ID = "discord";

/** Query builder, exposed for `.toSQL()` inspection. */
export function discordAccountQuery(db: AnyDb, baUserId: string) {
  return db
    .select({ accountId: baAccount.accountId })
    .from(baAccount)
    .where(and(eq(baAccount.userId, baUserId), eq(baAccount.providerId, DISCORD_PROVIDER_ID)))
    .limit(1);
}

export function createDiscordAccountLookup(db: AnyDb) {
  return {
    async discordIdForUser(baUserId: string): Promise<string | null> {
      const [row] = await discordAccountQuery(db, baUserId);
      return row?.accountId || null;
    },
  };
}

export type DiscordAccountLookupRepository = ReturnType<typeof createDiscordAccountLookup>;
