/**
 * rag.ts — Retrieval Dragon Ball. `RAG_BACKEND=aphrody` delegates search and
 * passage retrieval to Aphrody; the legacy local index remains available
 * until corpus quality and deployment are validated.
 *
 * Fusionne deux signaux :
 *   1. Lexical  — FTS5 BM25 sur `rag_chunks` (exact-match, noms propres, rapide).
 *   2. Sémantique — cosinus exact (brute-force) sur `rag_vectors` (paraphrases,
 *      questions naturelles), via embeddings denses servis par Aphrody
 *      (`POST /api/v1/shenron/embed`).
 *
 * Fusion par Reciprocal Rank Fusion (RRF, k=60) — robuste, sans calibration de
 * scores hétérogènes. Dégradation gracieuse : si Aphrody est indisponible ou non
 * configuré, ou les vecteurs absents, on retombe sur BM25 seul (l'endpoint reste
 * fonctionnel).
 *
 * Ce module n'importe PAS transformers.js — il ne fait qu'un fetch HTTP local
 * vers Aphrody (`APHRODY_AI_HTTP_URL`, jeton `APHRODY_AI_HTTP_TOKEN`).
 */
import type { Database } from "bun:sqlite";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as sqliteVec from "sqlite-vec";
import { AphrodyComputeClient } from "@shenron/pipeline/aphrody";
import { aphrodyNative, isNativeAvailable } from "@shenron/pipeline/aphrody/native";
import {
	DEFAULT_AI_TIMEOUTS,
	type EmbeddingSpace,
	type RerankDialect,
	type RerankEndpoint,
	requireEmbeddingSpace,
	resolveRerank,
	SHENRON_RAG_INDEX,
} from "@shenron/pipeline/ai/config";
import { e5DirectEmbeddingModel, embedQuery } from "@shenron/pipeline/ai/embeddings";

/** Modèle d'embedding de requête (type du fournisseur, sans dépendance directe au SDK). */
export type QueryEmbeddingModel = ReturnType<typeof e5DirectEmbeddingModel>;

export interface QueryEmbedding {
	/** `null` : embeddings indisponibles (Aphrody non configuré) → repli lexical. */
	model: QueryEmbeddingModel | null;
	/** Délai du chemin chaud (`EMBED_TIMEOUT_MS`, 3 s par défaut). */
	timeoutMs: number;
}

let queryEmbeddingState: QueryEmbedding | undefined;

/**
 * Modèle d'embedding des requêtes, construit paresseusement au premier usage
 * (B3) : une mauvaise URL ne fait plus planter l'import du module, la recherche
 * retombe simplement en lexical. Transport unique (D10) : Aphrody
 * `POST /api/v1/shenron/embed`, adresse et jeton lus par le résolveur unique
 * `@shenron/pipeline/ai/config` (`APHRODY_AI_HTTP_URL` / `APHRODY_AI_HTTP_TOKEN`
 * ou leurs alias ; aucune adresse par défaut : sans configuration, la recherche
 * reste lexicale). `maxRetries: 0`, délai `EMBED_TIMEOUT_MS`. Ne jette jamais.
 */
export function queryEmbeddingModel(): QueryEmbedding {
	if (queryEmbeddingState) return queryEmbeddingState;
	// 3 s : l'embed est rapide (~30 ms) mais peut faire la queue sous burst.
	const timeoutMs = Number(process.env.EMBED_TIMEOUT_MS ?? DEFAULT_AI_TIMEOUTS.embedHot);
	let state: QueryEmbedding = { model: null, timeoutMs };
	try {
		state = { model: e5DirectEmbeddingModel(null, "query"), timeoutMs };
	} catch (error) {
		console.warn(
			"[RAG] Embeddings de requête indisponibles, repli lexical :",
			error instanceof Error ? error.message : String(error)
		);
	}
	queryEmbeddingState = state;
	return state;
}

/** Test hook : oublie le modèle construit (relit l'environnement au prochain usage). */
export function resetQueryEmbeddingModel(): void {
	queryEmbeddingState = undefined;
}

/** Embedding d'une requête (`maxRetries: 0`), `null` si indisponible. Ne jette jamais. */
export async function embedQueryVector(text: string, timeoutMs?: number): Promise<number[] | null> {
	const { model, timeoutMs: hot } = queryEmbeddingModel();
	if (!model) return null;
	const result = await embedQuery(model, text, { timeoutMs: timeoutMs ?? hot });
	return result.ok ? result.value : null;
}

// Timeout large : le sidecar (onnxruntime WASM mono-thread) sérialise les
// inférences → sous concurrence, un rerank peut faire la queue. La réponse est
// cachée 5 min et /ask défère, donc le pire-cas cache-miss est absorbé.
const RERANK_TIMEOUT_MS = Number(process.env.RERANK_TIMEOUT_MS ?? 6000);

/**
 * Reranker optionnel, résolu par `@shenron/pipeline/ai/config` : `APHRODY_AI_RERANK_BASE_URL`
 * (dialecte llama-server), puis `RERANK_URL` (sidecar Shenron) et
 * `APHRODY_RAG_RERANK_ENDPOINT`. Une valeur invalide désactive le rerank avec
 * un avertissement nommant la variable, jamais sa valeur.
 */
function configuredReranker(): RerankEndpoint | null {
	const resolved = resolveRerank(process.env);
	if (resolved.ok) return resolved.value;
	console.warn(
		"[RAG] Reranker désactivé, configuration invalide :",
		resolved.issues.map((issue) => `${issue.name} ${issue.problem}`).join(", ")
	);
	return null;
}
const RERANKER = configuredReranker();
const RERANK_ENABLED = process.env.RAG_RERANK !== "0" && RERANKER !== null;
const RERANK_POOL = Number(process.env.RAG_RERANK_POOL ?? 20); // nombre de candidats RRF envoyés au cross-encoder
const RRF_K = 60;

// Préférence de SOURCE : focaliser les réponses sur le MANGA plutôt que sur les
// corpus secondaires. Boost multiplicatif (scale-invariant : marche sur le score RRF
// ET le score rerank)
// appliqué aux chunks source_id="manga", + quota garanti dans le top final. Le manga
// pertinent remonte au-dessus des autres corpus ; le bruit OCR (score bas) reste en bas.
const MANGA_SOURCE = process.env.RAG_MANGA_SOURCE ?? "manga";
const MANGA_WEIGHT = Number(process.env.RAG_MANGA_WEIGHT ?? 2.2);
const MANGA_QUOTA = Number(process.env.RAG_MANGA_QUOTA ?? 2);
/** Probabilité de pertinence (cross-encoder) minimale d'une planche promue par le quota. */
const MANGA_QUOTA_MIN_SCORE = Number(process.env.RAG_MANGA_QUOTA_MIN_SCORE ?? 0.3);

export interface RagHit {
	rowid: number;
	kind: string;
	title: string;
	url: string;
	snippet: string;
	/**
	 * Pertinence normalisée dans [0,1]. Comparable UNIQUEMENT au sein d'une même
	 * réponse ET d'un même `mode` : en `hybrid+rerank` c'est la sigmoïde du logit
	 * cross-encoder (≈ calibrée) ; en `hybrid`/`lexical` c'est un rang relatif
	 * (min-max). Ne JAMAIS comparer un score entre deux réponses/modes.
	 */
	score: number;
	/** Corpus d'origine (`db_characters`, `manga`, `databooks`, `canon_references`…). */
	sourceId?: string;
	/** Identifiant canonique unique du document (`shenron:<id>`) quand la frontière Aphrody le fournit. */
	documentId?: string;
	/** Langue du passage (`fr`, `en`, `ja`). */
	lang?: string;
	/** Full passage returned by the Aphrody search boundary when available. */
	content?: string;
}

/** Bases sur lesquelles sqlite-vec est déjà chargé : le recharger à chaque requête ne sert à rien. */
const vecLoaded = new WeakSet<Database>();
function loadVec(db: Database): void {
	if (vecLoaded.has(db)) return;
	sqliteVec.load(db);
	vecLoaded.add(db);
}

/**
 * Au-delà de ce nombre de rowids autorisés, la liste `rowid IN (…)` coûte plus
 * cher qu'un k-NN élargi filtré en JS (mesuré : 917 ids → 129 ms, k-NN nu → 44 ms).
 */
const FILTERED_KNN_MAX_IDS = 4000;

/** Effectue une recherche vectorielle native k-NN via l'extension sqlite-vec. */
function nativeVectorSearch(
	db: Database,
	qv: Float32Array,
	k: number,
	allowedRowids?: Set<number> | null
): { rowid: number; score: number }[] {
	loadVec(db);
	try {
		let rows: { rowid: number; distance: number }[] = [];
		if (allowedRowids && allowedRowids.size === 0) {
			rows = [];
		} else if (allowedRowids && allowedRowids.size <= FILTERED_KNN_MAX_IDS) {
			// Filtre sélectif (une entité, une petite source) : le k-NN est restreint
			// en amont. Filtrer après coup un pool global rendait souvent ZÉRO voisin,
			// et la requête retombait à tort en mode lexical.
			rows = db
				.query(
					`SELECT rowid, distance FROM vec_chunks WHERE embedding MATCH ?1 AND k = ?2 AND rowid IN (${[...allowedRowids].join(",")})`
				)
				.all(qv, k) as { rowid: number; distance: number }[];
		} else if (allowedRowids) {
			// Filtre large (une langue, les databooks) : pool élargi puis filtre en JS.
			const rawRows = db
				.query(
					"SELECT rowid, distance FROM vec_chunks WHERE embedding MATCH ?1 ORDER BY distance LIMIT ?2"
				)
				.all(qv, Math.max(k * 10, 500)) as { rowid: number; distance: number }[];

			rows = rawRows.filter((r) => allowedRowids.has(r.rowid)).slice(0, k);
		} else {
			rows = db
				.query(
					"SELECT rowid, distance FROM vec_chunks WHERE embedding MATCH ?1 ORDER BY distance LIMIT ?2"
				)
				.all(qv, k) as { rowid: number; distance: number }[];
		}

		// RRF (Reciprocal Rank Fusion) n'a besoin que du classement relatif.
		// Plus la distance L2 est petite (distance de match), plus le vecteur est proche.
		// On mappe le score à -distance pour conserver un score de pertinence décroissant.
		return rows.map((r) => ({
			rowid: r.rowid,
			score: -r.distance,
		}));
	} catch (err) {
		// Dégradation gracieuse si la table vec_chunks n'a pas encore été créée (ex. premier boot)
		console.warn("[RAG] Index vectoriel (vec_chunks) indisponible, repli lexical.", err);
		return [];
	}
}

/**
 * Vecteurs de requête récents. La même question revient souvent (boutons du
 * site, `/ask` rejoué, évaluations) et son embedding coûte un aller-retour à
 * Aphrody.
 */
const QUERY_VECTOR_CACHE_MAX = 512;
const queryVectorCache = new Map<string, Float32Array>();

/** Embed la requête via Aphrody. Renvoie null si indisponible (timeout/erreur). */
async function embedRemote(text: string): Promise<Float32Array | null> {
	const cached = queryVectorCache.get(text);
	if (cached) {
		// Réinsertion : l'ordre d'insertion de la Map sert d'ordre LRU.
		queryVectorCache.delete(text);
		queryVectorCache.set(text, cached);
		return cached;
	}
	const v = await embedRemoteUncached(text);
	if (v) {
		queryVectorCache.set(text, v);
		if (queryVectorCache.size > QUERY_VECTOR_CACHE_MAX) {
			queryVectorCache.delete(queryVectorCache.keys().next().value!);
		}
	}
	return v;
}

async function embedRemoteUncached(text: string): Promise<Float32Array | null> {
	try {
		const v = await embedQueryVector(text);
		return v ? Float32Array.from(v) : null;
	} catch {
		return null;
	}
}

/** Corps de requête du reranker selon son dialecte. */
export function rerankRequestBody(
	reranker: Pick<RerankEndpoint, "dialect" | "model">,
	query: string,
	passages: string[]
): Record<string, unknown> {
	if (reranker.dialect === "shenron-sidecar") return { query, passages };
	return {
		...(reranker.model ? { model: reranker.model } : {}),
		query,
		documents: passages,
		top_n: passages.length,
	};
}

/**
 * Score de pertinence dans [0,1] de chaque passage, dans l'ordre d'entrée, ou
 * `null` si la réponse est incomplète. Le sidecar Shenron renvoie déjà des
 * probabilités (`{scores}`) ; llama-server (`--pooling rank`) renvoie le logit
 * du cross-encoder (`{results: [{index, relevance_score}]}`), ramené dans [0,1]
 * par la sigmoïde pour garder le seuil `RAG_MANGA_QUOTA_MIN_SCORE` comparable.
 */
export function rerankScores(dialect: RerankDialect, payload: unknown, count: number): number[] | null {
	const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
	if (dialect === "shenron-sidecar") {
		const scores = (payload as { scores?: unknown } | null)?.scores;
		return Array.isArray(scores) && scores.length === count && scores.every(finite) ? scores : null;
	}
	const results = (payload as { results?: unknown } | null)?.results;
	if (!Array.isArray(results)) return null;
	const scores: (number | undefined)[] = Array.from({ length: count }, () => undefined);
	for (const item of results as { index?: unknown; relevance_score?: unknown; score?: unknown }[]) {
		const raw = item?.relevance_score ?? item?.score;
		if (!Number.isInteger(item?.index) || !finite(raw)) return null;
		const index = item.index as number;
		if (index < 0 || index >= count || scores[index] !== undefined) return null;
		scores[index] = 1 / (1 + Math.exp(-raw));
	}
	return scores.every((score) => score !== undefined) ? (scores as number[]) : null;
}

/** Rerank cross-encoder. Renvoie un score par passage, ou null si KO. */
async function rerankRemote(query: string, passages: string[]): Promise<number[] | null> {
	if (!RERANKER) return null;
	try {
		const res = await fetch(RERANKER.endpoint, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(rerankRequestBody(RERANKER, query, passages)),
			signal: AbortSignal.timeout(RERANK_TIMEOUT_MS),
		});
		if (!res.ok) return null;
		return rerankScores(RERANKER.dialect, await res.json(), passages.length);
	} catch {
		return null;
	}
}

export interface SearchOptions {
	lang?: string;
	entity?: string;
	sourceId?: string;
	/** Type de passage (`character`, `technique`, `manga_page`, `canon`…). */
	kind?: string;
	/** Force le chemin BM25 pour les baselines et audits reproductibles. */
	lexicalOnly?: boolean;
}

/** Clause SQL + paramètres des filtres de métadonnées communs aux deux étages. */
function filterClause(options?: SearchOptions): { sql: string; params: string[] } {
	const parts: string[] = [];
	const params: string[] = [];
	const add = (column: string, value: string | undefined) => {
		if (!value) return;
		parts.push(`${column} = ?`);
		params.push(value);
	};
	add("lang", options?.lang);
	add("entity", options?.entity);
	add("source_id", options?.sourceId);
	add("kind", options?.kind);
	return { sql: parts.map((p) => ` AND ${p}`).join(""), params };
}

// Mots vides FR (+ quelques EN fréquents) : retirés de la clause OR FTS5 pour
// réduire le bruit lexical des questions naturelles (« comment Goku devient… »).
// L'index utilise `remove_diacritics 2` → on fold les accents AUSSI dans la
// requête, ce qui (a) rend ce set sans-accent exhaustif (« où » → « ou »), et
// (b) garantit la cohérence requête/index.
const FR_STOPWORDS = new Set([
	"le",
	"la",
	"les",
	"un",
	"une",
	"des",
	"de",
	"du",
	"au",
	"aux",
	"et",
	"ou",
	"a",
	"en",
	"dans",
	"sur",
	"sous",
	"par",
	"pour",
	"avec",
	"que",
	"qui",
	"quoi",
	"dont",
	"comment",
	"pourquoi",
	"quand",
	"combien",
	"quel",
	"quelle",
	"quels",
	"quelles",
	"ce",
	"cet",
	"cette",
	"ces",
	"est",
	"sont",
	"etre",
	"ete",
	"ont",
	"son",
	"sa",
	"ses",
	"leur",
	"leurs",
	"mon",
	"ma",
	"mes",
	"ton",
	"ta",
	"tes",
	"notre",
	"votre",
	"il",
	"elle",
	"ils",
	"elles",
	"on",
	"se",
	"ne",
	"pas",
	"plus",
	"moins",
	"mais",
	"donc",
	"car",
	"ni",
	"or",
	"si",
	"comme",
	"tout",
	"tous",
	"toute",
	"toutes",
	"the",
	"is",
	"are",
	"was",
	"what",
	"who",
	"how",
	"of",
	"in",
	"to",
	"and",
	"or",
	"a",
	"an",
	"qu",
	"est-ce",
]);

/** Fold accents (NFD) + minuscule — aligné sur le tokenizer FTS5 `remove_diacritics 2`.
 * Recompose en NFC pour préserver les kanas japonais précomposés avec dakuten/handakuten (ベ, ピ, ブ, ザ).
 */
export function fold(s: string): string {
	return s
		.normalize("NFD")
		.replace(/[\u0300-\u036f]/g, "")
		.normalize("NFC")
		.toLowerCase();
}

/**
 * Tokenise une requête naturelle en liste de tokens nettoyés (sans ponctuation, kanas préservés, sans stopwords).
 */
export function tokenize(raw: string): string[] {
	const cleaned = fold(raw).replace(
		/[\x22\x27\u2018\u2019*()[\]{}:;,.~^?+!/\\|«»“”「」『』（）～〜【】〔〕〈〉《》、。・:!?;…_#@$&%<=>]/g,
		" "
	);
	const rawTokens = cleaned.split(/\s+/).filter((t) => t.length > 1);
	if (rawTokens.length === 0) return [];

	const tokenSet = new Set(rawTokens);

	// Découper aussi les termes CJK autour des particules japonaises courantes (ex: 孫悟空の必殺技 -> 孫悟空, 必殺技)
	const cjkRegex = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff]/;
	const particleRegex = /([のとはをがにでもへよりからまで])/g;

	for (const t of rawTokens) {
		if (cjkRegex.test(t)) {
			const subTokens = t
				.replace(particleRegex, " ")
				.split(/\s+/)
				.filter((sub) => sub.length > 1);
			for (const sub of subTokens) {
				tokenSet.add(sub);
			}
		}
	}

	const tokens = [...tokenSet];
	// Garde-fou stopwords : si le filtrage laisse ≥1 token de contenu, on élimine les mots vides.
	const filtered = tokens.filter((t) => !FR_STOPWORDS.has(t));
	return filtered.length > 0 ? filtered : tokens;
}

const PUNCT =
	/[\x22\x27‘’*()[\]{}:;,.~^?+!/\\|«»“”「」『』（）～〜【】〔〕〈〉《》、。・:!?;…_#@$&%<=>]/g;
const CJK_RE = /[぀-ヿ㐀-䶿一-鿿가-힯]/;
const normForm = (s: string) => fold(s).replace(PUNCT, " ").replace(/\s+/g, " ").trim();

/**
 * Expansion de requête par graphies équivalentes (FR/EN/JA). Le corpus parle
 * surtout français : « Frieza » ou « フリーザ » ne rencontraient jamais
 * « Freezer » en BM25. Quand une forme d'un groupe apparaît dans la question,
 * les autres formes du groupe rejoignent la clause OR. Le volet dense et le
 * rerank gardent la question d'origine.
 */
export function createQueryExpander(groups: string[][]): (raw: string) => string[] {
	const latin = new Map<string, number>();
	const cjk: { form: string; group: number }[] = [];
	groups.forEach((g, i) => {
		for (const f of g) {
			const k = normForm(f);
			if (k.length < 2) continue;
			if (CJK_RE.test(k)) cjk.push({ form: k, group: i });
			else if (k.length >= 3 && !latin.has(k)) latin.set(k, i);
		}
	});
	return (raw) => {
		const q = normForm(raw);
		const words = q.split(" ").filter(Boolean);
		const found = new Set<number>();
		const matched = new Set<string>();
		for (let n = Math.min(4, words.length); n >= 1; n--) {
			for (let i = 0; i + n <= words.length; i++) {
				const k = words.slice(i, i + n).join(" ");
				const g = latin.get(k);
				if (g !== undefined) {
					found.add(g);
					matched.add(k);
				}
			}
		}
		for (const { form, group } of cjk) {
			if (q.includes(form)) {
				found.add(group);
				matched.add(form);
			}
		}
		const out = new Set<string>();
		for (const g of found) {
			for (const f of groups[g]!) {
				const k = normForm(f);
				if (k.length >= 2 && !matched.has(k)) out.add(k);
			}
		}
		return [...out].slice(0, 16);
	};
}

const LEXIQUE_PATH =
	process.env.RAG_LEXIQUE ??
	fileURLToPath(new URL("../../data/rag/lexique-requetes.json", import.meta.url));
let expandQuery: (raw: string) => string[] = () => [];
if (process.env.RAG_QUERY_EXPANSION !== "0") {
	try {
		const { groups } = JSON.parse(readFileSync(LEXIQUE_PATH, "utf-8")) as { groups: string[][] };
		expandQuery = createQueryExpander(groups);
	} catch {
		// Lexique absent (généré par `scripts/rag-lexique.ts`) : recherche sans expansion.
	}
}

const ftsOr = (terms: string[]) => terms.map((t) => `"${t.replace(/"/g, "")}"`).join(" OR ");

/**
 * Formes exactes extraites de la question, de la plus spécifique à la moins
 * spécifique. Contrairement à `tokenize`, elles conservent les nombres :
 * « Super Saiyan 4 » doit pouvoir retrouver la fiche 4, pas seulement la
 * fiche générique « Super Saiyan ».
 */
export function exactQueryTerms(raw: string): string[] {
	const words = normForm(raw)
		.split(" ")
		.filter((word) => word.length > 0);
	const terms = new Set<string>();
	for (let n = Math.min(4, words.length); n >= 1; n--) {
		for (let i = 0; i + n <= words.length; i++) {
			const term = words.slice(i, i + n).join(" ");
			if (term.length >= 3 && (n > 1 || !FR_STOPWORDS.has(term))) terms.add(term);
		}
	}
	return [...terms];
}

/** Route les questions d'interview/biologie explicitement couvertes par le dossier canon. */
export function inferSourceHintUrl(raw: string): string | null {
	const q = normForm(raw);
	if (/parle[- ]moi.*tournoi du pouvoir|tournoi du pouvoir.*parle[- ]moi/.test(q)) {
		return "/wiki/sagas/tournament-of-power";
	}
	const canonPatterns = [
		/toriyama.*kamehameha|kamehameha.*toriyama/,
		/(vrai nom|real name).*mr\.? satan/,
		/saiyan.*(jeune|young)/,
		/(zeni|zenny).*(yen|yens)/,
		/namek.*(eau|water|nutrition)/,
		/piccolo.*(prefere|favorite).*toriyama|toriyama.*piccolo.*(prefere|favorite)/,
		/kaio.*heredit/,
		/gohan.*(remplace|replace).*goku/,
	];
	return canonPatterns.some((pattern) => pattern.test(q)) ? "/wiki/canon" : null;
}

/** Tokenise une requête naturelle en clause FTS5 OR (recall large, sans stopwords). */
function ftsMatch(raw: string): string | null {
	const tokens = tokenize(raw);
	return tokens.length === 0 ? null : ftsOr(tokens);
}

/**
 * Poids du classement BM25 des graphies équivalentes face à celui de la question.
 * Fusionnées dans la même clause OR, les expansions noyaient les questions
 * françaises (« Qui est Goku ? » ramenait les titres de chapitres « Son Goku ») ;
 * en liste séparée, elles complètent sans évincer. Une question en japonais n'a
 * presque rien à apparier dans un corpus français : l'expansion y pèse autant
 * que la question.
 */
const EXPANSION_WEIGHT = Number(process.env.RAG_EXPANSION_WEIGHT ?? 0.5);
const expansionWeight = (raw: string) => (CJK_RE.test(raw) ? 1 : EXPANSION_WEIGHT);

const round3 = (n: number) => Math.round(n * 1000) / 1000;

/**
 * Snippet de repli centré sur le 1er token de requête présent dans le contenu
 * (fenêtre de `width` chars), au lieu d'un simple préfixe — donne un extrait qui
 * contient effectivement le terme cherché. Utilisé quand le highlight BM25 manque.
 */
function centeredSnippet(content: string, tokens: string[], width = 220): string {
	const text = content.replace(/\s+/g, " ").trim();
	if (text.length <= width) return text;
	const lc = fold(text);
	let pos = -1;
	for (const t of tokens) {
		const i = lc.indexOf(t);
		if (i !== -1 && (pos === -1 || i < pos)) pos = i;
	}
	if (pos === -1) return `${text.slice(0, width).trimEnd()}…`;
	const start = Math.max(0, pos - Math.floor(width / 4));
	const end = Math.min(text.length, start + width);
	return `${start > 0 ? "…" : ""}${text.slice(start, end).trim()}${end < text.length ? "…" : ""}`;
}

/**
 * Normalise les scores bruts d'un set RÉSULTAT vers [0,1] selon le mode :
 *  - `hybrid+rerank` : sigmoïde du logit cross-encoder (≈ calibrée, absolue).
 *  - sinon (RRF/lexical) : min-max relatif, planché à 0.4 pour ne pas afficher
 *    « 0 % pertinent » sur le dernier hit d'une réponse par ailleurs pertinente.
 */
/**
 * Clé de déduplication d'un hit : URL canonique si présente, sinon TITRE foldé,
 * sinon rowid. Le repli par titre est crucial : les chunks `kind=source`
 * (databooks, jeux) ont souvent une `url` vide → sans lui, « Kamehameha — compétence »
 * remontait 3×.
 */
function dedupKey(url: string, title: string, rowid: number): string {
	const u = (url || "").split("?")[0]!.toLowerCase();
	if (u) return `u:${u}`;
	const t = fold(title || "")
		.replace(/\s+/g, " ")
		.trim();
	return t ? `t:${t}` : `r:${rowid}`;
}

/**
 * Clé de diversification du top-N, commune aux modes hybride et lexical : chaque
 * planche manga est un passage distinct (clé par rowid) même si toutes partagent
 * l'URL générique `/wiki/manga` ; les autres corpus sont dédupliqués par URL,
 * puis par titre foldé.
 */
function diversityKey(hit: { url: string; title: string; rowid: number; sourceId?: string }): string {
	return hit.sourceId === MANGA_SOURCE ? `m:${hit.rowid}` : dedupKey(hit.url, hit.title, hit.rowid);
}

function normalizeScores<T extends { score: number }>(arr: T[], mode: RagMode): T[] {
	if (mode === "hybrid+rerank") {
		// Le sidecar applique déjà la sigmoïde (`rerankTexts`) : réappliquer ici
		// écrasait tous les scores dans [0,5 ; 0,73].
		return arr.map((c) => ({ ...c, score: round3(Math.min(1, Math.max(0, c.score))) }));
	}
	const vals = arr.map((c) => c.score);
	const min = Math.min(...vals);
	const max = Math.max(...vals);
	const span = max - min;
	return arr.map((c) => ({
		...c,
		score: round3(span > 0 ? 0.4 + (0.6 * (c.score - min)) / span : 1),
	}));
}

/** Fiches encyclopédiques du wiki (une entité = une fiche). */
const ENCYCLOPEDIC_KINDS = new Set([
	"character",
	"character_section",
	"technique",
	"transformation",
	"saga",
	"arc",
	"planet",
	"race",
	"location",
	"tournament",
	"voice_actor",
	"soundtrack",
	"media_work",
]);

/** Passages que le quota manga n'a pas le droit d'évincer du top final. */
const PROTECTED_KINDS = new Set([
	"character",
	"character_section",
	"technique",
	"author",
	"canon",
	"location",
	"tournament",
	"voice_actor",
	"soundtrack",
]);

/** Dossiers éditoriaux transverses rattachés à une entité ou un événement. */
const DOSSIER_KINDS = new Set([
	"character_variant",
	"battle",
	"item",
	"dragon",
	"wish",
	"timeline_event",
	"power_level",
	"article",
	"location",
	"tournament",
	"narrative_timeline",
	"narrative_event",
]);

/**
 * Calcule le coefficient d'autorité canonique et de véracité du passage.
 *
 * Alignement strict sur la Doctrine Canon de Shenron (AGENTS.md) :
 * 1. Zéro invention éditoriale : primauté aux sources premières (Toriyama direct, manga original 42 tomes / DBS).
 * 2. Vérité encyclopédique du wiki : fiches personnages, techniques, transformations, sagas, arcs, planètes, races.
 * 3. Databooks officiels (Daizenshuu 1-7, Chōzenshū 1-4, SEG).
 * 4. Dérivés (anime / films Toei) en complément.
 * 5. Jeux vidéo (Xenoverse 2, etc.) & discussions secondaires : pénalisés pour ne jamais écraser
 *    la vérité canonique sauf si la requête porte explicitement sur un jeu vidéo.
 */
export function truthWeight(
	sourceId: string,
	kind: string,
	queryTokens: string[],
	title: string,
	entity?: string | null
): number {
	let w = 1.0;

	// 1. Primauté des sources de vérité
	if (sourceId === "aphrody" || kind === "author" || kind === "canon") {
		// Paroles et interviews directes d'Akira Toriyama, références canon sourcées
		w = 2.4;
	} else if (
		sourceId === "manga" ||
		kind === "manga_page" ||
		kind === "manga_chapter" ||
		kind === "manga_volume"
	) {
		// Manga original & chapitres
		w = 2.2;
	} else if (ENCYCLOPEDIC_KINDS.has(kind)) {
		// Fiches encyclopédiques validées
		w = 2.0;
	} else if (DOSSIER_KINDS.has(kind)) {
		// Dossiers éditoriaux du wiki (variantes par saga, combats, objets, dragons…)
		w = 1.9;
	} else if (kind === "voice_actor" || kind === "soundtrack") {
		// Production de l'anime (doublage, musiques) : fiable, mais hors œuvre
		w = 1.2;
	} else if (kind === "power_profile") {
		// Profils de puissance : analyse éditoriale, pas une donnée imprimée
		w = 1.0;
	} else if (kind === "databook" || sourceId === "databooks") {
		// Guides et encyclopédies canoniques / supervisées
		w = 1.6;
	} else if (kind === "episode" || kind === "movie") {
		// Adaptations anime / films
		w = 1.1;
	} else if (["xv2", "kz", "db_games"].includes(sourceId) || kind === "game") {
		// Corpus dérivé / jeux vidéo (ex. Xenoverse 2)
		const asksGame = queryTokens.some((t) =>
			["jeu", "game", "games", "xenoverse", "xv2", "mod", "gaming"].includes(t)
		);
		w = asksGame ? 1.6 : 0.7;
	}

	// 2. Alignement exact sur le sujet (Subject Match Boost) :
	// Quand le titre ou l'entité de la fiche correspond au sujet de la requête
	const titleFold = fold(title);
	const entityFold = entity ? fold(entity) : "";
	const isExactSubject = queryTokens.some(
		(t) => t.length >= 3 && (titleFold === t || entityFold === t)
	);
	if (isExactSubject) {
		w *= 1.45;
	} else if (
		queryTokens.some((t) => t.length >= 4 && (titleFold.startsWith(t) || entityFold.startsWith(t)))
	) {
		w *= 1.25;
	}

	return w;
}

/**
 * Helper pratique pour calculer le poids de vérité d'un hit ou chunk.
 */
export function hitTruthWeight(
	hit: {
		source_id?: string | null;
		sourceId?: string | null;
		kind: string;
		title: string;
		entity?: string | null;
	},
	queryTokens: string[] = []
): number {
	// Priorité : ligne SQLite (`source_id`), puis groupe d'origine public (`sourceId`).
	return truthWeight(hit.source_id ?? hit.sourceId ?? "", hit.kind, queryTokens, hit.title, hit.entity);
}

export type RagMode = "hybrid+rerank" | "hybrid" | "lexical";

/**
 * Pipeline RAG : récupération hybride (BM25 + dense, fusion RRF) puis reranking
 * cross-encoder du top-{@link RERANK_POOL} (2e étage, précision). Dégrade en
 * hybride sans rerank si le cross-encoder est indisponible, ou en BM25 seul si
 * le signal sémantique manque. Renvoie au plus `limit` hits.
 */
export async function hybridSearch(
	db: Database | null,
	raw: string,
	limit: number,
	options?: SearchOptions
): Promise<{ results: RagHit[]; mode: RagMode }> {
	const query = raw.trim();
	if (process.env.RAG_BACKEND === "aphrody" || process.env.RAG_BACKEND === "native") {
		if (!query) return { results: [], mode: "lexical" };
		if (process.env.RAG_BACKEND === "native" && isNativeAvailable() && !options?.lang && !options?.entity && !options?.sourceId) {
			try {
				const hits = await aphrodyNative.ragSearch(query, {
					limit,
					kind: options?.kind,
				});
				if (hits.length > 0) {
					return {
						mode: "lexical",
						results: hits.map((hit, idx) => ({
							rowid: idx,
							kind: hit.kind ?? "databook",
							title: hit.title ?? "Sans titre",
							url: hit.url ?? "",
							snippet: hit.snippet || hit.content || "",
							score: hit.score,
							sourceId: hit.sourceId,
							documentId: hit.sourceId,
							lang: options?.lang ?? "fr",
							content: hit.content,
						})),
					};
				}
			} catch {
				// Fallback to HTTP client
			}
		}
		const { results: hits, mode } = await new AphrodyComputeClient().ragSearchWithMode(query, limit, {
			lang: options?.lang, entity: options?.entity, sourceId: options?.sourceId, kind: options?.kind,
		});
		return {
			mode,
			results: hits.map((hit) => ({
				rowid: Number(hit.sourceId?.match(/^shenron:(\d+)$/)?.[1] ?? -1),
				kind: hit.kind,
				title: hit.title,
				url: hit.url,
				snippet: hit.snippet,
				score: hit.score,
				sourceId: hit.originSourceId,
				documentId: hit.sourceId,
				lang: hit.lang,
				content: hit.content,
			})),
		};
	}
	const match = ftsMatch(query);
	if (!match) return { results: [], mode: "lexical" };
	// Tokens (foldés) pour centrer le snippet de repli sur un terme cherché.
	const snipTokens = fold(query)
		.replace(
			/[\x22\x27\u2018\u2019*()[\]{}:;,.~^?+!/\\|«»“”「」『』（）～〜【】〔〕〈〉《》、。・:!?;…_#@$&%<=>]/g,
			" "
		)
		.split(/\s+/)
		.filter((t) => t.length > 1);

	if (!db) throw new Error("Local RAG requires a database; configure RAG_BACKEND=aphrody for remote retrieval");
	// Récupération des rowids autorisés si des filtres sont présents
	const filters = filterClause(options);
	let allowedRowids: Set<number> | null = null;
	if (filters.params.length > 0) {
		const rows = db
			.query(`SELECT rowid FROM rag_chunks WHERE 1=1${filters.sql}`)
			.all(...filters.params) as { rowid: number }[];
		allowedRowids = new Set(rows.map((r) => r.rowid));
	}

	const POOL = 50;

	// Requête FTS avec filtres et pondération BM25 :
	// kind: 2.0, title: 10.0, url: 1.0, content: 1.0, lang: 0.5, source_id: 0.5, entity: 8.0
	const bm = db
		.query(
			"SELECT rowid, kind, title, url, snippet(rag_chunks, 3, '', '', '…', 18) AS snippet, " +
				"source_id AS sourceId, lang, entity " +
				`FROM rag_chunks WHERE rag_chunks MATCH ?${filters.sql} ` +
				"ORDER BY bm25(rag_chunks, 2.0, 10.0, 1.0, 1.0, 0.5, 0.5, 8.0) LIMIT ?"
		)
		.all(match, ...filters.params, POOL) as (Omit<RagHit, "score"> & { entity: string | null })[];

	// Classement séparé des graphies équivalentes (FR/EN/JA), pondéré à la fusion.
	const expansions = expandQuery(query);
	const bmExp =
		expansions.length === 0
			? []
			: (db
					.query(
						"SELECT rowid, kind, title, url, snippet(rag_chunks, 3, '', '', '…', 18) AS snippet, " +
							"source_id AS sourceId, lang, entity " +
							`FROM rag_chunks WHERE rag_chunks MATCH ?${filters.sql} ` +
							"ORDER BY bm25(rag_chunks, 2.0, 10.0, 1.0, 1.0, 0.5, 0.5, 8.0) LIMIT ?"
					)
					.all(ftsOr(expansions), ...filters.params, POOL) as typeof bm);
	const expW = expansionWeight(query);

	// Rappel exact des fiches : BM25 pénalise les termes très fréquents et pouvait
	// exclure la fiche racine (« Kamehameha », « Son Goku ») du pool au profit de
	// dizaines de variantes. Une égalité titre/entité reste un signal strict,
	// sans préfixe (`freezer` ne matche jamais `freezer-futur`).
	// Les alias complètent la requête, ils ne la remplacent pas. Auparavant,
	// `exactTerms` ne contenait que les expansions : une question qui emploie le
	// nom canonique lui-même ("What is the Kamehameha technique?") n'avait aucun
	// rappel exact et les variantes pouvaient évincer la fiche racine.
	const primaryExactTerms = exactQueryTerms(query);
	const aliasExactTerms = expansions.map(normForm).filter((term) => term.length >= 3);
	const exactTerms = [...new Set([...primaryExactTerms, ...aliasExactTerms])];
	const exactCandidates =
		exactTerms.length === 0
			? []
			: (db
					.query(
						"SELECT rowid, kind, title, url, substr(content, 1, 220) AS snippet, " +
							"source_id AS sourceId, lang, entity FROM rag_chunks WHERE " +
							`(lower(title) IN (${exactTerms.map(() => "?").join(",")}) OR lower(entity) IN (${exactTerms.map(() => "?").join(",")}))${filters.sql} LIMIT ?`
					)
					.all(...exactTerms, ...exactTerms, ...filters.params, POOL) as typeof bm);
	const primarySet = new Set(primaryExactTerms);
	const aliasSet = new Set(aliasExactTerms);
	// Un intitulé explicitement présent dans la question prime une expansion.
	// Cela évite que « Bardock, père de Goku » favorise Son Goku simplement parce
	// que son alias canonique est plus long. Les aliases restent le repli utile
	// pour « Genki Dama » → « Genkidama ».
	const exactStrength = (hit: (typeof bm)[number]) => {
		const title = normForm(hit.title);
		const entity = normForm(hit.entity ?? "");
		if (primarySet.has(title)) return 4;
		if (primarySet.has(entity)) return 3;
		if (aliasSet.has(title)) return 2;
		if (aliasSet.has(entity)) return 1;
		return 0;
	};
	const strongestExact = exactCandidates.reduce((max, hit) => Math.max(max, exactStrength(hit)), 0);
	const bmExact = exactCandidates
		.filter((hit) => exactStrength(hit) === strongestExact)
		.toSorted((a, b) => {
			const titleA = exactTerms.includes(normForm(a.title)) ? 1 : 0;
			const titleB = exactTerms.includes(normForm(b.title)) ? 1 : 0;
			if (titleA !== titleB) return titleB - titleA;
			const sectionA = /[?#]/.test(a.url) ? 1 : 0;
			const sectionB = /[?#]/.test(b.url) ? 1 : 0;
			if (sectionA !== sectionB) return sectionA - sectionB;
			return a.url.length - b.url.length;
		});
	const hintedUrl = inferSourceHintUrl(query);
	const bmHint = hintedUrl
		? (db
				.query(
					"SELECT rowid, kind, title, url, snippet(rag_chunks, 3, '', '', '…', 18) AS snippet, " +
					"source_id AS sourceId, lang, entity FROM rag_chunks WHERE " +
					"(url LIKE ? || '%' OR url LIKE 'https://dragonballfr.com' || ? || '%') ORDER BY rowid LIMIT 1"
				)
				.all(hintedUrl, hintedUrl) as typeof bm)
		: [];

	const bmById = new Map<number, Omit<RagHit, "score">>();
	for (const h of bmExact) bmById.set(h.rowid, h);
	for (const h of bmExp) bmById.set(h.rowid, h);
	for (const h of bm) bmById.set(h.rowid, h);

	// Étage 1 — signal sémantique (best-effort).
	const qv = options?.lexicalOnly ? null : await embedRemote(query);
	const dense = qv ? nativeVectorSearch(db, qv, POOL, allowedRowids) : [];

	if (dense.length === 0) {
		// Repli lexical (sidecar/vecteurs absents) : on déduplique et on
		// pondère par la véracité canonique pour placer la vérité en tête.
		const lexScore = new Map<number, { hit: (typeof bm)[number]; score: number }>();
		const cumule = (list: typeof bm, weight: number) =>
			list.forEach((hit, i) => {
				const prev = lexScore.get(hit.rowid);
				lexScore.set(hit.rowid, {
					hit: prev?.hit ?? hit,
					score: (prev?.score ?? 0) + (list.length - i) * weight,
				});
			});
		cumule(bm, 1);
		cumule(bmExp, expW);
		cumule(bmExact, 0.001);
		// An explicit canonical route is stronger than a coincidental lexical hit;
		// keep it visible through deduplication without making it override exact
		// entity matches.
		cumule(bmHint, 0.1);
		const seen = new Set<string>();
		const out: (RagHit & { sortScore: number })[] = [];
		for (const { hit, score } of [...lexScore.values()].toSorted((a, b) => b.score - a.score)) {
			const { entity, ...h } = hit;
			const key = diversityKey(h);
			if (seen.has(key)) continue;
			seen.add(key);
			const tw = truthWeight(h.sourceId ?? "", h.kind, snipTokens, h.title, entity);
			out.push({ ...h, score, sortScore: score * tw });
		}
		out.sort((a, b) => b.sortScore - a.sortScore);
		// Une fiche d'entité issue du lexique peut être absente du pool BM25 quand
		// son nom est très fréquent. Une égalité stricte sur le titre ou l'entité
		// est plus fiable que les cooccurrences FTS : on la place donc dans le top-3
		// (sans jamais accepter un préfixe, p. ex. `freezer-futur` pour `freezer`).
		// Cela évite qu'une fiche racine soit noyée par ses variantes ou les pages
		// de manga qui répètent le même nom.
		const exactKeys = new Set(
			[...bmHint, ...bmExact].map((hit) => diversityKey(hit))
		);
		const exactIndex = out.findIndex((hit) => exactKeys.has(diversityKey(hit)));
		if (exactIndex > 2) out.splice(2, 0, out.splice(exactIndex, 1)[0]!);
		const sliced = out.slice(0, limit).map(({ sortScore, ...rest }) => rest);
		return { results: normalizeScores(sliced, "lexical"), mode: "lexical" };
	}

	// Fusion RRF des deux classements.
	const fused = new Map<number, number>();
	bm.forEach((h, r) => fused.set(h.rowid, (fused.get(h.rowid) ?? 0) + 1 / (RRF_K + r + 1)));
	bmExp.forEach((h, r) => fused.set(h.rowid, (fused.get(h.rowid) ?? 0) + expW / (RRF_K + r + 1)));
	bmExact.forEach((h, r) => fused.set(h.rowid, (fused.get(h.rowid) ?? 0) + 1 / (RRF_K + r + 1)));
	dense.forEach((d, r) => fused.set(d.rowid, (fused.get(d.rowid) ?? 0) + 1 / (RRF_K + r + 1)));

	// Métadonnées de tous les candidats fusionnés → pondération de vérité canonique.
	const fusedIds = [...fused.keys()];
	const metaById = new Map<
		number,
		{ source_id: string; kind: string; title: string; entity: string | null }
	>();
	if (fusedIds.length) {
		const srcPh = fusedIds.map(() => "?").join(",");
		const metaRows = db
			.query(
				`SELECT rowid, source_id, kind, title, entity FROM rag_chunks WHERE rowid IN (${srcPh})`
			)
			.all(...fusedIds) as {
			rowid: number;
			source_id: string;
			kind: string;
			title: string;
			entity: string | null;
		}[];
		for (const r of metaRows) metaById.set(r.rowid, r);
	}
	const isManga = (rowid: number) => metaById.get(rowid)?.source_id === MANGA_SOURCE;
	const boost = (rowid: number, s: number) => {
		const meta = metaById.get(rowid);
		if (!meta) return s;
		return s * truthWeight(meta.source_id, meta.kind, snipTokens, meta.title, meta.entity);
	};

	// Pool de rerank trié par score RRF BOOSTÉ par autorité de vérité → garantit que la
	// vérité canonique et le manga pertinent entrent dans le pool (au lieu d'être évincés par des fillers ou jeux).
	const ordered = [...fused.entries()]
		.toSorted((a, b) => boost(b[0], b[1]) - boost(a[0], a[1]))
		.slice(0, RERANK_POOL)
		.map(([rowid]) => rowid);

	// Hydrate kind/title/url + contenu (pour le rerank) de tous les candidats.
	const ph = ordered.map(() => "?").join(",");
	type ContentRow = Omit<RagHit, "score"> & { content: string };
	const rows = db
		.query(
			`SELECT rowid, kind, title, url, content, source_id AS sourceId, lang FROM rag_chunks WHERE rowid IN (${ph})`
		)
		.all(...ordered) as ContentRow[];
	const rowById = new Map<number, ContentRow>();
	for (const r of rows) rowById.set(r.rowid, r);

	// Candidats dans l'ordre RRF ; snippet d'affichage = surlignage BM25 si dispo,
	// sinon fenêtre centrée sur la requête. `score` = base RRF (remplacé par le rerank ci-dessous).
	let candidates = ordered
		.map((id) => {
			const r = rowById.get(id);
			if (!r) return null;
			const snippet = bmById.get(id)?.snippet ?? centeredSnippet(r.content, snipTokens);
			return {
				rowid: r.rowid,
				kind: r.kind,
				title: r.title,
				url: r.url,
				snippet,
				content: r.content,
				sourceId: r.sourceId,
				lang: r.lang,
				score: fused.get(r.rowid) ?? 0,
			};
		})
		.filter((x): x is NonNullable<typeof x> => x !== null);

	// Étage 2 — reranking cross-encoder (best-effort).
	let mode: RagMode = "hybrid";
	if (RERANK_ENABLED && candidates.length > 1) {
		// 400 chars suffisent : le cross-encoder tronque à 512 tokens. Au-delà, on
		// paie la tokenisation sans gain (4.8s vs 1.4s pour 20 passages).
		const passages = candidates.map((c2) => `${c2.title}. ${c2.content}`.slice(0, 400));
		const scores = await rerankRemote(query, passages);
		if (scores && scores.length === candidates.length) {
			candidates = candidates.map((cand, i) => ({ ...cand, score: scores[i]! }));
			mode = "hybrid+rerank";
		}
	}

	// Déduplication / diversification : un même article (URL) ne doit pas occuper
	// plusieurs slots du top-N. « Kamehameha » renvoyait 3× la MÊME fiche. On garde
	// le meilleur score par clé. Le MANGA est dédupliqué par rowid (chaque planche
	// est un passage distinct partageant l'URL générique /wiki/manga) → préserve le
	// quota manga ≥ MANGA_QUOTA appliqué juste après.
	const keyOf = (c: { rowid: number; url: string; title: string }) =>
		diversityKey({ ...c, sourceId: metaById.get(c.rowid)?.source_id });
	const bestByKey = new Map<string, (typeof candidates)[number]>();
	for (const c of candidates) {
		const k = keyOf(c);
		const prev = bestByKey.get(k);
		if (!prev || c.score > prev.score) bestByKey.set(k, c);
	}
	candidates = [...bestByKey.values()];

	// Tri final par score BOOSTÉ manga (×MANGA_WEIGHT), puis QUOTA garanti :
	// ≥ MANGA_QUOTA chunks manga dans le top `limit` si disponibles → les réponses
	// se focalisent sur le manga, les autres corpus restent en complément.
	const top = candidates
		.toSorted((a, b) => boost(b.rowid, b.score) - boost(a.rowid, a.score))
		.slice(0, limit);
	// Le quota ne s'applique qu'à une planche que le cross-encoder juge pertinente :
	// depuis que le manga est indexé planche par planche (10 000 passages OCR), un
	// quota inconditionnel glissait du bruit de bulles dans des réponses qui n'ont
	// rien à voir avec une scène (« combien vaut un zeni »).
	if (MANGA_QUOTA > 0 && mode === "hybrid+rerank" && candidates.length > limit) {
		const rest = candidates
			.filter((c) => isManga(c.rowid) && !top.includes(c) && c.score >= MANGA_QUOTA_MIN_SCORE)
			.toSorted((a, b) => boost(b.rowid, b.score) - boost(a.rowid, a.score));
		let mangaCount = top.filter((c) => isManga(c.rowid)).length;
		for (const m of rest) {
			if (mangaCount >= MANGA_QUOTA) break;
			let worst = -1;
			for (let i = top.length - 1; i >= 0; i--) {
				const meta = metaById.get(top[i]!.rowid);
				const isProtectedEntity = meta && PROTECTED_KINDS.has(meta.kind);
				if (!isManga(top[i]!.rowid) && !isProtectedEntity) {
					worst = i;
					break;
				}
			}
			if (worst === -1) break;
			top[worst] = m;
			mangaCount++;
		}
		top.sort((a, b) => boost(b.rowid, b.score) - boost(a.rowid, a.score));
	}

	const results: RagHit[] = normalizeScores(top, mode).map(
		({ rowid, kind, title, url, snippet, score, sourceId, lang }) => ({
			rowid,
			kind,
			title,
			url,
			snippet,
			score,
			sourceId,
			lang,
		})
	);
	return { results, mode };
}

export interface RagContextSource {
	n: number;
	rowid: number;
	title: string;
	url: string;
	kind: string;
	sourceId?: string;
	lang?: string;
	score: number;
}

export interface RagContext {
	q: string;
	mode: RagMode;
	/** Passages numérotés `[n]`, prêts à injecter dans un prompt ; chaque bloc cite son URL. */
	context: string;
	sources: RagContextSource[];
}

/** URL absolue d'une citation (les chunks du wiki portent un chemin relatif). */
export function absoluteUrl(url: string, siteBase = "https://dragonballfr.com"): string {
	if (!url) return siteBase;
	return url.startsWith("/") ? `${siteBase.replace(/\/$/, "")}${url}` : url;
}

/**
 * Contexte d'ancrage pour un LLM : les meilleurs passages en TEXTE INTÉGRAL
 * (l'extrait de `hybridSearch` fait 18 mots), numérotés et sourcés, dans un
 * budget de caractères. C'est la forme qu'attend un agent qui rédige : il cite
 * `[n]` et l'URL correspondante, sans second aller-retour pour lire la source.
 */
export async function buildRagContext(
	db: Database | null,
	q: string,
	opts: SearchOptions & { limit?: number; maxChars?: number; siteBase?: string } = {}
): Promise<RagContext> {
	const { limit = 6, maxChars = 6000, siteBase, ...search } = opts;
	const { results, mode } = await hybridSearch(db, q, limit, search);
	if (results.length === 0) return { q, mode, context: "", sources: [] };

	const contents = new Map<number, string>();
	if (process.env.RAG_BACKEND !== "aphrody") {
		if (!db) throw new Error("Local RAG context requires a database");
		const ph = results.map(() => "?").join(",");
		for (const row of db.query(`SELECT rowid, content FROM rag_chunks WHERE rowid IN (${ph})`).all(...results.map((r) => r.rowid)) as { rowid: number; content: string }[]) {
			contents.set(row.rowid, row.content);
		}
	}

	const blocks: string[] = [];
	const sources: RagContextSource[] = [];
	let used = 0;
	for (const hit of results) {
		const n = sources.length + 1;
		const url = absoluteUrl(hit.url, siteBase);
		const header = `[${n}] ${hit.title} (${hit.kind}${hit.sourceId ? ` · ${hit.sourceId}` : ""}) — ${url}`;
		const remaining = maxChars - used - header.length - 2;
		if (remaining < 120) break;
		// Chaque passage garde au moins sa part du budget restant, pour qu'un
		// premier chunk long n'évince pas les suivants.
		const share = Math.max(240, Math.floor(remaining / (results.length - sources.length)));
		const text = (hit.content ?? contents.get(hit.rowid) ?? hit.snippet).replace(/\s+/g, " ").trim();
		const body = text.length > share ? `${text.slice(0, share).trimEnd()}…` : text;
		blocks.push(`${header}\n${body}`);
		used += header.length + body.length + 2;
		sources.push({
			n,
			rowid: hit.rowid,
			title: hit.title,
			url,
			kind: hit.kind,
			sourceId: hit.sourceId,
			lang: hit.lang,
			score: hit.score,
		});
	}
	return { q, mode, context: blocks.join("\n\n"), sources };
}

/**
 * RAG Génératif : Construit un prompt avec le contexte récupéré et interroge le LLM.
 * L'implémentation vit dans `rag-answer.ts` ; elle est chargée à l'appel pour
 * que la fermeture d'import statique de `rag.ts` ne contienne pas `llm.ts` (B3).
 */
export async function generateAnswer(db: Database, query: string, hits: RagHit[]): Promise<string> {
	const answer = await import("./rag-answer");
	return answer.generateAnswer(db, query, hits);
}

/**
 * Espace d'embedding de l'index interrogé : le contrat `shenron-rag` en mode
 * Aphrody (le moteur Aphrody l'impose), sinon la ligne `rag_meta` de l'index
 * SQLite local quand elle existe.
 */
export function ragIndexSpace(db: Database | null): { space: EmbeddingSpace; label: string } {
	if (process.env.RAG_BACKEND !== "aphrody" && db) {
		try {
			const meta = db.query("SELECT model, dim FROM rag_meta LIMIT 1").get() as {
				model: string | null;
				dim: number | null;
			} | null;
			if (meta?.model && meta.dim) return { space: { model: meta.model, dimensions: meta.dim }, label: "rag_meta" };
		} catch {
			// table absente : pas d'index local, le contrat fait référence
		}
	}
	return {
		space: { model: SHENRON_RAG_INDEX.model, dimensions: SHENRON_RAG_INDEX.dimensions },
		label: SHENRON_RAG_INDEX.name,
	};
}

/**
 * Contrôle de démarrage : l'espace d'embedding configuré
 * (`APHRODY_AI_EMBED_MODEL` / `APHRODY_AI_EMBED_DIMENSIONS`, défaut : contrat)
 * doit être celui de l'index. Jette `EmbeddingSpaceMismatchError` sinon :
 * deux espaces vectoriels ne sont jamais mélangés.
 */
export function assertRagEmbeddingSpace(db: Database | null): EmbeddingSpace {
	const { space, label } = ragIndexSpace(db);
	return requireEmbeddingSpace(process.env, space, label);
}

/**
 * Vérifie l'état de l'index RAG au démarrage et loggue un diagnostic explicite.
 * Sans ce log, une dégradation en BM25 seul (vec_chunks vide → `mode:"lexical"`)
 * était silencieuse en prod : le retrieval sémantique + reranking restait inactif
 * sans aucune alerte. Best-effort — ne jette jamais, n'impacte pas le boot.
 */
export function logRagHealth(db: Database): void {
	if (process.env.RAG_BACKEND === "aphrody") {
		try {
			void new AphrodyComputeClient().ragStats()
				.then(({ chunks, vectors }) => console.log(`[RAG] Aphrody — ${chunks} chunks, ${vectors} vecteurs.`))
				.catch((error) => console.warn("[RAG] Diagnostic Aphrody impossible:", error));
		} catch (error) {
			console.warn("[RAG] Diagnostic Aphrody impossible:", error);
		}
		return;
	}
	try {
		const chunks = (db.query("SELECT count(*) AS c FROM rag_chunks").get() as { c: number }).c;
		let vec = -1;
		try {
			loadVec(db);
			vec = (db.query("SELECT count(*) AS c FROM vec_chunks").get() as { c: number }).c;
		} catch {
			// extension/table absente — reste en lexical
		}
		if (chunks === 0) {
			console.warn(
				"[RAG] rag_chunks vide → recherche indisponible. Lancer `bun --filter @shenron/bot run rag:build`."
			);
		} else if (vec <= 0) {
			console.warn(
				`[RAG] Index vectoriel vide (vec_chunks=${vec}, rag_chunks=${chunks}) → mode LEXICAL seul. ` +
					"Volet sémantique + reranking INACTIF. Lancer un build complet (sans --no-vectors)."
			);
		} else {
			console.log(`[RAG] OK — ${chunks} chunks, ${vec} vecteurs (retrieval hybride disponible).`);
		}
	} catch (err) {
		console.warn("[RAG] Diagnostic au démarrage impossible:", err);
	}
}
