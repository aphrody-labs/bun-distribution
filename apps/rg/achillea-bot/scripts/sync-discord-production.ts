import { createPgPool, type PoolClient } from "@rosegriffon/db/pg";

type Json = Record<string, any>;

const api = "https://discord.com/api/v10";
const tokens = [process.env.BOT_TOKEN, process.env.DEV_BOT_TOKEN].filter(
	(value, index, all): value is string => Boolean(value) && all.indexOf(value) === index
);

async function discord(token: string, path: string, allowForbidden = false): Promise<any> {
	for (;;) {
		const response = await fetch(`${api}${path}`, {
			headers: { Authorization: `Bot ${token}` },
		});
		if (response.status === 429) {
			const body = (await response.json()) as { retry_after?: number };
			await Bun.sleep(Math.ceil((body.retry_after ?? 1) * 1_000));
			continue;
		}
		if (allowForbidden && response.status === 403) return null;
		if (!response.ok) throw new Error(`${path}: Discord HTTP ${response.status}`);
		return response.json();
	}
}

function cdn(kind: "icons" | "banners", id: string, hash: string | null): string | null {
	if (!hash) return null;
	const ext = hash.startsWith("a_") ? "gif" : "webp";
	return `https://cdn.discordapp.com/${kind}/${id}/${hash}.${ext}?size=512`;
}

function avatar(user: Json): string {
	if (user.avatar) {
		const ext = String(user.avatar).startsWith("a_") ? "gif" : "webp";
		return `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.${ext}?size=256`;
	}
	const index = user.discriminator === "0" ? Number((BigInt(user.id) >> 22n) % 6n) : Number(user.discriminator) % 5;
	return `https://cdn.discordapp.com/embed/avatars/${index}.png`;
}

async function members(token: string, guildId: string): Promise<Json[]> {
	const result: Json[] = [];
	let after = "0";
	for (;;) {
		const page = (await discord(
			token,
			`/guilds/${guildId}/members?limit=1000&after=${after}`,
			true
		)) as Json[] | null;
		if (!page) {
			console.warn(`[discord-sync] ${guildId}: membres ignorés (GuildMembers non accordé au profil)`);
			return [];
		}
		result.push(...page);
		if (page.length < 1_000) return result;
		after = page.at(-1)!.user.id;
	}
}

async function upsertGuild(db: PoolClient, token: string, guild: Json): Promise<Json> {
	const [detail, roles, channels, guildMembers] = await Promise.all([
		discord(token, `/guilds/${guild.id}?with_counts=true`),
		discord(token, `/guilds/${guild.id}/roles`),
		discord(token, `/guilds/${guild.id}/channels`),
		members(token, guild.id),
	]);
	await db.query("BEGIN");
	try {
		await db.query(
			`INSERT INTO guild (id, created_at, updated_at, last_interact, deleted, ranked_enabled,
			 name, icon, banner, owner_id, member_count, presence_count, features, premium_tier,
			 verification_level, description, scanned_at)
			 VALUES ($1,NOW(),NOW(),NOW(),false,false,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,NOW())
			 ON CONFLICT (id) DO UPDATE SET deleted=false, updated_at=NOW(), name=EXCLUDED.name,
			 icon=EXCLUDED.icon, banner=EXCLUDED.banner, owner_id=EXCLUDED.owner_id,
			 member_count=EXCLUDED.member_count, presence_count=EXCLUDED.presence_count,
			 features=EXCLUDED.features, premium_tier=EXCLUDED.premium_tier,
			 verification_level=EXCLUDED.verification_level, description=EXCLUDED.description,
			 scanned_at=NOW()`,
			[
				detail.id,
				detail.name,
				cdn("icons", detail.id, detail.icon),
				cdn("banners", detail.id, detail.banner),
				detail.owner_id,
				detail.approximate_member_count ?? detail.member_count ?? guildMembers.length,
				detail.approximate_presence_count ?? null,
				detail.features ?? [],
				detail.premium_tier ?? 0,
				detail.verification_level ?? 0,
				detail.description ?? null,
			]
		);

		for (const role of roles as Json[]) {
			await db.query(
				`INSERT INTO guild_role (id,guild_id,name,color,position,permissions,hoist,managed,mentionable,scanned_at)
				 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW()) ON CONFLICT (id) DO UPDATE SET
				 guild_id=EXCLUDED.guild_id,name=EXCLUDED.name,color=EXCLUDED.color,position=EXCLUDED.position,
				 permissions=EXCLUDED.permissions,hoist=EXCLUDED.hoist,managed=EXCLUDED.managed,
				 mentionable=EXCLUDED.mentionable,scanned_at=NOW()`,
				[role.id, detail.id, role.name, role.color, role.position, role.permissions, role.hoist, role.managed, role.mentionable]
			);
		}
		for (const channel of channels as Json[]) {
			await db.query(
				`INSERT INTO guild_channel (id,guild_id,name,type,parent_id,position,topic,nsfw,scanned_at)
				 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW()) ON CONFLICT (id) DO UPDATE SET
				 guild_id=EXCLUDED.guild_id,name=EXCLUDED.name,type=EXCLUDED.type,parent_id=EXCLUDED.parent_id,
				 position=EXCLUDED.position,topic=EXCLUDED.topic,nsfw=EXCLUDED.nsfw,scanned_at=NOW()`,
				[channel.id, detail.id, channel.name, channel.type, channel.parent_id, channel.position, channel.topic, channel.nsfw ?? false]
			);
		}
		for (const member of guildMembers) {
			const user = member.user;
			const display = user.global_name || member.nick || user.username || user.id;
			await db.query(
				`INSERT INTO "user" (id,created_at,updated_at,last_interact,role,username,avatar,display_name,normalized_display_name)
				 VALUES ($1,NOW(),NOW(),NOW(),0,$2,$3,$4::varchar,lower($4::text)) ON CONFLICT (id) DO UPDATE SET
				 updated_at=NOW(),username=EXCLUDED.username,avatar=EXCLUDED.avatar,
				 display_name=EXCLUDED.display_name,normalized_display_name=EXCLUDED.normalized_display_name`,
				[user.id, user.username ?? null, avatar(user), display]
			);
			await db.query(
				`INSERT INTO guild_member_meta (guild_id,user_id,nick,joined_at,premium_since,roles,pending,scanned_at)
				 VALUES ($1,$2,$3,$4,$5,$6,$7,NOW()) ON CONFLICT (guild_id,user_id) DO UPDATE SET
				 nick=EXCLUDED.nick,joined_at=EXCLUDED.joined_at,premium_since=EXCLUDED.premium_since,
				 roles=EXCLUDED.roles,pending=EXCLUDED.pending,scanned_at=NOW()`,
				[detail.id, user.id, member.nick, member.joined_at, member.premium_since, member.roles ?? [], member.pending ?? false]
			);
			await db.query(`INSERT INTO user_elo (user_id,mode) VALUES ($1,2),($1,4) ON CONFLICT DO NOTHING`, [user.id]);
			await db.query(`INSERT INTO user_experience (user_id,created_at,updated_at) VALUES ($1,NOW(),NOW()) ON CONFLICT DO NOTHING`, [user.id]);
		}
		await db.query("COMMIT");
		return { channels: channels.length, guild: detail.name, id: detail.id, members: guildMembers.length, roles: roles.length };
	} catch (error) {
		await db.query("ROLLBACK");
		throw error;
	}
}

async function main(): Promise<void> {
	if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL manquante");
	if (!tokens.length) throw new Error("BOT_TOKEN/DEV_BOT_TOKEN manquants");
	const pool = createPgPool(process.env.DATABASE_URL, {
		applicationName: "achillea-discord-sync",
		max: 2,
	});
	const db = await pool.connect();
	const seen = new Set<string>();
	let totals = { channels: 0, guilds: 0, members: 0, roles: 0 };
	try {
		for (const token of tokens) {
			const application = await discord(token, "/applications/@me");
			const guilds = (await discord(token, "/users/@me/guilds")) as Json[];
			console.info(`[discord-sync] profil=${application.id} guildes=${guilds.length}`);
			for (const guild of guilds) {
				if (seen.has(guild.id)) continue;
				seen.add(guild.id);
				try {
					const count = await upsertGuild(db, token, guild);
					totals = { channels: totals.channels + count.channels, guilds: totals.guilds + 1, members: totals.members + count.members, roles: totals.roles + count.roles };
					console.info(`[discord-sync] ${totals.guilds}/${seen.size} ${count.guild}: membres=${count.members} salons=${count.channels}`);
				} catch (error) {
					console.error(`[discord-sync] ${guild.id} KO`, error instanceof Error ? error.message : error);
				}
			}
		}
		console.info(`[discord-sync] terminé ${JSON.stringify(totals)}`);
	} finally {
		db.release();
		await pool.end();
	}
}

await main();
