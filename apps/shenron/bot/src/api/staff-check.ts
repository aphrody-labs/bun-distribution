import { and, eq } from "drizzle-orm";
import { container } from "tsyringe";
import type { DiscordAccountLookup } from "@shenron/auth/ports";
import { DatabaseService, type DB } from "~/db/index";
import { baAccount } from "~/db/schema";
import { botStaffPolicy } from "~/lib/env";

/**
 * Bot staff policy (S1, docs/STACK.md §2.2).
 *
 * Staff = OWNER_ID ∪ OWNER_IDS ∪ BOT_DEV_ID ∪ OAUTH_ALLOWED_USERS
 * (`staffPolicyFromEnv(env, "bot")`): exactly the whitelist the Discord logins
 * are admitted with (`isUserAllowed`). It is evaluated on every admin request,
 * so removing someone from the whitelist revokes their live sessions instead
 * of waiting for them to expire.
 */
export function isBotStaff(discordId: string | null | undefined): boolean {
	return botStaffPolicy().isStaff(discordId);
}

/**
 * Discord snowflake linked to a Better Auth user (`ba_account`, provider
 * `discord`), or `null` when the user has no Discord account. Same lookup as
 * `getDiscordSession` in `oauth-session.ts`. The bot keeps its own SQLite
 * lookup (the `@shenron/db` repository targets PostgreSQL).
 */
export async function discordIdForBaUser(
	baUserId: string,
	db: DB = container.resolve(DatabaseService).db
): Promise<string | null> {
	const rows = await db
		.select({ accountId: baAccount.accountId })
		.from(baAccount)
		.where(and(eq(baAccount.userId, baUserId), eq(baAccount.providerId, "discord")))
		.limit(1);
	return rows[0]?.accountId ?? null;
}

/** SQLite implementation of the `DiscordAccountLookup` port of `@shenron/auth`. */
const sqliteDiscordAccounts: DiscordAccountLookup = {
	discordIdForUser: (baUserId) => discordIdForBaUser(baUserId),
};
