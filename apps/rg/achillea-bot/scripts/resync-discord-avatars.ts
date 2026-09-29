/**
 * Rafraîchit tous les avatars Discord en base via l'API Discord REST.
 * Corrige les 404 CDN (hash périmé après changement d'avatar).
 *
 * Usage (cwd apps/achillea-bot) :
 *   bun scripts/resync-discord-avatars.ts
 *   bun scripts/resync-discord-avatars.ts --limit=100
 */

import { config } from "dotenv";
config({ path: new URL("../.env", import.meta.url).pathname });

import {
	discordDefaultAvatarUrl,
	resolveDiscordAvatarUrl,
} from "../src/utils/functions/discordAvatar";

function openSql() {
	const host = process.env.DATABASE_HOST!;
	const port = Number(process.env.DATABASE_PORT || 5432);
	const user = process.env.DATABASE_USER!;
	const password = process.env.DATABASE_PASSWORD!;
	const database = process.env.DATABASE_NAME || "postgres";
	return new Bun.SQL({
		hostname: host,
		port,
		username: user,
		password,
		database,
		tls: host.includes("supabase") ? { rejectUnauthorized: false } : undefined,
		max: 2,
	});
}

function parseLimit(argv: string[]): number | null {
	for (let i = 0; i < argv.length; i++) {
		if (argv[i] === "--limit") return Number(argv[++i]);
		if (argv[i]!.startsWith("--limit=")) return Number(argv[i]!.slice(8));
	}
	return null;
}

async function fetchDiscordUser(
	token: string,
	userId: string
): Promise<{ avatar: string | null; username: string; global_name: string | null } | null> {
	const res = await fetch(`https://discord.com/api/v10/users/${userId}`, {
		headers: { Authorization: `Bot ${token}` },
	});
	if (res.status === 404) return null;
	if (res.status === 429) {
		const body = (await res.json().catch(() => ({}))) as { retry_after?: number };
		const wait = Math.ceil((body.retry_after ?? 1.5) * 1000);
		await new Promise((r) => setTimeout(r, wait));
		return fetchDiscordUser(token, userId);
	}
	if (!res.ok) {
		console.warn(`  discord ${userId}: HTTP ${res.status}`);
		return null;
	}
	return (await res.json()) as {
		avatar: string | null;
		username: string;
		global_name: string | null;
	};
}

function avatarUrlFromDiscord(userId: string, avatarHash: string | null): string {
	if (!avatarHash) return discordDefaultAvatarUrl(userId);
	const ext = avatarHash.startsWith("a_") ? "gif" : "webp";
	return `https://cdn.discordapp.com/avatars/${userId}/${avatarHash}.${ext}?size=256`;
}

async function main() {
	const token = process.env.BOT_TOKEN;
	if (!token) throw new Error("BOT_TOKEN manquant");

	const limit = parseLimit(process.argv.slice(2));
	const sql = openSql();

	const rows = (await sql.unsafe(`
		SELECT id, username, display_name, avatar FROM "user"
		ORDER BY last_interact DESC NULLS LAST
		${limit != null ? `LIMIT ${Number(limit)}` : ""}
	`)) as Array<{
		id: string;
		username: string;
		display_name: string | null;
		avatar: string | null;
	}>;

	console.info(`[resync-avatars] ${rows.length} user(s) à traiter`);

	let updated = 0;
	let failed = 0;
	let unchanged = 0;

	// ~5 req/s soft (Discord global 50/s ; on reste prudent)
	const DELAY_MS = 220;

	for (let i = 0; i < rows.length; i++) {
		const row = rows[i]!;
		try {
			const d = await fetchDiscordUser(token, row.id);
			let next: string;
			if (!d) {
				next = resolveDiscordAvatarUrl(row.id, row.avatar);
			} else {
				next = avatarUrlFromDiscord(row.id, d.avatar);
				const display = d.global_name || d.username;
				if (row.username !== d.username || row.display_name !== display || row.avatar !== next) {
					await sql`
						UPDATE "user" SET
							username = ${d.username},
							display_name = ${display},
							avatar = ${next},
							updated_at = NOW()
						WHERE id = ${row.id}
					`;
					updated++;
					if (i % 25 === 0) console.info(`  … ${i + 1}/${rows.length} (updated=${updated})`);
					await new Promise((r) => setTimeout(r, DELAY_MS));
					continue;
				}
			}
			if (row.avatar !== next) {
				await sql`
					UPDATE "user" SET avatar = ${next}, updated_at = NOW()
					WHERE id = ${row.id}
				`;
				updated++;
			} else {
				unchanged++;
			}
		} catch (e) {
			failed++;
			console.warn(`  err ${row.id}:`, e instanceof Error ? e.message : e);
		}
		if (i % 25 === 0) console.info(`  … ${i + 1}/${rows.length} (updated=${updated})`);
		await new Promise((r) => setTimeout(r, DELAY_MS));
	}

	console.info(`[resync-avatars] fin — updated=${updated} unchanged=${unchanged} failed=${failed}`);
	await sql.close();
	process.exit(failed > 50 ? 1 : 0);
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
