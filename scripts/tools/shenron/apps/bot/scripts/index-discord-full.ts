/**
 * index-discord-full.ts — Indexation COMPLÈTE de TOUT le serveur Discord dans Redis (REST-only).
 *
 * Pagine via l'API REST Discord (pas de gateway -> zéro conflit avec le bot live) l'INTÉGRALITÉ de
 * l'historique de chaque salon + tous les membres. Écrit dans Redis avec la même structure que le
 * worker (dbz:message / dbz:user / dbz:channel + analytics lore + sentiment). Idempotent (hset).
 *
 * Env : DISCORD_TOKEN_GRAND_PRETRE (perms lecture + intent GuildMembers activé). REDIS_URL -> db0.
 * Usage : bun apps/bot/scripts/index-discord-full.ts [--max <N par salon, défaut illimité>]
 */
import { redis } from "bun";
import { env } from "../src/lib/env";
import { readFileSync, existsSync } from "node:fs";

const TOKEN = env.DISCORD_TOKEN_GRAND_PRETRE;
const API = "https://discord.com/api/v10";
const args = process.argv.slice(2);
const maxArg = args.indexOf("--max");
const MAX_PER_CHANNEL = maxArg !== -1 ? Number(args[maxArg + 1]) : Infinity;

// ── Chargement de la table d'alias pour la canonicalisation (PLAN A3) ───────
const ALIAS_MAP_PATH = new URL("../data/rag/alias-map.json", import.meta.url).pathname;
let aliasMap: Record<string, { canonical: string; type: string; id: string }> = {};
let aliasRegex: RegExp | null = null;

if (existsSync(ALIAS_MAP_PATH)) {
	try {
		aliasMap = JSON.parse(readFileSync(ALIAS_MAP_PATH, "utf-8"));
		const keys = Object.keys(aliasMap).toSorted((a, b) => b.length - a.length);
		if (keys.length > 0) {
			const escapedKeys = keys.map((k) => k.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&"));
			aliasRegex = new RegExp(`\\b(${escapedKeys.join("|")})\\b`, "gi");
			console.log(`[FULL-INDEX] Table d'alias chargée : ${keys.length} règles. Regex compilée.`);
		}
	} catch (err) {
		console.error("[FULL-INDEX] Impossible de charger alias-map.json sémantique:", err);
	}
}

const LORE = [
	"goku",
	"vegeta",
	"freezer",
	"cell",
	"buu",
	"gohan",
	"trunks",
	"piccolo",
	"whis",
	"beerus",
	"bulma",
	"krillin",
	"broly",
	"bardock",
	"kamehameha",
	"fusion",
	"daima",
	"saiyan",
	"namek",
	"shenron",
];
const LORE_RE = LORE.map((e) => [e, new RegExp(`\\b${e}\\b`, "i")] as const);

// Liste étendue de sentiments sans accents (la recherche se fera sur le texte normalisé)
const POSITIVE_WORDS = [
	"cool",
	"genial",
	"super",
	"aimer",
	"adore",
	"bien",
	"fort",
	"incroyable",
	"magnifique",
	"hype",
	"style",
	"ouf",
	"gg",
	"win",
	"gagne",
	"propre",
	"masterclass",
	"banger",
	"kiffe",
	"top",
	"merci",
	"bravo",
	"parfait",
	"solide",
	"extraordinaire",
	"sublime",
	"legendaire",
	"chef d oeuvre",
	"reussi",
	"excellent",
	"kiff",
	"kiffer",
];
const NEGATIVE_WORDS = [
	"nul",
	"mauvais",
	"deteste",
	"triste",
	"colere",
	"faible",
	"moche",
	"horrible",
	"decu",
	"naze",
	"lose",
	"perdu",
	"rage",
	"seum",
	"relou",
	"chiant",
	"pete",
	"bug",
	"haine",
	"mechant",
	"abuse",
	"mort",
	"poubelle",
	"cringe",
	"laid",
	"eclate",
	"defaite",
	"flop",
	"nulachier",
	"bugge",
	"lag",
	"lague",
];
const POS_RE = POSITIVE_WORDS.map((w) => new RegExp(`\\b${w}`, "i"));
const NEG_RE = NEGATIVE_WORDS.map((w) => new RegExp(`\\b${w}`, "i"));

// Normalisation du texte
function normalizeKey(str: string): string {
	return str
		.toLowerCase()
		.normalize("NFD")
		.replace(/[\u0300-\u036f]/g, "")
		.replace(/[^a-z0-9]/g, " ")
		.replace(/\s+/g, " ")
		.trim();
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** GET REST avec gestion du rate-limit (429 -> retry-after). */
async function api<T>(path: string): Promise<T | null> {
	for (let attempt = 0; attempt < 6; attempt++) {
		const res = await fetch(`${API}${path}`, { headers: { Authorization: `Bot ${TOKEN}` } });
		if (res.status === 429) {
			const body = (await res.json().catch(() => ({}))) as { retry_after?: number };
			await sleep(Math.ceil((body.retry_after ?? 1) * 1000) + 250);
			continue;
		}
		if (res.status === 403 || res.status === 404) return null; // pas d'accès à ce salon
		if (!res.ok) {
			await sleep(500);
			continue;
		}
		// marge anti-rate-limit globale
		await sleep(60);
		return (await res.json()) as T;
	}
	return null;
}

let totalMsg = 0;
let totalUsers = 0;

async function indexMessages(msgs: any[]): Promise<void> {
	const p: Promise<unknown>[] = [];
	for (const m of msgs) {
		if (m.author?.bot) continue;
		const content = m.content || "";
		p.push(
			redis.hset(`dbz:message:${m.id}`, {
				id: m.id,
				content,
				authorId: m.author?.id ?? "",
				channelId: m.channel_id ?? "",
				createdAt: m.timestamp ?? "",
			})
		);
		// Même fenêtre glissante que le worker (cf. MESSAGE_TTL_SECONDS dans workers/indexer.ts).
		p.push(redis.expire(`dbz:message:${m.id}`, 30 * 24 * 60 * 60));
		if (m.author?.id) {
			p.push(
				redis.hset(`dbz:user:${m.author.id}`, {
					id: m.author.id,
					username: m.author.username ?? "",
					displayName: m.author.global_name ?? m.author.username ?? "",
					bot: "false",
				})
			);
			p.push(redis.sadd("dbz:users", m.author.id));
			p.push(redis.hincrby(`dbz:user:${m.author.id}:stats`, "messages", 1));
		}
		const normContent = " " + normalizeKey(content) + " ";
		const foundEntities = new Set<string>();

		if (aliasRegex) {
			const matches = normContent.match(aliasRegex);
			if (matches) {
				for (const m of matches) {
					const canonical = aliasMap[m.toLowerCase()]?.canonical;
					if (canonical) {
						foundEntities.add(canonical);
					}
				}
			}
		} else {
			for (const [e, re] of LORE_RE) {
				if (re.test(content)) {
					foundEntities.add(e);
				}
			}
		}

		if (m.author?.id) {
			for (const entity of foundEntities) {
				p.push(redis.hincrby(`dbz:user:${m.author.id}:lore`, entity, 1));
				p.push(redis.hincrby("dbz:global:lore", entity, 1));
			}
		}

		let pos = 0,
			neg = 0;
		for (const re of POS_RE) if (re.test(normContent)) pos++;
		for (const re of NEG_RE) if (re.test(normContent)) neg++;
		const bucket = pos > neg ? "positive" : neg > pos ? "negative" : "neutral";
		p.push(redis.hincrby("dbz:global:sentiment", bucket, 1));
	}
	await Promise.all(p);
	totalMsg += msgs.filter((m) => !m.author?.bot).length;
}

async function main(): Promise<void> {
	const guilds = (await api<any[]>("/users/@me/guilds")) ?? [];
	console.log(`[FULL-INDEX] ${guilds.length} guild(s)`);
	for (const g of guilds) {
		const channels = (await api<any[]>(`/guilds/${g.id}/channels`)) ?? [];
		const textCh = channels.filter((c) => c.type === 0 || c.type === 5); // GUILD_TEXT / ANNOUNCEMENT
		console.log(`[FULL-INDEX] guild ${g.name} — ${textCh.length} salons texte`);

		// Membres (pagination after)
		let after = "0";
		for (;;) {
			const members = await api<any[]>(`/guilds/${g.id}/members?limit=1000&after=${after}`);
			if (!members || members.length === 0) break;
			const p: Promise<unknown>[] = [];
			for (const mem of members) {
				const u = mem.user;
				if (!u) continue;
				p.push(
					redis.hset(`dbz:user:${u.id}`, {
						id: u.id,
						username: u.username ?? "",
						displayName: mem.nick ?? u.global_name ?? u.username ?? "",
						bot: u.bot ? "true" : "false",
					})
				);
				p.push(redis.sadd("dbz:users", u.id));
			}
			await Promise.all(p);
			totalUsers += members.length;
			after = members[members.length - 1].user.id;
			if (members.length < 1000) break;
		}

		// Messages — pagination complète par salon
		for (const ch of textCh) {
			await Promise.all([
				redis.hset(`dbz:channel:${ch.id}`, {
					id: ch.id,
					name: ch.name ?? "",
					type: String(ch.type),
					parentId: ch.parent_id ?? "",
				}),
				redis.sadd("dbz:channels", ch.id),
			]);
			let before: string | undefined;
			let fetched = 0;
			for (;;) {
				const q = `/channels/${ch.id}/messages?limit=100${before ? `&before=${before}` : ""}`;
				const msgs = await api<any[]>(q);
				if (!msgs || msgs.length === 0) break;
				await indexMessages(msgs);
				fetched += msgs.length;
				before = msgs[msgs.length - 1].id;
				if (msgs.length < 100 || fetched >= MAX_PER_CHANNEL) break;
			}
			if (fetched > 0)
				console.log(`[FULL-INDEX]   #${ch.name}: ${fetched} msgs (cumul ${totalMsg})`);
		}
	}
	console.log(`[FULL-INDEX] TERMINÉ — ${totalMsg} messages, ${totalUsers} membres vus.`);
	process.exit(0);
}

main().catch((e) => {
	console.error("[FULL-INDEX] erreur :", e);
	process.exit(1);
});
