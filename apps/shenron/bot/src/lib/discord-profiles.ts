/**
 * Discord user profiles (username + avatar hash) for the public API.
 *
 * The public leaderboard and profile routes build avatar URLs from a Discord
 * avatar hash. The hash used to come from `client.users.cache`, which the
 * gateway only refreshes for users that are still guild members: a member who
 * left kept the hash cached at the time of the first REST fetch forever, and
 * once they changed their avatar the URL answered 404 on the Discord CDN.
 *
 * Resolution order (`fetchDiscordUserCached`):
 *   1. in-memory cache (5 min) shared by every public route;
 *   2. the guild member cache — kept up to date by the gateway (GuildMembers
 *      intent), so it is always the freshest source when available;
 *   3. the persisted profile (`discord_user_profiles`) when it was confirmed
 *      recently, to avoid a REST call per former member on every cold cache;
 *   4. a forced REST fetch (bounded by a hard timeout);
 *   5. the persisted profile of any age, as a last resort.
 *
 * `recordDiscordProfile` is called by the `userUpdate` / `guildMemberUpdate`
 * gateway events (see `events/DiscordProfileSync.ts`) so that an avatar change
 * is persisted and served immediately instead of after the cache expires.
 */
import type { Database } from "bun:sqlite";
import type { Client, User } from "discord.js";
import { container } from "tsyringe";
import { DatabaseService } from "~/db/index";
import { env } from "~/lib/env";
import { logger } from "~/lib/logger";

export type DiscordUserData = {
	username: string | null;
	avatarHash: string | null;
	expiresAt: number;
};

type ProfileRow = {
	user_id: string;
	username: string | null;
	avatar_hash: string | null;
	updated_at: number;
};

const MEMORY_TTL_MS = 5 * 60_000;
const MEMORY_MAX = 1024;
/** A persisted profile younger than this is trusted without a REST call. */
const PERSISTED_FRESH_MS = 6 * 60 * 60_000;
const REST_TIMEOUT_MS = 2500;

const memory = new Map<string, DiscordUserData>();
const initialised = new WeakSet<Database>();

function sqlite(): Database {
	const db = container.resolve(DatabaseService).sqlite;
	if (!initialised.has(db)) {
		db.exec(`
			CREATE TABLE IF NOT EXISTS discord_user_profiles (
				user_id TEXT PRIMARY KEY,
				username TEXT,
				avatar_hash TEXT,
				updated_at INTEGER NOT NULL
			);
		`);
		initialised.add(db);
	}
	return db;
}

function readPersisted(id: string): ProfileRow | null {
	try {
		return (
			(sqlite()
				.query(
					"SELECT user_id, username, avatar_hash, updated_at FROM discord_user_profiles WHERE user_id = ?1"
				)
				.get(id) as ProfileRow | null) ?? null
		);
	} catch (err) {
		logger.warn({ err, userId: id }, "discord profile read failed");
		return null;
	}
}

function persist(id: string, username: string | null, avatarHash: string | null): void {
	try {
		sqlite()
			.query(
				`INSERT INTO discord_user_profiles (user_id, username, avatar_hash, updated_at)
				 VALUES (?1, ?2, ?3, ?4)
				 ON CONFLICT(user_id) DO UPDATE SET
					username = excluded.username,
					avatar_hash = excluded.avatar_hash,
					updated_at = excluded.updated_at`
			)
			.run(id, username, avatarHash, Date.now());
	} catch (err) {
		logger.warn({ err, userId: id }, "discord profile write failed");
	}
}

function remember(id: string, username: string | null, avatarHash: string | null): DiscordUserData {
	const entry: DiscordUserData = {
		username,
		avatarHash,
		expiresAt: Date.now() + MEMORY_TTL_MS,
	};
	memory.delete(id);
	if (memory.size >= MEMORY_MAX) {
		const oldest = memory.keys().next().value;
		if (oldest) memory.delete(oldest);
	}
	memory.set(id, entry);
	return entry;
}

function clients(): Client[] {
	try {
		const map = container.resolve<Map<string, Client>>("ClientMap");
		// Every persona alias points to the same Gateway client: dedupe.
		return [...new Set(map.values())];
	} catch {
		return [];
	}
}

/** Live member of the production guild, kept fresh by the gateway. */
function liveMemberUser(id: string): User | null {
	for (const c of clients()) {
		const member = c.guilds.cache.get(env.GUILD_ID)?.members.cache.get(id);
		if (member && !member.user.partial) return member.user;
	}
	return null;
}

async function restFetch(id: string): Promise<User | null> {
	const [shenron] = clients();
	if (!shenron) return null;
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		return await Promise.race([
			shenron.users.fetch(id, { force: true }).catch(() => null),
			new Promise<null>((resolve) => {
				timer = setTimeout(() => resolve(null), REST_TIMEOUT_MS);
			}),
		]);
	} finally {
		if (timer) clearTimeout(timer);
	}
}

/**
 * Persists the current username/avatar of a Discord user and refreshes the
 * in-memory entry. Writes only when the stored values differ, so it is cheap
 * to call on every `guildMemberUpdate`.
 */
export function recordDiscordProfile(
	user: Pick<User, "id" | "username" | "avatar">
): DiscordUserData {
	const username = user.username ?? null;
	const avatarHash = user.avatar ?? null;
	const stored = readPersisted(user.id);
	const changed =
		!stored || stored.username !== username || stored.avatar_hash !== avatarHash;
	if (changed) persist(user.id, username, avatarHash);
	return remember(user.id, username, avatarHash);
}

/** Username + avatar hash of a Discord user, freshest available source first. */
export async function fetchDiscordUserCached(id: string): Promise<DiscordUserData> {
	const cached = memory.get(id);
	if (cached && cached.expiresAt > Date.now()) return cached;

	const live = liveMemberUser(id);
	if (live) return recordDiscordProfile(live);

	const stored = readPersisted(id);
	if (stored && Date.now() - stored.updated_at < PERSISTED_FRESH_MS) {
		return remember(id, stored.username, stored.avatar_hash);
	}

	const fetched = await restFetch(id);
	if (fetched) {
		persist(id, fetched.username, fetched.avatar);
		return remember(id, fetched.username, fetched.avatar);
	}

	// REST unavailable (timeout, unknown user): last known profile, else nothing.
	return remember(id, stored?.username ?? null, stored?.avatar_hash ?? null);
}
