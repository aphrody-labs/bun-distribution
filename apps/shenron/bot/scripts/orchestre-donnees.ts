#!/usr/bin/env bun
import { userHome } from "@aphrody/paths";
/**
 * orchestre-donnees.ts — la chaîne complète qui mène les données du dépôt
 * jusqu'à ce que l'API sert réellement.
 *
 * Le dépôt possède beaucoup plus de matière que ses surfaces n'en montrent :
 * des planches de databooks traduites la nuit même, des fiches de wiki
 * réécrites, un corpus de citations d'auteur. Chacune a son script, chacun
 * marche — et personne ne sait, à un instant donné, lequel est en retard sur
 * l'autre. Le résultat se voit à l'usage : `/ask` cite encore l'ancienne fiche
 * de Goku, `rag_search` ignore une planche traduite il y a une heure.
 *
 * Ce script ne réinvente aucune ingestion. Il **ordonne** celles qui existent,
 * mesure l'écart avant et après, et écrit un rapport que l'API publie. L'ordre
 * n'est pas décoratif, c'est le sens de circulation de la donnée :
 *
 *   PostgreSQL (source éditoriale)
 *     └─▶ réplica SQLite du bot        (timer `shenron-neon-pull`, /15 min)
 *           └─▶ index RAG `rag_chunks` (ce script, à chaud, différentiel)
 *                 └─▶ /api/public/rag/search, /ask, MCP, recherche du site
 *
 *   PostgreSQL (planches + corpus .aphrody)
 *     └─▶ public.canon_references      (service `shenron-canon-ingest`, /15 min)
 *           └─▶ /api/canon, MCP canon_check, /wiki/canon
 *
 * Un maillon qu'on saute ne casse rien : il fait servir du périmé, en silence.
 * C'est précisément ce que le rapport rend visible.
 *
 * SIMULATION PAR DÉFAUT — sans `--appliquer`, rien n'est écrit nulle part.
 *
 * Usage :
 *   bun apps/shenron/bot/scripts/orchestre-donnees.ts                 # état + écarts
 *   bun apps/shenron/bot/scripts/orchestre-donnees.ts --appliquer     # exécute la chaîne
 *   bun apps/shenron/bot/scripts/orchestre-donnees.ts --sans-canon --appliquer
 *   bun apps/shenron/bot/scripts/orchestre-donnees.ts --sans-rag --appliquer
 */
import { Database } from "bun:sqlite";
import postgres from "postgres";
import { join } from "node:path";
import { AphrodyComputeClient } from "@shenron/pipeline/aphrody";

const ROOT = new URL("..", import.meta.url).pathname; // apps/shenron/bot/
const DEPOT = join(ROOT, "..", "..");
const DBP = process.env.RAG_DB ?? join(ROOT, "data/bot.db");
const RAPPORT = join(ROOT, "data/orchestration.json");

const args = new Set(process.argv.slice(2));
const APPLIQUER = args.has("--appliquer");
const SANS_CANON = args.has("--sans-canon");
const SANS_RAG = args.has("--sans-rag");
const SANS_CORPUS = args.has("--sans-corpus");
const RAG_APHRODY = process.env.RAG_BACKEND === "aphrody";
async function remoteRagStats() {
	try { return await new AphrodyComputeClient().ragStats(); }
	catch { return null; }
}

/** `apps/shenron/site/.env` porte DEUX `DATABASE_URL` (l'ancienne Neon d'abord) : la DERNIÈRE fait foi. */
async function urlPostgres(): Promise<string> {
	const direct = process.env.DATABASE_URL?.trim();
	if (direct) return direct;
	for (const chemin of [
		join(DEPOT, "apps/shenron/site/.env"),
		join(userHome(), ".shenron-neon.env"),
	]) {
		const texte = await Bun.file(chemin)
			.text()
			.catch(() => "");
		const valeur = texte
			.split("\n")
			.findLast((l) => l.startsWith("DATABASE_URL="))
			?.slice("DATABASE_URL=".length)
			.trim()
			.replace(/^["']|["']$/g, "");
		if (valeur) return valeur;
	}
	throw new Error("DATABASE_URL introuvable (env, apps/shenron/site/.env, ~/.shenron-neon.env).");
}

interface Etape {
	nom: string;
	role: string;
	statut: "ok" | "ignoré" | "écart" | "échec";
	detail: string;
	duree_ms?: number;
}

const etapes: Etape[] = [];
const t0 = Date.now();

function journal(e: Etape) {
	etapes.push(e);
	const icone = { ok: "✓", ignoré: "·", écart: "→", échec: "✗" }[e.statut];
	console.log(`${icone} ${e.nom} — ${e.detail}`);
}

/** Exécute un script du dépôt et rend sa sortie, sans jamais lever. */
async function lance(
	nom: string,
	argv: string[]
): Promise<{ ok: boolean; sortie: string; duree: number }> {
	const debut = Date.now();
	const proc = Bun.spawn(["bun", ...argv], {
		cwd: DEPOT,
		stdout: "pipe",
		stderr: "pipe",
		env: { ...process.env },
	});
	const [sortie, erreur] = await Promise.all([
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
	]);
	const code = await proc.exited;
	const duree = Date.now() - debut;
	if (code !== 0) {
		console.error(`  ${nom} : code ${code}\n${erreur.trim().slice(0, 600)}`);
	}
	return { ok: code === 0, sortie: `${sortie}${erreur}`, duree };
}

// ── 1. Le réplica SQLite suit-il PostgreSQL ? ───────────────────────────────

const sql = postgres(await urlPostgres(), { max: 2, prepare: false });
// Lecture seule : ce script ne touche jamais l'index lui-même, il délègue
// l'écriture à `rag-resync-entites.ts`, qui ouvre sa propre connexion.
const db = new Database(DBP, { readonly: true });

/**
 * Comparer les compteurs des tables éditoriales des deux côtés.
 *
 * Le réplica est tiré toutes les quinze minutes par `shenron-neon-pull`. On ne
 * le force pas ici : le forcer doublerait le travail du timer et, surtout,
 * masquerait une panne du timer derrière un rattrapage manuel. On la SIGNALE —
 * indexer un réplica en retard produit un index qui cite du périmé sans le dire.
 */
const TABLES = [
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
] as const;

const ecartsReplica: string[] = [];
for (const table of TABLES) {
	try {
		const [pg] = (await sql.unsafe(
			`select count(*)::int n from bot.${table} where visible is not false`
		)) as unknown as { n: number }[];
		const local = db.query(`SELECT count(*) n FROM ${table}`).get() as { n: number };
		if (pg!.n !== local.n) ecartsReplica.push(`${table} ${local.n}→${pg!.n}`);
	} catch {
		ecartsReplica.push(`${table} illisible`);
	}
}
journal({
	nom: "réplica SQLite",
	role: "PostgreSQL → apps/shenron/bot/data/bot.db (timer shenron-neon-pull)",
	statut: ecartsReplica.length === 0 ? "ok" : "écart",
	detail:
		ecartsReplica.length === 0
			? `${TABLES.length} tables éditoriales alignées sur PostgreSQL`
			: `en retard : ${ecartsReplica.join(", ")} — attendre le prochain pull avant d'indexer`,
});

// ── 2. Le corpus de canonicité ──────────────────────────────────────────────

if (SANS_CANON) {
	journal({ nom: "canon", role: "corpus → public.canon_references", statut: "ignoré", detail: "--sans-canon" });
} else {
	const [avant] = (await sql`
		select count(*)::int total, count(text_fr)::int traduites
		from public.canon_references where visible
	`) as unknown as { total: number; traduites: number }[];
	if (!APPLIQUER) {
		journal({
			nom: "canon",
			role: "corpus .aphrody + planches traduites → public.canon_references",
			statut: "ok",
			detail: `${avant!.total} preuves indexées (${avant!.traduites} traduites) — le service shenron-canon-ingest repasse toutes les 15 min`,
		});
	} else {
		const r = await lance("canon-ingest", ["apps/shenron/site/scripts/canon-ingest.ts"]);
		const [apres] = (await sql`
			select count(*)::int total from public.canon_references where visible
		`) as unknown as { total: number }[];
		journal({
			nom: "canon",
			role: "corpus .aphrody + planches traduites → public.canon_references",
			statut: r.ok ? "ok" : "échec",
			detail: `${avant!.total} → ${apres!.total} preuves`,
			duree_ms: r.duree,
		});
	}
}

// ── 3. Le corpus databooks versionné (pour le build hebdomadaire) ───────────

if (SANS_CORPUS || RAG_APHRODY || !APPLIQUER) {
	const f = Bun.file(join(ROOT, "data/rag/corpus-databooks.json"));
	const age = (await f.exists()) ? Date.now() - f.lastModified : null;
	journal({
		nom: "corpus databooks",
		role: "PostgreSQL → data/rag/corpus-databooks.json (lu par rag-build)",
		statut: SANS_CORPUS || RAG_APHRODY ? "ignoré" : "ok",
		detail:
			RAG_APHRODY ? "Aphrody ingère directement les sources PostgreSQL" : age === null
				? "absent"
				: `écrit il y a ${Math.round(age / 3_600_000)} h — le build hebdomadaire lit ce fichier, pas la base`,
	});
} else {
	const r = await lance("ingest-databooks-rag", ["packages/shenron/pipeline/scripts/ingest-databooks-rag.ts"]);
	journal({
		nom: "corpus databooks",
		role: "PostgreSQL → data/rag/corpus-databooks.json (lu par rag-build)",
		statut: r.ok ? "ok" : "échec",
		detail: r.sortie.trim().split("\n").at(-1)?.slice(0, 220) ?? "",
		duree_ms: r.duree,
	});
}

// ── 3 bis. Lexique d'expansion des requêtes ─────────────────────────────────
// Les noms ajoutés au wiki dans la journée doivent être reconnus sous leurs
// graphies anglaise et japonaise dès la prochaine recherche (lu au démarrage
// du bot par `lib/rag.ts`).

if (!SANS_RAG && !RAG_APHRODY && APPLIQUER) {
	const r = await lance("rag-lexique", ["packages/shenron/pipeline/scripts/rag-lexique.ts"]);
	journal({
		nom: "lexique des requêtes",
		role: "PostgreSQL + lexique canonique → data/rag/lexique-requetes.json",
		statut: r.ok ? "ok" : "échec",
		detail: r.sortie.trim().split("\n").at(-1)?.slice(0, 220) ?? "",
		duree_ms: r.duree,
	});
}

// ── 4. L'index RAG, à chaud et en différentiel ──────────────────────────────

const remoteAvant = RAG_APHRODY ? await remoteRagStats() : null;
const chunksAvant = RAG_APHRODY ? remoteAvant?.chunks ?? 0 : (db.query("SELECT count(*) n FROM rag_chunks").get() as { n: number }).n;
if (RAG_APHRODY && !remoteAvant) journal({ nom: "Aphrody RAG", role: "statistiques du corpus distant", statut: "échec", detail: "API Aphrody indisponible" });

if (SANS_RAG) {
	journal({ nom: "index RAG", role: RAG_APHRODY ? "→ Aphrody" : "→ rag_chunks", statut: "ignoré", detail: "--sans-rag" });
} else {
	const r = await lance("rag-resync-entites", [
		"packages/shenron/pipeline/scripts/rag-resync-entites.ts",
		"--toutes",
		...(APPLIQUER ? ["--appliquer"] : []),
	]);
	// Le script rend une ligne par source : on garde le décompte global, le
	// détail reste dans sa sortie (et dans le journal systemd quand il est joué
	// par un timer).
	const resume = r.sortie
		.split("\n")
		.filter((l) => l.startsWith("→ ") || l.startsWith("✓ index"))
		.map((l) => l.trim());
	journal({
		nom: "index RAG",
		role: RAG_APHRODY ? "PostgreSQL éditorial → Aphrody RAG" : "PostgreSQL éditorial → rag_chunks + vec_chunks",
		statut: r.ok ? "ok" : "échec",
		detail: resume.at(-1) ?? "aucune sortie",
		duree_ms: r.duree,
	});
	for (const l of resume.slice(0, -1)) console.log(`    ${l}`);
}

// ── 5. Rapport ──────────────────────────────────────────────────────────────

const dbLecture = RAG_APHRODY ? null : new Database(DBP, { readonly: true });
const remoteApres = RAG_APHRODY ? await remoteRagStats() : null;
const meta = dbLecture?.query("SELECT * FROM rag_meta LIMIT 1").get() as
	| { model: string; dim: number; count: number; built_at: number }
	| undefined;
const parSource = RAG_APHRODY ? remoteApres?.sources.map((s) => ({ source_id: s.sourceId, kind: s.kind, n: s.count })) ?? [] : dbLecture!
	.query("SELECT source_id, kind, count(*) n FROM rag_chunks GROUP BY 1,2 ORDER BY n DESC")
	.all() as { source_id: string; kind: string; n: number }[];
const chunksApres = RAG_APHRODY ? remoteApres?.chunks ?? 0 : (dbLecture!.query("SELECT count(*) n FROM rag_chunks").get() as { n: number }).n;
if (RAG_APHRODY && !remoteApres) journal({ nom: "Aphrody RAG", role: "statistiques après synchronisation", statut: "échec", detail: "API Aphrody indisponible" });
dbLecture?.close();

const rapport = {
	version: 1,
	joueLe: new Date().toISOString(),
	applique: APPLIQUER,
	duree_ms: Date.now() - t0,
	index: RAG_APHRODY ? (remoteApres ? { model: "aphrody", dim: null, chunks: chunksApres, builtAt: null } : null) : meta
		? {
				model: meta.model,
				dim: meta.dim,
				chunks: chunksApres,
				builtAt: meta.built_at ? new Date(meta.built_at).toISOString() : null,
			}
		: null,
	chunks: { avant: chunksAvant, apres: chunksApres },
	sources: parSource,
	etapes,
};

if (APPLIQUER) {
	await Bun.write(RAPPORT, `${JSON.stringify(rapport, null, "\t")}\n`);
	console.log(`\n✓ rapport écrit dans ${RAPPORT.replace(DEPOT, ".")}`);
} else {
	console.log("\n→ simulation : relancer avec --appliquer pour exécuter la chaîne.");
}
console.log(
	`  index : ${chunksAvant} → ${chunksApres} chunks · ${parSource.length} couples source/type · ${((Date.now() - t0) / 1000).toFixed(1)} s`
);

db.close();
await sql.end();
process.exitCode = etapes.some((e) => e.statut === "échec") ? 1 : 0;
