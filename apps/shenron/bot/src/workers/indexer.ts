/**
 * indexer.ts — Worker Bun d'indexation Redis parallèle (client natif Bun `redis`).
 *
 * Écrit, hors de l'event-loop du bot :
 *   - salons (dbz:channel:*), utilisateurs (dbz:user:*), messages (dbz:message:*) ;
 *   - analytics de lore : compteurs de mentions de personnages (dbz:{user,channel,global}:lore) ;
 *   - sentiment par mots-clés (dbz:{user,global}:sentiment).
 *
 * Les utilisateurs sont aussi déduits des AUTEURS de messages -> peuple dbz:user:* même sans
 * l'intent privilégié GuildMembers. La détection de lore utilise des limites de mots (\b) pour
 * éviter les faux positifs ("cell" dans "excellent").
 */
import { createResilientRedis } from "@shenron/db/redis";
import { resolveRedisUrl } from "@shenron/config/services";

/**
 * Client Redis résilient (B8, `@shenron/db/redis`).
 *
 * Le singleton `bun.redis` abandonne après `maxRetries` (10 par défaut) : une
 * fois ce quota épuisé, TOUTE commande ultérieure jette
 * `ERR_REDIS_CONNECTION_CLOSED`, définitivement. Vécu le 2026-08-21 — Redis a
 * redémarré, le bot ne s'est jamais reconnecté et a produit ~8 500 erreurs en
 * douze heures (≈ 49 par minute) pendant que l'indexation des messages restait
 * muette. Le service ne « tombe » pas : il boucle.
 *
 * `createResilientRedis` rend le client jetable : un client mort est oublié et
 * un nouveau est rebâti (mêmes options : autoReconnect, maxRetries 20, file
 * hors-ligne), après un court backoff. La reconnexion n'a donc pas de plafond.
 * Même URL que le `RedisClient` natif sans argument : `REDIS_URL`, puis
 * `VALKEY_URL`, puis le défaut de `@shenron/config/services`.
 */
const redis = createResilientRedis({
	url: resolveRedisUrl(process.env),
	name: "indexer",
});

type HashFields = Record<string, string>;

/** Les commandes utilisées par l'indexeur, portées par le client résilient. */
const commands = {
	hset: (key: string, fields: HashFields) =>
		redis.send("HSET", [key, ...Object.entries(fields).flatMap(([f, v]) => [f, String(v)])]),
	sadd: (key: string, member: string) => redis.send("SADD", [key, member]),
	expire: (key: string, seconds: number) => redis.send("EXPIRE", [key, String(seconds)]),
	rpush: (key: string, value: string) => redis.send("RPUSH", [key, value]),
	ltrim: (key: string, start: number, stop: number) =>
		redis.send("LTRIM", [key, String(start), String(stop)]),
	hincrby: (key: string, field: string, increment: number) =>
		redis.send("HINCRBY", [key, field, String(increment)]),
};

function r(): typeof commands {
	return commands;
}
import { readFileSync, existsSync } from "node:fs";

interface IndexChannel {
	id: string;
	name: string;
	type: string;
	parentId?: string | null;
}
interface IndexUser {
	id: string;
	username: string;
	displayName: string;
	bot: boolean;
	joinedAt?: string | null;
}
interface IndexMessage {
	id: string;
	content: string;
	authorId: string;
	channelId: string;
	createdAt: string;
	authorName?: string;
	authorDisplay?: string;
	authorBot?: boolean;
}

type WorkerMessage =
	| { type: "INDEX_CHANNELS"; data: IndexChannel[] }
	| { type: "INDEX_USERS"; data: IndexUser[] }
	| { type: "INDEX_MESSAGES"; data: IndexMessage[] };

declare var self: Worker;

/** Fenêtre de rétention de l'index des messages (30 j). Cf. la note dans INDEX_MESSAGES. */
const MESSAGE_TTL_SECONDS = 30 * 24 * 60 * 60;

// ── Chargement de la table d'alias pour la canonicalisation (PLAN A3) ───────

const ALIAS_MAP_PATH = new URL("../../data/rag/alias-map.json", import.meta.url).pathname;
let aliasMap: Record<string, { canonical: string; type: string; id: string }> = {};
let aliasRegex: RegExp | null = null;

if (existsSync(ALIAS_MAP_PATH)) {
	try {
		aliasMap = JSON.parse(readFileSync(ALIAS_MAP_PATH, "utf-8"));
		const keys = Object.keys(aliasMap).toSorted((a, b) => b.length - a.length);
		if (keys.length > 0) {
			const escapedKeys = keys.map((k) => k.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&"));
			aliasRegex = new RegExp(`\\b(${escapedKeys.join("|")})\\b`, "gi");
			console.log(`[WORKER] Table d'alias chargée : ${keys.length} règles. Regex compilée.`);
		}
	} catch (err) {
		console.error("[WORKER] Impossible de charger alias-map.json sémantique:", err);
	}
}

// Fallback legacy au cas où alias-map.json n'est pas encore construit
const LORE_ENTITIES = [
	"goku",
	"vegeta",
	"freezer",
	"frieza",
	"cell",
	"buu",
	"gohan",
	"trunks",
	"piccolo",
	"whis",
	"beerus",
	"bulma",
	"krillin",
	"krilin",
	"broly",
	"bardock",
	"kamehameha",
	"fusion",
	"daima",
	"saiyan",
	"namek",
	"shenron",
	"gotenks",
	"gogeta",
	"vegetto",
	"vegito",
	"jiren",
	"yamcha",
	"tenshinhan",
	"chichi",
	"raditz",
	"nappa",
	"zeno",
	"hit",
	"kaio",
	"c17",
	"c18",
	"oolong",
	"roshi",
	"pan",
	"uub",
	"dabra",
	"babidi",
	"majin",
	"morpion",
	"bingo",
];
const LORE_RE: Array<[string, RegExp]> = LORE_ENTITIES.map((e) => [
	e,
	new RegExp(`\\b${e}\\b`, "i"),
]);

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

// Normalisation du texte (minuscules, sans accents ni caractères spéciaux)
function normalizeKey(str: string): string {
	return str
		.toLowerCase()
		.normalize("NFD")
		.replace(/[\u0300-\u036f]/g, "") // Enlève les accents
		.replace(/[^a-z0-9]/g, " ") // Remplace les caractères spéciaux par des espaces
		.replace(/\s+/g, " ") // Effondre les espaces multiples
		.trim();
}

function upsertUser(
	promises: Promise<unknown>[],
	id: string,
	username: string,
	displayName: string,
	bot: boolean
): void {
	promises.push(
		r().hset(`dbz:user:${id}`, {
			id,
			username,
			displayName: displayName || username,
			bot: bot ? "true" : "false",
		})
	);
	promises.push(r().sadd("dbz:users", id));
}

self.onmessage = async (event: MessageEvent<WorkerMessage>) => {
	const { type, data } = event.data;
	console.log(`[WORKER] type=${type}, items=${data?.length}`);
	try {
		const promises: Promise<unknown>[] = [];

		if (type === "INDEX_CHANNELS") {
			for (const ch of data) {
				promises.push(
					r().hset(`dbz:channel:${ch.id}`, {
						id: ch.id,
						name: ch.name,
						type: ch.type,
						parentId: ch.parentId ?? "",
					})
				);
				promises.push(r().sadd("dbz:channels", ch.id));
			}
		} else if (type === "INDEX_USERS") {
			for (const u of data) {
				upsertUser(promises, u.id, u.username, u.displayName, u.bot);
				if (u.joinedAt) promises.push(r().hset(`dbz:user:${u.id}`, { joinedAt: u.joinedAt }));
			}
		} else if (type === "INDEX_MESSAGES") {
			for (const msg of data) {
				promises.push(
					r().hset(`dbz:message:${msg.id}`, {
						id: msg.id,
						content: msg.content,
						authorId: msg.authorId,
						channelId: msg.channelId,
						createdAt: msg.createdAt,
					})
				);
				// Sans TTL, cet index grossit sans borne (1,1 M de clés / 436 Mo mesurés le
				// 2026-08-27) alors que rien ne le relit : les analytics de lore et de sentiment
				// sont agrégées ici même par hincrby, et `dbz:channel:*:messages` est borné par
				// ltrim. Redis n'a pas de `maxmemory` — la saturation ferait tomber le bot, pas
				// Redis. On garde donc une fenêtre glissante, reconstructible par
				// `scripts/index-discord-full.ts` (idempotent).
				promises.push(r().expire(`dbz:message:${msg.id}`, MESSAGE_TTL_SECONDS));
				promises.push(r().rpush(`dbz:channel:${msg.channelId}:messages`, msg.id));
				promises.push(r().ltrim(`dbz:channel:${msg.channelId}:messages`, -1000, -1));

				// Indexer l'auteur (peuple dbz:user:* sans intent GuildMembers).
				if (msg.authorName) {
					upsertUser(
						promises,
						msg.authorId,
						msg.authorName,
						msg.authorDisplay || msg.authorName,
						!!msg.authorBot
					);
				}
				promises.push(r().hincrby(`dbz:user:${msg.authorId}:stats`, "messages", 1));

				// Analytics de lore (limites de mots & canonicalisation sémantique).
				const content = msg.content || "";
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
					// Fallback legacy si la regex / alias-map n'est pas chargée
					for (const [entity, re] of LORE_RE) {
						if (re.test(content)) {
							foundEntities.add(entity);
						}
					}
				}

				for (const entity of foundEntities) {
					promises.push(r().hincrby(`dbz:user:${msg.authorId}:lore`, entity, 1));
					promises.push(r().hincrby(`dbz:channel:${msg.channelId}:lore`, entity, 1));
					promises.push(r().hincrby("dbz:global:lore", entity, 1));
				}

				// Sentiment par mots-clés sur texte normalisé (plus de faux-négatifs d'accents).
				let pos = 0;
				let neg = 0;
				for (const re of POS_RE) if (re.test(normContent)) pos++;
				for (const re of NEG_RE) if (re.test(normContent)) neg++;
				const bucket = pos > neg ? "positive" : neg > pos ? "negative" : "neutral";
				promises.push(r().hincrby(`dbz:user:${msg.authorId}:sentiment`, bucket, 1));
				promises.push(r().hincrby("dbz:global:sentiment", bucket, 1));
			}
		}

		await Promise.all(promises);
		self.postMessage({ status: "success", type, count: data.length });
	} catch (err) {
		console.error(`[WORKER] Erreur fatale :`, err);
		self.postMessage({ status: "fatal", error: String(err), type });
	}
};
