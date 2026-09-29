/**
 * semantic-cache.ts — Cache sémantique intelligent basé sur Redis.
 *
 * Utilise les embeddings d'Aphrody (ou du sidecar avant bascule) pour comparer les nouvelles questions
 * aux questions déjà répondues. Si une similarité sémantique élevée (cosinus >= 0.92)
 * est trouvée, retourne la réponse du cache en moins de 5ms, économisant des appels API.
 *
 * Clients construits paresseusement (B3) : aucune URL n'est lue à l'import.
 * Redis résilient (B8). Chemin Aphrody via la façade de calcul (B18 : lots de
 * 16, 384 dimensions vérifiées, espaces réduits). Espace de noms `v3` (B7) :
 * la portée inclut désormais `PROMPT_VERSION`.
 */
import { createHash } from "node:crypto";
import { AphrodyComputeClient } from "@shenron/pipeline/aphrody";
import { createResilientRedis, type ResilientRedis } from "@shenron/db/redis";
import { embedQueryVector } from "./rag";
import { resolveRedisUrl } from "@shenron/config/services";

/** Commandes Redis utilisées par le cache (même forme que le client `redis` de Bun). */
export interface SemanticCacheStore {
	get(key: string): Promise<string | null>;
	set(key: string, value: string, mode: "EX", seconds: number): Promise<unknown>;
	zadd(key: string, score: number, member: string): Promise<unknown>;
	zrange(key: string, start: number, stop: number): Promise<string[]>;
	zcard(key: string): Promise<number>;
	zrem(key: string, member: string): Promise<unknown>;
	del(key: string): Promise<unknown>;
	hincrby(key: string, field: string, increment: number): Promise<unknown>;
}

/** Adapte un client Redis résilient (`send`) à {@link SemanticCacheStore}. */
export function resilientSemanticCacheStore(r: Pick<ResilientRedis, "send">): SemanticCacheStore {
	const s = (command: string, ...args: (string | number)[]) => r.send(command, args.map(String));
	return {
		get: async (key) => {
			const v = await s("GET", key);
			return v === null || v === undefined ? null : String(v);
		},
		set: (key, value, mode, seconds) => s("SET", key, value, mode, seconds),
		zadd: (key, score, member) => s("ZADD", key, score, member),
		zrange: async (key, start, stop) => {
			const v = await s("ZRANGE", key, start, stop);
			return Array.isArray(v) ? v.map(String) : [];
		},
		zcard: async (key) => Number(await s("ZCARD", key)),
		zrem: (key, member) => s("ZREM", key, member),
		del: (key) => s("DEL", key),
		hincrby: (key, field, increment) => s("HINCRBY", key, field, increment),
	};
}

let defaultStore: SemanticCacheStore | undefined;
function redisStore(): SemanticCacheStore {
	defaultStore ??= resilientSemanticCacheStore(
		createResilientRedis({
			// Même résolution que le client `redis` par défaut de Bun.
			url: resolveRedisUrl(process.env),
			name: "semantic-cache",
		})
	);
	return defaultStore;
}

const EMBED_TIMEOUT_MS = Number(process.env.EMBED_TIMEOUT_MS ?? 3000);
// Seuil élevé : à 0.90 des entités différentes se télescopaient (Krillin -> réponse Goku).
const CACHE_SIMILARITY_THRESHOLD = Number(process.env.SEMANTIC_CACHE_THRESHOLD ?? 0.97);
const MAX_CACHE_SIZE = 500; // LRU de 500 entrées par persona
const CACHE_TTL_SECONDS = 30 * 24 * 60; // 12 heures (Redis SET EX accepte les secondes)

function md5(text: string): string {
	return createHash("md5").update(text.toLowerCase().trim()).digest("hex");
}

function cosineSimilarity(a: Float32Array | number[], b: Float32Array | number[]): number {
	if (a.length !== b.length) return -1;
	let dot = 0;
	let normA = 0;
	let normB = 0;
	const len = a.length;
	for (let i = 0; i < len; i++) {
		dot += a[i] * b[i];
		normA += a[i] * a[i];
		normB += b[i] * b[i];
	}
	if (normA === 0 || normB === 0) return 0;
	return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

function cachePrefix(persona: string): string {
	const backendPrefix = process.env.RAG_BACKEND === "aphrody"
		? `dbz:scache:aphrody:${persona}`
		: `dbz:scache:${persona}`;
	// B7: the scope now binds PROMPT_VERSION; v3 kept v2 answers (older prompts) out.
	// v4 drops the answers cached before the Gemini Web restart-draft fix
	// (aphrody-gemini-web `strip_restarted_drafts`): some began with a cut, duplicated
	// opening ("…bien fascinOh oh ! …"). Older keys expire with their TTL.
	return `${backendPrefix}:v4`;
}

/** Embed la question via le backend RAG sélectionné. */
async function getQueryEmbedding(query: string): Promise<Float32Array | null> {
	try {
		if (process.env.RAG_BACKEND === "aphrody") {
			const vectors = await new AphrodyComputeClient().embed([query]);
			return Float32Array.from(vectors[0]!);
		}
		const v = await embedQueryVector(query, EMBED_TIMEOUT_MS);
		return v ? Float32Array.from(v) : null;
	} catch (err) {
		console.error("[SEMANTIC CACHE] Échec de l'embedding de la question :", err);
		return null;
	}
}

export interface SemanticCacheHit {
	answer: string;
	originalQuery: string;
	similarity: number;
}

export interface SemanticCacheDependencies {
	store?: SemanticCacheStore;
	embed?: (query: string) => Promise<Float32Array | null>;
}

/**
 * Tente de récupérer une réponse sémantiquement similaire du cache.
 */
export async function getSemanticCache(
	query: string,
	persona: string,
	contextScope: string,
	dependencies: SemanticCacheDependencies = {}
): Promise<SemanticCacheHit | null> {
	const t0 = performance.now();
	const store = dependencies.store ?? redisStore();

	// 1. Embed la requête
	const qv = await (dependencies.embed ?? getQueryEmbedding)(query);
	if (!qv) return null;

	const prefix = cachePrefix(persona);
	const lruKey = `${prefix}:lru`;

	try {
		// One bounded LRU per persona; only entries with the same prompt evidence qualify.
		const hashes = (await store.zrange(lruKey, -MAX_CACHE_SIZE, -1))
			?.filter((hash) => hash.startsWith(`${contextScope}:`));
		if (!hashes || hashes.length === 0) {
			await store.hincrby("dbz:scache:stats", "misses", 1);
			return null;
		}

		// 3. Récupérer les vecteurs et les requêtes correspondants en parallèle
		const promises: Promise<string | null>[] = [];
		for (const hash of hashes) {
			promises.push(store.get(`${prefix}:${hash}:vector`));
			promises.push(store.get(`${prefix}:${hash}:query`));
		}
		const results = await Promise.all(promises);

		let bestSimilarity = -1;
		let bestHash: string | null = null;
		let bestQuery = "";

		// 4. Calculer la similarité cosinus locale
		for (let i = 0; i < hashes.length; i++) {
			const vectorStr = results[i * 2];
			const cachedQuery = results[i * 2 + 1];

			if (!vectorStr || !cachedQuery) continue;

			try {
				const cachedVector = JSON.parse(vectorStr) as number[];
				const sim = cosineSimilarity(qv, cachedVector);
				if (sim > bestSimilarity) {
					bestSimilarity = sim;
					bestHash = hashes[i];
					bestQuery = cachedQuery;
				}
			} catch (e) {
				// Ignorer les vecteurs corrompus
			}
		}

		// 5. Vérifier le seuil
		if (bestHash && bestSimilarity >= CACHE_SIMILARITY_THRESHOLD) {
			const answer = await store.get(`${prefix}:${bestHash}:answer`);
			if (answer) {
				// Mettre à jour LRU et stats
				await Promise.all([
					store.zadd(lruKey, Date.now(), bestHash),
					store.hincrby("dbz:scache:stats", "hits", 1),
				]);

				const latency = performance.now() - t0;
				console.log(
					`[SEMANTIC CACHE HIT] Persona=${persona}, Sim=${bestSimilarity.toFixed(4)}, Latency=${latency.toFixed(2)}ms`
				);

				return {
					answer,
					originalQuery: bestQuery,
					similarity: bestSimilarity,
				};
			}
		}

		// Cache miss
		await store.hincrby("dbz:scache:stats", "misses", 1);
		return null;
	} catch (err) {
		console.error("[SEMANTIC CACHE] Erreur lors de la lecture du cache :", err);
		return null;
	}
}

/**
 * Enregistre une réponse dans le cache sémantique.
 */
export async function setSemanticCache(
	query: string,
	answer: string,
	persona: string,
	contextScope: string,
	dependencies: SemanticCacheDependencies = {}
): Promise<void> {
	if (!answer || answer.trim().length === 0) return;
	const store = dependencies.store ?? redisStore();

	try {
		// 1. Embed la requête
		const qv = await (dependencies.embed ?? getQueryEmbedding)(query);
		if (!qv) return;

		const hash = `${contextScope}:${md5(query)}`;
		const prefix = cachePrefix(persona);
		const lruKey = `${prefix}:lru`;
		const now = Date.now();

		// 2. Écrire dans Redis en parallèle avec TTL
		await Promise.all([
			store.set(`${prefix}:${hash}:query`, query, "EX", CACHE_TTL_SECONDS),
			store.set(`${prefix}:${hash}:answer`, answer, "EX", CACHE_TTL_SECONDS),
			store.set(
				`${prefix}:${hash}:vector`,
				JSON.stringify(Array.from(qv)),
				"EX",
				CACHE_TTL_SECONDS
			),
			store.zadd(lruKey, now, hash),
		]);

		// 3. Purger les anciens éléments s'il y en a trop
		const totalCached = await store.zcard(lruKey);
		if (totalCached > MAX_CACHE_SIZE) {
			// Récupérer les plus anciens à supprimer
			const toRemove = await store.zrange(lruKey, 0, totalCached - MAX_CACHE_SIZE - 1);
			if (toRemove && toRemove.length > 0) {
				const cleanupPromises: Promise<any>[] = [];
				for (const h of toRemove) {
					cleanupPromises.push(store.del(`${prefix}:${h}:query`));
					cleanupPromises.push(store.del(`${prefix}:${h}:answer`));
					cleanupPromises.push(store.del(`${prefix}:${h}:vector`));
					cleanupPromises.push(store.zrem(lruKey, h));
				}
				await Promise.all(cleanupPromises);
				console.log(`[SEMANTIC CACHE PURGE] Supprimé ${toRemove.length} éléments obsolètes.`);
			}
		}
	} catch (err) {
		console.error("[SEMANTIC CACHE] Erreur lors de l'écriture dans le cache :", err);
	}
}
