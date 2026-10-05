import { resolveApiUrl, resolveSiteUrl } from "@shenron/config/public-urls";
import os from "node:os";
import { singleton, inject, container } from "tsyringe";
import { Client } from "discordx";
import { botFile } from "~/lib/asset-files";
import { env } from "~/lib/env";
import { logger } from "~/lib/logger";
import { StatsService } from "~/services/StatsService";
import {
	assetUploadScopeDenied,
	authorizeAssetUpload,
	authorizeAdmin,
	checkAdmin,
	constantTimeEqual,
} from "./auth";
import {
	createSession,
	verifySession,
	readCookie,
	buildSessionCookie,
	buildLogoutCookie,
} from "./session";
import {
	getOAuthConfig,
	buildAuthorizeUrl,
	generateState,
	buildStateCookie,
	clearStateCookie,
	exchangeCode,
	fetchUser,
	isUserAllowed,
	revokeToken,
} from "./oauth";
import { getDiscordSession } from "./oauth-session";
import {
	A2A_WRITE_METHODS,
	a2aWriteGuard,
	clientIp,
	createLoginThrottle,
	isDirectLoopback,
} from "./request-guards";
import {
	fetchAgentCard,
	fetchCoordStream,
	postJsonRpc,
	postJsonRpcStream,
	STREAMING_METHODS,
	type UpstreamReply,
} from "./a2a-proxy";
import { discordFetch, DiscordRESTError } from "~/lib/discord-rest";
import { userAvatar, defaultAvatar, guildIcon } from "~/lib/discord-cdn";
import { fetchDiscordUserCached } from "~/lib/discord-profiles";
import { urlNueDe, urlSignee } from "~/lib/scans-couleur";
import {
	createChannelWebhook,
	deleteWebhook,
	executeWebhook,
	listChannelWebhooks,
	listGuildWebhooks,
	type ExecuteWebhookPayload,
} from "~/lib/discord-webhook";
import { CronRegistry } from "./cron-registry";
import { ModerationService } from "~/services/ModerationService";
import { TicketService } from "~/services/TicketService";
import { SettingsService } from "~/services/SettingsService";
import { saveLevelThresholds } from "~/lib/level-thresholds";
import { PERSONAS, PERSONA_IDS, type PersonaId } from "~/lib/personas";
import type { APIEmbed, GuildMember, TextChannel } from "discord.js";
import { verifyActingUser } from "./user-auth";
import { decideBotChoice, isPfcChoice, resolvePfc } from "~/services/games/pfc";
import {
	MORPION_BOT_BLUNDER_CHANCE,
	applyMorpionMove,
	decideMorpionMove,
	emptyBoard,
	evaluateBoard,
} from "~/services/games/morpion";
import {
	BINGO_MAX,
	BINGO_MAX_ATTEMPTS,
	BINGO_MIN,
	compareBingoGuess,
	randomBingoTarget,
} from "~/services/games/bingo";
import {
	constantTimeEqualStr,
	packBingoToken,
	parseMorpionBoard,
	signMorpion,
	unpackBingoToken,
} from "~/services/games/tokens";
import { SingleUseTokens } from "~/services/games/anti-farm";
import { GameRewardService } from "~/services/GameRewardService";

/**
 * États signés déjà joués (morpion) et jetons bingo consommés. Sans ce registre,
 * un même état « avant le coup gagnant » se rejouait pendant 30 min et payait à
 * chaque appel.
 */
const consumedGameStates = new SingleUseTokens();
const GAME_STATE_TTL_MS = 30 * 60 * 1000;
import { ZENI_GAME_WIN, ZENI_GAME_LOSS_PENALTY } from "~/lib/constants";
import { eq, and, sql, desc, asc, inArray, isNull } from "drizzle-orm";
import {
	users,
	actionLogs,
	levelRewards,
	raceLevelRoles,
	shopItems,
	achievements,
	achievementTriggers,
	inventory,
	dbCharacters,
	dbTransformations,
	dbPlanets,
	dmContacts,
	dmMessages,
	ragTrainingFeedback,
} from "~/db/schema";
import { COMMAND_CATALOG, resolveMember, runConsoleCommand } from "~/api/command-console";
import {
	addGoldCaseRoute,
	completeGoalRoute,
	createGoalRoute,
	evaluateRagRoute,
	feedbackStatusRoute,
	type IaCockpitDeps,
} from "~/api/ia-cockpit";
import { AdminReportGoalService } from "~/services/AdminReportGoalService";
import { TrainingService } from "~/services/TrainingService";
import { buildCommandCatalog, execCommand } from "~/api/command-exec";
import { DatabaseService } from "~/db/index";
import { RACE_IDS, isRaceId } from "~/lib/races";
import { reloadRaceLevelRoles } from "~/lib/race-levels";
import { MessageTemplateService } from "~/services/MessageTemplateService";
import { EconomyService } from "~/services/EconomyService";
import { InflationService } from "~/services/InflationService";
import { UrsafService } from "~/services/UrsafService";
import { CANON_PRICES, CANON_INFLATION_FACTOR, ZENI_YEN_PARITY } from "~/lib/economy-canon";
import { indexedPrice } from "~/lib/inflation-rules";
import { CardService } from "~/services/CardService";
import { CommandPermissionsService } from "~/services/CommandPermissionsService";
import { GaugeService } from "~/services/GaugeService";
import { FusionService } from "~/services/FusionService";
import { WikiService } from "~/services/WikiService";
import { DatabooksService } from "~/services/DatabooksService";
import { LeaderboardService, type LeaderboardEntry } from "~/services/LeaderboardService";
import { LevelService } from "~/services/LevelService";
import { getLevelThresholds, levelForXP, nextThresholdFrom, type LevelThreshold } from "~/lib/xp";
import { hybridSearch, logRagHealth } from "~/lib/rag";
import { contextPublicRag, searchPublicRag } from "./public-rag";
import { AphrodyComputeClient } from "@shenron/pipeline/aphrody";
import { generateLlmAnswer, isFallbackAnswer } from "~/lib/llm";
import { graphqlHandler } from "~/api/graphql";
import { openapiSpec, scalarHtml } from "~/api/openapi";
import { ADMIN_ROUTES, dashboardRedirect } from "@shenron/config/admin";
import { handleBetterAuthRequest, getBetterAuthSession } from "~/lib/better-auth";
import { EventBusService } from "~/services/EventBusService";
import { PgService } from "~/db/pg";
import {
	createBotShenronApi,
	createPublicFallback,
	createRemoteAddressRegistry,
	hitPublicBucket,
	buildPublicCorsOrigins,
	createMangaReviewApi,
	type StaffDecision,
} from "./shenron-api";

// Extrait le hash avatar depuis une URL CDN Discord
// `https://cdn.discordapp.com/avatars/{id}/{hash}.{ext}` → `{hash}`
function extractDiscordAvatarHash(url: string): string | null {
	const m = /\/avatars\/\d+\/([a-z0-9_]+)\.(?:png|jpg|jpeg|webp|gif)/i.exec(url);
	return m?.[1] ?? null;
}

// Helper pour servir un fichier statique du dossier `public/` avec content-type
// inféré + cache long (les favicons ont un hash via le manifest, donc immutable
// est OK pour 1 jour ; pas besoin de versioning).
function staticFile(path: string, contentType: string) {
	return () => {
		const file = Bun.file(botFile(path));
		return new Response(file as unknown as BodyInit, {
			headers: {
				"Content-Type": contentType,
				"Cache-Control": "public, max-age=86400",
			},
		});
	};
}

/**
 * Détecte le content-type via les magic bytes (PNG `89 50 4e 47`,
 * WebP `52 49 46 46 .. 57 45 42 50`, JPEG `ff d8 ff`).
 */
function detectImageType(bytes: Uint8Array): string {
	if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
		return "image/png";
	}
	if (
		bytes[0] === 0x52 &&
		bytes[1] === 0x49 &&
		bytes[2] === 0x46 &&
		bytes[3] === 0x46 &&
		bytes[8] === 0x57 &&
		bytes[9] === 0x45 &&
		bytes[10] === 0x42 &&
		bytes[11] === 0x50
	) {
		return "image/webp";
	}
	if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
		return "image/jpeg";
	}
	return "application/octet-stream";
}

/**
 * Hash rapide FNV-1a 32-bit sur un buffer — utilisé comme ETag.
 * Pas crypto-safe mais sub-microseconde sur des buffers de 100 KB-1 MB et
 * suffit pour identifier un rendu canvas par contenu.
 */
function etagOf(buffer: Uint8Array): string {
	let h = 0x811c9dc5;
	const len = buffer.length;
	// Échantillonner 4096 bytes répartis pour les gros buffers (PNG ~500KB+).
	const step = Math.max(1, Math.floor(len / 4096));
	for (let i = 0; i < len; i += step) {
		h ^= buffer[i] ?? 0;
		h = Math.imul(h, 0x01000193);
	}
	return `"${(h >>> 0).toString(16).padStart(8, "0")}-${len.toString(16)}"`;
}

/**
 * Cache LRU en mémoire pour les rendus canvas. Limite 32 entrées (suffisant
 * pour le dashboard admin) avec éviction du plus ancien.
 *
 * Évite que Skia re-render quand :
 *   - le browser ne respecte pas `Cache-Control` (ex: hard refresh)
 *   - plusieurs admins consultent en parallèle
 *   - le cache buster `_=N` du dashboard force un refresh côté HTTP
 *
 * Clé : path + query normalisé. TTL : 60 s (aligné avec Cache-Control HTTP).
 */
interface CacheEntry {
	buffer: Uint8Array;
	contentType: string;
	etag: string;
	expiresAt: number;
}
const renderCache = new Map<string, CacheEntry>();
const CACHE_MAX = 32;
const CACHE_TTL_MS = 60_000;

function cacheKey(req: Request): string {
	const url = new URL(req.url);
	const params = [...url.searchParams.entries()]
		.filter(([k]) => !k.startsWith("_")) // ignore cache busters
		.toSorted(([a], [b]) => a.localeCompare(b));
	return url.pathname + (params.length ? "?" + new URLSearchParams(params).toString() : "");
}

function getCached(key: string): CacheEntry | null {
	const entry = renderCache.get(key);
	if (!entry) return null;
	if (entry.expiresAt < Date.now()) {
		renderCache.delete(key);
		return null;
	}
	// LRU: re-insert pour marquer comme récent
	renderCache.delete(key);
	renderCache.set(key, entry);
	return entry;
}

function putCached(key: string, buffer: Uint8Array, contentType: string, etag: string): void {
	if (renderCache.size >= CACHE_MAX) {
		const oldest = renderCache.keys().next().value;
		if (oldest) renderCache.delete(oldest);
	}
	renderCache.set(key, {
		buffer,
		contentType,
		etag,
		expiresAt: Date.now() + CACHE_TTL_MS,
	});
}

/** Erreur HTTP propagée depuis un closure render — `cachedImage` la convertit en Response. */
class HttpError extends Error {
	constructor(
		public status: number,
		message: string
	) {
		super(message);
	}
}

/**
 * Sélectionne le format d'image préféré du client via le header `Accept`.
 * Ordre de préférence : AVIF (~−60 % vs PNG) > WebP (~−30 %) > PNG (fallback).
 *
 * Tous les browsers modernes (Chrome 85+, Firefox 93+, Safari 16.4+, Edge 121+)
 * supportent AVIF. Pour les vieux clients (curl, Discord embeds), on reste sur
 * le format natif du service (PNG/WebP).
 */
function pickFormat(accept: string | null): "avif" | "webp" | "png" {
	if (!accept) return "png";
	const a = accept.toLowerCase();
	if (a.includes("image/avif")) return "avif";
	if (a.includes("image/webp")) return "webp";
	return "png";
}

/**
 * Re-encode un buffer image dans un autre format. Coût : ~50-100 ms côté CPU
 * pour AVIF, ~30 ms pour WebP. Mitigé par le LRU cache qui mémorise par
 * (path, query, format).
 *
 * Si format == format source, retourne le buffer tel quel (zéro coût).
 */
async function reEncode(
	srcBuffer: Uint8Array,
	srcType: string,
	target: "avif" | "webp" | "png",
	quality = 75
): Promise<Uint8Array> {
	if (
		(target === "png" && srcType === "image/png") ||
		(target === "webp" && srcType === "image/webp") ||
		(target === "avif" && srcType === "image/avif")
	) {
		return srcBuffer;
	}
	const { loadImage, createCanvas } = await import("@napi-rs/canvas");
	const img = await loadImage(srcBuffer as unknown as Buffer);
	const cv = createCanvas(img.width, img.height);
	cv.getContext("2d").drawImage(img as never, 0, 0);
	if (target === "png") return new Uint8Array(await cv.encode("png"));
	if (target === "webp") return new Uint8Array(await cv.encode("webp", quality));
	return new Uint8Array(await cv.encode("avif", { quality, speed: 7 }));
}

/**
 * Cache LRU générique pour réponses JSON (canaux Discord, rôles, members,
 * templates de messages, config niveaux). Même structure que le cache canvas
 * mais TTL configurable + ETag sur le payload sérialisé.
 *
 * Pertinent pour les routes lecture-seule lentes (fetch Discord guild members
 * = 5757 entrées sur DBFR).
 */
const jsonCache = new Map<string, CacheEntry>();
const JSON_CACHE_MAX = 64;

async function cachedJson<T>(
	req: Request,
	build: () => Promise<T>,
	ttlMs = 30_000
): Promise<Response> {
	const key = cacheKey(req);
	const ifNoneMatch = req.headers.get("if-none-match");

	let entry = jsonCache.get(key);
	if (entry && entry.expiresAt < Date.now()) {
		jsonCache.delete(key);
		entry = undefined;
	}
	if (entry) {
		// LRU re-insert
		jsonCache.delete(key);
		jsonCache.set(key, entry);
	}

	if (!entry) {
		try {
			const data = await build();
			const json = JSON.stringify(data);
			const bytes = new TextEncoder().encode(json);
			const etag = etagOf(bytes);
			entry = {
				buffer: bytes,
				contentType: "application/json",
				etag,
				expiresAt: Date.now() + ttlMs,
			};
			if (jsonCache.size >= JSON_CACHE_MAX) {
				const oldest = jsonCache.keys().next().value;
				if (oldest) jsonCache.delete(oldest);
			}
			jsonCache.set(key, entry);
		} catch (err) {
			if (err instanceof HttpError) {
				return Response.json({ error: err.message }, { status: err.status });
			}
			throw err;
		}
	}

	const headers: HeadersInit = {
		"Content-Type": "application/json",
		"Cache-Control": `private, max-age=${Math.floor(ttlMs / 1000)}, must-revalidate`,
		ETag: entry.etag,
	};
	if (ifNoneMatch && ifNoneMatch === entry.etag) {
		return new Response(null, { status: 304, headers });
	}
	return new Response(entry.buffer as unknown as BodyInit, { headers });
}

/** Invalide le cache JSON pour une clé prefix (ex: après un POST `/messages/:event`). */
function invalidateJsonCache(prefix: string): number {
	let n = 0;
	// Snapshot des clés pour pouvoir delete pendant l'itération sans invalider l'iterator.
	const keys = Array.from(jsonCache.keys());
	for (const k of keys) {
		if (k.startsWith(prefix)) {
			jsonCache.delete(k);
			n++;
		}
	}
	return n;
}

/**
 * Wrapper canvas avec 3 optimisations :
 *
 *   1. **Fast path 304** — si `If-None-Match` match l'ETag en cache, renvoie
 *      `304 Not Modified` SANS appeler `render()`. Aucun fetch user/db, aucun
 *      Skia call. ~1 ms côté serveur, 0 byte transmis.
 *
 *   2. **LRU cache** — si pas d'`If-None-Match` mais une entrée non-expirée existe,
 *      sert le buffer en mémoire SANS re-render. Cache 60 s, max 32 entrées.
 *
 *   3. **Render + cache + ETag** — sinon appelle `render()`, encode le buffer
 *      (le service utilise déjà `canvas.encode()` async via libuv threadpool),
 *      détecte le content-type via magic bytes, calcule l'ETag FNV-1a, met en
 *      cache et répond.
 *
 * Les `HttpError` levés depuis `render()` (404 user introuvable, 400 paramètre
 * invalide…) sont convertis en Response JSON avec le bon status.
 */
async function cachedImage(
	req: Request,
	render: () => Promise<Buffer | Uint8Array>,
	cacheSeconds = 60
): Promise<Response> {
	const accept = req.headers.get("accept");
	const targetFormat = pickFormat(accept);
	// La clé de cache inclut le format pour ne pas servir un PNG quand AVIF demandé
	const key = `${cacheKey(req)}#${targetFormat}`;
	const ifNoneMatch = req.headers.get("if-none-match");

	let entry = getCached(key);
	if (!entry) {
		try {
			const buffer = await render();
			let bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
			let contentType = detectImageType(bytes);

			// Re-encode si le client préfère un format ≠ de celui retourné par le service
			if (
				(targetFormat === "avif" && contentType !== "image/avif") ||
				(targetFormat === "webp" && contentType !== "image/webp")
			) {
				const reencoded = await reEncode(bytes, contentType, targetFormat);
				bytes = reencoded;
				contentType = `image/${targetFormat}`;
			}

			const etag = etagOf(bytes);
			putCached(key, bytes, contentType, etag);
			entry = { buffer: bytes, contentType, etag, expiresAt: Date.now() + CACHE_TTL_MS };
		} catch (err) {
			if (err instanceof HttpError) {
				return Response.json({ error: err.message }, { status: err.status });
			}
			throw err;
		}
	}

	const headers: HeadersInit = {
		"Content-Type": entry.contentType,
		"Cache-Control": `public, max-age=${cacheSeconds}, must-revalidate`,
		ETag: entry.etag,
		Vary: "Accept",
	};

	if (ifNoneMatch && ifNoneMatch === entry.etag) {
		return new Response(null, { status: 304, headers });
	}

	return new Response(entry.buffer as unknown as BodyInit, { headers });
}

/** Couleur d'accent basée sur l'XP — calque la logique de /scan. */
function xpAccent(xp: number): string {
	if (xp >= 10_000_000) return "#f59e0b";
	if (xp >= 100_000) return "#facc15";
	if (xp >= 9_000) return "#dc2626";
	if (xp >= 5_000) return "#f87171";
	if (xp >= 1_000) return "#fb923c";
	if (xp >= 500) return "#60a5fa";
	return "#94a3b8";
}

const ASSET_CONTENT_TYPES: Record<string, string> = {
	".png": "image/png",
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".webp": "image/webp",
	".gif": "image/gif",
	".svg": "image/svg+xml",
	".ico": "image/x-icon",
	".woff": "font/woff",
	".woff2": "font/woff2",
	".ttf": "font/ttf",
	".otf": "font/otf",
	".css": "text/css",
	".js": "application/javascript",
	".json": "application/json",
	".vtt": "text/vtt",
	".srt": "application/x-subrip",
};

/**
 * Sert un fichier depuis `apps/shenron/assets/` ou refuse :
 *   - path traversal (`..`) interdit
 *   - extensions whitelist (cf ASSET_CONTENT_TYPES)
 *   - tout fichier hors `assets/` interdit
 *
 * URL : `/assets/<sub-path>` → `assets/<sub-path>`. Compat avec les paths DB
 * stockés `./assets/dbz/...` : le client peut soit normaliser côté front (préfixer
 * juste `/`), soit nous y faisons match exact via le pathname.
 */
// ── Proxy HLS ───────────────────────────────────────────────────────────────
// Relaie le flux vidéo résolu (voir-anime → m3u8/segments) en injectant le
// Referer côté serveur. CRITIQUE : le flux est lié à l'IP du résolveur (le VPS),
// donc c'est le bot (même IP) qui doit fetch — pas Vercel. La map est écrite par
// resolve-streams.ts dans data/streams.json. Signature HMAC anti open-proxy.
type HlsStream = { url: string; headers: Record<string, string>; type: string; at: number };
const HLS_SECRET = crypto.randomUUID();
let _hlsCache: { mtime: number; data: Record<string, HlsStream> } | null = null;

async function loadStreams(): Promise<Record<string, HlsStream>> {
	try {
		const f = Bun.file("data/streams.json");
		const mtime = f.lastModified;
		if (!_hlsCache || _hlsCache.mtime !== mtime) {
			_hlsCache = { mtime, data: (await f.json()) as Record<string, HlsStream> };
		}
		return _hlsCache.data;
	} catch {
		return {};
	}
}

function hlsSign(value: string): string {
	return new Bun.CryptoHasher("sha256", HLS_SECRET).update(value).digest("hex").slice(0, 24);
}

function hlsRewrite(text: string, baseUrl: string, id: string, referer: string): string {
	const abs = (uri: string) => {
		try {
			return new URL(uri, baseUrl).toString();
		} catch {
			return uri;
		}
	};
	const seg = (uri: string) => {
		const a = abs(uri);
		return `/api/hls/${id}/seg?u=${encodeURIComponent(a)}&r=${encodeURIComponent(referer)}&sig=${hlsSign(`${a}|${referer}`)}`;
	};
	return text
		.split("\n")
		.map((line) => {
			const l = line.trim();
			if (!l) return line;
			if (l.startsWith("#")) {
				return line.replace(/URI="([^"]+)"/g, (_m, uri) => `URI="${seg(uri)}"`);
			}
			return seg(l);
		})
		.join("\n");
}

type MoviePlayer = { name?: string; provider?: string; embedUrl?: string; lang?: string };

/** Extrait l'identifiant Archive.org d'une URL `embed`/`download`. `null` sinon. */
function archiveIdentifier(embedUrl: string): string | null {
	const m = /archive\.org\/(?:embed|download)\/([^/?#]+)/i.exec(embedUrl);
	return m ? m[1] : null;
}

/**
 * Dérive le MP4 direct d'un item Archive.org via l'API metadata publique :
 * `https://archive.org/metadata/<id>` → plus gros fichier `.mp4` de `files[]` →
 * `https://archive.org/download/<id>/<name>` (identifiant et nom url-encodés).
 * `null` si l'item n'a aucun MP4 ou en cas d'erreur réseau (dégradation propre).
 */
async function resolveArchiveMp4(identifier: string): Promise<string | null> {
	try {
		const res = await fetch(`https://archive.org/metadata/${encodeURIComponent(identifier)}`);
		if (!res.ok) return null;
		const meta = (await res.json()) as { files?: { name?: string; size?: string }[] };
		const files = (meta.files ?? []).filter((f) => /\.mp4$/i.test(f.name ?? ""));
		if (files.length === 0) return null;
		const largest = files.toSorted((a, b) => Number(b.size ?? 0) - Number(a.size ?? 0))[0];
		if (!largest?.name) return null;
		return `https://archive.org/download/${encodeURIComponent(identifier)}/${encodeURIComponent(largest.name)}`;
	} catch {
		return null;
	}
}

/**
 * Résout la source **téléchargeable** d'un film (id de la forme `movie-<n>`).
 * Contrairement aux épisodes, aucun résolveur bxc « à la volée » n'existe.
 * Priorité : `video_url` (MP4 stocké) → `stream_url` (HLS stocké) → scan des
 * lecteurs (`players`) pour une source réellement téléchargeable :
 *   - un `embedUrl` déjà direct (`.mp4`/`.m3u8`) → utilisé tel quel ;
 *   - un lecteur Archive.org (`provider:"archive"` ou `archive.org/embed|download/`)
 *     → MP4 direct dérivé de l'API metadata.
 * Les iframes tierces (vidmoly/voe/mailru) ne sont PAS des fichiers → ignorées.
 * `video_url`/`stream_url`/`players` sont Neon-only et **peuvent être absents du
 * replica SQLite** → sélection défensive des colonnes réellement présentes.
 * Absence de source téléchargeable ⇒ `null` (le caller renvoie un 404 propre).
 */
async function resolveMovieStream(rawId: string): Promise<HlsStream | null> {
	const movieId = Number(rawId);
	if (!Number.isInteger(movieId)) {
		console.error(`[HLS] ID de film invalide : "${rawId}".`);
		return null;
	}
	try {
		const dbs = container.resolve(DatabaseService);
		const cols = new Set(
			(dbs.sqlite.query("PRAGMA table_info(db_movies)").all() as { name: string }[]).map(
				(c) => c.name
			)
		);
		const wanted = ["video_url", "stream_url", "players"].filter((c) => cols.has(c));
		if (wanted.length === 0) {
			console.error(
				"[HLS] db_movies ne stocke aucune source (video_url/stream_url/players absents)."
			);
			return null;
		}
		const row = dbs.sqlite
			.query(`SELECT ${wanted.join(", ")} FROM db_movies WHERE id = ?`)
			.get(movieId) as
			| { video_url?: string | null; stream_url?: string | null; players?: string | null }
			| undefined;
		if (!row) {
			console.error(`[HLS] Film ID ${movieId} introuvable en base SQLite.`);
			return null;
		}

		// 1) MP4 direct stocké.
		if (row.video_url) {
			return { url: row.video_url, headers: {}, type: "mp4", at: Date.now() };
		}
		// 2) Flux HLS stocké.
		if (row.stream_url) {
			const type = /\.m3u8(\?|$)/i.test(row.stream_url) ? "hls" : "mp4";
			return { url: row.stream_url, headers: {}, type, at: Date.now() };
		}
		// 3) Lecteurs (`players`) téléchargeables : embed déjà direct puis Archive.org.
		if (row.players) {
			let players: MoviePlayer[] = [];
			try {
				const parsed = JSON.parse(row.players) as unknown;
				if (Array.isArray(parsed)) players = parsed as MoviePlayer[];
			} catch {
				players = [];
			}
			for (const p of players) {
				const embed = p?.embedUrl ?? "";
				if (/\.(mp4|m3u8)(\?|$)/i.test(embed)) {
					const type = /\.m3u8(\?|$)/i.test(embed) ? "hls" : "mp4";
					return { url: embed, headers: {}, type, at: Date.now() };
				}
			}
			for (const p of players) {
				const embed = p?.embedUrl ?? "";
				const identifier =
					p?.provider === "archive" || /archive\.org\/(?:embed|download)\//i.test(embed)
						? archiveIdentifier(embed)
						: null;
				if (identifier) {
					const mp4 = await resolveArchiveMp4(identifier);
					if (mp4) return { url: mp4, headers: {}, type: "mp4", at: Date.now() };
				}
			}
		}
		console.error(
			`[HLS] Film ID ${movieId} sans source téléchargeable (players non direct / absents).`
		);
		return null;
	} catch (err) {
		console.error(`[HLS] Erreur lors de la résolution du film "${rawId}" :`, err);
		return null;
	}
}

async function resolveStreamOnDemand(id: string): Promise<HlsStream | null> {
	const languageMatch = /^(.*)-(vf|vostfr)$/.exec(id);
	const mediaId = languageMatch?.[1] ?? id;
	const language = languageMatch?.[2] as "vf" | "vostfr" | undefined;
	// Films : `movie-<n>` → table db_movies (source stockée/players, pas de bxc).
	if (mediaId.startsWith("movie-")) {
		return await resolveMovieStream(mediaId.slice("movie-".length));
	}
	try {
		const dbs = container.resolve(DatabaseService);
		const row = dbs.sqlite
			.query("SELECT series, number_in_series FROM db_episodes WHERE id = ?")
			.get(Number(mediaId)) as { series: string; number_in_series: number } | undefined;
		if (!row) {
			console.error(`[HLS] Episode ID ${id} introuvable en base SQLite.`);
			return null;
		}
		console.log(
			`[HLS] Résolution à la volée de l'épisode ${id} (${row.series} ${row.number_in_series})...`
		);
		const BXC_DIR = process.env.BXC_DIR ?? `${os.homedir()}/bxc`;
		const proc = Bun.spawn(
			[process.execPath, "scripts/resolve-episode.ts", row.series, String(row.number_in_series)],
			{ cwd: BXC_DIR, stdout: "pipe", stderr: "ignore" }
		);
		const out = await new Response(proc.stdout).text();
		await proc.exited;
		// oxlint-disable-next-line unicorn/prefer-array-find -- getting the last non-empty line
		const line = out.trim().split("\n").filter(Boolean).pop() ?? "";
		const res = JSON.parse(line) as {
			type?: string;
			url?: string;
			headers?: Record<string, string>;
			provider?: string;
			variants?: Partial<
				Record<"vf" | "vostfr", Omit<HlsStream, "at"> & { provider?: string }>
			>;
			error?: string;
		};
		const selected = language ? res.variants?.[language] : res;
		if (selected?.url && (selected.type === "hls" || selected.type === "mp4")) {
			const entry: HlsStream = {
				url: selected.url,
				headers: selected.headers ?? {},
				type: selected.type,
				at: Date.now(),
			};
			const streams = await loadStreams();
			streams[id] = entry;
			for (const [variantLanguage, variant] of Object.entries(res.variants ?? {})) {
				if (variant?.url) streams[`${mediaId}-${variantLanguage}`] = { ...variant, at: Date.now() };
			}
			await Bun.write("data/streams.json", JSON.stringify(streams));
			console.log(`[HLS] Résolution réussie pour l'épisode ${id} : ${selected.url}`);
			return entry;
		} else {
			console.error(`[HLS] Échec de résolution pour l'épisode ${id} : ${res.error ?? "inconnu"}`);
			return null;
		}
	} catch (err) {
		console.error(`[HLS] Erreur lors de la résolution de l'épisode ${id} :`, err);
		return null;
	}
}

function requestedStreamId(req: Request, id: string): string {
	const language = new URL(req.url).searchParams.get("lang");
	return language === "vf" || language === "vostfr" ? `${id}-${language}` : id;
}

async function hlsMaster(req: Request, id: string): Promise<Response> {
	const streamId = requestedStreamId(req, id);
	let s = (await loadStreams())[streamId];
	if (!s?.url) {
		const newS = await resolveStreamOnDemand(streamId);
		if (!newS) return new Response("flux indisponible", { status: 404 });
		s = newS;
	}

	let ref = s.headers?.Referer ?? s.headers?.referer ?? "";
	const isStale = Date.now() - (s.at ?? 0) > 8 * 3600 * 1000; // Expire après 8h
	let up: Response | null = null;

	if (!isStale) {
		try {
			up = await fetch(s.url, {
				headers: ref ? { Referer: ref, Origin: new URL(ref).origin } : {},
			});
		} catch {
			// Ignoré, retente résolution
		}
	}

	if (!up || !up.ok) {
		console.log(`[HLS] Flux expiré ou injoignable pour master ${id}, actualisation...`);
		const newS = await resolveStreamOnDemand(id);
		if (newS) {
			s = newS;
			ref = s.headers?.Referer ?? s.headers?.referer ?? "";
			try {
				up = await fetch(s.url, {
					headers: ref ? { Referer: ref, Origin: new URL(ref).origin } : {},
				});
			} catch {
				return new Response("source injoignable après actualisation", { status: 502 });
			}
		}
	}

	if (!up || !up.ok) {
		return new Response("source en erreur", { status: 502 });
	}

	if (s.type === "mp4") {
		const contentType = up.headers.get("content-type") ?? "video/mp4";
		const contentLength = up.headers.get("content-length");
		const playHeaders: Record<string, string> = {
			"Content-Type": contentType,
			"Cache-Control": "public, max-age=3600",
		};
		if (contentLength) {
			playHeaders["Content-Length"] = contentLength;
		}
		return new Response(up.body, {
			headers: playHeaders,
		});
	}

	const out = hlsRewrite(await up.text(), s.url, streamId, ref);
	return new Response(out, {
		headers: { "content-type": "application/vnd.apple.mpegurl", "cache-control": "no-store" },
	});
}

async function hlsSeg(req: Request, id: string): Promise<Response> {
	const url = new URL(req.url);
	const u = url.searchParams.get("u") ?? "";
	const r = url.searchParams.get("r") ?? "";
	const sig = url.searchParams.get("sig") ?? "";
	if (!u || hlsSign(`${u}|${r}`) !== sig)
		return new Response("signature invalide", { status: 403 });
	let up: Response;
	try {
		up = await fetch(u, { headers: r ? { Referer: r, Origin: new URL(r).origin } : {} });
	} catch {
		return new Response("segment injoignable", { status: 502 });
	}
	if (!up.ok) return new Response("segment en erreur", { status: up.status });
	const ct = up.headers.get("content-type");
	if ((ct ?? "").includes("mpegurl") || /\.m3u8(\?|$)/i.test(u)) {
		const text = await up.text();
		if (text.startsWith("#EXTM3U")) {
			return new Response(hlsRewrite(text, u, id, r), {
				headers: { "content-type": "application/vnd.apple.mpegurl", "cache-control": "no-store" },
			});
		}
		return new Response(text, { headers: { "content-type": ct ?? "text/plain" } });
	}
	return new Response(up.body, {
		headers: { "content-type": ct ?? "video/mp2t", "cache-control": "public, max-age=3600" },
	});
}

/** Emplacements cosmétiques équipables depuis la boutique. */
const COSMETIC_TYPES = ["card", "badge", "color", "title", "banner"] as const;
type CosmeticType = (typeof COSMETIC_TYPES)[number];
/** Emplacements qui posent un rôle Discord à l'équipement. */
const ROLE_COSMETICS: ReadonlySet<CosmeticType> = new Set(["color", "title", "badge"]);

/** Rôle Discord lié à un objet de boutique, `null` s'il n'en porte pas. */
async function cosmeticRoleId(type: CosmeticType, key: string): Promise<string | null> {
	const dbs = container.resolve(DatabaseService);
	const item = await dbs.db.query.shopItems.findFirst({
		where: (s, { eq: e, and: a }) => a(e(s.type, type), e(s.key, key)),
	});
	return item?.roleId ?? null;
}

/** Clé actuellement équipée sur un emplacement. */
async function currentEquipped(
	eco: EconomyService,
	userId: string,
	type: CosmeticType
): Promise<string | null> {
	const u = await eco.getUser(userId);
	const byType: Record<CosmeticType, string | null | undefined> = {
		card: u?.equippedCard,
		badge: u?.equippedBadge,
		color: u?.equippedColor,
		title: u?.equippedTitle,
		banner: u?.equippedBanner,
	};
	return byType[type] ?? null;
}

async function hlsDownload(req: Request, id: string): Promise<Response> {
	const streamId = requestedStreamId(req, id);
	// Nom de fichier lisible selon le type d'entité (`movie-<n>` → film).
	const downloadName = id.startsWith("movie-")
		? `film-${id.slice("movie-".length)}.mp4`
		: `episode-${id}.mp4`;
	let s = (await loadStreams())[streamId];
	if (!s?.url) {
		const newS = await resolveStreamOnDemand(streamId);
		if (!newS) return new Response("flux indisponible", { status: 404 });
		s = newS;
	}

	let ref = s.headers?.Referer ?? s.headers?.referer ?? "";
	let headers: Record<string, string> = {};
	if (ref) {
		headers["Referer"] = ref;
		headers["Origin"] = new URL(ref).origin;
	}

	const isStale = Date.now() - (s.at ?? 0) > 8 * 3600 * 1000;
	let up: Response | null = null;

	if (!isStale) {
		try {
			up = await fetch(s.url, { headers });
		} catch {
			// Ignoré, retente
		}
	}

	if (!up || !up.ok) {
		console.log(`[HLS] Flux expiré ou injoignable pour download ${id}, actualisation...`);
		const newS = await resolveStreamOnDemand(streamId);
		if (newS) {
			s = newS;
			ref = s.headers?.Referer ?? s.headers?.referer ?? "";
			headers = {};
			if (ref) {
				headers["Referer"] = ref;
				headers["Origin"] = new URL(ref).origin;
			}
			try {
				up = await fetch(s.url, { headers });
			} catch {
				return new Response("source injoignable après actualisation", { status: 502 });
			}
		}
	}

	if (!up || !up.ok) {
		return new Response("source en erreur", { status: 502 });
	}

	if (s.type === "mp4") {
		const contentType = up.headers.get("content-type") ?? "video/mp4";
		const contentLength = up.headers.get("content-length");
		const downloadHeaders: Record<string, string> = {
			"Content-Type": contentType,
			"Content-Disposition": `attachment; filename="${downloadName}"`,
			"Cache-Control": "no-store",
		};
		if (contentLength) {
			downloadHeaders["Content-Length"] = contentLength;
		}
		return new Response(up.body, {
			headers: downloadHeaders,
		});
	}

	let text = await up.text();
	let mediaPlaylistUrl = s.url;

	if (text.includes("#EXT-X-STREAM-INF")) {
		const lines = text.split("\n");
		let subUrl = "";
		for (const line of lines) {
			const l = line.trim();
			if (l && !l.startsWith("#")) {
				subUrl = l;
				break;
			}
		}
		if (subUrl) {
			const resolvedSubUrl = new URL(subUrl, s.url).toString();
			try {
				const subUp = await fetch(resolvedSubUrl, { headers });
				if (subUp.ok) {
					text = await subUp.text();
					mediaPlaylistUrl = resolvedSubUrl;
				}
			} catch {
				// Fallback
			}
		}
	}

	const lines = text.split("\n");
	const segmentUrls: string[] = [];
	for (const line of lines) {
		const l = line.trim();
		if (l && !l.startsWith("#")) {
			try {
				segmentUrls.push(new URL(l, mediaPlaylistUrl).toString());
			} catch {
				segmentUrls.push(l);
			}
		}
	}

	if (segmentUrls.length === 0) {
		return new Response("aucun segment trouve", { status: 400 });
	}

	const stream = new ReadableStream({
		async start(controller) {
			try {
				for (let i = 0; i < segmentUrls.length; i++) {
					const segUrl = segmentUrls[i];
					const res = await fetch(segUrl, { headers });
					if (!res.ok) {
						console.error(`Failed to fetch HLS segment ${i}: ${segUrl}`);
						continue;
					}
					if (res.body) {
						const reader = res.body.getReader();
						while (true) {
							const { done, value } = await reader.read();
							if (done) break;
							controller.enqueue(value);
						}
					}
				}
				controller.close();
			} catch (err) {
				controller.error(err);
			}
		},
	});

	return new Response(stream, {
		headers: {
			"Content-Type": "video/mp4",
			"Content-Disposition": `attachment; filename="${downloadName}"`,
			"Cache-Control": "no-store",
		},
	});
}

async function serveAsset(pathname: string, req?: Request): Promise<Response> {
	const sub = decodeURIComponent(pathname.replace(/^\/assets\//, ""));
	if (!sub || sub.includes("..") || sub.startsWith("/") || sub.includes("\0")) {
		return new Response("Chemin d'asset refusé", { status: 400 });
	}
	const ext = (sub.match(/\.[a-z0-9]+$/i)?.[0] ?? "").toLowerCase();
	const contentType = ASSET_CONTENT_TYPES[ext];
	if (!contentType) {
		return new Response("Extension non autorisée", { status: 403 });
	}
	const filePath = sub.startsWith("wiki/") ? `../site/public/${sub}` : botFile(`assets/${sub}`);
	const file = Bun.file(filePath);
	if (!(await file.exists())) {
		return new Response("Asset introuvable", { status: 404 });
	}
	const cors = req ? publicCorsHeaders(req) : {};
	// Les assets wiki sont éditables en place (remplacement via l'admin au même
	// chemin) → JAMAIS de cache immutable, sinon l'ancienne image reste figée
	// (navigateur + optimiseur CDN). `no-cache` force la revalidation ; l'ETag
	// (taille + mtime) permet un 304 bon marché tant que le fichier est inchangé,
	// et sert la nouvelle image dès qu'il est réécrit.
	const etag = `"${file.size}-${Math.floor(file.lastModified)}"`;
	const cacheHeaders = {
		"Cache-Control": "no-cache, must-revalidate",
		ETag: etag,
		"Last-Modified": new Date(file.lastModified).toUTCString(),
		"Cross-Origin-Resource-Policy": "cross-origin",
		...cors,
	};
	if (req?.headers.get("if-none-match") === etag) {
		return new Response(null, { status: 304, headers: cacheHeaders });
	}
	return new Response(file as unknown as BodyInit, {
		headers: {
			"Content-Type": contentType,
			...cacheHeaders,
		},
	});
}
import {
	TABLES,
	getTableSpec,
	listRows,
	getRow,
	insertRow,
	updateRow,
	deleteRow,
} from "./db-tables";
import { findAction, listServiceActions, SERVICE_ACTIONS } from "./service-registry";

/**
 * API REST tscord-compatible — `Bun.serve` natif, full read/write.
 *
 * Surface :
 *
 *   PUBLIC
 *     GET  /health/check         online + uptime + version
 *     GET  /health/latency       ws + db
 *     GET  /                     ping + liens docs
 *     GET  /openapi              OpenAPI 3.0.1 spec
 *
 *   ADMIN (Bearer API_ADMIN_TOKEN requis)
 *     GET  /health/usage         pid CPU/mem
 *     GET  /health/host          host CPU/mem
 *     GET  /health/monitoring    aggregate
 *     GET  /health/logs          journalctl -u shenron, JSON parsé
 *
 *     GET  /stats/totals         users/guilds/commands
 *     GET  /stats/interaction/last
 *     GET  /stats/guilds/last
 *
 *     GET  /bot/guilds           liste guilds
 *     GET  /bot/commands         slash commands enregistrées (full schema)
 *     GET  /bot/commands/:name   détails d'une commande
 *
 *     GET  /cron                 liste des jobs périodiques (last/next run, errors)
 *     POST /cron/:name/trigger   trigger manuel
 *
 *     GET  /services             liste des services + actions exposables
 *     POST /services/:service/:action  exécute une action whitelist
 *
 *     GET  /database/tables                  liste les tables CRUD-able
 *     GET  /database/:table?limit&offset     pagination
 *     POST /database/:table                  insert
 *     GET  /database/:table/:id              get one
 *     PUT  /database/:table/:id              update (mutableColumns whitelist)
 *     DELETE /database/:table/:id            delete
 *
 * Bind par défaut sur 127.0.0.1:5006. Auth bearer via `API_ADMIN_TOKEN` env.
 * Compatible avec un dashboard fork de `barthofu/tscord-dashboard`.
 */
/** Garde staff des routes de revue manga (même politique que `checkAdmin`). */
async function mangaStaffDecision(req: Request): Promise<StaffDecision> {
	const decision = await authorizeAdmin(req);
	if (decision.ok) {
		const p = decision.principal;
		const reviewer =
			p.kind === "user" ? (p.discordId ? `discord:${p.discordId}` : `user:${p.userId}`) : p.kind;
		return { ok: true, reviewer };
	}
	const denied = await checkAdmin(req);
	return {
		ok: false,
		response: denied ?? Response.json({ error: "Authorization requise." }, { status: 401 }),
	};
}

@singleton()
export class ApiServer {
	private server: ReturnType<typeof Bun.serve> | null = null;

	constructor(@inject(StatsService) private stats: StatsService) {}

	start(): void {
		if (!env.API_ENABLED) {
			logger.info("API REST désactivée (API_ENABLED=false)");
			return;
		}
		if (this.server) {
			logger.warn("API REST déjà démarrée");
			return;
		}

		// B14 / S9 : @shenron/api en repli, même budget public que les routes historiques.
		const remoteAddresses = createRemoteAddressRegistry();
		const shenronApi = createPublicFallback({
			api: createBotShenronApi({
				pg: container.resolve(PgService),
				buckets: publicRateBuckets,
				remoteAddress: (request) => remoteAddresses.lookup(request),
				corsOrigins: PUBLIC_CORS_ORIGIN_LIST,
			}),
			buckets: publicRateBuckets,
			corsOrigins: PUBLIC_CORS_ORIGIN_LIST,
			graphql: graphqlHandler,
			// Revue Koharu → Shenron : candidats staff-only, traduction publiée publique.
			manga: createMangaReviewApi({
				sqlite: () => container.resolve(DatabaseService).sqlite,
				authorizeStaff: mangaStaffDecision,
				corsOrigins: PUBLIC_CORS_ORIGIN_LIST,
			}),
		});

		this.server = Bun.serve({
			port: env.API_PORT,
			hostname: env.API_HOST,
			development: false,
			idleTimeout: 120,

			routes: {
				// Administration is served once by the authenticated Aphrody M3 web host.
				...Object.fromEntries(Object.keys(ADMIN_ROUTES).map((path) => [path, (request: Request) => dashboardRedirect(request, Bun.env)])),

				// ── Static assets (favicons + manifest) ───────────────────────
				"/favicon.ico": staticFile("public/favicon.ico", "image/x-icon"),
				"/favicon-16.png": staticFile("public/favicon-16.png", "image/png"),
				"/favicon-32.png": staticFile("public/favicon-32.png", "image/png"),
				"/favicon-48.png": staticFile("public/favicon-48.png", "image/png"),
				"/favicon-96.png": staticFile("public/favicon-96.png", "image/png"),
				"/apple-touch-icon.png": staticFile("public/apple-touch-icon.png", "image/png"),
				"/icon-192.png": staticFile("public/icon-192.png", "image/png"),
				"/icon-512.png": staticFile("public/icon-512.png", "image/png"),
				"/icon-maskable-512.png": staticFile("public/icon-maskable-512.png", "image/png"),
				"/mstile-150.png": staticFile("public/mstile-150.png", "image/png"),
				"/manifest.webmanifest": staticFile(
					"public/manifest.webmanifest",
					"application/manifest+json"
				),

				// ── Auth (cookie session pour SPA) ────────────────────────────
				// Vérifie les 2 sources : Better Auth (table ba_session) ET cookie HMAC
				// legacy (shenron_session). Le 1er match wins.
				"/auth/me": async (req) => {
					// 1. Better Auth ?
					const baSession = await getBetterAuthSession(req);
					if (baSession?.user) {
						const u = baSession.user;
						const discordId = u.id; // Better Auth User.id n'est PAS le snowflake Discord
						// On essaie de retrouver l'accountId Discord en DB pour avoir le vrai snowflake
						return Response.json({
							authenticated: true,
							user: {
								id: discordId,
								username: u.name,
								avatar: u.image ? extractDiscordAvatarHash(u.image) : null,
								avatarUrl: u.image ?? null,
								email: u.email ?? null,
								source: "better-auth",
							},
						});
					}

					// 2. Session HMAC legacy ?
					const sessionCookie = readCookie(req, "shenron_session");
					const session = await verifySession(sessionCookie);
					if (!session) return Response.json({ authenticated: false });
					const user = session.userId
						? {
								id: session.userId,
								username: session.username,
								avatar: session.avatar ?? null,
								avatarUrl: userAvatar(session.userId, session.avatar, { size: 128 }),
								email: session.email ?? null,
								source: session.source,
							}
						: { source: session.source };
					return Response.json({ authenticated: true, user });
				},
				"/auth/discord": (req) => {
					const config = getOAuthConfig();
					if (!config) {
						return new Response(
							"OAuth Discord non configuré (DISCORD_CLIENT_ID, DISCORD_CLIENT_SECRET, OAUTH_REDIRECT_URI requis).",
							{ status: 503 }
						);
					}
					const state = generateState();
					const url = buildAuthorizeUrl(config, state);
					return new Response(null, {
						status: 302,
						headers: { Location: url, "Set-Cookie": buildStateCookie(state) },
					});
				},
				"/auth/callback": async (req) => {
					const config = getOAuthConfig();
					if (!config) return new Response("OAuth non configuré", { status: 503 });

					if (req.method === "OPTIONS") {
						return new Response(null, {
							status: 204,
							headers: publicCorsHeaders(req),
						});
					}

					const url = new URL(req.url);

					const code = url.searchParams.get("code");
					const state = url.searchParams.get("state");
					const expected = readCookie(req, "shenron_oauth_state");
					if (!code || !state || !expected || state !== expected) {
						return new Response("Paramètres OAuth invalides ou state mismatch.", {
							status: 400,
							headers: { "Set-Cookie": clearStateCookie() },
						});
					}
					try {
						const tokens = await exchangeCode(config, code);
						const user = await fetchUser(tokens.access_token);
						if (!isUserAllowed(user.id)) {
							logger.warn(
								{ userId: user.id, username: user.username },
								"OAuth login refusé : user hors whitelist"
							);
							return new Response(
								`Accès refusé : ${user.username} (${user.id}) n'est pas dans la whitelist.`,
								{ status: 403, headers: { "Set-Cookie": clearStateCookie() } }
							);
						}
						const session = await createSession({
							userId: user.id,
							username: user.global_name ?? user.username,
							avatar: user.avatar,
							email: user.email,
							accessToken: tokens.access_token,
							refreshToken: tokens.refresh_token ?? "",
							accessTokenExpiresAt: Date.now() + tokens.expires_in * 1000,
						});
						logger.info({ userId: user.id, username: user.username }, "OAuth login réussi");
						return new Response(null, {
							status: 302,
							headers: [
								["Location", "/"],
								["Set-Cookie", clearStateCookie()],
								["Set-Cookie", buildSessionCookie(session)],
							],
						});
					} catch (err) {
						logger.error({ err }, "OAuth callback failed");
						return new Response(
							`OAuth callback erreur : ${err instanceof Error ? err.message : String(err)}`,
							{ status: 500, headers: { "Set-Cookie": clearStateCookie() } }
						);
					}
				},
				"/auth/login": {
					POST: (req) => adminLogin(req),
				},
				"/auth/logout": {
					POST: async (req) => {
						// Best-effort revocation des tokens OAuth côté Discord (pas bloquant).
						const sessionCookie = readCookie(req, "shenron_session");
						const session = await verifySession(sessionCookie);
						const config = getOAuthConfig();
						if (session?.accessToken && config) {
							void revokeToken(config, session.accessToken);
						}
						return new Response(JSON.stringify({ ok: true }), {
							status: 200,
							headers: {
								"Content-Type": "application/json",
								"Set-Cookie": buildLogoutCookie(),
							},
						});
					},
				},

				// ── Public API ────────────────────────────────────────────────
				"/api": () =>
					Response.json({
						name: "shenron-api",
						version: "0.1.0",
						compatible: "tscord controllers (barthofu/tscord-dashboard)",
						endpoints: { docs: "/openapi", health: "/api/health/check" },
					}),
				"/openapi": () => Response.json(buildOpenApiSpec(env.API_PORT)),
				"/api/health/check": () => {
					const client = container.resolve(Client);
					return Response.json({
						online: client.isReady(),
						uptime: client.uptime,
						version: Bun.env.npm_package_version ?? "0.1.0",
					});
				},
				"/api/health/latency": () => Response.json(this.stats.getLatency()),
				"/api/manga/status": async () => {
					try {
						const dbs = container.resolve(DatabaseService);
						const countResult = dbs.sqlite
							.query<{ count: number; with_text: number }, []>(
								"SELECT count(*) as count, sum(case when text is not null and length(trim(text)) > 0 then 1 else 0 end) as with_text FROM db_manga_pages"
							)
							.get();
						let ocrRun = null;
						try {
							const currentFile = Bun.file("data/manga-ocr/current.json");
							if (await currentFile.exists()) {
								ocrRun = await currentFile.json();
							}
						} catch {}
						return Response.json({
							totalPlanches: countResult?.count ?? 0,
							planchesAvecTexte: countResult?.with_text ?? 0,
							currentRun: ocrRun,
							ok: true,
						});
					} catch (e: any) {
						return Response.json({ error: e.message, ok: false }, { status: 500 });
					}
				},
				"/api/databooks/status": async () => {
					try {
						const databooksService = container.resolve(DatabooksService);
						const tous = await databooksService.listAll();
						return Response.json({
							totalDatabooks: tous.length,
							ok: true,
						});
					} catch (e: any) {
						return Response.json({ error: e.message, ok: false }, { status: 500 });
					}
				},
				"/api/ia/status": async () => {
					try {
						const client = container.resolve(Client);
						const stats = this.stats.getLatency();
						if (process.env.RAG_BACKEND === "aphrody") {
							const rag = await new AphrodyComputeClient().ragStats();
							return Response.json({
								gatewayReady: client.isReady(), wsLatency: stats.ws, dbLatency: stats.db,
								ragReady: rag.chunks > 0,
								rag: { chunks: rag.chunks, vectors: rag.vectors, mode: rag.vectors > 0 ? "hybrid" : "lexical", builtAt: null },
								ok: true,
							});
						}
						// État calculé sur la base réellement ouverte par le bot : l'UI
						// ne doit pas annoncer un RAG prêt sur la seule foi du processus.
						const dbs = container.resolve(DatabaseService);
						const chunks =
							(dbs.sqlite.query("SELECT count(*) AS count FROM rag_chunks").get() as {
								count?: number;
							} | null)?.count ?? 0;
						let vectors = 0;
						try {
							vectors =
								(dbs.sqlite.query("SELECT count(*) AS count FROM vec_chunks").get() as {
									count?: number;
								} | null)?.count ?? 0;
						} catch {
							// sqlite-vec est optionnel : l'index lexical reste exploitable.
						}
						let builtAt: string | null = null;
						try {
							const meta = dbs.sqlite
								.query<{ built_at: number | null }, []>("SELECT built_at FROM rag_meta LIMIT 1")
								.get();
							builtAt = meta?.built_at ? new Date(meta.built_at).toISOString() : null;
						} catch {}
						const mode = chunks === 0 ? "unavailable" : vectors > 0 ? "hybrid" : "lexical";
						return Response.json({
							gatewayReady: client.isReady(),
							wsLatency: stats.ws,
							dbLatency: stats.db,
							ragReady: chunks > 0,
							rag: { chunks, vectors, mode, builtAt },
							ok: true,
						});
					} catch (e: any) {
						return Response.json({ error: e.message, ok: false }, { status: 500 });
					}
				},

				// Alias sans préfixe /api pour le site Vercel qui pingue /health/check.
				// Inclut un CORS allowlist + Cache-Control pour que Vercel cache 5 s.
				"/health/check": (req) =>
					publicCachedJson(req, 5_000, async () => {
						const client = container.resolve(Client);
						return {
							online: client.isReady(),
							uptime: client.uptime,
							version: Bun.env.npm_package_version ?? "0.1.0",
						};
					}),
				"/health/latency": (req) =>
					publicCachedJson(req, 5_000, async () => this.stats.getLatency()),

				// Liveness nu pour monitoring externe / uptime-checks (`GET /health`,
				// `GET /api/health`). Pas de résolution du Client Discord : répond 200
				// tant que le process HTTP écoute. Les détails (online/uptime/version)
				// restent sur `/health/check`.
				// S3 : une sonde loopback directe (socket loopback, sans x-real-ip ni XFF)
				// n'est pas limitée ; tout appel relayé par nginx l'est toujours.
				"/health": (req, server) =>
					publicCachedJson(
						req,
						5_000,
						async () => ({ status: "ok" }),
						server.requestIP(req)?.address
					),
				"/api/health": () => Response.json({ status: "ok" }),

				// ── Health admin ──────────────────────────────────────────────
				"/api/health/usage": admin(async () => Response.json(await this.stats.getPidUsage())),
				"/api/health/host": admin(async () => Response.json(await this.stats.getHostUsage())),
				"/api/health/monitoring": admin(async () => {
					const client = container.resolve(Client);
					return Response.json({
						botStatus: { online: client.isReady(), uptime: client.uptime },
						pid: await this.stats.getPidUsage(),
						host: await this.stats.getHostUsage(),
						latency: this.stats.getLatency(),
					});
				}),
				"/api/health/logs": admin(async (req) => {
					// Lecture des derniers logs via journalctl (le service systemd
					// `shenron.service` envoie tout sur stdout/stderr → journald).
					// Format JSON natif pour parser facilement.
					const url = new URL(req.url);
					const lines = Math.min(500, Number(url.searchParams.get("lines")) || 100);
					try {
						const proc = Bun.spawn(
							[
								"journalctl",
								"-u",
								"shenron",
								"-n",
								String(lines),
								"--output=short-iso",
								"--no-pager",
								"--reverse",
							],
							{ stdout: "pipe", stderr: "pipe" }
						);
						const text = await new Response(proc.stdout).text();
						await proc.exited;
						const logs = text
							.split("\n")
							.filter((line) => line.trim() && !line.startsWith("--"))
							.map((line) => {
								const m = line.match(/^(\S+)\s+(\S+)\s+(\S+)\s+(.*)$/);
								if (!m) return { raw: line };
								return { time: m[1], host: m[2], unit: m[3], message: m[4] };
							});
						return Response.json({ logs, count: logs.length });
					} catch (err) {
						return Response.json(
							{
								error: "journalctl indisponible",
								message: err instanceof Error ? err.message : String(err),
							},
							{ status: 500 }
						);
					}
				}),

				// ── Stats ─────────────────────────────────────────────────────
				"/api/stats/totals": admin(async () =>
					Response.json({ stats: await this.stats.getTotalStats() })
				),
				"/api/stats/interaction/last": admin(async () =>
					Response.json(await this.stats.getLastInteraction())
				),
				"/api/stats/guilds/last": admin(() => Response.json(this.stats.getLastGuildAdded())),

				// ── Bot ───────────────────────────────────────────────────────
				// Filtre mono-guild : on n'expose QUE la guild prod (env.GUILD_ID).
				// Defense in depth — `clientReady` quitte déjà les guilds non-prod.
				"/api/bot/guilds": admin(() => {
					const client = container.resolve(Client);
					const guilds = [...client.guilds.cache.values()]
						.filter((g) => g.id === env.GUILD_ID)
						.map((g) => ({
							id: g.id,
							name: g.name,
							memberCount: g.memberCount,
							iconUrl: g.iconURL({ size: 256 }),
							joinedAt: g.joinedTimestamp ? new Date(g.joinedTimestamp).toISOString() : null,
						}));
					return Response.json({ guilds });
				}),
				"/api/bot/commands": admin(() => {
					const client = container.resolve(Client);
					const commands = (client.applicationCommands ?? []).map((c) => serializeCommand(c));
					return Response.json({ commands, count: commands.length });
				}),
				"/api/bot/commands/expanded": admin(() => {
					const client = container.resolve(Client);
					const leaves: { name: string; description: string; group: string }[] = [];
					for (const c of client.applicationCommands ?? []) {
						expandCommandLeaves(c as any, leaves);
					}
					return Response.json({ commands: leaves, count: leaves.length });
				}),
				// Catalogue COMPLET (toutes les feuilles + schéma d'options) pour la page
				// admin « Exécuter une commande » — et exécution headless via interaction
				// synthétique (cf. command-exec.ts).
				"/api/bot/commands/catalog": admin(async () => Response.json(buildCommandCatalog())),
				"/api/bot/commands/exec": {
					POST: admin(async (req) => {
						const body = (await req.json().catch(() => null)) as {
							invocation?: string;
							options?: Record<string, unknown>;
							channelId?: string;
						} | null;
						if (!body?.invocation) {
							return Response.json({ error: "invocation requise" }, { status: 400 });
						}
						const res = await execCommand(body.invocation, body.options ?? {}, body.channelId);
						return Response.json(res, { status: res.ok ? 200 : 400 });
					}),
				},
				"/api/bot/commands/permissions": {
					GET: admin(async () => {
						const svc = container.resolve(CommandPermissionsService);
						return Response.json({ rules: await svc.list() });
					}),
					POST: admin(async (req) => {
						const body = (await req.json().catch(() => null)) as {
							name?: string;
							enabled?: boolean;
							allowedRoles?: unknown;
							deniedRoles?: unknown;
							deniedUsers?: unknown;
						} | null;
						if (!body || typeof body.name !== "string" || !body.name.trim()) {
							return Response.json(
								{
									error:
										"Body attendu : { name, enabled?, allowedRoles?, deniedRoles?, deniedUsers? }",
								},
								{ status: 400 }
							);
						}
						const sanitizeIds = (v: unknown): string[] => {
							if (!Array.isArray(v)) return [];
							return v
								.filter((x): x is string => typeof x === "string")
								.filter((x) => /^\d{17,20}$/.test(x));
						};
						const svc = container.resolve(CommandPermissionsService);
						const rule = await svc.upsert({
							name: body.name.trim(),
							enabled: typeof body.enabled === "boolean" ? body.enabled : true,
							allowedRoles: sanitizeIds(body.allowedRoles),
							deniedRoles: sanitizeIds(body.deniedRoles),
							deniedUsers: sanitizeIds(body.deniedUsers),
						});
						return Response.json({ rule });
					}),
				},
				"/api/bot/commands/permissions/delete": {
					POST: admin(async (req) => {
						const body = (await req.json().catch(() => null)) as { name?: string } | null;
						if (!body || typeof body.name !== "string") {
							return Response.json({ error: "Body attendu : { name }" }, { status: 400 });
						}
						const svc = container.resolve(CommandPermissionsService);
						await svc.remove(body.name.trim());
						return Response.json({ ok: true });
					}),
				},
				"/api/bot/commands/:name": admin((req) => {
					const client = container.resolve(Client);
					const found = (client.applicationCommands ?? []).find(
						(c: any) => c.name === req.params.name
					);
					if (!found) return Response.json({ error: "Commande introuvable" }, { status: 404 });
					return Response.json(serializeCommand(found));
				}),

				// ── Bot unifié — aliases conservés pour les routes de détail ───
				// GET /api/bots         : une carte synthétique du client Gateway
				// GET /api/bots/:id     : détail de Shenron ou d'un alias historique
				// GET /api/bots/:id/commands  : full schema slash commands d'un persona
				// GET /api/bots/:id/expanded  : leaves expandées (groupes flatten) pour Commands.tsx
				"/api/bots": admin(() => {
					const map = container.resolve<Map<string, Client>>("ClientMap");
					const unique = [...new Set(map.values())];
					// MetadataStorage discordx est singleton — `client.applicationCommands`
					// retourne TOUTES les classes @Slash sans filtrage par botId.
					// On filtre via `isBotAllowed("shenron")` pour le client unifié.
					const allCmds = (Client.applicationCommands ?? []) as unknown as Array<{
						isBotAllowed: (id: string) => boolean;
					}>;
					const bots = unique.map((c) => ({
						id: "shenron",
						name: c.user?.username ?? "shenron",
						username: c.user?.tag ?? null,
						avatar: c.user?.displayAvatarURL({ size: 128 }) ?? null,
						online: c.isReady(),
						uptime: c.uptime,
						wsPing: c.ws.ping,
						intents:
							typeof c.options.intents === "number"
								? c.options.intents
								: (c.options.intents?.bitfield ?? 0),
						guildCount: c.guilds.cache.size,
						commandCount: allCmds.filter((cmd) => cmd.isBotAllowed("shenron")).length,
					}));
					return Response.json({ bots });
				}),
				"/api/bots/:id": admin((req) => {
					const map = container.resolve<Map<string, Client>>("ClientMap");
					const c = map.get(req.params.id);
					if (!c) return Response.json({ error: "Bot introuvable" }, { status: 404 });
					const allCmds = (Client.applicationCommands ?? []) as unknown as Array<{
						isBotAllowed: (id: string) => boolean;
					}>;
					const guilds = [...c.guilds.cache.values()]
						.filter((g) => g.id === env.GUILD_ID)
						.map((g) => ({
							id: g.id,
							name: g.name,
							memberCount: g.memberCount,
							iconUrl: g.iconURL({ size: 256 }),
							joinedAt: g.joinedTimestamp ? new Date(g.joinedTimestamp).toISOString() : null,
						}));
					return Response.json({
						id: req.params.id,
						name: c.user?.username ?? req.params.id,
						username: c.user?.tag ?? null,
						avatar: c.user?.displayAvatarURL({ size: 256 }) ?? null,
						online: c.isReady(),
						uptime: c.uptime,
						wsPing: c.ws.ping,
						guilds,
						commandCount: allCmds.filter((cmd) => cmd.isBotAllowed(req.params.id)).length,
					});
				}),
				"/api/bots/:id/commands": admin((req) => {
					const map = container.resolve<Map<string, Client>>("ClientMap");
					const c = map.get(req.params.id);
					if (!c) return Response.json({ error: "Bot introuvable" }, { status: 404 });
					const id = req.params.id;
					const allCmds = (Client.applicationCommands ?? []) as unknown as Array<{
						isBotAllowed: (id: string) => boolean;
					}>;
					const commands = allCmds
						.filter((cmd) => cmd.isBotAllowed(id))
						.map((cmd) => serializeCommand(cmd as any));
					return Response.json({ commands, count: commands.length });
				}),
				"/api/bots/:id/expanded": admin((req) => {
					const map = container.resolve<Map<string, Client>>("ClientMap");
					const c = map.get(req.params.id);
					if (!c) return Response.json({ error: "Bot introuvable" }, { status: 404 });
					const id = req.params.id;
					const allCmds = (Client.applicationCommands ?? []) as unknown as Array<{
						isBotAllowed: (id: string) => boolean;
					}>;
					const leaves: { name: string; description: string; group: string }[] = [];
					for (const cmd of allCmds.filter((c2) => c2.isBotAllowed(id))) {
						expandCommandLeaves(cmd as any, leaves);
					}
					return Response.json({ commands: leaves, count: leaves.length });
				}),

				// ── Guild roles (role picker dashboard) ───────────────────────
				// Liste les rôles de la guild via cache discord.js du persona donné
				// (par défaut Shenron). Filtre @everyone + rôles managed (bots), SAUF le
				// rôle de boost serveur (premiumSubscriberRole) : il est `managed` mais
				// c'est un rôle humain légitime à cibler (gating, boosts XP, staff…).
				"/api/bots/:id/guild/roles": admin((req) => {
					const map = container.resolve<Map<string, Client>>("ClientMap");
					const c = map.get(req.params.id);
					if (!c) return Response.json({ error: "Bot introuvable" }, { status: 404 });
					const guild = c.guilds.cache.get(env.GUILD_ID);
					if (!guild) return Response.json({ error: "Guild introuvable" }, { status: 404 });
					const roles = [...guild.roles.cache.values()]
						.filter(
							(r) => r.id !== guild.id && (!r.managed || r.tags?.premiumSubscriberRole === true)
						)
						.toSorted((a, b) => b.position - a.position)
						.map((r) => ({
							id: r.id,
							name: r.name,
							color: r.color,
							hexColor: r.hexColor,
							position: r.position,
							managed: r.managed,
							premiumSubscriber: r.tags?.premiumSubscriberRole === true,
						}));
					return Response.json({ roles });
				}),

				// ── Routes PUBLIQUES (CORS + rate-limit + ETag + Cache-Control) ─
				// Cible : site Vercel dbfr-site qui mirror profil Discord.
				// Toutes utilisent `publicCachedJson` → 2 niveaux de cache :
				//   1) memo mémoire (TTL court) — absorbe les hits parallèles
				//   2) Cache-Control public + ETag — Vercel edge cache + 304
				"/api/public/user/:discordId": (req) =>
					publicCachedJson(req, 30_000, async () => {
						const id = req.params.discordId;
						if (!/^\d{17,20}$/.test(id)) throw new HttpError(400, "discordId invalide");
						const dbs = container.resolve(DatabaseService);
						const user = await dbs.db.query.users.findFirst({ where: eq(users.id, id) });
						if (!user) throw new HttpError(404, "User inconnu");

						const level = levelForXP(user.xp);
						const next = nextThresholdFrom(user.xp);

						// 4 fetches en parallèle (SQLite WAL supporte les lectures
						// concurrentes ; Discord REST de toute façon en parallèle).
						const [inv, ach, fusion, dUser] = await Promise.all([
							container.resolve(EconomyService).listInventory(id),
							dbs.db.query.achievements.findMany({
								where: (a, { eq: e }) => e(a.userId, id),
							}),
							container.resolve(FusionService).getFusion(id),
							fetchDiscordUserCached(id),
						]);

						// Deuxième vague parallèle : enrich inventory (JOIN shop) +
						// fetch partner Discord — dépend du résultat de la 1re vague.
						const itemKeys = inv.map((i) => i.itemKey);
						const [shopRows, partnerData] = await Promise.all([
							itemKeys.length
								? dbs.db.query.shopItems.findMany({
										where: inArray(shopItems.key, itemKeys),
									})
								: Promise.resolve([]),
							fusion ? fetchDiscordUserCached(fusion.partnerId) : Promise.resolve(null),
						]);
						const shopByKey = new Map(shopRows.map((s) => [s.key, s]));
						const avatarUrl = discordAvatarUrl(id, dUser.avatarHash, 512);

						let fusionData: {
							partnerId: string;
							partnerName: string | null;
							createdAt: Date;
						} | null = null;
						if (fusion && partnerData) {
							fusionData = {
								partnerId: fusion.partnerId,
								partnerName: partnerData.username,
								createdAt: fusion.createdAt,
							};
						}

						// Bannière : priorité 1) banner explicitement équipé via /inventaire equip,
						// 2) bannière du level reward atteint, 3) carte équipée legacy, 4) null.
						const siteBase = resolveSiteUrl(Bun.env);

						let bannerUrl: string | null = null;
						if (user.equippedBanner) {
							// Lookup via shop_items.meta.bannerPath
							const banItem = await dbs.db.query.shopItems.findFirst({
								where: (s, { eq: e }) => e(s.key, user.equippedBanner ?? ""),
							});
							if (banItem?.meta) {
								try {
									const m = JSON.parse(banItem.meta) as { bannerPath?: string };
									if (m.bannerPath) {
										const f = m.bannerPath.split("/").pop();
										if (f) bannerUrl = `${siteBase}/banners/${f}`;
									}
								} catch {}
							}
						}
						if (!bannerUrl && level >= 1) {
							const lr = await dbs.db.query.levelRewards.findFirst({
								where: (l, { eq: e }) => e(l.level, level),
							});
							if (lr?.bannerUrl) {
								const f = lr.bannerUrl.split("/").pop();
								if (f) bannerUrl = `${siteBase}/banners/${f}`;
							}
						}
						if (!bannerUrl && user.equippedCard) {
							const apiBase = resolveApiUrl(Bun.env);
							bannerUrl = `${apiBase}/assets/cards/${encodeURIComponent(user.equippedCard)}.png`;
						}

						// Rôle Discord le plus haut du membre (hors @everyone), pour le
						// profil public. Best-effort : membre parti du serveur → null.
						const member = await resolveMember(id).catch(() => null);
						const highest = member?.roles.highest;
						const topRole =
							highest && highest.id !== member?.guild.id
								? {
										id: highest.id,
										name: highest.name,
										// `#000000` = rôle sans couleur chez Discord.
										color: highest.hexColor === "#000000" ? null : highest.hexColor,
									}
								: null;

						return {
							discordId: user.id,
							username: dUser.username,
							avatar: dUser.avatarHash,
							avatarUrl,
							topRole,
							level,
							xp: user.xp,
							zeni: user.zeni,
							xpProgress: next
								? {
										current: user.xp,
										nextLevel: next.level,
										nextLevelXp: next.xp,
										needed: next.xp - user.xp,
									}
								: null,
							banner: bannerUrl,
							equipped: {
								card: user.equippedCard,
								badge: user.equippedBadge,
								color: user.equippedColor,
								title: user.equippedTitle,
								banner: user.equippedBanner,
							},
							achievements: ach.map((a) => ({ code: a.code, unlockedAt: a.unlockedAt })),
							inventory: inv.map((i) => {
								const shop = shopByKey.get(i.itemKey);
								return {
									type: i.itemType,
									key: i.itemKey,
									name: shop?.name ?? i.itemKey,
									description: shop?.description ?? null,
								};
							}),
							fusion: fusionData,
						};
					}),

				"/api/public/shop": (req) =>
					publicCachedJson(req, 5 * 60_000, async () => {
						const dbs = container.resolve(DatabaseService);
						const items = await dbs.db.query.shopItems.findMany({
							where: (s, { eq: e }) => e(s.enabled, true),
						});
						// Guilde (n'importe quel client) pour résoudre la couleur des rôles cosmétiques.
						const clientMap = container.resolve<Map<string, Client>>("ClientMap");
						const guild = [...clientMap.values()]
							.map((c) => c.guilds.cache.get(env.GUILD_ID))
							.find(Boolean);
						const inflationStatus = await container.resolve(InflationService).status();
						return {
							economy: {
								priceIndex: inflationStatus.index,
								inflationEnabled: inflationStatus.enabled,
								change7d: inflationStatus.change7d,
								ceiling: CANON_INFLATION_FACTOR,
								canonPrices: CANON_PRICES,
								parity: ZENI_YEN_PARITY,
							},
							items: items.map((i) => {
								let meta: Record<string, unknown> | undefined;
								if (i.meta) {
									try {
										meta = JSON.parse(i.meta);
									} catch {
										meta = undefined;
									}
								}
								// Convertit le bannerPath bot (assets/banners/...) en URL CDN site
								let preview: string | undefined;
								if (meta?.bannerPath && typeof meta.bannerPath === "string") {
									const fname = meta.bannerPath.split("/").pop();
									if (fname) preview = `/banners/${fname}`;
								} else if (meta?.badgePath && typeof meta.badgePath === "string") {
									// Emblèmes vectoriels servis par le site (`public/badges/*.svg`).
									const fname = meta.badgePath.split("/").pop();
									if (fname) preview = `/badges/${fname}`;
								} else if (meta?.cardPath && typeof meta.cardPath === "string") {
									const fname = meta.cardPath.split("/").pop();
									if (fname) preview = `/banners/${fname}`;
								}
								// Couleur hex du rôle cosmétique (items color/title/badge) pour l'aperçu.
								let roleColor: string | undefined;
								if (i.roleId && guild) {
									const role = guild.roles.cache.get(i.roleId);
									if (role && role.color)
										roleColor = `#${role.color.toString(16).padStart(6, "0")}`;
								}
								return {
									key: i.key,
									type: i.type,
									name: i.name,
									description: i.description,
									price: i.price,
									// Prix du jour, indexé quand l'inflation est active.
									effectivePrice:
										inflationStatus.index === 1
											? i.price
											: indexedPrice(i.price, inflationStatus.index),
									roleId: i.roleId,
									roleColor,
									preview,
									meta,
								};
							}),
						};
					}),

				"/api/public/leaderboard": (req) =>
					publicCachedJson(req, 15_000, async () => {
						const url = new URL(req.url);
						const metric = url.searchParams.get("metric") === "zeni" ? "zeni" : "xp";
						const period = url.searchParams.get("period") === "month" ? "month" : "general";
						const limit = Math.min(
							Math.max(parseInt(url.searchParams.get("limit") ?? "100", 10) || 100, 1),
							500
						);
						const enrich = url.searchParams.get("enrich") === "1";
						const dbs = container.resolve(DatabaseService);
						const rows: Array<{ id: string; xp: number; zeni: number; level: number }> = [];
						if (period === "month") {
							const now = new Date();
							const since = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
							const amount = sql<number>`coalesce(sum(cast(json_extract(${actionLogs.meta}, '$.amount') as integer)), 0)`;
							const action =
								metric === "xp"
									? eq(actionLogs.action, "XP_GAIN")
									: inArray(actionLogs.action, [
											"ZENI_GAIN",
											"ZENI_DROP",
											"ZENI_REGEN",
											"ZENI_DAILY",
										]);
							const monthly = await dbs.db
								.select({ id: actionLogs.userId, score: amount })
								.from(actionLogs)
								.where(
									and(
										action,
										sql`${actionLogs.createdAt} >= ${since}`,
										sql`${actionLogs.userId} is not null`
									)
								)
								.groupBy(actionLogs.userId)
								.orderBy(desc(amount))
								.limit(limit);
							const ids = monthly.map((r) => r.id).filter((id): id is string => Boolean(id));
							const current = ids.length
								? await dbs.db
										.select({ id: users.id, xp: users.xp, zeni: users.zeni })
										.from(users)
										.where(inArray(users.id, ids))
								: [];
							const byId = new Map(current.map((r) => [r.id, r]));
							for (const r of monthly) {
								if (!r.id) continue;
								const currentUser = byId.get(r.id);
								rows.push({
									id: r.id,
									xp: metric === "xp" ? Number(r.score) : (currentUser?.xp ?? 0),
									zeni: metric === "zeni" ? Number(r.score) : (currentUser?.zeni ?? 0),
									level: levelForXP(currentUser?.xp ?? 0),
								});
							}
						} else {
							const col = metric === "zeni" ? users.zeni : users.xp;
							const current = await dbs.db
								.select({ id: users.id, xp: users.xp, zeni: users.zeni })
								.from(users)
								.where(sql`${col} > 0`)
								.orderBy(desc(col))
								.limit(limit);
							for (const r of current) rows.push({ ...r, level: levelForXP(r.xp) });
						}

						if (!enrich) {
							return {
								leaderboard: rows.map((r, i) => ({
									rank: i + 1,
									discordId: r.id,
									username: null as string | null,
									avatarUrl: null as string | null,
									xp: r.xp,
									zeni: r.zeni,
									level: r.level,
								})),
							};
						}

						// Enrich opt-in via cache Discord users (5 min). Concurrence
						// bornée (8) + deadline 7 s : cache chaud ≈ instantané, cache
						// froid borné (jamais de 502 par rate-limit storm). Les users
						// non résolus dans le budget → username null + avatar défaut.
						const enriched = await mapLimitDeadline(
							rows,
							8,
							7000,
							async (r, i) => {
								const u = await fetchDiscordUserCached(r.id);
								return {
									rank: i + 1,
									discordId: r.id,
									username: u.username,
									avatarUrl: discordAvatarUrl(r.id, u.avatarHash, 128),
									xp: r.xp,
									zeni: r.zeni,
									level: r.level,
								};
							},
							(r, i) => ({
								rank: i + 1,
								discordId: r.id,
								username: null as string | null,
								avatarUrl: discordAvatarUrl(r.id, null, 128),
								xp: r.xp,
								zeni: r.zeni,
								level: r.level,
							})
						);
						return { leaderboard: enriched };
					}),

				// Stats globales pour widgets de homepage du site (compte users,
				// XP total distribué, zenis en circulation, succès débloqués).
				// Cache 15s (cohérent avec leaderboard pour éviter incohérence
				// totalXp = top.sum(xp) entre les deux endpoints).
				"/api/public/stats": (req) =>
					publicCachedJson(req, 15_000, async () => {
						const dbs = container.resolve(DatabaseService);
						const db = dbs.db;
						const [u] = await db
							.select({
								c: sql<number>`count(*)`,
								totalXp: sql<number>`coalesce(sum(xp), 0)`,
								totalZeni: sql<number>`coalesce(sum(zeni), 0)`,
							})
							.from(users);
						const [a] = await db.select({ c: sql<number>`count(*)` }).from(achievements);
						const [s] = await db
							.select({ c: sql<number>`count(*)` })
							.from(shopItems)
							.where(eq(shopItems.enabled, true));
						const [inv] = await db.select({ c: sql<number>`count(*)` }).from(inventory);
						return {
							users: Number(u?.c ?? 0),
							totalXp: Number(u?.totalXp ?? 0),
							totalZeni: Number(u?.totalZeni ?? 0),
							achievementsUnlocked: Number(a?.c ?? 0),
							shopItems: Number(s?.c ?? 0),
							inventoryItems: Number(inv?.c ?? 0),
						};
					}),

				// Présence live des membres du serveur (compteur en ligne +
				// échantillon) pour le widget « connectés » de la home. Lecture via le
				// client grandPretre (seul persona avec l'intent GuildPresences). Le
				// COMPTE est toujours public ; l'échantillon nominatif (avatars +
				// pseudos) est gardé par le réglage `presence.public` (défaut on).
				"/api/public/presence": (req) =>
					publicCachedJson(req, 15_000, async () => {
						const map = container.resolve<Map<string, Client>>("ClientMap");
						const client = map.get("grandPretre");
						const guild = client?.guilds.cache.get(env.GUILD_ID);
						if (!guild) {
							return {
								total: 0,
								online: 0,
								members: [] as Array<{
									id: string;
									username: string;
									avatarUrl: string;
									status: string;
								}>,
							};
						}

						// `presences.cache` = présences reçues via l'intent GuildPresences.
						// On ne garde que les humains non hors-ligne, dédupliqués.
						const seen = new Set<string>();
						const online: Array<{
							id: string;
							username: string;
							avatarUrl: string;
							status: string;
						}> = [];
						for (const presence of guild.presences.cache.values()) {
							const status = presence.status;
							if (status === "offline" || status === "invisible") continue;
							const member = presence.member ?? guild.members.cache.get(presence.userId);
							const user = member?.user;
							if (!user || user.bot || seen.has(user.id)) continue;
							seen.add(user.id);
							online.push({
								id: user.id,
								username: member?.displayName ?? user.username,
								avatarUrl: user.displayAvatarURL({ size: 64, extension: "webp" }),
								status,
							});
						}

						const rank: Record<string, number> = { online: 0, idle: 1, dnd: 2 };
						const sorted = online.toSorted(
							(a, b) =>
								(rank[a.status] ?? 9) - (rank[b.status] ?? 9) ||
								a.username.localeCompare(b.username)
						);

						const settings = container.resolve(SettingsService);
						const showNames = await settings.getBool("presence.public", true);

						return {
							total: guild.memberCount,
							online: online.length,
							members: showNames ? sorted.slice(0, 30) : [],
						};
					}),

				// ── Personas + Commands publics (mirroring site) ────────────
				"/api/public/personas": (req) =>
					publicCachedJson(req, 5 * 60_000, async () => {
						const clientMap = container.resolve<Map<string, Client>>("ClientMap");
						const list = [];
						for (const id of ["shenron"] as const) {
							const c = clientMap.get(id);
							const cfg = PERSONAS[id];
							list.push({
								id,
								name: cfg.name,
								aliases: PERSONA_IDS.filter((alias) => alias !== "shenron"),
								username: c?.user?.username ?? null,
								// `userAvatar` bascule sur l'avatar par défaut quand le
								// bot n'a pas d'avatar (évitait `/avatars/<id>/null.webp`).
								avatar: c?.user ? userAvatar(c.user.id, c.user.avatar, { size: 256 }) : null,
								online: c?.isReady() ?? false,
								wsPing: c?.ws?.ping ?? -1,
								intents: cfg.intents.length,
								guildCount: c?.guilds.cache.size ?? 0,
								commandCount: c
									? Client.applicationCommands.filter((cmd) => cmd.isBotAllowed(id)).length
									: 0,
							});
						}
						return { personas: list };
					}),

				"/api/public/commands": (req) =>
					publicCachedJson(req, 5 * 60_000, async () => {
						const grouped: Record<
							string,
							Array<{
								name: string;
								description: string;
								type: number;
								options?: unknown[];
							}>
						> = {};
						for (const id of PERSONA_IDS) {
							const cmds = Client.applicationCommands
								.filter((c) => c.isBotAllowed(id))
								.map((c) => ({
									name: c.name,
									description: c.description ?? "",
									type: c.type ?? 1,
									options: c.options as unknown[],
								}));
							grouped[id] = cmds;
						}
						return { commands: grouped };
					}),

				// ── Wiki Dragon Ball (cache 1 h — données quasi statiques) ────
				"/api/public/wiki/characters": (req) =>
					publicCachedJson(req, 60 * 60_000, async () => {
						const url = new URL(req.url);
						const query = url.searchParams.get("q");
						const wiki = container.resolve(WikiService);
						const all = query ? await wiki.search(query) : await wiki.listAll();
						// `limit`/`offset` are in the OpenAPI contract; without them the full
						// list stays the default (existing consumers read every character).
						const rawLimit = url.searchParams.get("limit");
						const offset = Math.max(0, Number(url.searchParams.get("offset")) || 0);
						const limit = rawLimit ? Math.min(Math.max(Number(rawLimit) || 50, 1), 200) : undefined;
						const characters =
							limit !== undefined || offset > 0
								? all.slice(offset, limit !== undefined ? offset + limit : undefined)
								: all;
						return { characters };
					}),

				"/api/public/wiki/characters/:id": (req) =>
					publicCachedJson(req, 60 * 60_000, async () => {
						const id = parseInt(req.params.id, 10);
						if (!Number.isFinite(id)) throw new HttpError(400, "ID invalide");
						const wiki = container.resolve(WikiService);
						const character = await wiki.getCharacter(id);
						if (!character) throw new HttpError(404, "Personnage inconnu");
						return character;
					}),

				"/api/public/wiki/planets": (req) =>
					publicCachedJson(req, 60 * 60_000, async () => {
						const wiki = container.resolve(WikiService);
						return { planets: await wiki.listPlanets() };
					}),

				"/api/public/wiki/transformations": (req) =>
					publicCachedJson(req, 60 * 60_000, async () => {
						const wiki = container.resolve(WikiService);
						return { transformations: await wiki.listTransformations() };
					}),

				"/api/public/wiki/planets/:id": (req) =>
					publicCachedJson(req, 60 * 60_000, async () => {
						const id = parseInt(req.params.id, 10);
						if (!Number.isFinite(id)) throw new HttpError(400, "ID invalide");
						const wiki = container.resolve(WikiService);
						const planet = await wiki.getPlanet(id);
						if (!planet) throw new HttpError(404, "Planète inconnue");
						return planet;
					}),

				"/api/public/wiki/races": (req) =>
					publicCachedJson(req, 60 * 60_000, async () => {
						const wiki = container.resolve(WikiService);
						return { races: await wiki.listRaces() };
					}),

				"/api/public/wiki/races/:slug": (req) =>
					publicCachedJson(req, 60 * 60_000, async () => {
						const wiki = container.resolve(WikiService);
						const r = await wiki.getRace(req.params.slug);
						if (!r) throw new HttpError(404, "Race inconnue");
						return r;
					}),

				"/api/public/wiki/techniques": (req) =>
					publicCachedJson(req, 60 * 60_000, async () => {
						const wiki = container.resolve(WikiService);
						return { techniques: await wiki.listTechniques() };
					}),

				"/api/public/wiki/techniques/:slug": (req) =>
					publicCachedJson(req, 60 * 60_000, async () => {
						const wiki = container.resolve(WikiService);
						const t = await wiki.getTechnique(req.params.slug);
						if (!t) throw new HttpError(404, "Technique inconnue");
						return t;
					}),

				"/api/public/wiki/sagas": (req) =>
					publicCachedJson(req, 60 * 60_000, async () => {
						const wiki = container.resolve(WikiService);
						return { sagas: await wiki.listSagas() };
					}),

				"/api/public/wiki/sagas/:slug": (req) =>
					publicCachedJson(req, 60 * 60_000, async () => {
						const wiki = container.resolve(WikiService);
						const s = await wiki.getSaga(req.params.slug);
						if (!s) throw new HttpError(404, "Saga inconnue");
						return s;
					}),

				"/api/public/wiki/arcs/:slug": (req) =>
					publicCachedJson(req, 60 * 60_000, async () => {
						const wiki = container.resolve(WikiService);
						const a = await wiki.getArc(req.params.slug);
						if (!a) throw new HttpError(404, "Arc inconnu");
						return a;
					}),

				"/api/public/wiki/episodes": (req) =>
					publicCachedJson(req, 30 * 60_000, async () => {
						const url = new URL(req.url);
						const series = url.searchParams.get("series");
						const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "100", 10), 500);
						const offset = Math.max(0, Number(url.searchParams.get("offset")) || 0);
						const dbs = container.resolve(DatabaseService);
						const sql = series
							? "SELECT * FROM db_episodes WHERE series = ? ORDER BY number_in_series LIMIT ? OFFSET ?"
							: "SELECT * FROM db_episodes ORDER BY series, number_in_series LIMIT ? OFFSET ?";
						const episodes = series
							? dbs.sqlite.query(sql).all(series, limit, offset)
							: dbs.sqlite.query(sql).all(limit, offset);
						const total = series
							? (
									dbs.sqlite
										.query("SELECT COUNT(*) AS n FROM db_episodes WHERE series = ?")
										.get(series) as { n: number }
								).n
							: (
									dbs.sqlite.query("SELECT COUNT(*) AS n FROM db_episodes").get() as {
										n: number;
									}
								).n;
						return { episodes, total, limit, offset };
					}),

				"/api/public/wiki/episodes/:id": (req) =>
					publicCachedJson(req, 60 * 60_000, async () => {
						const id = parseInt(req.params.id, 10);
						if (!Number.isFinite(id)) throw new HttpError(400, "ID invalide");
						const wiki = container.resolve(WikiService);
						const ep = await wiki.getEpisodeById(id);
						if (!ep) throw new HttpError(404, "Épisode inconnu");
						return ep;
					}),

				// Proxy HLS : le site joue le flux dans son player via ces routes
				// (le bot fetch depuis l'IP du VPS = IP de résolution → CDN OK).
				"/api/hls/:id/master.m3u8": (req) => hlsMaster(req, req.params.id),
				"/api/hls/:id/seg": (req) => hlsSeg(req, req.params.id),
				"/api/hls/:id/download": (req) => hlsDownload(req, req.params.id),

				"/api/public/wiki/movies": (req) =>
					publicCachedJson(req, 60 * 60_000, async () => {
						const wiki = container.resolve(WikiService);
						return { movies: await wiki.listMovies() };
					}),

				"/api/public/wiki/movies/:slug": (req) =>
					publicCachedJson(req, 60 * 60_000, async () => {
						const wiki = container.resolve(WikiService);
						const m = await wiki.getMovie(req.params.slug);
						if (!m) throw new HttpError(404, "Film inconnu");
						return m;
					}),

				"/api/public/wiki/games": (req) =>
					publicCachedJson(req, 60 * 60_000, async () => {
						const wiki = container.resolve(WikiService);
						return { games: await wiki.listGames() };
					}),

				"/api/public/wiki/games/:slug": (req) =>
					publicCachedJson(req, 60 * 60_000, async () => {
						const wiki = container.resolve(WikiService);
						const g = await wiki.getGame(req.params.slug);
						if (!g) throw new HttpError(404, "Jeu inconnu");
						return g;
					}),

				"/api/public/wiki/tools": (req) =>
					publicCachedJson(req, 60 * 60_000, async () => {
						const wiki = container.resolve(WikiService);
						return { tools: await wiki.listTools() };
					}),

				"/api/public/wiki/tools/:slug": (req) =>
					publicCachedJson(req, 60 * 60_000, async () => {
						const wiki = container.resolve(WikiService);
						const t = await wiki.getTool(req.params.slug);
						if (!t) throw new HttpError(404, "Outil inconnu");
						return t;
					}),

				"/api/public/wiki/manga/volumes": (req) =>
					publicCachedJson(req, 60 * 60_000, async () => {
						const url = new URL(req.url);
						const series = url.searchParams.get("series") ?? "DB";
						const wiki = container.resolve(WikiService);
						return { volumes: await wiki.listMangaVolumes(series) };
					}),

				"/api/public/wiki/manga/volumes/:id": (req) =>
					publicCachedJson(req, 60 * 60_000, async () => {
						const id = parseInt(req.params.id, 10);
						if (!Number.isFinite(id)) throw new HttpError(400, "ID invalide");
						const wiki = container.resolve(WikiService);
						const v = await wiki.getMangaVolume(id);
						if (!v) throw new HttpError(404, "Volume inconnu");
						return v;
					}),

				"/api/public/wiki/news": (req) =>
					publicCachedJson(req, 5 * 60_000, async () => {
						const url = new URL(req.url);
						const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "10", 10), 100);
						const wiki = container.resolve(WikiService);
						return { news: await wiki.listNews(limit) };
					}),

				"/api/public/wiki/search": (req) =>
					publicCachedJson(req, 5 * 60_000, async () => {
						const url = new URL(req.url);
						const q = (url.searchParams.get("q") ?? "").trim();
						if (q.length < 2) return { results: [], q };
						const dbs = container.resolve(DatabaseService);
						// Search both FTS5 (if populated) AND raw LIKE across canonical entities
						const like = `%${q}%`;
						const characters = dbs.sqlite
							.query(
								"SELECT id, name, name_ja, image, race FROM db_characters WHERE name LIKE ? OR name_ja LIKE ? OR name_romaji LIKE ? LIMIT 20"
							)
							.all(like, like, like);
						const planets = dbs.sqlite
							.query(
								"SELECT id, name, name_ja, image FROM db_planets WHERE name LIKE ? OR name_ja LIKE ? LIMIT 10"
							)
							.all(like, like);
						const sagas = dbs.sqlite
							.query(
								"SELECT id, slug, name, name_ja, series FROM db_sagas WHERE name LIKE ? OR name_ja LIKE ? LIMIT 10"
							)
							.all(like, like);
						const movies = dbs.sqlite
							.query(
								"SELECT id, slug, title, title_ja, series FROM db_movies WHERE title LIKE ? OR title_ja LIKE ? LIMIT 10"
							)
							.all(like, like);
						const games = dbs.sqlite
							.query(
								"SELECT id, slug, title, title_ja FROM db_games WHERE title LIKE ? OR title_ja LIKE ? LIMIT 10"
							)
							.all(like, like);
						// Techniques, transformations and races are wiki entities too:
						// without them `q=kamehameha` matched nothing.
						const techniques = dbs.sqlite
							.query(
								"SELECT id, slug, name, name_ja, type FROM db_techniques WHERE name LIKE ? OR name_ja LIKE ? OR name_romaji LIKE ? OR slug LIKE ? LIMIT 10"
							)
							.all(like, like, like, like);
						const transformations = dbs.sqlite
							.query(
								"SELECT id, name, image, character_id FROM db_transformations WHERE name LIKE ? LIMIT 10"
							)
							.all(like);
						const races = dbs.sqlite
							.query(
								"SELECT id, slug, name, name_ja FROM db_races WHERE name LIKE ? OR name_ja LIKE ? OR slug LIKE ? LIMIT 10"
							)
							.all(like, like, like);
						return { q, characters, planets, sagas, movies, games, techniques, transformations, races };
					}),

				// Redis in the shared backend invalidates retrieval after editorial writes.
                // Public responses must not retain an independent stale result cache.
                "/api/public/rag/search": (req) =>
                    publicCachedJson(req, 0, () => searchPublicRag(
                        req,
                        process.env.RAG_BACKEND === "aphrody" ? null : container.resolve(DatabaseService).sqlite,
                    )),
                "/api/public/rag/context": (req) =>
                    publicCachedJson(req, 0, () => contextPublicRag(
                        req,
                        process.env.RAG_BACKEND === "aphrody" ? null : container.resolve(DatabaseService).sqlite,
                    )),

				// --- Manga « Full Color » : redirection vers le CDN Discord ---
				//
				// Les planches couleur sont des pièces jointes du forum scan-db, et une
				// URL `cdn.discordapp.com` n'est servie que **signée**, pour 24 h
				// (mesuré : signée → 200, dénudée → 404). Une page ISR ne peut donc pas
				// pointer le CDN en dur — son HTML survivrait à la signature.
				//
				// Cette route est l'indirection stable : le site pointe ici pour
				// toujours, et nous rendons un `302` vers une signature fraîche à chaque
				// requête. Les 3,2 Go d'images ne transitent jamais par le VPS.
				//
				// `cache-control` court et `private` : c'est la REDIRECTION qui ne doit
				// pas être mise en cache au-delà de la validité de sa cible, l'image
				// elle-même étant mise en cache par le CDN de Discord.
				"/api/public/manga/couleur/:salonId/:pieceJointeId/:fichier": async (req) => {
					const cors = publicCorsHeaders(req);
					if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
					const nue = await urlNueDe({
						salonId: String(req.params.salonId),
						pieceJointeId: String(req.params.pieceJointeId),
						fichier: String(req.params.fichier),
					});
					if (!nue) return new Response("Planche couleur inconnue", { status: 404, headers: cors });
					const signee = await urlSignee(nue);
					if (!signee) {
						return new Response("Signature indisponible", { status: 502, headers: cors });
					}
					return new Response(null, {
						status: 302,
						headers: { ...cors, Location: signee, "cache-control": "private, max-age=300" },
					});
				},

				// --- Manga : transcriptions OCR des planches (durable, bilingue FR+JP) ---
				// Liste des tomes transcrits + compteurs. ?series=DB|DBS pour filtrer.
				"/api/public/manga/tomes": (req) =>
					publicCachedJson(req, 60 * 60_000, async () => {
						const url = new URL(req.url);
						const series = url.searchParams.get("series") || undefined;
						const dbs = container.resolve(DatabaseService);
						const sql =
							`SELECT series, tome, COUNT(*) AS planches, SUM(line_count) AS lines, ` +
							`SUM(has_ja) AS planches_ja, MIN(planche) AS first, MAX(planche) AS last ` +
							`FROM db_manga_pages ${series ? "WHERE series = ?" : ""} ` +
							`GROUP BY series, tome ORDER BY series, tome`;
						const rows = dbs.sqlite.query(sql).all(...(series ? [series] : [])) as {
							series: string;
							tome: string;
							planches: number;
							lines: number;
							planches_ja: number;
							first: number;
							last: number;
						}[];
						return {
							count: rows.length,
							tomes: rows.map((r) => ({
								series: r.series,
								tome: r.tome,
								planches: r.planches,
								lines: r.lines,
								planchesWithJa: r.planches_ja,
								plancheRange: [r.first, r.last],
							})),
						};
					}),

				// Toutes les planches d'un tome (bulles `lines` en ordre de lecture + texte).
				"/api/public/manga/tomes/:series/:tome": (req) =>
					publicCachedJson(req, 60 * 60_000, async () => {
						const series = String(req.params.series).toUpperCase();
						const tome = String(req.params.tome);
						if (!/^[A-Z]{1,6}$/.test(series)) throw new HttpError(400, "series invalide");
						if (!/^[\w-]{1,32}$/.test(tome)) throw new HttpError(400, "tome invalide");
						const dbs = container.resolve(DatabaseService);
						const pages = await dbs.db.query.dbMangaPages.findMany({
							where: (p, { eq, and }) => and(eq(p.series, series), eq(p.tome, tome)),
							orderBy: (p, { asc }) => asc(p.planche),
						});
						if (!pages.length) throw new HttpError(404, "Tome introuvable");
						return {
							series,
							tome,
							planches: pages.length,
							pages: pages.map((p) => ({
								planche: p.planche,
								lang: p.lang,
								hasJa: p.hasJa,
								lineCount: p.lineCount,
								lines: p.lines,
								text: p.text,
							})),
						};
					}),

				// Une planche précise.
				"/api/public/manga/page/:series/:tome/:planche": (req) =>
					publicCachedJson(req, 60 * 60_000, async () => {
						const series = String(req.params.series).toUpperCase();
						const tome = String(req.params.tome);
						const planche = Number(req.params.planche);
						if (!Number.isInteger(planche) || planche < 0)
							throw new HttpError(400, "planche invalide");
						const dbs = container.resolve(DatabaseService);
						const page = await dbs.db.query.dbMangaPages.findFirst({
							where: (p, { eq, and }) =>
								and(eq(p.series, series), eq(p.tome, tome), eq(p.planche, planche)),
						});
						if (!page) throw new HttpError(404, "Planche introuvable");
						return {
							series: page.series,
							tome: page.tome,
							planche: page.planche,
							lang: page.lang,
							hasJa: page.hasJa,
							lineCount: page.lineCount,
							lines: page.lines,
							text: page.text,
						};
					}),

				// Recherche plein-texte (FTS5 bilingue FR+JP) sur les transcriptions.
				"/api/public/manga/search": (req) =>
					publicCachedJson(req, 5 * 60_000, async () => {
						const url = new URL(req.url);
						const q = (url.searchParams.get("q") ?? "").trim();
						const series = url.searchParams.get("series") || undefined;
						const limit = Math.min(Math.max(Number(url.searchParams.get("limit") ?? 20), 1), 100);
						const tokens = q
							.split(/\s+/)
							.filter((t) => t.length > 1)
							.map((t) => `"${t.replace(/"/g, "")}"`);
						if (tokens.length === 0) return { q, count: 0, results: [] };
						const dbs = container.resolve(DatabaseService);
						const params: (string | number)[] = [tokens.join(" OR ")];
						let sql =
							`SELECT series, tome, planche, lang, ` +
							`snippet(manga_pages_fts, 0, '[', ']', '…', 12) AS snippet ` +
							`FROM manga_pages_fts WHERE manga_pages_fts MATCH ?`;
						if (series) {
							sql += " AND series = ?";
							params.push(series);
						}
						sql += " ORDER BY rank LIMIT ?";
						params.push(limit);
						let rows: {
							series: string;
							tome: string;
							planche: number;
							lang: string;
							snippet: string;
						}[] = [];
						try {
							rows = dbs.sqlite.query(sql).all(...params) as typeof rows;
						} catch (err) {
							// Missing/broken FTS index is an outage, not an empty result.
							logger.error({ err }, "manga search: manga_pages_fts query failed");
							throw new HttpError(503, "Index manga indisponible");
						}
						// unicode61 keeps a CJK run as ONE token (「孫悟空修業編」), so a Japanese
						// query such as 悟空 never matches through MATCH: substring fallback.
						if (rows.length === 0 && /[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u.test(q)) {
							const terms = q.split(/\s+/).filter((t) => t.length > 1);
							const likeParams: (string | number)[] = terms.map((t) => `%${t}%`);
							let likeSql =
								"SELECT series, tome, planche, lang, text FROM manga_pages_fts WHERE (" +
								terms.map(() => "text LIKE ?").join(" OR ") +
								")";
							if (series) {
								likeSql += " AND series = ?";
								likeParams.push(series);
							}
							likeSql += " LIMIT ?";
							likeParams.push(limit);
							const hits = dbs.sqlite.query(likeSql).all(...likeParams) as (Omit<
								(typeof rows)[number],
								"snippet"
							> & { text: string })[];
							rows = hits.map(({ text, ...rest }) => {
								const term = terms.find((t) => text.includes(t)) ?? terms[0]!;
								const at = text.indexOf(term);
								const from = Math.max(0, at - 30);
								const snippet =
									(from > 0 ? "…" : "") +
									text.slice(from, at) +
									`[${term}]` +
									text.slice(at + term.length, at + term.length + 30) +
									(at + term.length + 30 < text.length ? "…" : "");
								return Object.assign(rest, { snippet });
							});
						}
						// Nettoie le bruit OCR des snippets (watermarks scantrad/domaines) pour
						// un affichage public propre, en gardant le match entre crochets.
						const cleanSnip = (s: string) =>
							s
								.replace(/\b(?:WWW\.|HTTPS?:\/\/)\S+/gi, " ")
								.replace(/\b[A-Z0-9][A-Z0-9-]*\.(?:NET|FR|COM|ORG|MX|TO|IO|CC|ME)\b/gi, " ")
								.replace(
									/\b(?:SCANTRAD|BLEACH-?MX|VOIRANIME|MANGA-?SCAN|LELSCAN|JATSCAN)\S*/gi,
									" "
								)
								.replace(/\s{2,}/g, " ")
								.trim();
						for (const r of rows) r.snippet = cleanSnip(r.snippet);
						return { q, count: rows.length, results: rows };
					}),

				// Endpoint de chat génératif RAG-grounded avec injection de contexte page-level
				"/api/public/rag/chat": async (req) => {
					// CORS + rate-limit (parité avec /rag/search). PAS de cache mémoire :
					// la réponse n'est pas idempotente (contexte page + session). Accepte
					// GET et POST (les clients MCP/agents postent un body JSON).
					const chatCors = publicCorsHeaders(req);
					if (req.method === "OPTIONS")
						return new Response(null, { status: 204, headers: chatCors });
					if (req.method !== "GET" && req.method !== "POST")
						return new Response("Method Not Allowed", { status: 405, headers: chatCors });
					if (!publicRateLimit(clientIp(req)))
						return Response.json(
							{ error: "Rate limit (60/min)" },
							{ status: 429, headers: { ...chatCors, "Retry-After": "60" } }
						);
					const url = new URL(req.url);
					// Les paramètres peuvent venir de la query-string OU du corps JSON
					// (POST {q}). Les clients MCP/agents postent un body : on lit les deux,
					// query-string prioritaire pour rester rétro-compatible.
					let body: Record<string, unknown> = {};
					if (req.method === "POST") {
						try {
							body = (await req.json()) as Record<string, unknown>;
						} catch {
							body = {};
						}
					}
					const pick = (k: string): string | null => {
						const v = url.searchParams.get(k);
						if (v != null && v !== "") return v;
						const b = body[k];
						return typeof b === "string" && b !== "" ? b : null;
					};
					const q = (pick("q") ?? "").trim();
					const persona = (pick("persona") ?? "whis").toLowerCase();
					const pageContext = (pick("context") ?? "").trim();
					const session = (pick("session") ?? "").trim();
					const lang = pick("lang") || undefined;
					const entity = pick("entity") || undefined;
					const sourceId = pick("sourceId") || undefined;
					const kind = pick("kind") || undefined;

					if (q.length < 2) {
						return Response.json(
							{
								answer: "Posez une question un peu plus précise, jeune guerrier.",
								hits: [],
								mode: "lexical",
							},
							{ headers: chatCors }
						);
					}

					const dbs = container.resolve(DatabaseService);
					try {
						const { results, mode } = await hybridSearch(dbs.sqlite, q, 5, {
							lang,
							entity,
							sourceId,
							kind,
						});

						// Si le contexte de la page est fourni, on l'injecte comme document prioritaire
						const hits = [...results];
						if (pageContext) {
							hits.unshift({
								rowid: -1,
								kind: "page_context",
								title: "Page consultée actuellement",
								url: "",
								snippet: pageContext,
								score: 1,
							});
						}

						const answer = await generateLlmAnswer(
							dbs.sqlite,
							q,
							hits,
							persona,
							session ? { sessionId: `site:${session}` } : {}
						);
						// Persona fallback = LLM backend down: signal it instead of a 200.
						if (isFallbackAnswer(answer)) {
							return Response.json(
								{ answer, hits: results, mode, error: "llm_unavailable" },
								{ status: 503, headers: { ...chatCors, "Retry-After": "30" } }
							);
						}
						return Response.json({ answer, hits: results, mode }, { headers: chatCors });
					} catch (err) {
						console.error("Erreur API rag/chat:", err);
						return Response.json(
							{ error: "generation_failed" },
							{ status: 500, headers: chatCors }
						);
					}
				},

				// Stats du cache sémantique Redis
				"/api/public/eval/cache-stats": async () => {
					try {
						const { redis } = await import("bun");
						const stats = await redis.hgetall("dbz:scache:stats");
						const hits = Number(stats?.hits ?? 0);
						const misses = Number(stats?.misses ?? 0);
						const total = hits + misses;
						const hitRate = total > 0 ? (hits / total) * 100 : 0;
						return Response.json({ hits, misses, total, hitRate });
					} catch (err) {
						return Response.json({ error: "redis_error" }, { status: 500 });
					}
				},

				// Rapports d'évaluations du Grand Prêtre et de pertinence du RAG
				"/api/public/eval/reports": async () => {
					try {
						const { redis } = await import("bun");
						const ragReportRaw = await redis.get("dbz:eval:report:rag");
						const llmReportRaw = await redis.get("dbz:eval:report:llm:latest");

						const rag = ragReportRaw ? JSON.parse(ragReportRaw) : null;
						const llm = llmReportRaw ? JSON.parse(llmReportRaw) : null;

						return Response.json({ rag, llm });
					} catch (err) {
						return Response.json({ error: "redis_error" }, { status: 500 });
					}
				},

				// Statistiques analytiques de lore et de sentiment issues de l'indexation Redis
				"/api/public/eval/lore-stats": async () => {
					try {
						const { redis } = await import("bun");
						const lore = (await redis.hgetall("dbz:global:lore")) ?? {};
						const sentiment = (await redis.hgetall("dbz:global:sentiment")) ?? {};

						const totalUsers = (await redis.scard("dbz:users")) ?? 0;
						const totalChannels = (await redis.scard("dbz:channels")) ?? 0;

						return Response.json({
							lore,
							sentiment,
							metrics: {
								totalUsers,
								totalChannels,
							},
						});
					} catch (err) {
						console.error("Erreur API eval/lore-stats:", err);
						return Response.json({ error: "redis_error" }, { status: 500 });
					}
				},

				"/api/public/news": (req) =>
					publicCachedJson(req, 5 * 60_000, async () => {
						const url = new URL(req.url);
						const source = url.searchParams.get("source");
						const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "20", 10), 100);
						const dbs = container.resolve(DatabaseService);
						const sql = source
							? "SELECT * FROM db_news WHERE source_id = ? ORDER BY published_at DESC LIMIT ?"
							: "SELECT * FROM db_news ORDER BY published_at DESC LIMIT ?";
						const news = source
							? dbs.sqlite.query(sql).all(source, limit)
							: dbs.sqlite.query(sql).all(limit);
						return { news, limit };
					}),

				"/api/public/assets": (req) =>
					publicCachedJson(req, 5 * 60_000, async () => {
						const url = new URL(req.url);
						const bucket = url.searchParams.get("bucket"); // path prefix
						const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "50", 10), 200);
						const dbs = container.resolve(DatabaseService);
						const sql = bucket
							? "SELECT id, path, source_id, attribution, license_key, role FROM db_assets WHERE path LIKE ? ORDER BY id DESC LIMIT ?"
							: "SELECT id, path, source_id, attribution, license_key, role FROM db_assets ORDER BY id DESC LIMIT ?";
						const assets = bucket
							? dbs.sqlite.query(sql).all(`${bucket}%`, limit)
							: dbs.sqlite.query(sql).all(limit);
						return { assets };
					}),

				"/api/public/sources": (req) =>
					publicCachedJson(req, 60 * 60_000, async () => {
						const dbs = container.resolve(DatabaseService);
						const sources = dbs.sqlite
							.query(
								"SELECT s.*, l.name AS license_name, l.url AS license_url FROM db_sources s JOIN db_licenses l ON s.license_key = l.key ORDER BY s.id"
							)
							.all();
						return { sources };
					}),

				// Couverture des données : ce que le RAG voit réellement (index,
				// composition par corpus/type) et le volume du réplica wiki. Sert à
				// savoir si une donnée est indexée avant de conclure qu'elle n'existe
				// pas — sans avoir à ouvrir le VPS.
				"/api/public/data/coverage": (req) =>
					publicCachedJson(req, 5 * 60_000, async () => {
						const dbs = container.resolve(DatabaseService);
						const aphrodyRag = process.env.RAG_BACKEND === "aphrody"
							? await new AphrodyComputeClient().ragStats().catch(() => null)
							: null;
						const meta = process.env.RAG_BACKEND === "aphrody" ? null : dbs.sqlite
							.query<
								{ model: string | null; dim: number | null; count: number | null; built_at: number | null },
								[]
							>("SELECT model, dim, count, built_at FROM rag_meta LIMIT 1")
							.get() ?? null;
						const index = aphrodyRag ? {
							model: "aphrody", dim: null, chunks: aphrodyRag.chunks, builtAt: null,
						} : meta
							? {
									model: meta.model,
									dim: meta.dim,
									chunks: meta.count,
									builtAt: meta.built_at ? new Date(meta.built_at).toISOString() : null,
								}
							: null;
						const sources = process.env.RAG_BACKEND === "aphrody"
							? (aphrodyRag?.sources ?? []).map((s) => ({ source_id: s.sourceId, kind: s.kind, n: s.count }))
							: dbs.sqlite
							.query("SELECT source_id, kind, count(*) n FROM rag_chunks GROUP BY 1,2 ORDER BY n DESC")
							.all();
						// Une seule requête UNION ALL plutôt que treize allers-retours ;
						// une table absente du réplica ne doit pas faire échouer la route.
						const wikiTables = [
							"db_characters",
							"db_planets",
							"db_races",
							"db_techniques",
							"db_transformations",
							"db_sagas",
							"db_arcs",
							"db_movies",
							"db_games",
							"db_episodes",
							"db_manga_volumes",
							"db_manga_chapters",
							"db_tools",
						];
						const present = new Set(
							dbs.sqlite
								.query<{ name: string }, []>(
									"SELECT name FROM sqlite_master WHERE type IN ('table','view')"
								)
								.all()
								.map((r) => r.name)
						);
						const usable = wikiTables.filter((t) => present.has(t));
						const wiki: Record<string, number | null> = {};
						for (const t of wikiTables) wiki[t] = null;
						if (usable.length > 0) {
							const rows = dbs.sqlite
								.query<{ table_name: string; n: number }, []>(
									usable
										.map((t) => `SELECT '${t}' AS table_name, count(*) AS n FROM ${t}`)
										.join(" UNION ALL ")
								)
								.all();
							for (const row of rows) wiki[row.table_name] = row.n;
						}
						// Dernier passage de `scripts/orchestre-donnees.ts` : il dit quel
						// maillon de la chaîne (réplica → index → canon) était en retard,
						// ce qu'aucun comptage ne révèle. Absent tant qu'il n'a pas tourné.
						const orchestration = await Bun.file(
							new URL("../../data/orchestration.json", import.meta.url).pathname
						)
							.json()
							.catch(() => null);
						return { index, sources, wiki, orchestration };
					}),

				// ── Cards profile dynamiques (public, cache 1 h) ──────────────
				// Le site Vercel peut faire `<img src="/api/public/profile/{id}/card.png"/>`
				// pour afficher la card profil DBZ. Cache mémoire LRU + ETag +
				// Vercel CDN = ~1 ms côté edge après warm-up.
				"/api/public/profile/:discordId/card.png": (req) =>
					publicCachedImage(
						req,
						async () => {
							const id = req.params.discordId;
							if (!/^\d{17,20}$/.test(id)) throw new HttpError(400, "discordId invalide");
							const map = container.resolve<Map<string, Client>>("ClientMap");
							const shenron = map.get("shenron");
							if (!shenron) throw new HttpError(503, "Bot offline");
							const user = await shenron.users.fetch(id).catch(() => null);
							if (!user) throw new HttpError(404, "Utilisateur introuvable");
							const dbs = container.resolve(DatabaseService);
							const row = await dbs.db.query.users.findFirst({
								where: eq(users.id, id),
							});
							if (!row) throw new HttpError(404, "Profil bot introuvable");

							const url = new URL(req.url);
							const rawTheme = url.searchParams.get("theme") ?? row.equippedCard;
							const rawBanner = url.searchParams.get("banner") ?? row.equippedBanner;
							const rawBadge = url.searchParams.get("badge") ?? row.equippedBadge;
							const rawTitle = url.searchParams.get("title") ?? row.equippedTitle;
							const rawColor = url.searchParams.get("color") ?? row.equippedColor;

							const [titleItem, badgeItem, colorItem, bannerItem] = await Promise.all([
								rawTitle ? dbs.db.query.shopItems.findFirst({ where: eq(shopItems.key, rawTitle) }) : Promise.resolve(null),
								rawBadge ? dbs.db.query.shopItems.findFirst({ where: eq(shopItems.key, rawBadge) }) : Promise.resolve(null),
								rawColor && !rawColor.startsWith("#") ? dbs.db.query.shopItems.findFirst({ where: eq(shopItems.key, rawColor) }) : Promise.resolve(null),
								rawBanner ? dbs.db.query.shopItems.findFirst({ where: eq(shopItems.key, rawBanner) }) : Promise.resolve(null),
							]);

							const titleText = titleItem?.name ?? rawTitle ?? null;
							const badgeText = badgeItem
								? (badgeItem.name.match(/[\u3400-\u9FFF]/)?.[0] ?? badgeItem.name)
								: (rawBadge ?? null);

							let colorHex: string | null = null;
							if (colorItem?.roleId) {
								const clientMap = container.resolve<Map<string, Client>>("ClientMap");
								const guild = [...clientMap.values()].map((c) => c.guilds.cache.get(env.GUILD_ID)).find(Boolean);
								const role = guild?.roles.cache.get(colorItem.roleId);
								if (role?.color) colorHex = `#${role.color.toString(16).padStart(6, "0")}`;
							}
							if (!colorHex && colorItem?.meta) {
								try {
									const parsed = JSON.parse(colorItem.meta);
									if (parsed.colorHex) colorHex = parsed.colorHex;
								} catch {}
							}
							if (!colorHex && rawColor?.startsWith("#")) {
								colorHex = rawColor;
							}

							let bannerPath: string | null = null;
							if (bannerItem?.meta) {
								try {
									const parsed = JSON.parse(bannerItem.meta);
									if (parsed.bannerPath) bannerPath = parsed.bannerPath;
								} catch {}
							}
							if (!bannerPath && rawBanner?.startsWith("assets/banners/")) {
								bannerPath = rawBanner;
							}

							const card = container.resolve(CardService);
							return await card.render({
								discordUser: user,
								xp: row.xp,
								zeni: row.zeni,
								messageCount: row.messageCount,
								cardKey: rawTheme,
								bannerPath,
								bannerKey: rawBanner,
								badge: badgeText,
								title: titleText,
								color: colorHex,
							});
						},
						3600
					),

				// Scanner de ki (gauge dynamique) — variante pour widget compact.
				"/api/public/profile/:discordId/scan.png": (req) =>
					publicCachedImage(
						req,
						async () => {
							const id = req.params.discordId;
							if (!/^\d{17,20}$/.test(id)) throw new HttpError(400, "discordId invalide");
							const map = container.resolve<Map<string, Client>>("ClientMap");
							const shenron = map.get("shenron");
							if (!shenron) throw new HttpError(503, "Bot offline");
							const user = await shenron.users.fetch(id).catch(() => null);
							if (!user) throw new HttpError(404, "Utilisateur introuvable");
							const dbs = container.resolve(DatabaseService);
							const row = await dbs.db.query.users.findFirst({
								where: eq(users.id, id),
							});
							const xp = row?.xp ?? 0;
							const accent = xpAccent(xp);
							const gauge = container.resolve(GaugeService);
							const pct = Math.min(100, Math.round((xp / 9_000_000) * 100));
							return await gauge.render({
								user,
								title: "SCANNER DE KI",
								subtitle: "Lecture du potentiel",
								pct,
								accent,
								accentDark: "#0a0a0a",
							});
						},
						3600
					),

				// ── A2A — Agent2Agent protocol (Claude ↔ Gemini bridge) ──────
				// Relais vers le serveur Rust `aphrody a2a serve` (./a2a-proxy.ts) :
				// agent card, JSON-RPC (message/send → /a2a, reste → racine A2A 1.0)
				// et SSE du mailbox (/coord). Plus d'implémentation locale.
				"/.well-known/agent-card.json": (req) => a2aAgentCard(req),

				"/api/a2a/jsonrpc": (req) => a2aJsonRpc(req),
				"/api/a2a/events": (req) => a2aEventsStream(req),

				// ── Cron ──────────────────────────────────────────────────────
				"/api/cron": admin(() => {
					const cron = container.resolve(CronRegistry);
					return Response.json({ jobs: cron.list() });
				}),
				"/api/cron/:name/trigger": {
					POST: admin(async (req) => {
						const cron = container.resolve(CronRegistry);
						const result = await cron.run(req.params.name);
						return Response.json(result, { status: result.ok ? 200 : 500 });
					}),
				},
				"/api/cron/:name/interval": {
					POST: admin(async (req) => {
						const name = req.params.name;
						const body = (await req.json().catch(() => ({}))) as {
							intervalMs?: number;
						};
						const intervalMs = Number(body.intervalMs);
						if (!Number.isFinite(intervalMs) || intervalMs < 1_000) {
							return Response.json({ error: "intervalMs ≥ 1000 requis" }, { status: 400 });
						}
						const settings = container.resolve(SettingsService);
						// Auto-déclare la clé si elle n'existe pas dans SETTINGS_KEYS — `set`
						// vérifie le catalogue donc on by-pass via direct DB upsert pour les
						// crons (clé dynamique connue uniquement au runtime via register).
						const dbs = container.resolve(DatabaseService);
						const { guildSettings } = await import("~/db/schema");
						await dbs.db
							.insert(guildSettings)
							.values({
								key: `cron.${name}.interval_ms`,
								value: String(intervalMs),
								updatedAt: new Date(),
							})
							.onConflictDoUpdate({
								target: guildSettings.key,
								set: { value: String(intervalMs), updatedAt: new Date() },
							});
						settings.invalidate();
						const cron = container.resolve(CronRegistry);
						const result = await cron.reload(name);
						return Response.json(result);
					}),
				},

				// ── Discord proxy (REST scoped sur la session OAuth user OU bot) ──
				// Toutes ces routes requièrent admin (cookie session OU Bearer admin).
				// Les routes en mode "Bearer" requièrent en plus une session OAuth Discord.
				"/api/discord/me": admin(async (req) => {
					const sess = await getDiscordSession(req);
					if (!sess) return Response.json({ error: "OAuth session requise" }, { status: 401 });
					try {
						const { data } = await discordFetch<any>("/users/@me", {
							mode: "Bearer",
							token: sess.payload.accessToken,
						});
						const headers = new Headers({ "Content-Type": "application/json" });
						if (sess.refreshedCookie) headers.append("Set-Cookie", sess.refreshedCookie);
						return new Response(JSON.stringify({ user: data }), { headers });
					} catch (err) {
						const status = err instanceof DiscordRESTError ? err.status : 500;
						return Response.json({ error: String(err) }, { status });
					}
				}),
				"/api/discord/guilds": admin(async (req) => {
					const sess = await getDiscordSession(req);
					if (!sess) return Response.json({ error: "OAuth session requise" }, { status: 401 });
					try {
						const { data } = await discordFetch<any[]>("/users/@me/guilds?with_counts=true", {
							mode: "Bearer",
							token: sess.payload.accessToken,
						});
						const guilds = data.map((g: any) => ({
							id: g.id,
							name: g.name,
							icon: g.icon,
							iconUrl: guildIcon(g.id, g.icon, { size: 128 }),
							owner: g.owner,
							permissions: g.permissions,
							features: g.features,
							approximate_member_count: g.approximate_member_count,
							approximate_presence_count: g.approximate_presence_count,
							isCurrent: g.id === env.GUILD_ID,
						}));
						const headers = new Headers({ "Content-Type": "application/json" });
						if (sess.refreshedCookie) headers.append("Set-Cookie", sess.refreshedCookie);
						return new Response(JSON.stringify({ guilds }), { headers });
					} catch (err) {
						const status = err instanceof DiscordRESTError ? err.status : 500;
						return Response.json({ error: String(err) }, { status });
					}
				}),
				"/api/discord/guild-member": admin(async (req) => {
					// Membership du user OAuth dans la guild courante (roles, nick, joined_at)
					const sess = await getDiscordSession(req);
					if (!sess) return Response.json({ error: "OAuth session requise" }, { status: 401 });
					try {
						const { data } = await discordFetch<any>(`/users/@me/guilds/${env.GUILD_ID}/member`, {
							mode: "Bearer",
							token: sess.payload.accessToken,
						});
						const headers = new Headers({ "Content-Type": "application/json" });
						if (sess.refreshedCookie) headers.append("Set-Cookie", sess.refreshedCookie);
						return new Response(JSON.stringify({ member: data }), { headers });
					} catch (err) {
						const status = err instanceof DiscordRESTError ? err.status : 500;
						return Response.json({ error: String(err) }, { status });
					}
				}),
				"/api/discord/guild": admin(async () => {
					try {
						const { data } = await discordFetch<any>(`/guilds/${env.GUILD_ID}?with_counts=true`, {
							mode: "Bot",
						});
						return Response.json({ guild: data });
					} catch (err) {
						const status = err instanceof DiscordRESTError ? err.status : 500;
						return Response.json({ error: String(err) }, { status });
					}
				}),
				// ── Server-Sent Events ────────────────────────────────────────
				// Stream live des events bot → dashboard (sync sans poll).
				// Subscribers : 1 par tab dashboard ouvert.
				"/api/events": admin((req) => {
					const bus = container.resolve(EventBusService);
					const encoder = new TextEncoder();

					const stream = new ReadableStream({
						start(controller) {
							const send = (data: object) => {
								try {
									controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
								} catch {
									// stream fermé côté client — on ignore
								}
							};

							// Hello immédiat
							send({ name: "hello", payload: { ts: Date.now(), subs: bus.size() } });

							// Subscribe
							const unsub = bus.subscribe((event) => send(event));

							// Keepalive 25s (nginx coupe à 60s par défaut)
							const ka = setInterval(
								() => send({ name: "ping", payload: { t: Date.now() } }),
								25_000
							);

							// Abort sur fermeture client
							req.signal.addEventListener("abort", () => {
								clearInterval(ka);
								unsub();
								try {
									controller.close();
								} catch {}
							});
						},
					});

					return new Response(stream, {
						headers: {
							"Content-Type": "text/event-stream; charset=utf-8",
							"Cache-Control": "no-cache, no-transform",
							Connection: "keep-alive",
							"X-Accel-Buffering": "no", // disable nginx buffering
						},
					});
				}),

				// ── Boutique jouable depuis le SITE (user-authenticated) ──────
				// Achat + équipement de cosmétiques directement sur dragonballfr.com
				// (plus besoin de passer par Discord). Auth acting-user (proxy bot-user).
				"/api/economy/balance": {
					GET: async (req) => {
						const userId = verifyActingUser(req);
						if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });
						const eco = container.resolve(EconomyService);
						const [balance, inv, u] = await Promise.all([
							eco.getBalance(userId),
							eco.listInventory(userId),
							eco.getUser(userId),
						]);
						const inflation = container.resolve(InflationService);
						const ursafNotices = container
							.resolve(UrsafService)
							.list({ userId, limit: 10 })
							.filter((n) => n.status !== "cancelled");
						return Response.json({
							balance,
							frozen: Boolean(u?.zeniFrozen),
							priceIndex: await inflation.currentIndex(),
							ursaf: ursafNotices.map((n) => ({
								reference: n.reference,
								amount: n.amount,
								collected: n.collected,
								rate: n.rate,
								status: n.status,
								createdAt: n.createdAt,
							})),
							owned: inv.map((r) => ({ type: r.itemType, key: r.itemKey })),
							equipped: {
								card: u?.equippedCard ?? null,
								badge: u?.equippedBadge ?? null,
								color: u?.equippedColor ?? null,
								title: u?.equippedTitle ?? null,
								banner: u?.equippedBanner ?? null,
							},
						});
					},
				},
				"/api/economy/purchase": {
					POST: async (req) => {
						const userId = verifyActingUser(req);
						if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });
						const body = (await req.json().catch(() => null)) as { key?: string } | null;
						if (!body?.key) return Response.json({ error: "key requis" }, { status: 400 });
						const eco = container.resolve(EconomyService);
						const res = await eco.purchase(userId, body.key);
						const balance = await eco.getBalance(userId);
						return Response.json(
							{ ok: res.ok, reason: res.reason, price: res.price, balance },
							{ status: res.ok ? 200 : 400 }
						);
					},
				},
				"/api/economy/equip": {
					POST: async (req) => {
						const userId = verifyActingUser(req);
						if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });
						const body = (await req.json().catch(() => null)) as {
							type?: string;
							key?: string;
						} | null;
						const type = body?.type;
						const key = body?.key;
						if (!type || !COSMETIC_TYPES.includes(type as CosmeticType) || !key) {
							return Response.json({ error: "type/key invalide" }, { status: 400 });
						}
						const eco = container.resolve(EconomyService);
						const previous = await currentEquipped(eco, userId, type as CosmeticType);
						const ok = await eco.equip(userId, type as CosmeticType, key);
						if (!ok)
							return Response.json({ ok: false, reason: "Objet non possédé" }, { status: 400 });
						// Rôle cosmétique Discord (color/title/badge) : posé à l'équipement,
						// comme dans la commande /inventaire. L'ancien rôle du même emplacement
						// est retiré — sinon changer de couleur empilait les rôles de couleur.
						let roleGranted = false;
						if (ROLE_COSMETICS.has(type as CosmeticType)) {
							const member = await resolveMember(userId);
							if (member) {
								if (previous && previous !== key) {
									const oldRole = await cosmeticRoleId(type as CosmeticType, previous);
									const newRole = await cosmeticRoleId(type as CosmeticType, key);
									if (oldRole && oldRole !== newRole) {
										await member.roles
											.remove(oldRole, "Changement d'équipement boutique (site)")
											.catch(() => {});
									}
								}
								const roleId = await cosmeticRoleId(type as CosmeticType, key);
								if (roleId) {
									await member.roles.add(roleId, "Équipement boutique (site)").catch(() => {});
									roleGranted = true;
								}
							}
						}
						return Response.json({ ok: true, roleGranted });
					},
				},

				// ── Économie : inflation (public) et URSAF (admin) ──────────────
				"/api/public/economy/inflation": (req) =>
					publicCachedJson(req, 5 * 60_000, async () => {
						const st = await container.resolve(InflationService).status();
						return { ...st, canonPrices: CANON_PRICES, canonCeiling: CANON_INFLATION_FACTOR };
					}),
				"/api/economy/inflation/snapshot": {
					POST: admin(async () => Response.json(await container.resolve(InflationService).snapshot())),
				},
				"/api/ursaf/notices": admin((req) => {
					const url = new URL(req.url);
					return Response.json({
						mode: null,
						notices: container.resolve(UrsafService).list({
							status: url.searchParams.get("status") ?? undefined,
							userId: url.searchParams.get("userId") ?? undefined,
							limit: Number(url.searchParams.get("limit")) || 100,
						}),
					});
				}),
				"/api/ursaf/assess": {
					// Simulation par défaut : rien n'est écrit tant que `dryRun` ne vaut pas false.
					POST: admin(async (req) => {
						const body = (await req.json().catch(() => ({}))) as { dryRun?: boolean };
						const svc = container.resolve(UrsafService);
						return Response.json({
							mode: await svc.mode(),
							dryRun: body.dryRun !== false,
							assessments: await svc.assessAll({ dryRun: body.dryRun !== false }),
						});
					}),
				},
				"/api/anticheat/backfill": {
					// Simulation par défaut ; `dryRun: false` écrit les signalements.
					POST: admin(async (req) => {
						const body = (await req.json().catch(() => ({}))) as { days?: number; dryRun?: boolean };
						const { AntiCheatService } = await import("~/services/AntiCheatService");
						return Response.json(
							await container.resolve(AntiCheatService).backfill({ days: body.days, dryRun: body.dryRun })
						);
					}),
				},
				"/api/ursaf/run": {
					POST: admin(async () => Response.json(await container.resolve(UrsafService).run())),
				},
				"/api/ursaf/notices/:id/cancel": {
					POST: admin(async (req) => {
						const body = (await req.json().catch(() => ({}))) as { by?: string; note?: string };
						const n = await container
							.resolve(UrsafService)
							.cancel(Number(req.params.id), body.by ?? "admin", body.note ?? null);
						return n
							? Response.json({ ok: true, notice: n })
							: Response.json({ error: "Avis introuvable" }, { status: 404 });
					}),
				},

				// Retirer l'objet équipé d'un emplacement (retour à l'apparence par défaut).
				"/api/economy/unequip": {
					POST: async (req) => {
						const userId = verifyActingUser(req);
						if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });
						const body = (await req.json().catch(() => null)) as { type?: string } | null;
						const type = body?.type;
						if (!type || !COSMETIC_TYPES.includes(type as CosmeticType)) {
							return Response.json({ error: "type invalide" }, { status: 400 });
						}
						const eco = container.resolve(EconomyService);
						const previous = await eco.unequip(userId, type as CosmeticType);
						let roleRemoved = false;
						if (previous && ROLE_COSMETICS.has(type as CosmeticType)) {
							const roleId = await cosmeticRoleId(type as CosmeticType, previous);
							const member = roleId ? await resolveMember(userId) : null;
							if (member && roleId) {
								await member.roles
									.remove(roleId, "Objet retiré depuis la boutique (site)")
									.catch(() => {});
								roleRemoved = true;
							}
						}
						return Response.json({ ok: true, previous, roleRemoved });
					},
				},

				// ── Jeux jouables depuis le site (user-authenticated) ─────────
				// Auth : HMAC-SHA256(discordId:ts) via headers X-Acting-User/Ts/Sig.
				// Le proxy site `/api/bot-user/*` signe automatiquement.
				// Mêmes règles que les slash commands Discord (engines partagés).
				"/api/games/pfc/play": {
					POST: async (req) => {
						const userId = verifyActingUser(req);
						if (!userId) {
							return Response.json({ error: "Unauthorized" }, { status: 401 });
						}
						const body = (await req.json().catch(() => null)) as {
							choice?: unknown;
							stake?: number;
						} | null;
						if (!body || !isPfcChoice(body.choice)) {
							return Response.json({ error: "choice invalide" }, { status: 400 });
						}
						// Contre le robot, pas de mise : gagnée 1 pour 1 (×race, sans passer
						// par l'anti-triche) sur un tirage à 1 chance sur 3 de perdre, elle
						// se farmait en boucle depuis le site.
						if (typeof body.stake === "number" && body.stake > 0) {
							return Response.json(
								{ error: "Les mises contre le robot sont refusées." },
								{ status: 400 }
							);
						}
						const eco = container.resolve(EconomyService);
						const settings = container.resolve(SettingsService);
						const defaultWin = await settings.getInt("zeni.game.win", ZENI_GAME_WIN);
						const defaultLoss = await settings.getInt(
							"zeni.game.loss_penalty",
							ZENI_GAME_LOSS_PENALTY
						);

						const botChoice = decideBotChoice();
						const result = resolvePfc(body.choice, botChoice);
						let delta = 0;
						let blocked: string | null = null;
						if (result === "win") {
							const grant = await container
								.resolve(GameRewardService)
								.grantWin({ userId, amount: defaultWin, game: "pfc (site)" });
							delta = grant.paid;
							blocked = grant.blocked;
						} else if (result === "lose") {
							if (defaultLoss > 0 && (await eco.removeZeni(userId, defaultLoss))) delta = -defaultLoss;
						}
						const newBalance = await eco.getBalance(userId);
						return Response.json({
							ok: true,
							player: body.choice,
							bot: botChoice,
							result,
							delta,
							blocked,
							balance: newBalance,
						});
					},
				},
				// Morpion vs bot — stateless HMAC. Le client renvoie son state
				// à chaque coup, le bot signe pour empêcher la forge d'un board
				// gagnant. Joueur = X, bot = O. `stake` figé au 1er coup.
				"/api/games/morpion/move": {
					POST: async (req) => {
						const userId = verifyActingUser(req);
						if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });
						if (!env.API_USER_SECRET) {
							return Response.json({ error: "user-auth désactivé" }, { status: 503 });
						}
						const body = (await req.json().catch(() => null)) as {
							cell?: unknown;
							state?: { board?: string; sig?: string; ts?: number };
							stake?: number;
						} | null;
						const stakeRaw = body?.stake;
						const stake =
							typeof stakeRaw === "number" && stakeRaw > 0
								? Math.min(1_000_000, Math.floor(stakeRaw))
								: undefined;
						const eco = container.resolve(EconomyService);
						const settings = container.resolve(SettingsService);

						// Mises refusées contre le robot : un joueur qui ne perd jamais
						// (morpion bien joué) transformait chaque mise en gain sans risque.
						if (stake !== undefined) {
							return Response.json(
								{ error: "Les mises sont réservées aux duels sur Discord." },
								{ status: 400 }
							);
						}
						if (!body?.state) {
							const board = emptyBoard();
							const ts = Date.now();
							return Response.json({
								board,
								sig: signMorpion(env.API_USER_SECRET, board, userId, stake ?? 0, ts),
								ts,
								stake: stake ?? 0,
								outcome: { kind: "playing" },
							});
						}

						const stateBoard = parseMorpionBoard(body.state.board);
						const stateTs = Number(body.state.ts);
						const stateStake = stake ?? 0;
						if (
							!stateBoard ||
							!body.state.sig ||
							!Number.isFinite(stateTs) ||
							Math.abs(Date.now() - stateTs) > 30 * 60 * 1000
						) {
							return Response.json({ error: "state invalide ou expiré" }, { status: 400 });
						}
						const expectedSig = signMorpion(
							env.API_USER_SECRET,
							stateBoard,
							userId,
							stateStake,
							stateTs
						);
						if (!constantTimeEqualStr(expectedSig, body.state.sig)) {
							return Response.json({ error: "signature invalide" }, { status: 403 });
						}
						const cell = Number(body.cell);
						const move = applyMorpionMove(stateBoard, cell, "X");
						if (!move.ok) return Response.json({ error: move.error }, { status: 400 });
						if (!consumedGameStates.consume(`morpion:${body.state.sig}`, GAME_STATE_TTL_MS)) {
							return Response.json({ error: "état déjà joué" }, { status: 409 });
						}
						let board = move.board;
						let outcome = evaluateBoard(board);
						let botCell: number | null = null;
						if (outcome.kind === "playing") {
							botCell = decideMorpionMove(board, "O", {
								blunderChance: MORPION_BOT_BLUNDER_CHANCE,
							});
							const botMove = applyMorpionMove(board, botCell, "O");
							if (botMove.ok) {
								board = botMove.board;
								outcome = evaluateBoard(board);
							}
						}
						let delta = 0;
						let balance: number | undefined;
						if (outcome.kind === "won" || outcome.kind === "draw") {
							const defaultWin = await settings.getInt("zeni.game.win", ZENI_GAME_WIN);
							const defaultLoss = await settings.getInt(
								"zeni.game.loss_penalty",
								ZENI_GAME_LOSS_PENALTY
							);
							if (outcome.kind === "won" && outcome.mark === "X") {
								const grant = await container
									.resolve(GameRewardService)
									.grantWin({ userId, amount: defaultWin });
								delta = grant.paid;
							} else if (outcome.kind === "won" && outcome.mark === "O") {
								if (defaultLoss > 0 && (await eco.removeZeni(userId, defaultLoss))) {
									delta = -defaultLoss;
								}
							}
							balance = await eco.getBalance(userId);
						}
						const ts = Date.now();
						return Response.json({
							board,
							sig: signMorpion(env.API_USER_SECRET, board, userId, stateStake, ts),
							ts,
							stake: stateStake,
							outcome,
							botCell,
							delta,
							balance,
						});
					},
				},

				// Bingo vs bot — stateless : target chiffré dans token HMAC,
				// 10 essais max, hints "plus haut/plus bas".
				"/api/games/bingo/play": {
					POST: async (req) => {
						const userId = verifyActingUser(req);
						if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });
						if (!env.API_USER_SECRET) {
							return Response.json({ error: "user-auth désactivé" }, { status: 503 });
						}
						const body = (await req.json().catch(() => null)) as {
							token?: string;
							guess?: unknown;
							stake?: number;
						} | null;
						const stakeRaw = body?.stake;
						const stake =
							typeof stakeRaw === "number" && stakeRaw > 0
								? Math.min(1_000_000, Math.floor(stakeRaw))
								: undefined;
						const eco = container.resolve(EconomyService);
						const settings = container.resolve(SettingsService);

						// Mises refusées : la dichotomie gagne toujours en 10 essais sur 1-100,
						// une mise était donc un gain garanti.
						if (stake !== undefined) {
							return Response.json(
								{ error: "Les mises sont réservées aux duels sur Discord." },
								{ status: 400 }
							);
						}
						if (!body?.token) {
							const target = randomBingoTarget();
							const ts = Date.now();
							const token = packBingoToken(env.API_USER_SECRET, userId, target, stake ?? 0, 0, ts);
							return Response.json({
								token,
								ts,
								attempts: 0,
								max: BINGO_MAX,
								min: BINGO_MIN,
							});
						}

						const parsed = unpackBingoToken(env.API_USER_SECRET, body.token, userId);
						if (!parsed) {
							return Response.json({ error: "token invalide ou expiré" }, { status: 403 });
						}
						const guess = Number(body.guess);
						const hint = compareBingoGuess(guess, parsed.target);
						if (hint === "out-of-range") {
							return Response.json(
								{ error: `Nombre entre ${BINGO_MIN} et ${BINGO_MAX}` },
								{ status: 400 }
							);
						}
						if (parsed.stake > 0) {
							return Response.json(
								{ error: "Les mises sont réservées aux duels sur Discord." },
								{ status: 400 }
							);
						}
						if (!consumedGameStates.consume(`bingo:${body.token}`, GAME_STATE_TTL_MS)) {
							return Response.json({ error: "jeton déjà joué" }, { status: 409 });
						}
						const attempts = parsed.attempts + 1;
						if (hint === "match") {
							const defaultWin = await settings.getInt("zeni.game.win", ZENI_GAME_WIN);
							const grant = await container
								.resolve(GameRewardService)
								.grantWin({ userId, amount: defaultWin });
							const balance = await eco.getBalance(userId);
							return Response.json({
								hint,
								target: parsed.target,
								attempts,
								delta: grant.paid,
								balance,
							});
						}
						if (attempts >= BINGO_MAX_ATTEMPTS) {
							const defaultLoss = await settings.getInt(
								"zeni.game.loss_penalty",
								ZENI_GAME_LOSS_PENALTY
							);
							const charged =
								defaultLoss > 0 && (await eco.removeZeni(userId, defaultLoss));
							const balance = await eco.getBalance(userId);
							return Response.json({
								hint: "lost",
								target: parsed.target,
								attempts,
								delta: charged ? -defaultLoss : 0,
								balance,
							});
						}
						const ts = Date.now();
						const token = packBingoToken(
							env.API_USER_SECRET,
							userId,
							parsed.target,
							parsed.stake,
							attempts,
							ts
						);
						return Response.json({ hint, attempts, token, ts });
					},
				},
				"/api/games/pendu/new": {
					POST: async () =>
						Response.json({ error: "WIP — UI Pendu round suivant" }, { status: 501 }),
				},

				// ── Shop CRUD (admin) ─────────────────────────────────────────
				"/api/shop": {
					POST: admin(async (req) => {
						const body = (await req.json().catch(() => null)) as {
							key?: string;
							type?: "card" | "badge" | "color" | "title" | "banner";
							name?: string;
							description?: string | null;
							price?: number;
							role_id?: string | null;
							roleId?: string | null;
							meta?: string | null;
							enabled?: boolean | number;
						} | null;
						if (!body?.key || !body?.type || !body?.name || typeof body.price !== "number") {
							return Response.json({ error: "key, type, name, price requis" }, { status: 400 });
						}
						try {
							const dbs = container.resolve(DatabaseService);
							await dbs.db.insert(shopItems).values({
								key: body.key,
								type: body.type,
								name: body.name,
								description: body.description ?? null,
								price: body.price,
								roleId: body.role_id ?? body.roleId ?? null,
								meta: body.meta ?? null,
								enabled: body.enabled !== undefined ? Boolean(body.enabled) : true,
							});
							invalidateJsonCache("/api/shop");
							return Response.json({ ok: true, key: body.key });
						} catch (err) {
							return Response.json(
								{ error: err instanceof Error ? err.message : "insert failed" },
								{ status: 400 }
							);
						}
					}),
				},
				"/api/shop/:key": {
					PUT: admin(async (req) => {
						const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
						if (!body) return Response.json({ error: "JSON body requis" }, { status: 400 });
						try {
							const dbs = container.resolve(DatabaseService);
							const patch: Record<string, unknown> = {};
							if (typeof body.name === "string") patch.name = body.name;
							if (typeof body.description === "string" || body.description === null)
								patch.description = body.description;
							if (typeof body.price === "number") patch.price = body.price;
							const roleIdVal = body.role_id !== undefined ? body.role_id : body.roleId;
							if (typeof roleIdVal === "string" || roleIdVal === null)
								patch.roleId = roleIdVal;
							if (typeof body.meta === "string" || body.meta === null) patch.meta = body.meta;
							if (body.enabled !== undefined) patch.enabled = Boolean(body.enabled);
							if (typeof body.type === "string") patch.type = body.type;
							await dbs.db.update(shopItems).set(patch).where(eq(shopItems.key, req.params.key));
							invalidateJsonCache("/api/shop");
							return Response.json({ ok: true });
						} catch (err) {
							return Response.json(
								{ error: err instanceof Error ? err.message : "update failed" },
								{ status: 400 }
							);
						}
					}),
					DELETE: admin(async (req) => {
						const dbs = container.resolve(DatabaseService);
						await dbs.db.delete(shopItems).where(eq(shopItems.key, req.params.key));
						invalidateJsonCache("/api/shop");
						return Response.json({ ok: true });
					}),
					PATCH: admin(async (req) => {
						// Toggle enabled
						const dbs = container.resolve(DatabaseService);
						const item = await dbs.db.query.shopItems.findFirst({
							where: eq(shopItems.key, req.params.key),
						});
						if (!item) return Response.json({ error: "Item introuvable" }, { status: 404 });
						await dbs.db
							.update(shopItems)
							.set({ enabled: !item.enabled })
							.where(eq(shopItems.key, req.params.key));
						invalidateJsonCache("/api/shop");
						return Response.json({ ok: true, enabled: !item.enabled });
					}),
				},

				// ── Settings set/unset ────────────────────────────────────────
				"/api/settings/:key": {
					POST: admin(async (req) => {
						const body = (await req.json().catch(() => null)) as { value?: unknown } | null;
						if (!body || body.value === undefined) {
							return Response.json({ error: "{ value } requis" }, { status: 400 });
						}
						const svc = container.resolve(SettingsService);
						try {
							const value =
								typeof body.value === "string" ? body.value : JSON.stringify(body.value);
							await svc.set(req.params.key, value);
							return Response.json({ ok: true, key: req.params.key, value });
						} catch (err) {
							return Response.json(
								{ error: err instanceof Error ? err.message : "set failed" },
								{ status: 400 }
							);
						}
					}),
					DELETE: admin(async (req) => {
						const svc = container.resolve(SettingsService);
						await svc.unset(req.params.key);
						return Response.json({ ok: true });
					}),
				},

				// ── Triggers CRUD (achievement_triggers) ──────────────────────
				"/api/triggers": {
					GET: admin(async () => {
						const dbs = container.resolve(DatabaseService);
						const rows = await dbs.db.select().from(achievementTriggers);
						return Response.json({ rows });
					}),
					POST: admin(async (req) => {
						const body = (await req.json().catch(() => null)) as {
							code?: string;
							description?: string | null;
							pattern?: string;
							flags?: string;
							enabled?: boolean;
						} | null;
						if (!body?.code || !body?.pattern) {
							return Response.json({ error: "code, pattern requis" }, { status: 400 });
						}
						try {
							// Validate regex
							new RegExp(body.pattern, body.flags ?? "i");
						} catch (err) {
							return Response.json(
								{ error: `regex invalide : ${err instanceof Error ? err.message : err}` },
								{ status: 400 }
							);
						}
						try {
							const dbs = container.resolve(DatabaseService);
							await dbs.db.insert(achievementTriggers).values({
								code: body.code,
								description: body.description ?? null,
								pattern: body.pattern,
								flags: body.flags ?? "i",
								enabled: body.enabled ?? true,
							});
							return Response.json({ ok: true, code: body.code });
						} catch (err) {
							return Response.json(
								{ error: err instanceof Error ? err.message : "insert failed" },
								{ status: 400 }
							);
						}
					}),
				},
				"/api/triggers/:code": {
					PUT: admin(async (req) => {
						const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
						if (!body) return Response.json({ error: "JSON body requis" }, { status: 400 });
						if (typeof body.pattern === "string") {
							try {
								new RegExp(body.pattern, (body.flags as string) ?? "i");
							} catch (err) {
								return Response.json(
									{ error: `regex invalide : ${err instanceof Error ? err.message : err}` },
									{ status: 400 }
								);
							}
						}
						const dbs = container.resolve(DatabaseService);
						const patch: Record<string, unknown> = {};
						if (typeof body.description === "string" || body.description === null)
							patch.description = body.description;
						if (typeof body.pattern === "string") patch.pattern = body.pattern;
						if (typeof body.flags === "string") patch.flags = body.flags;
						if (typeof body.enabled === "boolean") patch.enabled = body.enabled;
						await dbs.db
							.update(achievementTriggers)
							.set(patch)
							.where(eq(achievementTriggers.code, req.params.code));
						return Response.json({ ok: true });
					}),
					DELETE: admin(async (req) => {
						const dbs = container.resolve(DatabaseService);
						await dbs.db
							.delete(achievementTriggers)
							.where(eq(achievementTriggers.code, req.params.code));
						return Response.json({ ok: true });
					}),
				},

				// ── Relais de messages privés (boîte aux lettres de l'agent) ──
				// Shenron sert de canal entre une personne et l'agent qui opère la
				// prod : `DirectMessageRelay` enregistre ce qui arrive, ces routes
				// donnent à l'agent de quoi lire et répondre. Toutes en admin — le
				// relais donne accès à une conversation privée.

				// Messages reçus et non encore lus, du plus ancien au plus récent.
				// `?tout=1` rend aussi les messages déjà lus (relecture du fil).
				// `?userId=` restreint à un correspondant.
				"/api/dm/inbox": {
					GET: admin(async (req) => {
						const dbs = container.resolve(DatabaseService);
						const url = new URL(req.url);
						const tout = url.searchParams.get("tout") === "1";
						const userId = url.searchParams.get("userId");
						const limite = Math.min(200, Math.max(1, Number(url.searchParams.get("limit") ?? 50)));

						const conditions = [eq(dmMessages.direction, "in")];
						if (!tout) conditions.push(isNull(dmMessages.readAt));
						if (userId) conditions.push(eq(dmMessages.userId, userId));

						const lignes = await dbs.db
							.select({
								id: dmMessages.id,
								userId: dmMessages.userId,
								content: dmMessages.content,
								createdAt: dmMessages.createdAt,
								readAt: dmMessages.readAt,
								username: dmContacts.username,
								displayName: dmContacts.displayName,
								allowed: dmContacts.allowed,
							})
							.from(dmMessages)
							.leftJoin(dmContacts, eq(dmContacts.userId, dmMessages.userId))
							.where(and(...conditions))
							.orderBy(dmMessages.createdAt)
							.limit(limite);
						return Response.json({ messages: lignes, count: lignes.length });
					}),
				},

				// Marque des messages comme lus. Séparé de la lecture : consulter sa
				// boîte ne veut pas dire avoir traité, et un GET ne doit pas muter.
				"/api/dm/read": {
					POST: admin(async (req) => {
						const body = (await req.json().catch(() => null)) as {
							ids?: number[];
							userId?: string;
						} | null;
						const dbs = container.resolve(DatabaseService);
						if (Array.isArray(body?.ids) && body.ids.length > 0) {
							await dbs.db
								.update(dmMessages)
								.set({ readAt: new Date() })
								.where(and(inArray(dmMessages.id, body.ids), isNull(dmMessages.readAt)));
							return Response.json({ ok: true, marques: body.ids.length });
						}
						if (body?.userId) {
							await dbs.db
								.update(dmMessages)
								.set({ readAt: new Date() })
								.where(
									and(
										eq(dmMessages.userId, body.userId),
										eq(dmMessages.direction, "in"),
										isNull(dmMessages.readAt)
									)
								);
							return Response.json({ ok: true });
						}
						return Response.json({ error: "Fournir `ids` ou `userId`." }, { status: 400 });
					}),
				},

				// Répond à un correspondant. Refuse si le contact n'est pas autorisé :
				// c'est la même liste blanche qu'à la réception, appliquée aux deux
				// sens — sinon le relais pourrait servir à écrire à n'importe qui.
				"/api/dm/send": {
					POST: admin(async (req) => {
						const body = (await req.json().catch(() => null)) as {
							userId?: string;
							content?: string;
						} | null;
						const contenu = (body?.content ?? "").trim();
						if (!body?.userId || !contenu) {
							return Response.json({ error: "`userId` et `content` requis." }, { status: 400 });
						}
						// Discord tronque au-delà de 2000 caractères : mieux vaut refuser
						// que laisser partir un message amputé sans le dire.
						if (contenu.length > 2000) {
							return Response.json(
								{ error: `Message trop long (${contenu.length} > 2000 caractères).` },
								{ status: 400 }
							);
						}

						const dbs = container.resolve(DatabaseService);
						const [contact] = await dbs.db
							.select({ allowed: dmContacts.allowed, username: dmContacts.username })
							.from(dmContacts)
							.where(eq(dmContacts.userId, body.userId))
							.limit(1);
						if (!contact?.allowed) {
							return Response.json(
								{ error: "Correspondant inconnu ou non autorisé — l'ouvrir d'abord." },
								{ status: 403 }
							);
						}

						const clientMap = container.resolve<Map<PersonaId, Client>>("ClientMap");
						const client = clientMap.get("shenron");
						if (!client) return Response.json({ error: "Shenron hors ligne." }, { status: 503 });

						try {
							const user = await client.users.fetch(body.userId);
							const sent = await user.send(contenu);
							await dbs.db.insert(dmMessages).values({
								userId: body.userId,
								direction: "out",
								content: contenu,
								persona: "shenron",
								messageId: sent.id,
							});
							return Response.json({
								ok: true,
								messageId: sent.id,
								destinataire: contact.username,
							});
						} catch (e) {
							// Cause la plus fréquente : le correspondant a fermé ses messages
							// privés. Le dire explicitement évite de chercher côté bot.
							return Response.json(
								{ error: `Envoi impossible : ${(e as Error).message}` },
								{ status: 502 }
							);
						}
					}),
				},

				// Correspondants connus, autorisés ou non, avec leur volume d'échange.
				"/api/dm/contacts": {
					GET: admin(async () => {
						const dbs = container.resolve(DatabaseService);
						const lignes = await dbs.db
							.select({
								userId: dmContacts.userId,
								username: dmContacts.username,
								displayName: dmContacts.displayName,
								allowed: dmContacts.allowed,
								note: dmContacts.note,
								firstSeenAt: dmContacts.firstSeenAt,
								lastSeenAt: dmContacts.lastSeenAt,
							})
							.from(dmContacts)
							.orderBy(dmContacts.lastSeenAt);
						return Response.json({ contacts: lignes });
					}),
				},

				// Ouvre ou ferme l'accès d'un correspondant. `POST {allowed, note}`.
				// Le contact peut ne pas exister encore : on le crée, ce qui permet
				// d'autoriser quelqu'un AVANT son premier message.
				"/api/dm/contacts/:userId": {
					POST: admin(async (req) => {
						const userId = req.params.userId as string;
						if (!/^\d{17,20}$/.test(userId)) {
							return Response.json({ error: "userId Discord invalide." }, { status: 400 });
						}
						const body = (await req.json().catch(() => null)) as {
							allowed?: boolean;
							note?: string;
						} | null;
						const allowed = body?.allowed !== false;
						const dbs = container.resolve(DatabaseService);

						// Le nom vient de Discord, pas de l'appelant : une liste blanche
						// dont les libellés sont saisis à la main finit par désigner
						// quelqu'un d'autre que celui qu'on croit.
						let username = userId;
						let displayName: string | null = null;
						const clientMap = container.resolve<Map<PersonaId, Client>>("ClientMap");
						const client = clientMap.get("shenron");
						if (client) {
							try {
								const user = await client.users.fetch(userId);
								username = user.username;
								displayName = user.globalName ?? null;
							} catch {
								return Response.json(
									{ error: "Utilisateur Discord introuvable." },
									{ status: 404 }
								);
							}
						}

						await dbs.db
							.insert(dmContacts)
							.values({ userId, username, displayName, allowed, note: body?.note ?? null })
							.onConflictDoUpdate({
								target: dmContacts.userId,
								set: { allowed, username, displayName, ...(body?.note ? { note: body.note } : {}) },
							});
						return Response.json({ ok: true, userId, username, allowed });
					}),
				},

				// ── Discord direct send (depuis site admin) ───────────────────
				// Envoie un message dans un salon Discord via une persona donnée.
				// Body : { channelId: string, content?: string, embed?: object,
				//          persona?: PersonaId (défaut: shenron) }
				"/api/discord/send": {
					POST: admin(async (req) => {
						const body = (await req.json().catch(() => null)) as {
							channelId?: string;
							/** Envoi en message privé : le canal DM est ouvert à la volée. */
							userId?: string;
							content?: string;
							embed?: Record<string, unknown>;
							persona?: PersonaId;
						} | null;
						if (!body?.channelId && !body?.userId) {
							return Response.json({ error: "channelId ou userId requis" }, { status: 400 });
						}
						if (!body.content && !body.embed) {
							return Response.json({ error: "content ou embed requis" }, { status: 400 });
						}
						const personaId = (body.persona ?? "shenron") as PersonaId;
						if (!PERSONA_IDS.includes(personaId)) {
							return Response.json({ error: "persona invalide" }, { status: 400 });
						}
						const clientMap = container.resolve<Map<PersonaId, Client>>("ClientMap");
						const client = clientMap.get(personaId);
						if (!client) {
							return Response.json({ error: "persona offline" }, { status: 503 });
						}
						try {
							// Un identifiant d'utilisateur ne se résout pas en salon : il faut
							// ouvrir (ou retrouver) le canal privé. On renvoie son id et le nom
							// du destinataire — écrire à quelqu'un est irréversible, l'appelant
							// doit pouvoir vérifier à qui il vient de parler.
							let destinataire: string | null = null;
							let channel: unknown;
							if (body.userId) {
								if (!/^\d{17,20}$/.test(body.userId)) {
									return Response.json({ error: "userId invalide" }, { status: 400 });
								}
								const user = await client.users.fetch(body.userId);
								destinataire = user.globalName ?? user.username;
								channel = await user.createDM();
							} else {
								channel = await client.channels.fetch(body.channelId!);
							}
							const ch = channel as TextChannel | null;
							if (!ch || !ch.isTextBased?.() || !("send" in (ch as object))) {
								return Response.json({ error: "salon textuel introuvable" }, { status: 404 });
							}
							const sent = await ch.send({
								content: body.content ?? undefined,
								embeds: body.embed ? [body.embed as APIEmbed] : undefined,
							});
							return Response.json({
								ok: true,
								messageId: sent.id,
								channelId: sent.channelId,
								destinataire,
								url: `https://discord.com/channels/${sent.guildId ?? "@me"}/${sent.channelId}/${sent.id}`,
							});
						} catch (err) {
							return Response.json(
								{ error: err instanceof Error ? err.message : "envoi échoué" },
								{ status: 500 }
							);
						}
					}),
				},

				// ── Console bot : exécution d'opérations réelles à distance ────
				// GET  → catalogue des commandes (rendu par l'UI admin du site).
				// POST → exécute { command, args } via les vrais services (XP, zénis,
				// rôles, race, message). Admin-gated. Renvoie { ok, message, data }.
				"/api/admin/console/commands": admin(async () =>
					Response.json({ commands: COMMAND_CATALOG })
				),
				"/api/admin/console/exec": {
					POST: admin(async (req) => {
						const body = (await req.json().catch(() => null)) as {
							command?: string;
							args?: Record<string, unknown>;
						} | null;
						if (!body?.command) {
							return Response.json({ ok: false, message: "command requis" }, { status: 400 });
						}
						const result = await runConsoleCommand(body.command, body.args ?? {});
						return Response.json(result, { status: result.ok ? 200 : 400 });
					}),
				},

				// ── Cockpit IA du site (/admin/ia) : écritures sur les tables runtime ──
				// Le site lit le miroir PostgreSQL `bot.*` et délègue ici ses écritures :
				// le bot reste l'autorité de admin_goals, rag_training_feedback,
				// rag_eval_history et du jeu doré (cf. ~/api/ia-cockpit).
				"/api/admin/goals": {
					POST: admin(async (req) => createGoalRoute(iaCockpitDeps(), await req.json().catch(() => null))),
				},
				"/api/admin/goals/:id/complete": {
					POST: admin(async (req) =>
						completeGoalRoute(iaCockpitDeps(), req.params.id, await req.json().catch(() => null))
					),
				},
				"/api/training/feedback/:id/status": {
					POST: admin(async (req) =>
						feedbackStatusRoute(iaCockpitDeps(), req.params.id, await req.json().catch(() => null))
					),
				},
				"/api/training/gold": {
					POST: admin(async (req) => addGoldCaseRoute(iaCockpitDeps(), await req.json().catch(() => null))),
				},
				"/api/training/eval": {
					POST: admin(async (req) => evaluateRagRoute(iaCockpitDeps(), await req.json().catch(() => null))),
				},

				// ── Discord : lecture des messages récents d'un salon ──────────
				// GET /api/discord/messages?channelId=&limit= (défaut 30, max 100).
				// Utilise Grand Prêtre (intent MessageContent) pour voir le contenu ;
				// fallback sur le 1er persona dispo si offline (contenu possiblement vide).
				"/api/discord/messages": admin(async (req) => {
					const url = new URL(req.url);
					const channelId = url.searchParams.get("channelId");
					if (!channelId || !/^\d{17,20}$/.test(channelId)) {
						return Response.json({ error: "channelId invalide" }, { status: 400 });
					}
					const limit = Math.min(100, Math.max(1, Number(url.searchParams.get("limit")) || 30));
					const clientMap = container.resolve<Map<PersonaId, Client>>("ClientMap");
					// Un canal privé appartient au couple (bot, destinataire) : seul le
					// persona qui a ouvert le DM peut le relire. Lire les réponses à un
					// message envoyé par Shenron avec le client du Grand Prêtre renvoyait
					// un fil vide, sans erreur — d'où le paramètre explicite.
					const demande = url.searchParams.get("persona") as PersonaId | null;
					const client =
						(demande && PERSONA_IDS.includes(demande) ? clientMap.get(demande) : null) ??
						clientMap.get("grandPretre") ??
						[...clientMap.values()].find((c) => c.isReady());
					if (!client) {
						return Response.json({ error: "aucun persona en ligne" }, { status: 503 });
					}
					try {
						const channel = await client.channels.fetch(channelId);
						if (!channel || !channel.isTextBased() || !("messages" in channel)) {
							return Response.json({ error: "salon textuel introuvable" }, { status: 404 });
						}
						const fetched = await (channel as TextChannel).messages.fetch({ limit });
						const messages = [...fetched.values()]
							.toSorted((a, b) => a.createdTimestamp - b.createdTimestamp)
							.map((m) => ({
								id: m.id,
								authorId: m.author.id,
								authorName: m.member?.displayName ?? m.author.globalName ?? m.author.username,
								authorAvatar: m.author.displayAvatarURL({ size: 64 }),
								authorBot: m.author.bot,
								content: m.content,
								createdAt: new Date(m.createdTimestamp).toISOString(),
								attachments: [...m.attachments.values()].map((a) => ({
									url: a.url,
									name: a.name,
									contentType: a.contentType,
								})),
								embedCount: m.embeds.length,
							}));
						const channelName = "name" in channel ? (channel.name ?? null) : null;
						return Response.json({ channelId, channelName, messages, count: messages.length });
					} catch (err) {
						return Response.json(
							{ error: err instanceof Error ? err.message : "lecture échouée" },
							{ status: 500 }
						);
					}
				}),

				// ── Settings schema (catalogue SETTINGS_KEYS + valeur courante) ──
				"/api/settings/schema": admin(async () => {
					const { SETTINGS_KEYS } = await import("~/services/SettingsService");
					const svc = container.resolve(SettingsService);
					const overrides = await svc.list();
					const currentMap = new Map(overrides.map((o) => [o.key, o.value]));
					const keys = SETTINGS_KEYS.map((k) =>
						Object.assign({}, k, { current: currentMap.get(k.key) ?? null })
					);
					return Response.json({ keys });
				}),

				// ── Webhooks (CRUD + exécution) ──────────────────────────────
				"/api/webhooks": admin(async (req) => {
					const url = new URL(req.url);
					const channelId = url.searchParams.get("channel_id");
					try {
						const list = channelId
							? await listChannelWebhooks(channelId)
							: await listGuildWebhooks(env.GUILD_ID);
						return Response.json({ webhooks: list });
					} catch (err) {
						const status = err instanceof DiscordRESTError ? err.status : 500;
						return Response.json({ error: String(err) }, { status });
					}
				}),
				"/api/webhooks/create": {
					POST: admin(async (req) => {
						const body = (await req.json().catch(() => null)) as {
							channel_id?: string;
							name?: string;
							avatar?: string | null;
						} | null;
						if (!body?.channel_id || !body.name) {
							return Response.json(
								{ error: "Body attendu : { channel_id, name, avatar? }" },
								{ status: 400 }
							);
						}
						try {
							const webhook = await createChannelWebhook(body.channel_id, {
								name: body.name,
								avatar: body.avatar ?? null,
							});
							return Response.json({ webhook });
						} catch (err) {
							const status = err instanceof DiscordRESTError ? err.status : 500;
							return Response.json({ error: String(err) }, { status });
						}
					}),
				},
				"/api/webhooks/:id": {
					DELETE: admin(async (req) => {
						try {
							await deleteWebhook(req.params.id);
							return Response.json({ ok: true });
						} catch (err) {
							const status = err instanceof DiscordRESTError ? err.status : 500;
							return Response.json({ error: String(err) }, { status });
						}
					}),
				},
				"/api/webhooks/execute": {
					POST: admin(async (req) => {
						const body = (await req.json().catch(() => null)) as
							| (ExecuteWebhookPayload & { url?: string; wait?: boolean })
							| null;
						if (!body?.url) {
							return Response.json(
								{
									error: "Body attendu : { url, content?, embeds?, username?, avatar_url?, wait? }",
								},
								{ status: 400 }
							);
						}
						const { url, wait, ...payload } = body;
						try {
							const result = await executeWebhook(url, payload, { wait });
							return Response.json({ ok: true, message: result });
						} catch (err) {
							return Response.json(
								{ error: err instanceof Error ? err.message : String(err) },
								{ status: 500 }
							);
						}
					}),
				},

				"/api/discord/audit-logs": admin(async (req) => {
					const url = new URL(req.url);
					const params = new URLSearchParams();
					const limit = Math.min(100, Number(url.searchParams.get("limit")) || 50);
					params.set("limit", String(limit));
					const at = url.searchParams.get("action_type");
					if (at) params.set("action_type", at);
					const before = url.searchParams.get("before");
					if (before) params.set("before", before);
					const userId = url.searchParams.get("user_id");
					if (userId) params.set("user_id", userId);
					try {
						const { data } = await discordFetch<any>(
							`/guilds/${env.GUILD_ID}/audit-logs?${params}`,
							{ mode: "Bot" }
						);
						return Response.json(data);
					} catch (err) {
						const status = err instanceof DiscordRESTError ? err.status : 500;
						return Response.json({ error: String(err) }, { status });
					}
				}),

				// ── Services ──────────────────────────────────────────────────
				"/api/services": admin(() => Response.json({ actions: listServiceActions() })),
				"/api/services/:service/:action": {
					POST: admin(async (req) => {
						const action = findAction(req.params.service, req.params.action);
						if (!action) return Response.json({ error: "Action inconnue" }, { status: 404 });
						const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
						try {
							const result = await action.handler(body);
							return Response.json({ ok: true, result });
						} catch (err) {
							return Response.json(
								{ ok: false, error: err instanceof Error ? err.message : "erreur" },
								{ status: 400 }
							);
						}
					}),
				},

				// ── Niveaux & XP (page dédiée /levels) ────────────────────────
				"/api/levels/config": admin(async () => {
					const dbs = container.resolve(DatabaseService);
					// Lit les surcharges runtime depuis guild_settings (clés `xp.*` + `zeni.*`)
					const settings = await dbs.db.select().from((await import("~/db/schema")).guildSettings);
					const overrides = Object.fromEntries(settings.map((s) => [s.key, s.value]));
					// Défauts tirés du schéma : une liste recopiée ici avait divergé des valeurs réelles.
					const { SETTINGS_KEYS } = await import("~/services/SettingsService");
					const defaults = Object.fromEntries(
						SETTINGS_KEYS.filter(
							(k) => !k.prefix && k.default !== undefined && /^(xp|zeni)\./.test(k.key)
						).map((k) => [k.key, k.default])
					);
					return Response.json({ thresholds: getLevelThresholds(), defaults, overrides });
				}),
				// Courbe de niveaux ÉDITABLE (guild_settings.xp.thresholds).
				// GET → courbe active ; PUT → remplace (validé, appliqué à chaud + persisté).
				"/api/levels/thresholds": {
					GET: admin(async () => Response.json({ thresholds: getLevelThresholds() })),
					PUT: admin(async (req) => {
						const body = (await req.json().catch(() => null)) as {
							thresholds?: Array<{ level?: unknown; xp?: unknown }>;
						} | null;
						const raw = body?.thresholds;
						if (!Array.isArray(raw) || raw.length === 0) {
							return Response.json(
								{ error: "thresholds: tableau non vide { level, xp } attendu" },
								{ status: 400 }
							);
						}
						if (raw.length > 50) {
							return Response.json({ error: "Maximum 50 paliers." }, { status: 400 });
						}
						const rows: LevelThreshold[] = [];
						const seenLevels = new Set<number>();
						for (const r of raw) {
							const level = Number(r.level);
							const xp = Number(r.xp);
							if (!Number.isInteger(level) || level < 1) {
								return Response.json({ error: `Niveau invalide : ${r.level}` }, { status: 400 });
							}
							if (!Number.isFinite(xp) || xp < 0) {
								return Response.json({ error: `XP invalide au niveau ${level}` }, { status: 400 });
							}
							if (seenLevels.has(level)) {
								return Response.json({ error: `Niveau ${level} en double` }, { status: 400 });
							}
							seenLevels.add(level);
							rows.push({ level, xp: Math.round(xp) });
						}
						// Cohérence : xp strictement croissant avec le niveau.
						const byLevel = rows.toSorted((a, b) => a.level - b.level);
						for (let i = 1; i < byLevel.length; i++) {
							if (byLevel[i]!.xp <= byLevel[i - 1]!.xp) {
								return Response.json(
									{
										error: `L'XP doit croître avec le niveau (niveau ${byLevel[i]!.level} ≤ niveau ${byLevel[i - 1]!.level}).`,
									},
									{ status: 400 }
								);
							}
						}
						const dbs = container.resolve(DatabaseService);
						const applied = saveLevelThresholds(dbs.db, rows);
						return Response.json({ ok: true, thresholds: applied });
					}),
				},
				"/api/levels/distribution": admin(async () => {
					const dbs = container.resolve(DatabaseService);
					const curve = getLevelThresholds();
					// Compte les users dans chaque tranche de palier (basé sur user.xp).
					const buckets = curve.map((t, i) => ({
						level: t.level,
						minXp: i === 0 ? 0 : curve[i - 1]!.xp,
						maxXp: t.xp,
					}));
					const result: Array<{ level: number; minXp: number; maxXp: number; count: number }> = [];
					for (const b of buckets) {
						const [{ c = 0 } = { c: 0 }] = await dbs.db
							.select({ c: sql<number>`COUNT(*)` })
							.from(users)
							.where(sql`${users.xp} >= ${b.minXp} AND ${users.xp} < ${b.maxXp}`);
						result.push({ ...b, count: Number(c) });
					}
					// Bucket "au-delà" pour ceux qui dépassent le dernier seuil
					const lastXp = curve[curve.length - 1]!.xp;
					const [{ c: cBeyond = 0 } = { c: 0 }] = await dbs.db
						.select({ c: sql<number>`COUNT(*)` })
						.from(users)
						.where(sql`${users.xp} >= ${lastXp}`);
					result.push({
						level: 11,
						minXp: lastXp,
						maxXp: Number.MAX_SAFE_INTEGER,
						count: Number(cBeyond),
					});
					return Response.json({ buckets: result });
				}),
				"/api/levels/rewards": {
					GET: admin(async () => {
						const dbs = container.resolve(DatabaseService);
						const rows = await dbs.db.select().from(levelRewards).orderBy(levelRewards.level);
						return Response.json({ rewards: rows });
					}),
					POST: admin(async (req) => {
						const body = (await req.json().catch(() => null)) as {
							level?: number;
							roleId?: string;
							xpThreshold?: number;
							zeniBonus?: number;
						} | null;
						if (
							!body ||
							typeof body.level !== "number" ||
							!body.roleId ||
							typeof body.xpThreshold !== "number"
						) {
							return Response.json(
								{ error: "Body attendu : { level, roleId, xpThreshold, zeniBonus? }" },
								{ status: 400 }
							);
						}
						// Hiérarchie : refuser si rôle au-dessus du bot (sinon attribution silencieuse échoue)
						const client = container.resolve(Client);
						const guild = client.guilds.cache.get(env.GUILD_ID);
						const botMember = guild?.members.me;
						const targetRole = guild?.roles.cache.get(body.roleId);
						if (!targetRole) {
							return Response.json({ error: "Rôle introuvable dans la guild" }, { status: 404 });
						}
						if (botMember && targetRole.position >= botMember.roles.highest.position) {
							return Response.json(
								{
									error: `Rôle "${targetRole.name}" au-dessus du bot — l'attribution échouera silencieusement. Replacer le rôle du bot plus haut dans la hiérarchie.`,
								},
								{ status: 400 }
							);
						}
						const dbs = container.resolve(DatabaseService);
						await dbs.db
							.insert(levelRewards)
							.values({
								level: body.level,
								roleId: body.roleId,
								xpThreshold: body.xpThreshold,
								zeniBonus: body.zeniBonus ?? 1000,
							})
							.onConflictDoUpdate({
								target: levelRewards.level,
								set: {
									roleId: body.roleId,
									xpThreshold: body.xpThreshold,
									zeniBonus: body.zeniBonus ?? 1000,
								},
							});
						container.resolve(EventBusService).emit("levels:rewards:changed", {
							level: body.level,
							action: "upsert",
						});
						return Response.json({ ok: true });
					}),
				},
				"/api/levels/rewards/:level": {
					DELETE: admin(async (req) => {
						const level = Number(req.params.level);
						if (!Number.isFinite(level)) {
							return Response.json({ error: "level invalide" }, { status: 400 });
						}
						const dbs = container.resolve(DatabaseService);
						await dbs.db.delete(levelRewards).where(eq(levelRewards.level, level));
						container.resolve(EventBusService).emit("levels:rewards:changed", {
							level,
							action: "delete",
						});
						return Response.json({ ok: true });
					}),
				},
				// Rôles de palier PAR RACE (table race_level_roles, source de vérité des rôles
				// de level-up). Distinct de /levels/rewards (zéni/seuil/bannière, race-agnostique).
				"/api/levels/race-rewards": {
					GET: admin(async () => {
						const dbs = container.resolve(DatabaseService);
						const rows = await dbs.db
							.select()
							.from(raceLevelRoles)
							.orderBy(asc(raceLevelRoles.race), asc(raceLevelRoles.level));
						return Response.json({ rewards: rows });
					}),
					POST: admin(async (req) => {
						const body = (await req.json().catch(() => null)) as {
							race?: string;
							level?: number;
							roleId?: string;
						} | null;
						if (
							!body ||
							!isRaceId(body.race) ||
							typeof body.level !== "number" ||
							!Number.isInteger(body.level) ||
							body.level < 1 ||
							!body.roleId
						) {
							return Response.json(
								{
									error: `Body attendu : { race ∈ [${RACE_IDS.join(", ")}], level: entier ≥ 1, roleId }`,
								},
								{ status: 400 }
							);
						}
						// Hiérarchie : refuser si rôle au-dessus du bot (sinon attribution silencieuse échoue)
						const client = container.resolve(Client);
						const guild = client.guilds.cache.get(env.GUILD_ID);
						const botMember = guild?.members.me;
						const targetRole = guild?.roles.cache.get(body.roleId);
						if (!targetRole) {
							return Response.json({ error: "Rôle introuvable dans la guild" }, { status: 404 });
						}
						if (botMember && targetRole.position >= botMember.roles.highest.position) {
							return Response.json(
								{
									error: `Rôle "${targetRole.name}" au-dessus du bot — l'attribution échouera silencieusement. Replacer le rôle du bot plus haut dans la hiérarchie.`,
								},
								{ status: 400 }
							);
						}
						const dbs = container.resolve(DatabaseService);
						await dbs.db
							.insert(raceLevelRoles)
							.values({ race: body.race, level: body.level, roleId: body.roleId })
							.onConflictDoUpdate({
								target: [raceLevelRoles.race, raceLevelRoles.level],
								set: { roleId: body.roleId },
							});
						reloadRaceLevelRoles();
						return Response.json({ ok: true });
					}),
				},
				"/api/levels/race-rewards/:race/:level": {
					DELETE: admin(async (req) => {
						const race = req.params.race;
						const level = Number(req.params.level);
						if (!isRaceId(race) || !Number.isFinite(level)) {
							return Response.json({ error: "race ou level invalide" }, { status: 400 });
						}
						const dbs = container.resolve(DatabaseService);
						await dbs.db
							.delete(raceLevelRoles)
							.where(and(eq(raceLevelRoles.race, race), eq(raceLevelRoles.level, level)));
						reloadRaceLevelRoles();
						return Response.json({ ok: true });
					}),
				},
				"/api/levels/top": admin(async (req) => {
					const dbs = container.resolve(DatabaseService);
					const url = new URL(req.url);
					const metric = (url.searchParams.get("metric") ?? "xp") as
						| "xp"
						| "zeni"
						| "voice"
						| "streak"
						| "messages";
					const limit = Math.min(50, Number(url.searchParams.get("limit")) || 10);
					const col =
						metric === "voice"
							? users.totalVoiceMs
							: metric === "streak"
								? users.dailyStreak
								: metric === "zeni"
									? users.zeni
									: metric === "messages"
										? users.messageCount
										: users.xp;
					const rows = await dbs.db
						.select({
							id: users.id,
							xp: users.xp,
							zeni: users.zeni,
							lastLevelReached: users.lastLevelReached,
							messageCount: users.messageCount,
							totalVoiceMs: users.totalVoiceMs,
							dailyStreak: users.dailyStreak,
						})
						.from(users)
						.orderBy(desc(col))
						.limit(limit);
					return Response.json({ metric, limit, users: rows });
				}),
				"/api/levels/users/:userId/xp": {
					POST: admin(async (req) => {
						const dbs = container.resolve(DatabaseService);
						const userId = req.params.userId;
						const body = (await req.json().catch(() => null)) as {
							mode: "set" | "add";
							amount: number;
						} | null;
						if (!body || !["set", "add"].includes(body.mode) || typeof body.amount !== "number") {
							return Response.json(
								{ error: "Body attendu : { mode: 'set'|'add', amount: number }" },
								{ status: 400 }
							);
						}
						const existing = await dbs.db.select().from(users).where(eq(users.id, userId)).limit(1);
						if (existing.length === 0) {
							return Response.json({ error: "Utilisateur introuvable en base" }, { status: 404 });
						}
						const current = existing[0]!.xp;
						// Passe par LevelService → recalcule lastLevelReached, puis réaligne les
						// rôles de palier de la race (sinon niveau + rôles se désynchronisent).
						const levels = container.resolve(LevelService);
						const newXp =
							body.mode === "set" ? Math.max(0, body.amount) : Math.max(0, current + body.amount);
						const res =
							body.mode === "set"
								? await levels.setXP(userId, newXp)
								: await levels.addXP(userId, body.amount, { propagateFusion: false });
						const member = await resolveMember(userId);
						if (member) await levels.syncRaceLevelRoles(member).catch(() => {});
						return Response.json({
							ok: true,
							userId,
							previousXp: current,
							newXp,
							newLevel: res.newLevel,
							levelUp: res.levelUp,
							rolesSynced: !!member,
						});
					}),
				},
				"/api/levels/users/:userId/zeni": {
					POST: admin(async (req) => {
						const dbs = container.resolve(DatabaseService);
						const userId = req.params.userId;
						const body = (await req.json().catch(() => null)) as {
							mode: "set" | "add";
							amount: number;
						} | null;
						if (!body || !["set", "add"].includes(body.mode) || typeof body.amount !== "number") {
							return Response.json(
								{ error: "Body attendu : { mode: 'set'|'add', amount: number }" },
								{ status: 400 }
							);
						}
						const existing = await dbs.db.select().from(users).where(eq(users.id, userId)).limit(1);
						if (existing.length === 0) {
							return Response.json({ error: "Utilisateur introuvable en base" }, { status: 404 });
						}
						const current = existing[0]!.zeni;
						const economy = container.resolve(EconomyService);
						if (body.mode === "set") {
							await economy.setZeni(userId, Math.max(0, body.amount));
						} else if (body.amount >= 0) {
							if (!Number.isFinite(body.amount) || body.amount > 1_000_000_000_000) {
								return Response.json({ error: "Montant hors plafond d'un octroi manuel" }, { status: 400 });
							}
							await economy.addZeni(userId, body.amount, { propagateFusion: false, source: "admin" });
						} else {
							await economy.removeZeni(userId, -body.amount);
						}
						const newZeni = await economy.getBalance(userId);
						return Response.json({ ok: true, userId, previousZeni: current, newZeni });
					}),
				},

				// ── Canvas (rendu PNG via @napi-rs/canvas) ────────────────────
				// Tous les services renvoient Buffer<PNG>, on les wrappe en Response.
				// Cache HTTP 60 s pour amortir le coût Skia (100 ms - 1 s par render).
				"/api/canvas/profile/:userId": admin((req) =>
					cachedImage(req, async () => {
						const client = container.resolve(Client);
						const userId = req.params.userId;
						const user = await client.users.fetch(userId).catch(() => null);
						if (!user) throw new HttpError(404, "Utilisateur introuvable");
						const dbs = container.resolve(DatabaseService);
						const rows = await dbs.db.select().from(users).where(eq(users.id, userId)).limit(1);
						const row = rows[0];
						if (!row) throw new HttpError(404, "Pas de profil en base");
						const url = new URL(req.url);
						const rawTheme = url.searchParams.get("theme") ?? row.equippedCard;
						const rawBanner = url.searchParams.get("banner") ?? row.equippedBanner;
						const rawBadge = url.searchParams.get("badge") ?? row.equippedBadge;
						const rawTitle = url.searchParams.get("title") ?? row.equippedTitle;
						const rawColor = url.searchParams.get("color") ?? row.equippedColor;

						const [titleItem, badgeItem, colorItem, bannerItem] = await Promise.all([
							rawTitle ? dbs.db.query.shopItems.findFirst({ where: eq(shopItems.key, rawTitle) }) : Promise.resolve(null),
							rawBadge ? dbs.db.query.shopItems.findFirst({ where: eq(shopItems.key, rawBadge) }) : Promise.resolve(null),
							rawColor && !rawColor.startsWith("#") ? dbs.db.query.shopItems.findFirst({ where: eq(shopItems.key, rawColor) }) : Promise.resolve(null),
							rawBanner ? dbs.db.query.shopItems.findFirst({ where: eq(shopItems.key, rawBanner) }) : Promise.resolve(null),
						]);

						const titleText = titleItem?.name ?? rawTitle ?? null;
						const badgeText = badgeItem
							? (badgeItem.name.match(/[\u3400-\u9FFF]/)?.[0] ?? badgeItem.name)
							: (rawBadge ?? null);

						let colorHex: string | null = null;
						if (colorItem?.roleId) {
							const clientMap = container.resolve<Map<string, Client>>("ClientMap");
							const guild = [...clientMap.values()].map((c) => c.guilds.cache.get(env.GUILD_ID)).find(Boolean);
							const role = guild?.roles.cache.get(colorItem.roleId);
							if (role?.color) colorHex = `#${role.color.toString(16).padStart(6, "0")}`;
						}
						if (!colorHex && colorItem?.meta) {
							try {
								const parsed = JSON.parse(colorItem.meta);
								if (parsed.colorHex) colorHex = parsed.colorHex;
							} catch {}
						}
						if (!colorHex && rawColor?.startsWith("#")) {
							colorHex = rawColor;
						}

						let bannerPath: string | null = null;
						if (bannerItem?.meta) {
							try {
								const parsed = JSON.parse(bannerItem.meta);
								if (parsed.bannerPath) bannerPath = parsed.bannerPath;
							} catch {}
						}
						if (!bannerPath && rawBanner?.startsWith("assets/banners/")) {
							bannerPath = rawBanner;
						}

						const card = container.resolve(CardService);
						return await card.render({
							discordUser: user,
							xp: row.xp,
							zeni: row.zeni,
							messageCount: row.messageCount,
							cardKey: rawTheme,
							bannerPath,
							bannerKey: rawBanner,
							badge: badgeText,
							title: titleText,
							color: colorHex,
						});
					})
				),
				"/api/canvas/scan/:userId": admin((req) =>
					cachedImage(req, async () => {
						const client = container.resolve(Client);
						const userId = req.params.userId;
						const user = await client.users.fetch(userId).catch(() => null);
						if (!user) throw new HttpError(404, "Utilisateur introuvable");
						const levels = container.resolve(LevelService);
						const row = await levels.getUser(userId);
						const xp = row?.xp ?? 0;
						const accent = xpAccent(xp);
						const gauge = container.resolve(GaugeService);
						const pct = Math.min(100, Math.round((xp / 9_000_000) * 100));
						return await gauge.render({
							user,
							title: "SCANNER DE KI",
							subtitle: "Lecture du potentiel",
							pct,
							accent,
							accentDark: "#0a0a0a",
						});
					})
				),
				"/api/canvas/scouter/:userId": admin((req) =>
					cachedImage(req, async () => {
						const client = container.resolve(Client);
						const userId = req.params.userId;
						const user = await client.users.fetch(userId).catch(() => null);
						if (!user) throw new HttpError(404, "Utilisateur introuvable");
						const url = new URL(req.url);
						const type = (url.searchParams.get("type") ?? "gay") as "gay" | "raciste";
						const pct = Math.max(0, Math.min(101, Number(url.searchParams.get("pct") ?? 50)));
						const gauge = container.resolve(GaugeService);
						const config =
							type === "raciste"
								? {
										title: "RACISM-O-MÈTRE",
										subtitle: "Scanner calibré sur Commander Red",
										accent: "#dc2626",
										accentDark: "#4a0000",
									}
								: {
										title: "GAYDAR DE BULMA",
										subtitle: "Scanner calibré sur Master Roshi",
										accent: "#ec4899",
										accentDark: "#3a0420",
									};
						return await gauge.render({ user, ...config, pct });
					})
				),
				"/api/canvas/fusion": admin((req) =>
					cachedImage(req, async () => {
						const client = container.resolve(Client);
						const url = new URL(req.url);
						const aId = url.searchParams.get("a");
						const bId = url.searchParams.get("b");
						if (!aId || !bId) {
							throw new HttpError(400, "Paramètres a + b requis (IDs Discord)");
						}
						const [a, b] = await Promise.all([
							client.users.fetch(aId).catch(() => null),
							client.users.fetch(bId).catch(() => null),
						]);
						if (!a || !b) throw new HttpError(404, "Utilisateur(s) introuvable(s)");
						const state = (url.searchParams.get("state") ?? "success") as "propose" | "success";
						const fusedName =
							url.searchParams.get("name") ?? `${a.username.slice(0, 4)}${b.username.slice(0, 4)}`;
						const fusion = container.resolve(FusionService);
						return await fusion.render({ a, b, state, fusedName });
					})
				),
				"/api/canvas/leaderboard": admin((req) =>
					cachedImage(req, async () => {
						const client = container.resolve(Client);
						const dbs = container.resolve(DatabaseService);
						const url = new URL(req.url);
						const metric = (url.searchParams.get("metric") ?? "xp") as "xp" | "zeni";
						const limit = Math.min(20, Math.max(3, Number(url.searchParams.get("limit") ?? 10)));
						const col = metric === "zeni" ? users.zeni : users.xp;
						const rows = await dbs.db
							.select({ id: users.id, xp: users.xp, zeni: users.zeni })
							.from(users)
							.orderBy(desc(col))
							.limit(limit);
						const fetched = await Promise.all(
							rows.map(async (r) => {
								const u = await client.users.fetch(r.id).catch(() => null);
								if (!u) return null;
								return {
									id: r.id,
									username: u.username,
									avatarURL: u.displayAvatarURL({ size: 128, extension: "png", forceStatic: true }),
									xp: r.xp,
									zeni: r.zeni,
								} satisfies LeaderboardEntry;
							})
						);
						const entries = fetched.filter((e): e is LeaderboardEntry => e !== null);
						const lb = container.resolve(LeaderboardService);
						return await lb.render(entries, {
							title: metric === "zeni" ? "Classement zénis" : "Classement XP",
							subtitle: `Top ${entries.length} joueurs`,
							page: 1,
							totalPages: 1,
						});
					})
				),
				// ── Card themes CRUD (canvas profile) ─────────────────────────
				"/api/card-themes": {
					GET: admin(async () => {
						const dbs = container.resolve(DatabaseService);
						const { cardThemes } = await import("~/db/schema");
						const rows = await dbs.db.select().from(cardThemes);
						return Response.json({ rows });
					}),
					POST: admin(async (req) => {
						const body = (await req.json().catch(() => null)) as {
							id?: string;
							name?: string;
							accent?: string;
							aura?: string;
							bgGrad1?: string;
							bgGrad2?: string;
							bgGrad3?: string;
							bgFile?: string | null;
							textShadow?: string;
							overlayOpacity?: number;
							tintStrength?: number;
							gradientAngle?: number;
							enabled?: boolean;
						} | null;
						if (
							!body?.id ||
							!body?.name ||
							!body?.accent ||
							!body?.aura ||
							!body?.bgGrad1 ||
							!body?.bgGrad2 ||
							!body?.bgGrad3 ||
							!body?.textShadow
						) {
							return Response.json(
								{ error: "id/name/accent/aura/bgGrad1-3/textShadow requis" },
								{ status: 400 }
							);
						}
						try {
							const dbs = container.resolve(DatabaseService);
							const { cardThemes } = await import("~/db/schema");
							const { CardService } = await import("~/services/CardService");
							await dbs.db.insert(cardThemes).values({
								id: body.id,
								name: body.name,
								accent: body.accent,
								aura: body.aura,
								bgGrad1: body.bgGrad1,
								bgGrad2: body.bgGrad2,
								bgGrad3: body.bgGrad3,
								bgFile: body.bgFile ?? null,
								textShadow: body.textShadow,
								overlayOpacity:
									typeof body.overlayOpacity === "number" ? body.overlayOpacity : 0.78,
								tintStrength: typeof body.tintStrength === "number" ? body.tintStrength : 0.08,
								gradientAngle: typeof body.gradientAngle === "number" ? body.gradientAngle : 135,
								enabled: body.enabled ?? true,
							});
							container.resolve(CardService).invalidateThemes();
							return Response.json({ ok: true, id: body.id });
						} catch (err) {
							return Response.json(
								{ error: err instanceof Error ? err.message : "insert failed" },
								{ status: 400 }
							);
						}
					}),
				},
				"/api/card-themes/:id": {
					PUT: admin(async (req) => {
						const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
						if (!body) return Response.json({ error: "JSON body requis" }, { status: 400 });
						const dbs = container.resolve(DatabaseService);
						const { cardThemes } = await import("~/db/schema");
						const { CardService } = await import("~/services/CardService");
						const patch: Record<string, unknown> = {};
						for (const k of [
							"name",
							"accent",
							"aura",
							"bgGrad1",
							"bgGrad2",
							"bgGrad3",
							"textShadow",
						]) {
							if (typeof body[k] === "string") patch[k] = body[k];
						}
						if (typeof body.bgFile === "string" || body.bgFile === null) patch.bgFile = body.bgFile;
						if (typeof body.enabled === "boolean") patch.enabled = body.enabled;
						const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
						if (typeof body.overlayOpacity === "number")
							patch.overlayOpacity = clamp(body.overlayOpacity, 0, 1);
						if (typeof body.tintStrength === "number")
							patch.tintStrength = clamp(body.tintStrength, 0, 1);
						if (typeof body.gradientAngle === "number")
							patch.gradientAngle = clamp(Math.round(body.gradientAngle), 0, 360);
						await dbs.db.update(cardThemes).set(patch).where(eq(cardThemes.id, req.params.id));
						container.resolve(CardService).invalidateThemes();
						return Response.json({ ok: true });
					}),
					DELETE: admin(async (req) => {
						const dbs = container.resolve(DatabaseService);
						const { cardThemes } = await import("~/db/schema");
						const { CardService } = await import("~/services/CardService");
						await dbs.db.delete(cardThemes).where(eq(cardThemes.id, req.params.id));
						container.resolve(CardService).invalidateThemes();
						return Response.json({ ok: true });
					}),
				},

				"/api/canvas/list": admin(() =>
					Response.json({
						canvases: [
							{
								id: "profile",
								name: "Carte de profil",
								description:
									"Carte XP/zéni avec avatar, palier, barre de progression et thème (1000×360)",
								url: "/api/canvas/profile/:userId?theme=goku|vegeta|kaio|ssj|blue|rose|ultra|default",
								params: ["userId", "theme"],
							},
							{
								id: "scouter",
								name: "Scouter (gauge)",
								description: "Gauge style scouter pour /gay et /raciste (700×320)",
								url: "/api/canvas/scouter/:userId?type=gay|raciste&pct=50",
								params: ["userId", "type", "pct"],
							},
							{
								id: "scan",
								name: "Scanner de ki",
								description: "Lecture de ki d'un membre, basée sur l'XP en base",
								url: "/api/canvas/scan/:userId",
								params: ["userId"],
							},
							{
								id: "fusion",
								name: "Fusion",
								description: "Carte fusion dual-portrait (1100×500)",
								url: "/api/canvas/fusion?a=ID1&b=ID2&state=success&name=Gokuetto",
								params: ["a", "b", "state", "name"],
							},
							{
								id: "leaderboard",
								name: "Classement",
								description: "Podium top joueurs (1100×720)",
								url: "/api/canvas/leaderboard?metric=xp&limit=10",
								params: ["metric", "limit"],
							},
						],
					})
				),

				// ── Discord scan (channels, rôles, members) ───────────────────
				// Source live depuis le cache Discord du bot (pas de fichier scan).
				// Utilisé par le dashboard pour résoudre les IDs en noms.
				"/api/discord/channels": admin((req) =>
					cachedJson(
						req,
						async () => {
							const client = container.resolve(Client);
							const guild = client.guilds.cache.get(env.GUILD_ID);
							if (!guild) return { channels: [], count: 0 };
							const channels = [...guild.channels.cache.values()].map((c) => ({
								id: c.id,
								name: c.name,
								type: c.type,
								parentId: c.parentId,
								position: "position" in c ? c.position : 0,
							}));
							channels.sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
							return { channels, count: channels.length };
						},
						30_000
					)
				),
				"/api/discord/roles": admin((req) =>
					cachedJson(
						req,
						async () => {
							const client = container.resolve(Client);
							const guild = client.guilds.cache.get(env.GUILD_ID);
							if (!guild) return { roles: [], count: 0 };
							const roles = [...guild.roles.cache.values()]
								.filter((r) => r.name !== "@everyone")
								.map((r) => ({
									id: r.id,
									name: r.name,
									color: r.color,
									hoist: r.hoist,
									position: r.position,
									memberCount: r.members.size,
									managed: r.managed,
									// Rôle de boost serveur : `managed` mais porté par des humains →
									// les sélecteurs le gardent malgré `excludeManaged`.
									premiumSubscriber: r.tags?.premiumSubscriberRole === true,
								}));
							roles.sort((a, b) => b.position - a.position);
							return { roles, count: roles.length };
						},
						30_000
					)
				),
				"/api/discord/members": admin((req) =>
					cachedJson(
						req,
						async () => {
							const url = new URL(req.url);
							const limit = Math.min(100, Math.max(1, Number(url.searchParams.get("limit")) || 25));
							const search = (url.searchParams.get("search") ?? "").trim();

							// Le client par défaut (Shenron, intents=[Guilds]) n'a que ~2 membres
							// en cache → toute recherche renvoyait 0 résultat sur une guilde de
							// 6000+ membres. Seuls Kaïo et Grand Prêtre portent l'intent privilégié
							// GuildMembers (cf. personas.ts) → leur cache guild contient tous les
							// membres et permet la recherche server-side. On les préfère, puis on
							// retombe sur le client au plus gros cache de membres, enfin sur le
							// singleton (dégradation gracieuse, jamais de 500).
							const clientMap = container.resolve<Map<PersonaId, Client>>("ClientMap");
							let membersClient: Client | undefined;
							for (const id of ["kaio", "grandPretre"] as const) {
								const c = clientMap.get(id);
								if (c?.isReady() && c.guilds.cache.has(env.GUILD_ID)) {
									membersClient = c;
									break;
								}
							}
							if (!membersClient) {
								membersClient = [...clientMap.values()]
									.filter((c) => c.isReady() && c.guilds.cache.has(env.GUILD_ID))
									.toSorted(
										(a, b) =>
											(b.guilds.cache.get(env.GUILD_ID)?.members.cache.size ?? 0) -
											(a.guilds.cache.get(env.GUILD_ID)?.members.cache.size ?? 0)
									)[0];
							}
							const client = membersClient ?? container.resolve(Client);
							const guild = client.guilds.cache.get(env.GUILD_ID);
							if (!guild) return { members: [], count: 0, total: 0 };

							const toDto = (m: GuildMember) => ({
								id: m.id,
								username: m.user.username,
								displayName: m.displayName,
								avatar: m.user.displayAvatarURL({ size: 64 }),
								bot: m.user.bot,
								joinedAt: m.joinedTimestamp ? new Date(m.joinedTimestamp).toISOString() : null,
								roleIds: [...m.roles.cache.keys()],
							});

							let members: GuildMember[] = [];
							if (!search) {
								// Pas de recherche : liste depuis le cache (comportement historique).
								members = [...guild.members.cache.values()].slice(0, limit);
							} else if (/^\d{17,20}$/.test(search)) {
								// Snowflake : fetch REST par ID, repli cache.
								const m =
									(await guild.members.fetch(search).catch(() => null)) ??
									guild.members.cache.get(search) ??
									null;
								members = m ? [m] : [];
							} else {
								// Recherche texte : recherche server-side Discord (préfixe
								// username/nick), + repli substring sur le cache (dédupliqué par id)
								// pour faire remonter les correspondances non-préfixe déjà en cache.
								const fetched = await guild.members
									.fetch({ query: search, limit })
									.catch(() => null);
								const byId = new Map<string, GuildMember>();
								if (fetched) for (const m of fetched.values()) byId.set(m.id, m);
								const low = search.toLowerCase();
								for (const m of guild.members.cache.values()) {
									if (byId.size >= limit) break;
									if (byId.has(m.id)) continue;
									if (
										m.user.username.toLowerCase().includes(low) ||
										m.displayName.toLowerCase().includes(low) ||
										m.id.includes(search)
									) {
										byId.set(m.id, m);
									}
								}
								members = [...byId.values()].slice(0, limit);
							}

							return {
								members: members.map(toDto),
								count: members.length,
								total: guild.memberCount,
							};
						},
						60_000
					)
				),
				"/api/discord/scan": admin(async () => {
					const client = container.resolve(Client);
					const guild = client.guilds.cache.get(env.GUILD_ID);
					if (!guild) return Response.json({ error: "guild absente" }, { status: 404 });
					const channels = [...guild.channels.cache.values()].map((c) => ({
						id: c.id,
						name: c.name,
						type: c.type,
						parentId: c.parentId,
					}));
					const roles = [...guild.roles.cache.values()].map((r) => ({
						id: r.id,
						name: r.name,
						color: r.color,
						position: r.position,
					}));
					return Response.json({
						guild: {
							id: guild.id,
							name: guild.name,
							memberCount: guild.memberCount,
							iconUrl: guild.iconURL({ size: 256 }),
						},
						channels,
						channelCount: channels.length,
						roles,
						roleCount: roles.length,
						scannedAt: new Date().toISOString(),
					});
				}),

				// ── Templates de messages événementiels ───────────────────────
				"/api/messages": admin((req) =>
					cachedJson(
						req,
						async () => {
							const svc = container.resolve(MessageTemplateService);
							return { events: await svc.list() };
						},
						30_000
					)
				),
				"/api/messages/:event": {
					GET: admin(async (req) => {
						const svc = container.resolve(MessageTemplateService);
						const list = await svc.list();
						const found = list.find((e) => e.event === req.params.event);
						if (!found) return Response.json({ error: "Événement inconnu" }, { status: 404 });
						return Response.json(found);
					}),
					POST: admin(async (req) => {
						const svc = container.resolve(MessageTemplateService);
						const body = (await req.json().catch(() => null)) as {
							template?: string | null;
							channelKey?: string | null;
							enabled?: boolean;
						} | null;
						if (!body) return Response.json({ error: "JSON body requis" }, { status: 400 });
						try {
							await svc.upsert({
								event: req.params.event,
								template: body.template ?? null,
								channelKey: body.channelKey ?? null,
								enabled: body.enabled ?? true,
							});
							invalidateJsonCache("/api/messages");
							return Response.json({ ok: true });
						} catch (err) {
							return Response.json(
								{ error: err instanceof Error ? err.message : "erreur" },
								{ status: 400 }
							);
						}
					}),
					DELETE: admin(async (req) => {
						const svc = container.resolve(MessageTemplateService);
						await svc.reset(req.params.event);
						invalidateJsonCache("/api/messages");
						return Response.json({ ok: true });
					}),
				},
				"/api/messages/:event/preview": {
					POST: admin(async (req) => {
						const svc = container.resolve(MessageTemplateService);
						const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
						try {
							return Response.json(await svc.preview(req.params.event, body));
						} catch (err) {
							return Response.json(
								{ error: err instanceof Error ? err.message : "erreur" },
								{ status: 400 }
							);
						}
					}),
				},

				// ── Modération (page dédiée /moderation) ──────────────────────
				"/api/moderation/stats": admin(async () => {
					const mod = container.resolve(ModerationService);
					return Response.json(await mod.statsWindow());
				}),
				"/api/moderation/warns": admin(async (req) => {
					const url = new URL(req.url);
					const userId = url.searchParams.get("userId") ?? undefined;
					const mod = container.resolve(ModerationService);
					if (userId) {
						const rows = await mod.listActiveWarns(userId);
						return Response.json({ rows, total: rows.length });
					}
					const limit = Math.min(200, Number(url.searchParams.get("limit")) || 100);
					const offset = Math.max(0, Number(url.searchParams.get("offset")) || 0);
					return Response.json(await mod.listAllActiveWarns(limit, offset));
				}),
				"/api/moderation/warns/:id": {
					DELETE: admin(async (req) => {
						const id = Number(req.params.id);
						if (!Number.isFinite(id)) {
							return Response.json({ error: "id invalide" }, { status: 400 });
						}
						const mod = container.resolve(ModerationService);
						const ok = await mod.unwarnById(id);
						if (!ok)
							return Response.json({ error: "warn introuvable ou déjà inactif" }, { status: 404 });
						return Response.json({ ok: true });
					}),
				},
				"/api/moderation/warns/clear/:userId": {
					POST: admin(async (req) => {
						const userId = req.params.userId;
						const mod = container.resolve(ModerationService);
						const removed = await mod.clearWarns(userId, "dashboard");
						return Response.json({ ok: true, removed });
					}),
				},
				"/api/moderation/jails": admin(async (req) => {
					const url = new URL(req.url);
					const limit = Math.min(200, Number(url.searchParams.get("limit")) || 100);
					const offset = Math.max(0, Number(url.searchParams.get("offset")) || 0);
					const mod = container.resolve(ModerationService);
					return Response.json(await mod.listActiveJails(limit, offset));
				}),
				"/api/moderation/jails/:userId": {
					DELETE: admin(async (req) => {
						const userId = req.params.userId;
						const client = container.resolve(Client);
						const guild = client.guilds.cache.get(env.GUILD_ID);
						if (!guild) return Response.json({ error: "guild absente" }, { status: 503 });
						const mod = container.resolve(ModerationService);
						const ok = await mod.unjail(guild, userId, "dashboard", "unjail via dashboard");
						if (!ok)
							return Response.json({ error: "membre introuvable ou pas en jail" }, { status: 404 });
						return Response.json({ ok: true });
					}),
				},
				"/api/moderation/bans": admin(async (req) => {
					const url = new URL(req.url);
					const limit = Math.min(200, Number(url.searchParams.get("limit")) || 100);
					const offset = Math.max(0, Number(url.searchParams.get("offset")) || 0);
					const mod = container.resolve(ModerationService);
					return Response.json(await mod.listActiveBans(limit, offset));
				}),
				"/api/moderation/bans/:userId": {
					DELETE: admin(async (req) => {
						const userId = req.params.userId;
						const client = container.resolve(Client);
						const guild = client.guilds.cache.get(env.GUILD_ID);
						if (!guild) return Response.json({ error: "guild absente" }, { status: 503 });

						// Try to unban from Discord guild
						try {
							await guild.members.unban(userId, "unban via dashboard");
						} catch (err) {
							logger.warn(
								{ err, userId },
								"Failed to unban from Discord guild during dashboard unban"
							);
						}

						const mod = container.resolve(ModerationService);
						const ok = await mod.removeBan(userId, "dashboard", "unban via dashboard");
						if (!ok)
							return Response.json({ error: "ban introuvable ou déjà inactif" }, { status: 404 });
						return Response.json({ ok: true });
					}),
				},
				// ── Hiérarchie staff ──────────────────────────────────────────
				"/api/moderation/hierarchy": {
					GET: admin(async () => {
						const settings = container.resolve(SettingsService);
						const raw = (await settings.getRaw("moderation.hierarchy")) ?? "[]";
						let parsed: string[][] = [];
						try {
							const p = JSON.parse(raw);
							if (Array.isArray(p)) parsed = p as string[][];
						} catch {}
						return Response.json({ levels: parsed, raw });
					}),
					PUT: admin(async (req) => {
						const body = (await req.json().catch(() => null)) as { levels?: string[][] } | null;
						if (!body || !Array.isArray(body.levels)) {
							return Response.json(
								{ error: "Body attendu : { levels: string[][] }" },
								{ status: 400 }
							);
						}
						// Validation : chaque niveau = array de snowflakes
						for (const lvl of body.levels) {
							if (!Array.isArray(lvl)) {
								return Response.json(
									{ error: "Chaque niveau doit être un array." },
									{ status: 400 }
								);
							}
							for (const r of lvl) {
								if (typeof r !== "string" || !/^\d{17,20}$/.test(r)) {
									return Response.json({ error: `Snowflake invalide : ${r}` }, { status: 400 });
								}
							}
						}
						const settings = container.resolve(SettingsService);
						const value = JSON.stringify(body.levels);
						await settings.set("moderation.hierarchy", value);
						return Response.json({ ok: true, levels: body.levels });
					}),
				},

				// ── Tickets (list + close) ────────────────────────────────────
				"/api/tickets": admin(async (req) => {
					const url = new URL(req.url);
					const closed = url.searchParams.get("closed");
					const dbs = container.resolve(DatabaseService);
					const { tickets } = await import("~/db/schema");
					const { desc, eq } = await import("drizzle-orm");
					const where =
						closed === "true"
							? eq(tickets.closed, true)
							: closed === "false"
								? eq(tickets.closed, false)
								: undefined;
					const q = dbs.db.select().from(tickets).orderBy(desc(tickets.createdAt));
					const rows = where ? await q.where(where) : await q;
					return Response.json({ rows, total: rows.length });
				}),
				"/api/tickets/:channelId/close": {
					POST: admin(async (req) => {
						const channelId = req.params.channelId;
						const tsvc = container.resolve(TicketService);
						const ok = await tsvc.close(channelId, "dashboard");
						if (!ok) {
							return Response.json({ error: "ticket introuvable ou déjà fermé" }, { status: 404 });
						}
						return Response.json({ ok: true });
					}),
				},
				// Rejoue la config d'accès par rôle (tickets.access.<kind>.<roleId>) sur
				// tous les tickets déjà ouverts — utile après avoir ajouté un rôle modo
				// dans les Réglages pour qu'il voie aussi les tickets en cours.
				"/api/tickets/sync-access": {
					POST: admin(async () => {
						const client = container.resolve(Client);
						const guild = client.guilds.cache.get(env.GUILD_ID);
						if (!guild) return Response.json({ error: "guild introuvable" }, { status: 503 });
						const tsvc = container.resolve(TicketService);
						const result = await tsvc.syncOpenTicketsAccess(guild);
						return Response.json({ ok: true, ...result });
					}),
				},

				// ── Giveaways (page dédiée /giveaways) ────────────────────────
				"/api/giveaways": admin(async (req) => {
					const url = new URL(req.url);
					const ended = url.searchParams.get("ended");
					const dbs = container.resolve(DatabaseService);
					const { giveaways, giveawayEntries } = await import("~/db/schema");
					const { desc, eq, sql } = await import("drizzle-orm");
					const where =
						ended === "true"
							? eq(giveaways.ended, true)
							: ended === "false"
								? eq(giveaways.ended, false)
								: undefined;
					const q = dbs.db.select().from(giveaways).orderBy(desc(giveaways.endsAt));
					const rows = where ? await q.where(where) : await q;
					const counts = await dbs.db
						.select({ giveawayId: giveawayEntries.giveawayId, c: sql<number>`count(*)` })
						.from(giveawayEntries)
						.groupBy(giveawayEntries.giveawayId);
					const countMap = new Map(counts.map((r) => [r.giveawayId, Number(r.c)]));
					return Response.json({
						rows: rows.map((r) => ({ ...r, entries: countMap.get(r.id) ?? 0 })),
						total: rows.length,
					});
				}),
				"/api/giveaways/:id/end": {
					POST: admin(async (req) => {
						const id = Number(req.params.id);
						if (!Number.isFinite(id)) {
							return Response.json({ error: "id invalide" }, { status: 400 });
						}
						const dbs = container.resolve(DatabaseService);
						const { giveaways } = await import("~/db/schema");
						const { eq } = await import("drizzle-orm");
						// Avance la date de fin à maintenant — le ticker (1 min) tirera les
						// gagnants au prochain cycle. Solution la plus sûre : on délègue le
						// flow au GiveawayTicker plutôt que de dupliquer ici.
						const updated = await dbs.db
							.update(giveaways)
							.set({ endsAt: new Date() })
							.where(eq(giveaways.id, id))
							.returning();
						if (updated.length === 0) {
							return Response.json({ error: "giveaway introuvable" }, { status: 404 });
						}
						return Response.json({ ok: true, giveaway: updated[0] });
					}),
				},

				// ── Wiki (utilise WikiService — DragonBall content) ───────────
				"/api/wiki/stats": admin(async () => {
					const { WikiService } = await import("~/services/WikiService");
					const wiki = container.resolve(WikiService);
					return Response.json({
						counts: await wiki.count(),
						isSeeded: await wiki.isSeeded(),
					});
				}),

				// ── Économie (page dédiée /economy) ───────────────────────────
				"/api/economy/stats": admin(async () => {
					const dbs = container.resolve(DatabaseService);
					const {
						users: u,
						fusions: f,
						inventory: inv,
						shopItems: si,
					} = await import("~/db/schema");
					const { sql: dsql } = await import("drizzle-orm");
					const [agg] = await dbs.db
						.select({
							total: dsql<number>`coalesce(sum(${u.zeni}), 0)`,
							avg: dsql<number>`coalesce(avg(${u.zeni}), 0)`,
							max: dsql<number>`coalesce(max(${u.zeni}), 0)`,
							count: dsql<number>`count(*)`,
							rich: dsql<number>`sum(case when ${u.zeni} >= 10000 then 1 else 0 end)`,
							zero: dsql<number>`sum(case when ${u.zeni} = 0 then 1 else 0 end)`,
						})
						.from(u);
					const [fusionsCount] = await dbs.db.select({ c: dsql<number>`count(*)` }).from(f);
					const [invCount] = await dbs.db.select({ c: dsql<number>`count(*)` }).from(inv);
					const [shopCount] = await dbs.db
						.select({ c: dsql<number>`count(*) filter (where ${si.enabled} = 1)` })
						.from(si);
					return Response.json({
						zeni: {
							total: Number(agg?.total ?? 0),
							avg: Number(agg?.avg ?? 0),
							max: Number(agg?.max ?? 0),
							users: Number(agg?.count ?? 0),
							rich: Number(agg?.rich ?? 0),
							zero: Number(agg?.zero ?? 0),
						},
						fusions: Number(fusionsCount?.c ?? 0),
						inventoryItems: Number(invCount?.c ?? 0),
						shopItemsActive: Number(shopCount?.c ?? 0),
					});
				}),
				"/api/economy/leaderboard": admin(async (req) => {
					const url = new URL(req.url);
					const limit = Math.min(100, Number(url.searchParams.get("limit")) || 25);
					const offset = Math.max(0, Number(url.searchParams.get("offset")) || 0);
					const dbs = container.resolve(DatabaseService);
					const { users: u } = await import("~/db/schema");
					const rows = await dbs.db
						.select()
						.from(u)
						.orderBy(desc(u.zeni))
						.limit(limit)
						.offset(offset);
					return Response.json({ rows, total: rows.length });
				}),
				"/api/economy/transactions": admin(async (req) => {
					const url = new URL(req.url);
					const limit = Math.min(500, Number(url.searchParams.get("limit")) || 100);
					const offset = Math.max(0, Number(url.searchParams.get("offset")) || 0);
					const dbs = container.resolve(DatabaseService);
					const { actionLogs } = await import("~/db/schema");
					const { inArray } = await import("drizzle-orm");
					const rows = await dbs.db
						.select()
						.from(actionLogs)
						.where(
							inArray(actionLogs.action, [
								"SHOP_PURCHASE",
								"LEVEL_UP",
								"ZENI_ADMIN_GIVE",
								"ZENI_ADMIN_REMOVE",
								"ZENI_ADMIN_SET",
								"ZENI_ADMIN_BULK",
							])
						)
						.orderBy(desc(actionLogs.createdAt))
						.limit(limit)
						.offset(offset);
					return Response.json({ rows, total: rows.length });
				}),
				"/api/economy/give": {
					POST: admin(async (req) => {
						const body = (await req.json().catch(() => ({}))) as {
							mode?: "user" | "role" | "all";
							userId?: string;
							roleId?: string;
							amount?: number;
						};
						const amount = Number(body.amount);
						if (!Number.isFinite(amount) || amount === 0) {
							return Response.json({ error: "amount non nul requis" }, { status: 400 });
						}
						const eco = container.resolve(EconomyService);
						const dbs = container.resolve(DatabaseService);
						const { users: u, actionLogs } = await import("~/db/schema");

						if (body.mode === "user") {
							if (!body.userId) return Response.json({ error: "userId requis" }, { status: 400 });
							if (amount > 0) await eco.addZeni(body.userId, amount, { propagateFusion: false, source: "admin" });
							else {
								const ok = await eco.removeZeni(body.userId, -amount);
								if (!ok) return Response.json({ error: "solde insuffisant" }, { status: 400 });
							}
							await dbs.db.insert(actionLogs).values({
								userId: body.userId,
								action: amount > 0 ? "ZENI_ADMIN_GIVE" : "ZENI_ADMIN_REMOVE",
								meta: JSON.stringify({ amount, mode: "user", source: "dashboard" }),
							});
							return Response.json({ ok: true, applied: 1, amount });
						}

						if (body.mode === "role" || body.mode === "all") {
							const cli = container.resolve(Client);
							const guild = cli.guilds.cache.get(env.GUILD_ID);
							if (!guild) return Response.json({ error: "guild introuvable" }, { status: 500 });
							let targets: string[] = [];
							if (body.mode === "role") {
								if (!body.roleId) return Response.json({ error: "roleId requis" }, { status: 400 });
								await guild.members.fetch();
								targets = [...guild.members.cache.values()]
									.filter((m) => !m.user.bot && m.roles.cache.has(body.roleId!))
									.map((m) => m.id);
							} else {
								// all = tous les users en DB
								const all = await dbs.db.select({ id: u.id }).from(u);
								targets = all.map((r) => r.id);
							}
							let applied = 0;
							for (const id of targets) {
								if (amount > 0) {
									await eco.addZeni(id, amount, { propagateFusion: false, source: "admin" });
									applied++;
								} else {
									const ok = await eco.removeZeni(id, -amount);
									if (ok) applied++;
								}
							}
							await dbs.db.insert(actionLogs).values({
								action: "ZENI_ADMIN_BULK",
								meta: JSON.stringify({
									amount,
									mode: body.mode,
									roleId: body.roleId,
									targets: targets.length,
									applied,
									source: "dashboard",
								}),
							});
							return Response.json({ ok: true, applied, targeted: targets.length, amount });
						}

						return Response.json({ error: "mode invalide (user|role|all)" }, { status: 400 });
					}),
				},
				"/api/economy/set": {
					POST: admin(async (req) => {
						const body = (await req.json().catch(() => ({}))) as {
							userId?: string;
							amount?: number;
						};
						if (!body.userId) return Response.json({ error: "userId requis" }, { status: 400 });
						const amount = Number(body.amount);
						if (!Number.isFinite(amount) || amount < 0) {
							return Response.json({ error: "amount ≥ 0 requis" }, { status: 400 });
						}
						const eco = container.resolve(EconomyService);
						await eco.setZeni(body.userId, amount);
						const dbs = container.resolve(DatabaseService);
						const { actionLogs } = await import("~/db/schema");
						await dbs.db.insert(actionLogs).values({
							userId: body.userId,
							action: "ZENI_ADMIN_SET",
							meta: JSON.stringify({ amount, source: "dashboard" }),
						});
						return Response.json({ ok: true, amount });
					}),
				},

				// ── Audit logs internes (table action_logs) ───────────────────
				"/api/audit/logs": admin(async (req) => {
					const url = new URL(req.url);
					const limit = Math.min(500, Number(url.searchParams.get("limit")) || 100);
					const offset = Math.max(0, Number(url.searchParams.get("offset")) || 0);
					const action = url.searchParams.get("action") ?? undefined;
					const userId = url.searchParams.get("userId") ?? undefined;
					const dbs = container.resolve(DatabaseService);
					const { actionLogs } = await import("~/db/schema");
					const { desc, eq, and } = await import("drizzle-orm");
					const conds = [
						action ? eq(actionLogs.action, action) : undefined,
						userId ? eq(actionLogs.userId, userId) : undefined,
					].filter(Boolean) as ReturnType<typeof eq>[];
					const where =
						conds.length === 0 ? undefined : conds.length === 1 ? conds[0] : and(...conds);
					// Id tie-break: many rows share the same second-resolution createdAt,
					// so pagination must be stable across pages.
					const rows = await dbs.db
						.select()
						.from(actionLogs)
						.where(where)
						.orderBy(desc(actionLogs.createdAt), desc(actionLogs.id))
						.limit(limit)
						.offset(offset);
					// `total` is the filtered row count, not the page size: the admin audit
					// pages compute "page X of Y" from it.
					const [{ count = 0 } = { count: 0 }] = await dbs.db
						.select({ count: sql<number>`COUNT(*)` })
						.from(actionLogs)
						.where(where);
					return Response.json({ rows, total: Number(count), limit, offset });
				}),

				"/api/moderation/recent": admin(async (req) => {
					const url = new URL(req.url);
					const limit = Math.min(200, Number(url.searchParams.get("limit")) || 50);
					const filter = url.searchParams.get("actions")?.split(",").filter(Boolean);
					const mod = container.resolve(ModerationService);
					const rows = await mod.recentActions(limit, filter);
					return Response.json({ rows, total: rows.length });
				}),

				// ── Database (CRUD générique whitelist) ───────────────────────
				// Upload d'image wiki → écrit dans `assets/wiki/` (servi en self-host
				// via /assets/wiki/...). Retourne le path DB (`./assets/...`) que le
				// site convertit en URL CDN via assetUrl(). Admin, ou membre signé
				// (acting-user, S7) pour le seul périmètre `tierlists`.
				"/api/assets/upload": {
					POST: async (req) => {
						const uploadAuth = await authorizeAssetUpload(req);
						if (!uploadAuth.ok) return uploadAuth.response;
						let form: FormData;
						try {
							form = await req.formData();
						} catch {
							return Response.json({ error: "multipart/form-data requis" }, { status: 400 });
						}
						const file = form.get("file");
						if (!(file instanceof File)) {
							return Response.json({ error: "champ 'file' manquant" }, { status: 400 });
						}
						const MAX = 50 * 1024 * 1024;
						if (file.size > MAX) {
							return Response.json({ error: "Fichier trop lourd (max 50 Mo)" }, { status: 413 });
						}
						const extByType: Record<string, string> = {
							"image/png": ".png",
							"image/jpeg": ".jpg",
							"image/webp": ".webp",
							"image/gif": ".gif",
						};
						const ext = extByType[file.type];
						if (!ext) {
							return Response.json(
								{ error: "Type non supporté (png, jpg, webp, gif)" },
								{ status: 415 }
							);
						}
						// Sous-dossier optionnel (slug strict) → namespace distinct des
						// assets wiki curés (ex. `tierlists` pour les uploads membres).
						const subdirRaw = String(form.get("subdir") ?? "")
							.trim()
							.toLowerCase();
						const subdir = /^[a-z0-9-]{1,32}$/.test(subdirRaw) ? subdirRaw : "";
						// S7 : un membre signé (acting-user) ne téléverse que dans le
						// périmètre tierlist ; le Bearer admin garde tous les périmètres.
						const scopeDenied = assetUploadScopeDenied(uploadAuth, subdir);
						if (scopeDenied) return scopeDenied;
						const relDir = subdir ? `assets/wiki/${subdir}` : "assets/wiki";
						const writeDir = subdir ? `../site/public/wiki/${subdir}` : "../site/public/wiki";
						const name = `${crypto.randomUUID()}${ext}`;
						const rel = `${relDir}/${name}`;
						const writePath = `${writeDir}/${name}`;
						try {
							const { mkdir } = await import("node:fs/promises");
							await mkdir(writeDir, { recursive: true });
							await Bun.write(writePath, await file.arrayBuffer());
						} catch (err) {
							logger.error(
								{ err, writeDir, writePath, subdir, size: file.size, type: file.type },
								"wiki image upload write failed"
							);
							return Response.json(
								{ error: err instanceof Error ? err.message : "écriture échouée" },
								{ status: 500 }
							);
						}
						return Response.json({ path: `./${rel}`, url: `/${rel}` });
					},
				},
				// Upload d'une piste de sous-titres d'épisode (.vtt/.srt) → écrit dans
				// `assets/subtitles/db_episodes/<id>/<lang>.<ext>`. Le site sert/convertit
				// ensuite en WebVTT via /api/subtitles. Admin-only.
				"/api/assets/upload-subtitle": {
					POST: admin(async (req) => {
						let form: FormData;
						try {
							form = await req.formData();
						} catch {
							return Response.json({ error: "multipart/form-data requis" }, { status: 400 });
						}
						const file = form.get("file");
						const episodeId = String(form.get("episodeId") ?? "").trim();
						const lang = String(form.get("lang") ?? "")
							.trim()
							.toLowerCase();
						if (!(file instanceof File)) {
							return Response.json({ error: "champ 'file' manquant" }, { status: 400 });
						}
						if (!/^\d+$/.test(episodeId)) {
							return Response.json({ error: "episodeId invalide" }, { status: 400 });
						}
						if (!/^[a-z]{2,5}(-[a-z]{2,5})?$/.test(lang)) {
							return Response.json({ error: "lang invalide (ex. fr, en, fr-fr)" }, { status: 400 });
						}
						if (file.size > 2 * 1024 * 1024) {
							return Response.json({ error: "Fichier trop lourd (max 2 Mo)" }, { status: 413 });
						}
						const lower = file.name.toLowerCase();
						const ext = lower.endsWith(".vtt") ? ".vtt" : lower.endsWith(".srt") ? ".srt" : null;
						if (!ext) {
							return Response.json({ error: "Type non supporté (.vtt, .srt)" }, { status: 415 });
						}
						const dir = `assets/subtitles/db_episodes/${episodeId}`;
						const rel = `${dir}/${lang}${ext}`;
						try {
							const { mkdir } = await import("node:fs/promises");
							await mkdir(dir, { recursive: true });
							await Bun.write(rel, file);
						} catch (err) {
							return Response.json(
								{ error: err instanceof Error ? err.message : "écriture échouée" },
								{ status: 500 }
							);
						}
						return Response.json({ path: `./${rel}`, url: `/${rel}`, src: rel });
					}),
				},
				// Liste les images d'un dossier d'assets whitelisté (galerie admin :
				// banners utilisables comme fond de carte, visuels wiki, etc.).
				"/api/assets/list": admin(async (req) => {
					const ALLOWED = new Set([
						"banners",
						"backgrounds",
						"cards",
						"dbz",
						"ext",
						"sanctions",
						"wiki",
					]);
					const url = new URL(req.url);
					const dir = url.searchParams.get("dir") ?? "banners";
					if (!ALLOWED.has(dir)) {
						return Response.json(
							{ error: `dir non autorisé (autorisés: ${[...ALLOWED].join(", ")})` },
							{ status: 400 }
						);
					}
					const { Glob } = await import("bun");
					const glob = new Glob("**/*.{png,jpg,jpeg,webp,gif}");
					const files: { path: string; url: string; name: string }[] = [];
					try {
						const cwd = dir === "wiki" ? "../site/public/wiki" : `assets/${dir}`;
						for await (const f of glob.scan({
							cwd,
							onlyFiles: true,
						})) {
							const rel = dir === "wiki" ? `assets/wiki/${f}` : `assets/${dir}/${f}`;
							files.push({ path: rel, url: `/${rel}`, name: f });
							if (files.length >= 1000) break;
						}
					} catch {
						// dossier absent → liste vide
					}
					files.sort((a, b) => a.name.localeCompare(b.name));
					return Response.json({
						dir,
						dirs: [...ALLOWED],
						count: files.length,
						files,
					});
				}),
				"/api/database/tables": admin(() =>
					Response.json({
						tables: TABLES.map((t) => ({
							name: t.name,
							pk: t.pk,
							readonly: !!t.readonly,
							mutableColumns: t.mutableColumns ?? [],
							description: t.description ?? null,
						})),
					})
				),
				"/api/database/:table": {
					GET: admin(async (req) => {
						const spec = getTableSpec(req.params.table);
						if (!spec) return Response.json({ error: "Table inconnue" }, { status: 404 });
						const url = new URL(req.url);
						const limit = Math.min(500, Number(url.searchParams.get("limit")) || 50);
						const offset = Math.max(0, Number(url.searchParams.get("offset")) || 0);
						const result = await listRows(spec, limit, offset);
						return Response.json(result);
					}),
					POST: admin(async (req) => {
						const spec = getTableSpec(req.params.table);
						if (!spec) return Response.json({ error: "Table inconnue" }, { status: 404 });
						if (spec.name.startsWith("db_"))
							return Response.json(
								{ error: "Wiki en lecture seule côté bot — édition sur le site (Neon)." },
								{ status: 409 }
							);
						if (spec.readonly) return Response.json({ error: "Table readonly" }, { status: 403 });
						const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
						if (!body) return Response.json({ error: "JSON body requis" }, { status: 400 });
						try {
							if (spec.name === "guild_settings") {
								if (typeof body.key !== "string") throw new Error("key requis");
								await container.resolve(SettingsService).set(body.key, String(body.value ?? ""));
								return Response.json({ ok: true });
							}
							await insertRow(spec, body);
							if (spec.name.startsWith("db_")) invalidatePublicWikiCache();
							return Response.json({ ok: true });
						} catch (err) {
							return Response.json(
								{ error: err instanceof Error ? err.message : "erreur" },
								{ status: 400 }
							);
						}
					}),
				},
				"/api/database/:table/:id": {
					GET: admin(async (req) => {
						const spec = getTableSpec(req.params.table);
						if (!spec) return Response.json({ error: "Table inconnue" }, { status: 404 });
						const row = await getRow(spec, req.params.id);
						if (!row) return Response.json({ error: "Row introuvable" }, { status: 404 });
						return Response.json(row);
					}),
					PUT: admin(async (req) => {
						const spec = getTableSpec(req.params.table);
						if (!spec) return Response.json({ error: "Table inconnue" }, { status: 404 });
						if (spec.name.startsWith("db_"))
							return Response.json(
								{ error: "Wiki en lecture seule côté bot — édition sur le site (Neon)." },
								{ status: 409 }
							);
						const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
						if (!body) return Response.json({ error: "JSON body requis" }, { status: 400 });
						try {
							// `guild_settings` passe par SettingsService.set : l'éditeur générique
							// écrivait sans aucune validation, et c'est par là que des valeurs
							// hors plafond (xp.voice.per_minute = 5 000, boost booster ×25…)
							// ont pu entrer alors que /api/settings les refuse.
							if (spec.name === "guild_settings") {
								if (typeof body.value !== "string" && typeof body.value !== "number" && typeof body.value !== "boolean") {
									throw new Error("value requis");
								}
								await container.resolve(SettingsService).set(req.params.id, String(body.value));
								return Response.json({ ok: true });
							}
							await updateRow(spec, req.params.id, body);
							if (spec.name.startsWith("db_")) invalidatePublicWikiCache();
							return Response.json({ ok: true });
						} catch (err) {
							return Response.json(
								{ error: err instanceof Error ? err.message : "erreur" },
								{ status: 400 }
							);
						}
					}),
					DELETE: admin(async (req) => {
						const spec = getTableSpec(req.params.table);
						if (!spec) return Response.json({ error: "Table inconnue" }, { status: 404 });
						if (spec.name.startsWith("db_"))
							return Response.json(
								{ error: "Wiki en lecture seule côté bot — édition sur le site (Neon)." },
								{ status: 409 }
							);
						try {
							await deleteRow(spec, req.params.id);
							if (spec.name.startsWith("db_")) invalidatePublicWikiCache();
							return Response.json({ ok: true });
						} catch (err) {
							return Response.json(
								{ error: err instanceof Error ? err.message : "erreur" },
								{ status: 400 }
							);
						}
					}),
				},
			},

			async fetch(req, server) {
				const url = new URL(req.url);

				// GraphQL — API publique read-only du wiki (Pothos + yoga, GraphiQL),
				// limitée à 60/min/IP comme les autres routes publiques (S9).
				if (url.pathname === "/graphql" || url.pathname.startsWith("/graphql/")) {
					return shenronApi.graphql(req, server);
				}

				// OpenAPI 3.1 — spec de l'API publique REST + UI Scalar interactive.
				if (url.pathname === "/api/openapi.json") {
					return Response.json(openapiSpec, {
						headers: {
							"Cache-Control": "public, max-age=3600",
							...publicCorsHeaders(req),
						},
					});
				}
				if (url.pathname === "/api/docs" || url.pathname === "/api/docs/") {
					return new Response(scalarHtml, {
						headers: {
							"Content-Type": "text/html; charset=utf-8",
							"Cache-Control": "public, max-age=3600",
						},
					});
				}

				// Better Auth — intercepte /api/auth/* (sign-in, callback, signout, get-session).
				if (url.pathname.startsWith("/api/auth/")) {
					const baResponse = await handleBetterAuthRequest(req);
					if (baResponse) return baResponse;
				}

				// Sert tout chemin commençant par /assets/ depuis le dossier assets/.
				// Routes Map de Bun ne supporte pas les wildcards multi-segment, donc
				// on les capture ici dans le fallback.
				if (url.pathname.startsWith("/assets/")) {
					if (req.method === "OPTIONS") {
						return new Response(null, { status: 204, headers: publicCorsHeaders(req) });
					}
					return serveAsset(url.pathname, req);
				}

				// /db/* — sert les 617 assets DB (Phase 2 mirror) avec headers
				// d'attribution X-DB-Attribution + X-DB-License + X-DB-Source.
				if (url.pathname.startsWith("/db/")) {
					if (req.method === "OPTIONS") {
						return new Response(null, { status: 204, headers: publicCorsHeaders(req) });
					}
					// Les ingests ont peuplé `public/db/` avec DEUX conventions de nommage
					// incompatibles, et il faut servir les deux (mesuré le 2026-09-03) :
					//   · `dbofficial/` : 36 fichiers au nom japonais réel (« 310-サムネイル.jpg »).
					//     Le client encode toujours l'URL → sans décodage, 404 sur 12 médias.
					//   · d'anciens ingests ont enregistré la forme DÉJÀ ENCODÉE comme nom de
					//     fichier (« Pan_%28Artwork%29.png ») : les décoder donne « ( » et ne
					//     trouve plus rien.
					// On essaie donc le chemin décodé, puis on retombe sur le chemin brut.
					// Décoder sans ce repli répare 16 médias et en casse 15 : mesuré aussi.
					const cheminBrut = url.pathname.slice("/db/".length);
					let cheminDecode = cheminBrut;
					try {
						cheminDecode = decodeURIComponent(cheminBrut);
					} catch {
						// Séquence d'échappement invalide : on s'en tient au brut.
					}
					// Contrôle de traversée sur les DEUX formes : le tester avant décodage
					// laisserait passer un « %2e%2e » qui redeviendrait « .. » juste après.
					const refuse = (c: string) =>
						!c || c.includes("..") || c.startsWith("/") || c.includes("\0");
					if (refuse(cheminBrut) || refuse(cheminDecode)) {
						return new Response("Forbidden", { status: 403 });
					}
					const racineDb = `${process.cwd()}/public/db`;
					const relPath = (await Bun.file(`${racineDb}/${cheminDecode}`).exists())
						? cheminDecode
						: cheminBrut;
					// Content-Negotiation : si client supporte AVIF/WebP et qu'on a
					// la variante pré-générée, on la sert (10-60% plus léger).
					const accept = req.headers.get("accept") ?? "";
					const baseDir = racineDb;
					const ext = relPath.replace(/^.*\./, "").toLowerCase();
					const negotiable = ext === "png" || ext === "jpg" || ext === "jpeg";
					let servedPath = relPath;
					if (negotiable) {
						const stem = relPath.replace(/\.(png|jpe?g)$/i, "");
						if (accept.includes("image/avif")) {
							const avif = Bun.file(`${baseDir}/${stem}.avif`);
							if (await avif.exists()) servedPath = `${stem}.avif`;
						}
						if (servedPath === relPath && accept.includes("image/webp")) {
							const webp = Bun.file(`${baseDir}/${stem}.webp`);
							if (await webp.exists()) servedPath = `${stem}.webp`;
						}
					}
					const file = Bun.file(`${baseDir}/${servedPath}`);
					if (!(await file.exists())) {
						return new Response("Asset introuvable", { status: 404 });
					}
					// Lookup attribution metadata (best-effort, query peut faillir si la
					// table n'existe pas — la file existe quand même, on sert)
					let attribution = "";
					let licenseKey = "";
					let sourceId = "";
					try {
						const dbs = container.resolve(DatabaseService);
						const row = dbs.sqlite
							.query("SELECT attribution, license_key, source_id FROM db_assets WHERE path = ?")
							.get(relPath) as {
							attribution: string;
							license_key: string;
							source_id: string;
						} | null;
						if (row) {
							attribution = row.attribution ?? "";
							licenseKey = row.license_key ?? "";
							sourceId = row.source_id ?? "";
						}
					} catch {}
					// Headers HTTP n'acceptent que ISO-8859-1 ; on encode l'attribution
					// (souvent en UTF-8 avec ©, —, etc.) en utf-8 percent-encoded.
					const safe = (s: string) => encodeURIComponent(s).replace(/%20/g, " ");
					return new Response(file, {
						headers: {
							"Content-Type": file.type,
							"Cache-Control": "public, max-age=31536000, immutable",
							Vary: "Accept",
							...publicCorsHeaders(req),
							...(attribution ? { "X-DB-Attribution": safe(attribution) } : {}),
							...(licenseKey ? { "X-DB-License": licenseKey } : {}),
							...(sourceId ? { "X-DB-Source": sourceId } : {}),
							...(servedPath !== relPath
								? { "X-DB-Served-Variant": servedPath.replace(/.*\./, "") }
								: {}),
						},
					});
				}
				// B14 : routes additives @shenron/api (wiki PG, OpenAPI), après tout l'historique.
				if (shenronApi.handles(url.pathname)) {
					remoteAddresses.remember(req, server);
					return shenronApi.fetch(req);
				}
				return Response.json({ error: "Not found" }, { status: 404 });
			},

			error(error) {
				logger.error({ err: error }, "API error");
				return Response.json({ error: "Internal server error" }, { status: 500 });
			},
		});

		logger.info(
			{
				port: env.API_PORT,
				host: env.API_HOST,
				adminAuth: !!env.API_ADMIN_TOKEN,
				tables: TABLES.length,
				actions: SERVICE_ACTIONS.length,
			},
			`✓ API REST démarrée sur http://${env.API_HOST}:${env.API_PORT}`
		);

		// Diagnostic RAG (best-effort) : alerte explicite si l'index vectoriel est
		// vide (retrieval dégradé en BM25 seul), sinon c'était silencieux.
		logRagHealth(container.resolve(DatabaseService).sqlite);
	}

	get isRunning(): boolean {
		return this.server !== null;
	}

	get port(): number | null {
		return this.server?.port ?? null;
	}

	get pendingRequests(): number {
		return this.server?.pendingRequests ?? 0;
	}

	async stop(force = false): Promise<void> {
		if (!this.server) return;
		this.server.stop(force);
		this.server = null;
	}

	/**
	 * Arrête d'accepter de nouvelles connexions TCP et attend que toutes
	 * les requêtes HTTP en vol se terminent (ou jusqu'au timeout) avant de fermer.
	 */
	async drain(timeoutMs = 10_000): Promise<{ drained: boolean; pendingRequests: number }> {
		if (!this.server) return { drained: true, pendingRequests: 0 };
		const srv = this.server;
		logger.info(
			{ port: srv.port, pendingRequests: srv.pendingRequests },
			"ApiServer: draining in-flight requests..."
		);
		srv.stop(false); // Cesse d'écouter les nouvelles connexions, laisse filer les requêtes actives
		const start = Date.now();
		while (srv.pendingRequests > 0 && Date.now() - start < timeoutMs) {
			await Bun.sleep(20);
		}
		const drained = srv.pendingRequests === 0;
		if (!drained) {
			logger.warn(
				{ pendingRequests: srv.pendingRequests, timeoutMs },
				"ApiServer: drain timed out, forcing close"
			);
			srv.stop(true);
		} else {
			logger.info("ApiServer: all in-flight requests drained successfully");
		}
		this.server = null;
		return { drained, pendingRequests: drained ? 0 : srv.pendingRequests };
	}
}

/** Services réels derrière les routes d'écriture du cockpit IA du site. */
function iaCockpitDeps(): IaCockpitDeps {
	const dbs = container.resolve(DatabaseService);
	return {
		goals: container.resolve(AdminReportGoalService),
		training: container.resolve(TrainingService),
		setFeedbackStatus: async (id, status) =>
			(
				await dbs.db
					.update(ragTrainingFeedback)
					.set({ status })
					.where(eq(ragTrainingFeedback.id, id))
					.returning({ id: ragTrainingFeedback.id })
			).length > 0,
	};
}

/** Wrapper qui injecte checkAdmin avant le handler. */
function admin<R extends Request & { params: any }>(
	handler: (req: R) => Response | Promise<Response>
): (req: R) => Promise<Response> {
	return async (req) => {
		const err = await checkAdmin(req);
		if (err) return err;
		return handler(req);
	};
}

// ── Routes publiques : CORS allowlist + rate-limit 60 req/min/IP ─────────
const PUBLIC_CORS_ORIGIN_LIST: readonly string[] = buildPublicCorsOrigins(process.env);
const PUBLIC_CORS_ORIGINS = new Set(PUBLIC_CORS_ORIGIN_LIST);

const publicRateBuckets = new Map<string, { count: number; resetAt: number }>();

function publicCorsHeaders(req: Request): Record<string, string> {
	const origin = req.headers.get("origin") ?? "";
	const allow = PUBLIC_CORS_ORIGINS.has(origin) ? origin : (PUBLIC_CORS_ORIGIN_LIST[0] ?? "");

	return {
		"Access-Control-Allow-Origin": allow,
		"Access-Control-Allow-Methods": "GET, OPTIONS",
		"Access-Control-Allow-Headers": "Content-Type",
		"Access-Control-Max-Age": "600",
		Vary: "Origin",
	};
}

// `clientIp` (S3) vient de ./request-guards : x-real-ip, sinon DERNIER saut XFF.

/** S4 : 10 tentatives/min/IP sur `/auth/login`, comptées avant la comparaison du jeton. */
const adminLoginThrottle = createLoginThrottle({ limit: 10, windowMs: 60_000 });

/** `POST /auth/login` : jeton admin → cookie de session HMAC. */
export async function adminLogin(req: Request): Promise<Response> {
	if (!env.API_ADMIN_TOKEN) {
		return Response.json({ error: "API_ADMIN_TOKEN non configuré" }, { status: 503 });
	}
	const attempt = adminLoginThrottle.hit(clientIp(req));
	if (!attempt.allowed) {
		return Response.json(
			{ error: "Trop de tentatives, réessayez dans une minute." },
			{ status: 429, headers: { "Retry-After": String(attempt.retryAfterSeconds) } }
		);
	}
	const body = (await req.json().catch(() => null)) as { token?: string } | null;
	if (!body?.token || !constantTimeEqual(body.token, env.API_ADMIN_TOKEN)) {
		return Response.json({ error: "Token invalide" }, { status: 401 });
	}
	const session = await createSession();
	return new Response(JSON.stringify({ ok: true }), {
		status: 200,
		headers: {
			"Content-Type": "application/json",
			"Set-Cookie": buildSessionCookie(session),
		},
	});
}

function publicRateLimit(ip: string): boolean {
	return hitPublicBucket(publicRateBuckets, ip);
}

async function publicRoute(
	req: Request & { params: any },
	handler: () => Response | Promise<Response>
): Promise<Response> {
	const cors = publicCorsHeaders(req);
	if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
	if (req.method !== "GET") {
		return new Response("Method Not Allowed", { status: 405, headers: cors });
	}
	if (!publicRateLimit(clientIp(req))) {
		return new Response(JSON.stringify({ error: "Rate limit (60/min)" }), {
			status: 429,
			headers: { ...cors, "Content-Type": "application/json", "Retry-After": "60" },
		});
	}
	const res = await handler();
	const headers = new Headers(res.headers);
	for (const [k, v] of Object.entries(cors)) headers.set(k, v);
	return new Response(res.body, { status: res.status, headers });
}

// ── publicCachedJson : 2 niveaux de cache (mémoire + HTTP) ──────────────
// Le site Vercel (`dragonballfr.com`) fetch ces routes avec `next: { revalidate: 60 }` —
// le Cache-Control `public, s-maxage=…, stale-while-revalidate=…` permet à
// l'edge Vercel + au browser de mettre en cache. Le memo cache local (TTL
// court) absorbe les hits parallèles pendant le warming d'un déploiement
// Vercel. Combiné, ça transforme une page profil de "1 req SQLite + 1 REST
// Discord par hit" à "1 req par minute en stable state".
type PublicCacheEntry = { body: Uint8Array; etag: string; expiresAt: number };
const publicCache = new Map<string, PublicCacheEntry>();
const PUBLIC_CACHE_MAX = 256;

/**
 * Purge les entrées du cache public wiki (TTL 1 h) pour qu'une édition admin
 * d'une table `db_*` soit visible immédiatement sur le site, sans attendre
 * l'expiration ni un restart du bot. Appelé après chaque écriture CRUD sur
 * une table wiki (cf. routes `/api/database/:table`).
 */
function invalidatePublicWikiCache(): void {
	for (const key of publicCache.keys()) {
		if (key.startsWith("/api/public/wiki/")) publicCache.delete(key);
	}
}

function publicCacheKey(req: Request & { params: any }): string {
	const url = new URL(req.url);
	const params = [...url.searchParams.entries()].toSorted(([a], [b]) => a.localeCompare(b));
	return url.pathname + (params.length ? "?" + new URLSearchParams(params).toString() : "");
}

/**
 * `remoteAddress` (optionnel, adresse de socket `server.requestIP(req)`) : quand
 * il désigne un appel loopback direct (S3), la limite publique ne s'applique pas.
 * Sans lui, comportement historique : toute requête est limitée.
 */
export async function publicCachedJson(
	req: Request & { params: any },
	ttlMs: number,
	build: () => Promise<unknown>,
	remoteAddress?: string | null
): Promise<Response> {
	const cors = publicCorsHeaders(req);
	if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
	if (req.method !== "GET" && req.method !== "HEAD") {
		return new Response("Method Not Allowed", { status: 405, headers: cors });
	}
	if (!isDirectLoopback(req, remoteAddress) && !publicRateLimit(clientIp(req))) {
		return new Response(JSON.stringify({ error: "Rate limit (60/min)" }), {
			status: 429,
			headers: { ...cors, "Content-Type": "application/json", "Retry-After": "60" },
		});
	}

	const key = publicCacheKey(req);
	const now = Date.now();
	let entry = ttlMs > 0 ? publicCache.get(key) : undefined;
	if (entry && entry.expiresAt < now) {
		publicCache.delete(key);
		entry = undefined;
	}
	if (entry) {
		// LRU: re-insert pour marquer comme récent
		publicCache.delete(key);
		publicCache.set(key, entry);
	}

	if (!entry) {
		try {
			const data = await build();
			const json = JSON.stringify(data);
			const bytes = new TextEncoder().encode(json);
			const etag = etagOf(bytes);
			entry = { body: bytes, etag, expiresAt: now + ttlMs };
			if (ttlMs > 0 && publicCache.size >= PUBLIC_CACHE_MAX) {
				const oldest = publicCache.keys().next().value;
				if (oldest) publicCache.delete(oldest);
			}
			if (ttlMs > 0) publicCache.set(key, entry);
		} catch (err) {
			if (err instanceof HttpError) {
				return new Response(JSON.stringify({ error: err.message }), {
					status: err.status,
					headers: { ...cors, "Content-Type": "application/json" },
				});
			}
			logger.error({ err, route: key }, "publicCachedJson build failed");
			return new Response(JSON.stringify({ error: "internal" }), {
				status: 500,
				headers: { ...cors, "Content-Type": "application/json" },
			});
		}
	}

	const seconds = Math.max(1, Math.floor(ttlMs / 1000));
	const cacheControl = ttlMs > 0
		? `public, max-age=${seconds}, s-maxage=${seconds * 2}, stale-while-revalidate=${seconds * 4}`
		: "no-store";
	const headers: Record<string, string> = {
		...cors,
		"Content-Type": "application/json; charset=utf-8",
		"Cache-Control": cacheControl,
		ETag: entry.etag,
	};
	const ifNoneMatch = req.headers.get("if-none-match");
	if (ifNoneMatch && ifNoneMatch === entry.etag) {
		return new Response(null, { status: 304, headers });
	}
	const body = req.method === "HEAD" ? null : (entry.body as unknown as BodyInit);
	return new Response(body, { status: 200, headers });
}

/** Invalide les entrées du cache public dont la clé commence par `prefix`. */
function invalidatePublicCache(prefix: string): number {
	let n = 0;
	for (const k of Array.from(publicCache.keys())) {
		if (k.startsWith(prefix)) {
			publicCache.delete(k);
			n++;
		}
	}
	return n;
}

// ── Profils Discord (username + avatar hash) ─────────────────────────
// `fetchDiscordUserCached` vit dans `~/lib/discord-profiles` : cache mémoire
// 5 min partagé par les routes publiques, cache membres du Gateway en priorité,
// profil persisté (`discord_user_profiles`, tenu à jour par les événements
// userUpdate/guildMemberUpdate) puis REST forcé borné à 2,5 s.

/** Construit l'URL avatar via `userAvatar` (hash) ou `defaultAvatar` (fallback). */
function discordAvatarUrl(
	id: string,
	hash: string | null,
	size: 64 | 128 | 256 | 512 = 512
): string {
	return hash ? userAvatar(id, hash, { size }) : defaultAvatar(id);
}

/**
 * map() avec **concurrence bornée + deadline globale**. Au-delà du budget temps,
 * les items restants prennent `fallback` (pas de REST) → garantit une réponse
 * rapide même cache froid (ex. enrich leaderboard : 100 fetch Discord bornés).
 */
async function mapLimitDeadline<T, R>(
	items: T[],
	limit: number,
	deadlineMs: number,
	fn: (item: T, idx: number) => Promise<R>,
	fallback: (item: T, idx: number) => R
): Promise<R[]> {
	const results = Array.from({ length: items.length }) as R[];
	const deadline = Date.now() + deadlineMs;
	let next = 0;
	async function worker() {
		while (next < items.length) {
			const i = next++;
			if (Date.now() > deadline) {
				results[i] = fallback(items[i], i);
				continue;
			}
			try {
				results[i] = await fn(items[i], i);
			} catch {
				results[i] = fallback(items[i], i);
			}
		}
	}
	await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
	return results;
}

// ── A2A bridge ────────────────────────────────────────────────────────────
// Le bot n'implémente plus A2A : tout est relayé vers le serveur Rust
// `aphrody a2a serve` (APHRODY_A2A_URL, défaut http://127.0.0.1:8788), comme
// le site (`apps/shenron/site/src/lib/a2a-hub.ts`). Voir ./a2a-proxy.ts.

const A2A_CORS = { "Access-Control-Allow-Origin": "*" } as const;

function a2aRpcError(id: unknown, code: number, message: string): Response {
	return Response.json({ jsonrpc: "2.0", id, error: { code, message } });
}

function a2aReply(reply: UpstreamReply, headers: Record<string, string> = A2A_CORS): Response {
	return Response.json(reply.body, { status: reply.status, headers });
}

function a2aStreamResponse(res: Response | UpstreamReply): Response {
	if (!(res instanceof Response)) return a2aReply(res);
	const contentType = res.headers.get("content-type") ?? "application/json";
	return new Response(res.body, {
		status: res.status,
		headers: {
			"Content-Type": contentType,
			"Cache-Control": "no-cache, no-transform",
			...A2A_CORS,
		},
	});
}

/** Agent card relayée depuis le serveur Rust (CORS public, cache 5 min côté client). */
export async function a2aAgentCard(req: Request): Promise<Response> {
	const cors = publicCorsHeaders(req);
	if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
	if (req.method !== "GET" && req.method !== "HEAD") {
		return new Response("Method Not Allowed", { status: 405, headers: cors });
	}
	const reply = await fetchAgentCard();
	const headers: Record<string, string> = { ...cors };
	if (reply.status === 200) headers["Cache-Control"] = "public, max-age=300";
	return a2aReply(reply, headers);
}

export async function a2aJsonRpc(req: Request): Promise<Response> {
	if (req.method === "OPTIONS") {
		return new Response(null, {
			status: 204,
			headers: {
				"Access-Control-Allow-Origin": "*",
				"Access-Control-Allow-Methods": "POST, OPTIONS",
				"Access-Control-Allow-Headers": "Content-Type, Authorization",
			},
		});
	}
	if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405 });

	let body: any;
	try {
		body = await req.json();
	} catch {
		return a2aRpcError(null, -32700, "Parse error");
	}
	const { id = null, method, params } = body ?? {};
	if (!method) return a2aRpcError(id, -32600, "Invalid Request");

	// S5 (D14) : écritures gardées par SHENRON_A2A_ENFORCE ; drapeau inactif =
	// comportement inchangé + un avertissement par processus.
	if (A2A_WRITE_METHODS.has(method)) {
		const denied = a2aWriteGuard(req, Bun.env, (message) => logger.warn(message));
		if (denied) return denied;
	}

	if (method === "message/send" && !params?.message?.parts?.length) {
		return a2aRpcError(id, -32602, "params.message.parts required");
	}
	if (method === "tasks/update") {
		return a2aRpcError(
			id,
			-32601,
			"Method not found: tasks/update has no A2A 1.0 equivalent on the aphrody a2a server"
		);
	}

	try {
		if (STREAMING_METHODS.has(method)) return a2aStreamResponse(await postJsonRpcStream(body));
		return a2aReply(await postJsonRpc(body));
	} catch (err) {
		logger.error({ err }, "a2a/jsonrpc proxy failed");
		return a2aRpcError(id, -32000, (err as Error).message ?? "Internal error");
	}
}

export async function a2aEventsStream(req: Request): Promise<Response> {
	if (req.method === "OPTIONS") {
		return new Response(null, {
			status: 204,
			headers: {
				"Access-Control-Allow-Origin": "*",
				"Access-Control-Allow-Methods": "GET, OPTIONS",
			},
		});
	}
	return a2aStreamResponse(await fetchCoordStream());
}

/**
 * Variante publique de `cachedImage` : CORS allowlist + rate-limit 60/min/IP
 * + Cache-Control `public` (au lieu de `private`) pour activer le CDN Vercel.
 * Réutilise le LRU cache buffer et le 304 d'ETag de `cachedImage` derrière.
 */
async function publicCachedImage(
	req: Request & { params: any },
	render: () => Promise<Buffer | Uint8Array>,
	cacheSeconds = 3600
): Promise<Response> {
	const cors = publicCorsHeaders(req);
	if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
	if (req.method !== "GET" && req.method !== "HEAD") {
		return new Response("Method Not Allowed", { status: 405, headers: cors });
	}
	if (!publicRateLimit(clientIp(req))) {
		return new Response(JSON.stringify({ error: "Rate limit (60/min)" }), {
			status: 429,
			headers: { ...cors, "Content-Type": "application/json", "Retry-After": "60" },
		});
	}
	const res = await cachedImage(req, render, cacheSeconds);
	const headers = new Headers(res.headers);
	for (const [k, v] of Object.entries(cors)) headers.set(k, v);
	// Override le Cache-Control : `cachedImage` met `public, max-age=, must-revalidate`
	// qui n'autorise pas Vercel/CDN à servir stale. Ici on veut `s-maxage` + `swr`.
	headers.set(
		"Cache-Control",
		`public, max-age=${cacheSeconds}, s-maxage=${cacheSeconds * 2}, stale-while-revalidate=${cacheSeconds * 4}`
	);
	return new Response(res.body, { status: res.status, headers });
}

/**
 * Aplatit une slash command + ses sous-groupes / sous-commandes en feuilles
 * exécutables (le format que l'utilisateur tape : `admin reload`, `economy give`).
 *
 * Types Discord :
 *   1 = SUB_COMMAND
 *   2 = SUB_COMMAND_GROUP
 */
function expandCommandLeaves(
	cmd: any,
	out: { name: string; description: string; group: string }[],
	prefix = ""
) {
	const root = prefix || cmd.name;
	const group = (prefix.split(" ")[0] ?? cmd.name) as string;
	const opts = cmd.options ?? [];
	const subs = opts.filter((o: any) => o.type === 1 || o.type === 2);
	if (subs.length === 0) {
		out.push({
			name: prefix || cmd.name,
			description: cmd.description ?? "",
			group: prefix ? group : cmd.name,
		});
		return;
	}
	for (const sub of subs) {
		if (sub.type === 1) {
			out.push({
				name: `${root} ${sub.name}`,
				description: sub.description ?? "",
				group: prefix ? group : cmd.name,
			});
		} else if (sub.type === 2) {
			expandCommandLeaves(sub, out, `${root} ${sub.name}`);
		}
	}
}

function serializeCommand(cmd: any) {
	return {
		name: cmd.name,
		description: cmd.description,
		type: cmd.type,
		guildId: cmd.guildId ?? null,
		nsfw: cmd.nsfw ?? false,
		options: (cmd.options ?? []).map((o: any) => ({
			name: o.name,
			description: o.description,
			type: o.type,
			required: o.required ?? false,
			choices: o.choices ?? undefined,
		})),
	};
}

function buildOpenApiSpec(port: number) {
	return {
		openapi: "3.0.1",
		info: {
			title: "shenron API",
			version: "0.1.0",
			description: "API REST tscord-compatible pour dashboard. Full read/write sur la DB.",
		},
		servers: [{ url: `http://127.0.0.1:${port}` }],
		paths: {
			"/api/health/check": { get: { summary: "Health public" } },
			"/api/health/latency": { get: { summary: "WS + DB latency" } },
			"/api/health/monitoring": { get: { summary: "Full monitoring", security: [{ bearer: [] }] } },
			"/api/stats/totals": { get: { summary: "Totaux", security: [{ bearer: [] }] } },
			"/api/bot/guilds": { get: { summary: "Guilds", security: [{ bearer: [] }] } },
			"/api/bot/commands": { get: { summary: "Slash commands", security: [{ bearer: [] }] } },
			"/api/cron": { get: { summary: "Cron jobs", security: [{ bearer: [] }] } },
			"/cron/{name}/trigger": { post: { summary: "Trigger cron", security: [{ bearer: [] }] } },
			"/api/admin/goals": { post: { summary: "Create session goal (site IA cockpit)", security: [{ bearer: [] }] } },
			"/api/admin/goals/{id}/complete": { post: { summary: "Complete session goal", security: [{ bearer: [] }] } },
			"/api/training/feedback/{id}/status": { post: { summary: "Set RAG feedback status", security: [{ bearer: [] }] } },
			"/api/training/gold": { post: { summary: "Add RAG gold case", security: [{ bearer: [] }] } },
			"/api/training/eval": { post: { summary: "Run and record RAG gold evaluation", security: [{ bearer: [] }] } },
			"/api/services": { get: { summary: "Service actions", security: [{ bearer: [] }] } },
			"/services/{service}/{action}": {
				post: { summary: "Run action", security: [{ bearer: [] }] },
			},
			"/api/database/tables": { get: { summary: "List tables", security: [{ bearer: [] }] } },
			"/database/{table}": {
				get: { summary: "List rows", security: [{ bearer: [] }] },
				post: { summary: "Insert row", security: [{ bearer: [] }] },
			},
			"/database/{table}/{id}": {
				get: { summary: "Get row", security: [{ bearer: [] }] },
				put: { summary: "Update row", security: [{ bearer: [] }] },
				delete: { summary: "Delete row", security: [{ bearer: [] }] },
			},
		},
		components: { securitySchemes: { bearer: { type: "http", scheme: "bearer" } } },
	};
}
