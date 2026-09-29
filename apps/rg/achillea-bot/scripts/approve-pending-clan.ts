/**
 * Valide manuellement un clan bloqué en état PendingReview (le vote d'approbation
 * Administrateurs sur Discord a expiré sans atteindre le quorum de majorité) et
 * notifie son créateur.
 *
 * Reproduit les effets de bord de `ClanApprovalVoteHandler.handleApproval`
 * (apps/achillea-bot/src/utils/handlers/clanApprovalVoteHandler.ts) : passage en état
 * Approved, rôle Président sur le serveur central, annonces dans le salon du
 * clan + salon broadcast du serveur du clan + salon d'annonces général, plus
 * un DM personnel au capitaine.
 *
 * Usage (cwd apps/achillea-bot) :
 *   bun scripts/approve-pending-clan.ts --id=78
 */

import { config } from "dotenv";
config({ path: new URL("../.env", import.meta.url).pathname });

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

function parseId(argv: string[]): number {
	for (const a of argv) {
		if (a.startsWith("--id=")) return Number(a.slice(5));
	}
	throw new Error("Usage: bun scripts/approve-pending-clan.ts --id=<clanId>");
}

const BOT_TOKEN = process.env.BOT_TOKEN!;
const CORE_GUILD_ID = "1055585286320554055"; // coreManagerConfig_Prod.coreGuildId
const CAPTAIN_ROLE_ID = "1398801292079403121"; // coreManagerConfig_Prod.captainRoleId
const CLAN_ANNOUNCEMENTS_CHANNEL_ID = "1398801515694788719"; // coreManagerConfig_Prod.clanAnnouncementsChannelId
const SUCCESS_COLOR = 0x57f287;

async function discordFetch(path: string, init: RequestInit = {}): Promise<any> {
	const res = await fetch(`https://discord.com/api/v10${path}`, {
		...init,
		headers: {
			Authorization: `Bot ${BOT_TOKEN}`,
			"Content-Type": "application/json",
			...(init.headers || {}),
		},
	});
	if (res.status === 429) {
		const body: any = await res.json().catch(() => ({}));
		const wait = Math.ceil((body.retry_after ?? 1.5) * 1000);
		await new Promise((r) => setTimeout(r, wait));
		return discordFetch(path, init);
	}
	if (!res.ok) {
		const text = await res.text().catch(() => "");
		throw new Error(`Discord API ${res.status} on ${path}: ${text}`);
	}
	return res.status === 204 ? null : res.json();
}

function socialLines(row: any): string {
	const lines: string[] = [];
	if (row.x_url) lines.push(`[X/Twitter](${row.x_url})`);
	if (row.instagram_url) lines.push(`[Instagram](${row.instagram_url})`);
	if (row.tiktok_url) lines.push(`[TikTok](${row.tiktok_url})`);
	return lines.join("\n") || "-";
}

async function main() {
	const clanId = parseId(process.argv.slice(2));
	const sql = openSql();

	const [clan] = await sql`select * from clan where id = ${clanId}`;
	if (!clan) throw new Error(`Clan #${clanId} introuvable`);
	if (clan.state === 2) {
		console.log(`Clan "${clan.name}" (#${clanId}) est déjà approuvé, rien à faire.`);
		await sql.close();
		return;
	}

	const members = await sql`select * from clan_member where clan_id = ${clanId}`;
	const captain = members.find((m: any) => m.role === 3);
	if (!captain) throw new Error(`Aucun capitaine (role=3) trouvé pour le clan #${clanId}`);

	console.log(`Validation du clan "${clan.name}" (#${clanId}), capitaine ${captain.user_id}...`);

	// 1. État du clan -> Approved
	await sql`update clan set state = 2, updated_at = now() where id = ${clanId}`;

	// 2. Clôture de la proposition CLAN_APPROVAL restée PENDING (expirée sans quorum)
	await sql`
		update vote_proposal
		set status = 'APPROVED', closed_at = now(), updated_at = now()
		where target_entity_type = 'Clan'
			and target_entity_id = ${clanId}
			and type = 'CLAN_APPROVAL'
			and status = 'PENDING'
	`;

	// 3. Rôle Président sur le serveur central
	await discordFetch(
		`/guilds/${CORE_GUILD_ID}/members/${captain.user_id}/roles/${CAPTAIN_ROLE_ID}`,
		{ method: "PUT" }
	);

	const successEmbed = {
		title: "✅ Félicitations, votre Clan a été approuvé par les Administrateurs !",
		color: SUCCESS_COLOR,
	};

	// 4. Annonce dans le salon du clan (côté Achillea)
	await discordFetch(`/channels/${clan.channel_id}/messages`, {
		method: "POST",
		body: JSON.stringify({ content: `<@&${clan.role_id}>`, embeds: [successEmbed] }),
	});

	// 5. Annonce dans le salon broadcast du serveur du clan (si lié + configuré)
	const [guildRow] = clan.guild_id
		? await sql`select * from guild where id = ${clan.guild_id}`
		: [];
	if (guildRow?.broadcast_channel) {
		await discordFetch(`/channels/${guildRow.broadcast_channel}/messages`, {
			method: "POST",
			body: JSON.stringify({ content: `<@${captain.user_id}>`, embeds: [successEmbed] }),
		});
	}

	// 6. Annonce générale "Nouveau Clan"
	const foundersLines = (clan.founders as string[]).map((id) => `- <@${id}>`).join("\n");
	await discordFetch(`/channels/${CLAN_ANNOUNCEMENTS_CHANNEL_ID}/messages`, {
		method: "POST",
		body: JSON.stringify({
			embeds: [
				{
					title: `Nouveau Clan : ${clan.name}`,
					description: clan.clan_biography,
					thumbnail: { url: clan.clan_avatar_url },
					color: SUCCESS_COLOR,
					fields: [
						{ name: "Président", value: `<@${captain.user_id}>`, inline: true },
						{ name: "Fondateurs", value: foundersLines, inline: true },
						{ name: "Réseaux sociaux", value: socialLines(clan), inline: true },
					],
				},
			],
		}),
	});

	// 7. DM personnel au créateur
	try {
		const dmChannel = await discordFetch(`/users/@me/channels`, {
			method: "POST",
			body: JSON.stringify({ recipient_id: captain.user_id }),
		});
		await discordFetch(`/channels/${dmChannel.id}/messages`, {
			method: "POST",
			body: JSON.stringify({
				embeds: [
					{
						title: `✅ Ton clan ${clan.name} a été approuvé !`,
						description: `Félicitations ! La création de ton clan **${clan.name}** vient d'être validée par les Administrateurs d'Achillea. Le rôle Président t'a été attribué et le clan est maintenant actif.`,
						color: SUCCESS_COLOR,
					},
				],
			}),
		});
		console.log("DM envoyé au créateur.");
	} catch (e) {
		console.warn("DM au créateur impossible (DMs probablement fermés) :", (e as Error).message);
	}

	console.log(`Clan "${clan.name}" (#${clanId}) validé. Capitaine ${captain.user_id} notifié.`);
	await sql.close();
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
