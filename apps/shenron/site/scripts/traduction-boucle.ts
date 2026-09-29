#!/usr/bin/env bun
/**
 * traduction-boucle.ts — la traduction des planches de databooks, en boucle,
 * sur cette machine, sans personne devant l'écran.
 *
 * Le corpus compte 13 592 planches transcrites et quelques centaines traduites.
 * Le rythme d'un agent de conversation — un lot, une relecture, un dépôt — ne
 * couvre pas ce volume : il couvre les ouvrages qui comptent. Pour le reste, il
 * faut une boucle qui tourne pendant qu'on fait autre chose.
 *
 * Ce script ne remplace donc pas la traduction relue, il **la précède** :
 *   - il ne sort que des planches saines (la file `planches-a-traduire.ts`
 *     écarte déjà les transcriptions fautives — traduire une hallucination la
 *     blanchit en la rendant lisible, c'est le pire résultat possible) ;
 *   - il protège le vocabulaire du domaine par le lexique du wiki, sans quoi
 *     `界王拳` ressort en « poing du roi » et `ベジータ` en « Végitta » ;
 *   - il passe chaque sortie par le MÊME juge que le dépôt manuel (`refus`) ;
 *   - il **signe ce qu'il dépose** (`text_fr_by = machine:<moteur>`), pour qu'une
 *     passe humaine ou un agent de relecture puisse retrouver et reprendre
 *     exactement ce qui vient d'une machine.
 *
 * Quatre moteurs, dans cet ordre de préférence :
 *
 *   `aphrody` — le CLI local (`aphrody chat --prompt`). Quand sa session est
 *               valide, c'est un modèle d'instruction : il comprend une consigne,
 *               un lexique et une mise en page, donc il rend des planches
 *               structurées (tableaux de puissance, fiches de personnage) que la
 *               traduction automatique classique massacre.
 *   `google`  — Google Traduction sans clé ni compte, par l'émulateur d'API de
 *               bxc (`bxc google translate --serve`, 127.0.0.1:8089). Il traduit
 *               un LOT de segments par appel, ce qui le rend tenable sur 12 000
 *               planches, et il rend les tableaux correctement. Mesuré le
 *               2026-09-12 : disponible quand `aphrody chat` est en 401.
 *   `nllb`    — NLLB-200 distillé, **hors ligne**, via `@huggingface/transformers`
 *               (le même cache de modèles que le RAG). Aucune clé, aucun compte,
 *               aucun réseau. Il traduit de la prose correctement et bute sur les
 *               listes : le juge en refuse une bonne part, c'est voulu.
 *
 * `--moteur auto` (défaut) sonde `aphrody`, puis `agy`, puis retombe sur
 * `google`. NLLB reste le dernier recours : il est le seul à tourner sans
 * réseau, mais c'est aussi celui que le juge refuse le plus.
 * Un moteur indisponible n'interrompt jamais la boucle : il la fait basculer.
 *
 * SIMULATION PAR DÉFAUT : sans `--appliquer`, rien n'est écrit en base.
 *
 * Usage :
 *   bun apps/shenron/site/scripts/traduction-boucle.ts --lots 1              # un lot, à blanc
 *   bun apps/shenron/site/scripts/traduction-boucle.ts --lots 5 --appliquer
 *   bun apps/shenron/site/scripts/traduction-boucle.ts --databook 12 --appliquer
 *   bun apps/shenron/site/scripts/traduction-boucle.ts --moteur google --lots 0 --appliquer  # jusqu'à épuisement
 */
import postgres from "postgres";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { arretSiGel, jugerTraduction } from "./_databooks-base";
import { protegerTermes, restaurerJetons, segmentsTraduisibles } from "../src/lib/ja/traduction";
import { trierLexique, type TermeLexique } from "../src/lib/ja/anomalies";
import { contientJaponais } from "../src/lib/ja/normalisation";

// Gel des écrivains : sortie 3 avant toute sonde ou connexion si
// .coord/FREEZE-databooks.json existe.
arretSiGel("traduction-boucle");

const RACINE = fileURLToPath(new URL("..", import.meta.url)); // apps/shenron/site/
const DEPOT = join(RACINE, "..", "..");

const args = process.argv.slice(2);
const flag = (n: string) => args.includes(`--${n}`);
const opt = (n: string, def?: string) => {
	const i = args.indexOf(`--${n}`);
	return i >= 0 ? (args[i + 1] ?? def) : def;
};

const APPLIQUER = flag("appliquer");
/** `--lots 0` = jusqu'à épuisement de la file. */
const LOTS = Number(opt("lots", "1")) || 0;
const TAILLE = Math.max(1, Math.min(60, Number(opt("taille", "20")) || 20));
const DATABOOK = opt("databook");
const MOTEUR_DEMANDE = (opt("moteur", "auto") ?? "auto") as
	| "auto"
	| "aphrody"
	| "aphrody-translate"
	| "agy"
	| "google"
	| "nllb";
/** bxc depuis ses sources : le binaire compilé est cassé pour ces commandes. */
const BXC_CLI =
	process.env.BXC_CLI ??
	(process.env.BXC_ROOT
		? join(process.env.BXC_ROOT, "src", "cli", "index.ts")
		: join(DEPOT, "..", "aphrody-web", "apps", "bxc", "src", "cli", "index.ts"));
const BXC_COMMAND = BXC_CLI.endsWith(".ts") ? ["bun", BXC_CLI] : [BXC_CLI];
const MODELE = opt("modele") ?? "Xenova/nllb-200-distilled-600M";
/** Aphrody accepts `google`, not the BXC CLI label; BXC remains a separate fallback engine. */
const APHRODY_TRANSLATE_BACKEND = process.env.APHRODY_TRANSLATE_BACKEND ?? "bxc";
const APHRODY_TRANSLATE_CANDIDATES = [
	process.env.APHRODY_TRANSLATE_BIN,
	Bun.which("aphrody") ?? (process.platform === "win32" ? "aphrody.exe" : "aphrody"),
	join(DEPOT, "..", "aphrody-ai", "target", "release", process.platform === "win32" ? "aphrody-translate.exe" : "aphrody-translate"),
	process.platform === "win32" ? "aphrody-translate.exe" : "aphrody-translate",
	"/srv/aphrody/current/bin/aphrody-translate",
].filter((value): value is string => Boolean(value));
const APHRODY_TOKEN_PREFIX = "QXZ";
/** Four digits make `QXZ0001` unambiguous when a source digit follows it. */
const APHRODY_TOKEN_WIDTH = 4;
const SHARDS = Math.max(1, Number(opt("shards", "1")) || 1);
const SHARD_INDEX = Math.max(0, Math.min(SHARDS - 1, Number(opt("shard-index", "0")) || 0));
const WORKER_ID = (opt("worker-id", `worker-${SHARD_INDEX}`) ?? `worker-${SHARD_INDEX}`).replace(/[^a-zA-Z0-9_-]/g, "_");
const EXCLUDE_FILE = join(tmpdir(), `traduction-boucle-${WORKER_ID}-exclusions.txt`);
const exclusions = new Set<string>();

function clefPlanche(p: Planche): string {
	return `${p.databookId}:${p.page}`;
}

async function sauvegardeExclusions(): Promise<void> {
	await Bun.write(EXCLUDE_FILE, `${[...exclusions].join("\n")}\n`);
}

async function urlBase(): Promise<string> {
	const direct = process.env.DATABASE_URL?.trim();
	if (direct) return direct;
	const texte = await Bun.file(join(RACINE, ".env"))
		.text()
		.catch(() => "");
	// La DERNIÈRE : `.env` porte l'ancienne URL Neon AVANT la locale.
	const valeur = texte
		.split("\n")
		.filter((l) => l.startsWith("DATABASE_URL="))
		.at(-1)
		?.slice("DATABASE_URL=".length)
		.trim()
		.replace(/^["']|["']$/g, "");
	if (!valeur) throw new Error("DATABASE_URL introuvable");
	return valeur;
}

const sql = postgres(await urlBase(), { max: 2, prepare: false });

/** Où en est le corpus, en une ligne : c'est la seule mesure qui compte. */
async function avancement(): Promise<{ transcrites: number; traduites: number; part: number }> {
	const [r] = (await sql`
		select
			count(*) filter (where coalesce(p->>'text', '') <> '')::int transcrites,
			count(*) filter (where coalesce(p->>'text_fr', '') <> '')::int traduites
		from bot.db_databooks d, jsonb_array_elements(d.pages) p
		where d.visible
	`) as unknown as { transcrites: number; traduites: number }[];
	return {
		transcrites: r!.transcrites,
		traduites: r!.traduites,
		part: r!.transcrites === 0 ? 0 : r!.traduites / r!.transcrites,
	};
}

// ── Moteurs ─────────────────────────────────────────────────────────────────

/**
 * Restaure les jetons d'un segment, ou fait échouer la planche : un « Zêta010 »
 * resté en clair ne doit jamais atteindre le dépôt.
 */
function restaurerOuEchouer(traduction: string, table: Map<string, string>): string {
	const { texte, residuels } = restaurerJetons(traduction, table);
	if (residuels.length) {
		throw new Error(`jeton non restauré (${residuels.slice(0, 3).join(", ")})`);
	}
	return texte;
}

interface Planche {
	databookId: number;
	page: number;
	titre: string;
	texte: string;
}
type Terme = { ja: string; fr: string; kind: string; dansLaPlanche?: string };

/** Exécute une commande et rend sa sortie ; ne lève jamais. */
async function execute(
	argv: string[],
	timeoutMs = 180_000
): Promise<{ ok: boolean; sortie: string }> {
	try {
		const proc = Bun.spawn(argv, { cwd: DEPOT, stdout: "pipe", stderr: "pipe" });
		const minuteur = setTimeout(() => proc.kill(), timeoutMs);
		const [out, err] = await Promise.all([
			new Response(proc.stdout).text(),
			new Response(proc.stderr).text(),
		]);
		const code = await proc.exited;
		clearTimeout(minuteur);
		return { ok: code === 0, sortie: code === 0 ? out : `${out}${err}` };
	} catch (e) {
		return { ok: false, sortie: e instanceof Error ? e.message : String(e) };
	}
}

/**
 * La consigne envoyée au moteur d'instruction.
 *
 * Elle porte le lexique DU LOT (pas les 4 000 entrées du wiki) et les deux
 * interdits qui produisent les erreurs les plus coûteuses : inventer ce qu'on ne
 * lit pas, et traduire un nom propre au son.
 */
function consigne(p: Planche, lexique: Terme[]): string {
	const lex = lexique
		.slice(0, 60)
		.map((t) => `${t.dansLaPlanche ?? t.ja} = ${t.fr}`)
		.join(" · ");
	return [
		"Traduis en français cette planche d'un databook Dragon Ball japonais.",
		"Rends UNIQUEMENT la traduction, sans préambule, sans commentaire, sans guillemets.",
		"Conserve la mise en page (retours à la ligne, listes, tableaux) et les chiffres à l'identique.",
		"N'invente rien : si un passage est illisible, omets-le plutôt que de le deviner.",
		lex ? `Graphies officielles à respecter : ${lex}` : "",
		"",
		`Ouvrage : ${p.titre} — planche ${p.page}`,
		"---",
		p.texte,
	]
		.filter(Boolean)
		.join("\n");
}

/** Le moteur `aphrody` est-il utilisable maintenant ? Une seule sonde, au démarrage. */
async function aphrodyDisponible(): Promise<boolean> {
	const r = await execute(["aphrody", "chat", "--prompt", "Réponds exactement : ok"], 90_000);
	return r.ok && /\bok\b/i.test(r.sortie);
}

type Traducteur = (p: Planche, lexique: Terme[]) => Promise<string>;

async function moteurAphrody(): Promise<Traducteur> {
	return async (p, lexique) => {
		const r = await execute(["aphrody", "chat", "--prompt", consigne(p, lexique)], 240_000);
		if (!r.ok) throw new Error(`aphrody : ${r.sortie.trim().slice(0, 200)}`);
		return r.sortie.trim();
	};
}

function isAphrodyCli(bin: string): boolean {
	return /(?:^|[\\/])aphrody(?:\.exe)?$/i.test(bin) && !/aphrody-translate/i.test(bin);
}

function commandeAphrodyTranslate(bin: string, text: string): string[] {
	if (isAphrodyCli(bin)) {
		return [bin, "translate", "-s", "ja", "-t", "fr", "-b", APHRODY_TRANSLATE_BACKEND, "--", text];
	}
	return [bin, "--source", "ja", "--target", "fr", "--backend", APHRODY_TRANSLATE_BACKEND, "--", text];
}

function extraireTraductionAphrody(raw: string): string {
	const marker = /Traduction\s*:\s*([\s\S]*)$/i.exec(raw);
	return marker ? marker[1].trim() : raw.trim();
}

/** Locate Aphrody's dedicated one-shot translator without requiring Node or a global install. */
async function cheminAphrodyTranslate(): Promise<string | undefined> {
	for (const candidate of APHRODY_TRANSLATE_CANDIDATES) {
		if (candidate.includes("\\") || candidate.includes("/")) {
			if (!(await Bun.file(candidate).exists())) continue;
		} else {
			if (!Bun.which(candidate)) continue;
		}
		return candidate;
	}
	return undefined;
}

/** Probe the actual JA→FR contract, not the unrelated Aphrody chat command. */
async function aphrodyTranslateDisponible(): Promise<boolean> {
	const bin = await cheminAphrodyTranslate();
	if (!bin) return false;
	const r = await execute(
		commandeAphrodyTranslate(bin, "孫悟空は界王拳を使った。"),
		90_000
	);
	const text = extraireTraductionAphrody(r.sortie);
	return r.ok && !contientJaponais(text) && /Goku|悟空/i.test(text);
}

/** Aphrody's dedicated translator with Dragon Ball lexicon protection. */
async function moteurAphrodyTranslate(): Promise<Traducteur> {
	const bin = await cheminAphrodyTranslate();
	if (!bin) throw new Error("binaire aphrody-translate introuvable");
	return async (p, lexique) => {
		const lex = trierLexique(
			lexique.map((t) => ({ ja: t.dansLaPlanche ?? t.ja, fr: t.fr, kind: t.kind }) as TermeLexique)
		);
		const sortie: string[] = [];
		for (const segment of segmentsTraduisibles(p.texte)) {
			if (!contientJaponais(segment)) {
				sortie.push(segment);
				continue;
			}
			const { masque, table } = protegerTermes(segment, lex, {
				prefixe: APHRODY_TOKEN_PREFIX,
				largeur: APHRODY_TOKEN_WIDTH,
			});
			const r = await execute(
				commandeAphrodyTranslate(bin, masque),
				120_000
			);
			if (!r.ok) throw new Error(`aphrody-translate : ${r.sortie.trim().slice(0, 200)}`);
			const texteTraduit = extraireTraductionAphrody(r.sortie);
			const { texte: restauree, residuels } = restaurerJetons(
				texteTraduit,
				table,
				APHRODY_TOKEN_PREFIX,
				APHRODY_TOKEN_WIDTH
			);
			if (residuels.length) throw new Error(`jeton non restauré (${residuels.slice(0, 3).join(", ")})`);
			sortie.push(restauree);
		}
		return sortie.join("\n").trim();
	};
}

/**
 * Le CLI Antigravity (`aphrody agy`), mesuré le 2026-09-11.
 *
 * C'est le moteur d'instruction qui reste debout quand `aphrody chat` tombe :
 * ce jour-là, `chat` rendait un HTTP 401 (« the Google AI session has expired »)
 * sur le VPS comme sur le poste, tandis que `agy -p` répondait normalement sur
 * les deux. Les deux commandes ne partagent donc pas le même chemin
 * d'authentification, et sonder l'une ne dit rien de l'autre.
 *
 * `agy` écrit une ligne d'amorçage (« home agent + yolo câblés dans ~/.gemini »)
 * avant la réponse du modèle. La laisser passer déposerait cette phrase comme
 * traduction de la planche : on la retire.
 */
function nettoieAgy(sortie: string): string {
	return sortie
		.split(/\r?\n/)
		.filter((ligne) => !ligne.trim().startsWith('aphrody agy:'))
		.join("\n")
		.trim();
}

/** Le moteur `agy` est-il utilisable maintenant ? Une seule sonde, au démarrage. */
async function agyDisponible(): Promise<boolean> {
	const r = await execute(["aphrody", "agy", "-p", "Réponds exactement : ok"], 120_000);
	return r.ok && /\bok\b/i.test(nettoieAgy(r.sortie));
}

async function moteurAgy(): Promise<Traducteur> {
	return async (p, lexique) => {
		const r = await execute(["aphrody", "agy", "-p", consigne(p, lexique)], 240_000);
		if (!r.ok) throw new Error(`agy : ${r.sortie.trim().slice(0, 200)}`);
		return nettoieAgy(r.sortie);
	};
}

/**
 * Google Traduction, sans clé ni compte, par l'émulateur d'API de bxc.
 *
 * `bxc google translate --serve` ouvre sur 127.0.0.1:8089 un service qui parle
 * le protocole de Google Cloud Translation v2 et traduit **un lot de segments
 * par appel**. C'est ce qui le rend utilisable ici : un processus par segment
 * coûterait des heures sur 12 000 planches, un POST par planche coûte une
 * seconde.
 *
 * Sa place dans l'ordre de repli n'est pas arbitraire. Mesuré le 2026-09-12 :
 * `aphrody chat` reste en 401, `agy` répond ; ce moteur-ci répond lui aussi,
 * sans authentification, et rend correctement les tableaux et les listes que
 * NLLB refuse. Il passe donc devant NLLB, qui reste le dernier recours parce
 * qu'il est le seul à fonctionner sans réseau.
 *
 * Le masquage du lexique reste indispensable malgré les progrès du moteur : il
 * rend parfois `界王拳` par « Kaioken » et parfois par « le poing du roi », et
 * seule la forme officielle du wiki doit atterrir en base.
 */
const PORT_GOOGLE = Number(opt("port-google", "8089"));

async function googleDisponible(): Promise<boolean> {
	try {
		const r = await fetch(`http://127.0.0.1:${PORT_GOOGLE}/language/translate/v2`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ q: ["テスト"], source: "ja", target: "fr" }),
			signal: AbortSignal.timeout(8_000),
		});
		return r.ok;
	} catch {
		return false;
	}
}

async function moteurGoogle(): Promise<Traducteur> {
	if (!(await googleDisponible())) {
		// Le service n'est pas là : on le lève et on le laisse vivre le temps de
		// la boucle. `unref` évite qu'il retienne le script à la sortie.
		const proc = Bun.spawn([...BXC_COMMAND, "google", "translate", "--serve"], {
			stdout: "ignore",
			stderr: "ignore",
		});
		proc.unref();
		for (let essai = 0; essai < 15; essai++) {
			await Bun.sleep(1_000);
			if (await googleDisponible()) break;
		}
		if (!(await googleDisponible())) {
			throw new Error(`émulateur Google injoignable sur 127.0.0.1:${PORT_GOOGLE}`);
		}
	}

	return async (p, lexique) => {
		const lex = trierLexique(
			lexique.map((t) => ({ ja: t.dansLaPlanche ?? t.ja, fr: t.fr, kind: t.kind }) as TermeLexique)
		);
		const segments = segmentsTraduisibles(p.texte);
		// Un segment déjà latin (crédits, ISBN, numéro de tome) ne part pas au
		// moteur : il en reviendrait « traduit ».
		const aTraduire: { index: number; masque: string; table: Map<string, string> }[] = [];
		const sortie: string[] = segments.map((s) => s);
		segments.forEach((segment, index) => {
			if (!contientJaponais(segment)) return;
			const { masque, table } = protegerTermes(segment, lex);
			aTraduire.push({ index, masque, table });
		});
		if (aTraduire.length === 0) return p.texte;

		const reponse = await fetch(`http://127.0.0.1:${PORT_GOOGLE}/language/translate/v2`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ q: aTraduire.map((s) => s.masque), source: "ja", target: "fr" }),
			signal: AbortSignal.timeout(120_000),
		});
		if (!reponse.ok) throw new Error(`google : HTTP ${reponse.status}`);
		const data = (await reponse.json()) as {
			data?: { translations?: { translatedText?: string }[] };
		};
		const traductions = data.data?.translations ?? [];
		if (traductions.length !== aTraduire.length) {
			// Un lot rendu incomplet recollerait la traduction d'un segment sur un
			// autre : mieux vaut échouer la planche que la fausser.
			throw new Error(`google : ${traductions.length} traductions pour ${aTraduire.length} segments`);
		}
		aTraduire.forEach((s, i) => {
			sortie[s.index] = restaurerOuEchouer(traductions[i]?.translatedText ?? "", s.table);
		});
		return sortie.join("\n").trim();
	};
}

/**
 * NLLB-200, hors ligne. Le modèle traduit une phrase à la fois : on découpe, on
 * masque les termes du domaine, on traduit, on restaure. Un segment déjà latin
 * (crédits, ISBN) ne passe pas par le modèle — il en ressortirait déformé.
 */
async function moteurNllb(): Promise<Traducteur> {
	const { env, pipeline } = await import("@huggingface/transformers");
	// Cache partagé avec les modèles du RAG : inutile de dupliquer des gigaoctets.
	env.cacheDir = join(DEPOT, "apps/shenron/bot/.models");
	console.log(`chargement de ${MODELE} (hors ligne)…`);
	const t0 = Date.now();
	const pipe = (await pipeline("translation", MODELE, { dtype: "q8" })) as unknown as (
		t: string,
		o: Record<string, unknown>
	) => Promise<{ translation_text: string }[]>;
	console.log(`  prêt en ${Math.round((Date.now() - t0) / 1000)} s`);

	return async (p, lexique) => {
		const lex = trierLexique(
			lexique.map((t) => ({ ja: t.dansLaPlanche ?? t.ja, fr: t.fr, kind: t.kind }) as TermeLexique)
		);
		const morceaux: string[] = [];
		for (const segment of segmentsTraduisibles(p.texte)) {
			if (!contientJaponais(segment)) {
				morceaux.push(segment);
				continue;
			}
			const { masque, table } = protegerTermes(segment, lex);
			const sortie = (
				await pipe(masque, { src_lang: "jpn_Jpan", tgt_lang: "fra_Latn", max_new_tokens: 220 })
			)[0]!.translation_text;
			morceaux.push(restaurerOuEchouer(sortie, table));
		}
		return morceaux.join("\n").trim();
	};
}

// ── Boucle ──────────────────────────────────────────────────────────────────

const depart = await avancement();
console.log(
	`corpus : ${depart.traduites}/${depart.transcrites} planches traduites ` +
		`(${(depart.part * 100).toFixed(1)} %) — objectif 100 %`
);

let moteur: "aphrody" | "aphrody-translate" | "agy" | "google" | "nllb";
if (MOTEUR_DEMANDE === "auto") {
	process.stdout.write("sonde du moteur aphrody-translate… ");
	moteur = (await aphrodyTranslateDisponible())
		? "aphrody-translate"
		: (await aphrodyDisponible())
			? "aphrody"
			: (await agyDisponible())
				? "agy"
				: "google";
	console.log(
		moteur === "aphrody-translate"
			? "disponible (JA→FR dédié)"
			: moteur === "aphrody"
				? "disponible"
			: moteur === "agy"
				? "chat indisponible, repli sur agy (Antigravity)"
				: "indisponible, repli sur google (bxc, sans clé)"
	);
} else {
	moteur = MOTEUR_DEMANDE;
}
/** Un moteur qui ne se lève pas fait basculer la boucle, il ne l'arrête pas. */
async function traducteur(m: typeof moteur): Promise<Traducteur> {
	switch (m) {
		case "aphrody-translate":
			return moteurAphrodyTranslate();
		case "aphrody":
			return moteurAphrody();
		case "agy":
			return moteurAgy();
		case "google":
			return moteurGoogle();
		default:
			return moteurNllb();
	}
}
let traduire: Traducteur;
try {
	traduire = await traducteur(moteur);
} catch (e) {
	if (moteur === "nllb") throw e;
	console.log(`  ${moteur} indisponible (${e instanceof Error ? e.message : e}) — repli sur nllb`);
	moteur = "nllb";
	traduire = await moteurNllb();
}
const SIGNATURES: Record<typeof moteur, string> = {
	"aphrody-translate": "machine:aphrody-translate",
	aphrody: "machine:aphrody",
	agy: "machine:agy",
	google: "machine:google",
	nllb: "machine:nllb-200",
};
const signature = SIGNATURES[moteur];

let lot = 0;
let deposees = 0;
let refusees = 0;
let echecs = 0;

while (LOTS === 0 || lot < LOTS) {
	lot++;
	const fichierLot = join(tmpdir(), `traduction-boucle-${WORKER_ID}-lot-${lot}.json`);
	const argvFile = [
		process.execPath,
		join(import.meta.dir, "planches-a-traduire.ts"),
		"--lot",
		String(TAILLE),
		"--json",
		fichierLot,
		"--shards",
		String(SHARDS),
		"--shard-index",
		String(SHARD_INDEX),
		"--exclure",
		EXCLUDE_FILE,
		...(DATABOOK ? ["--databook", DATABOOK] : []),
	];
	const file = await execute(argvFile, 300_000);
	if (!file.ok) {
		console.error(`✗ file : ${file.sortie.trim().slice(0, 300)}`);
		break;
	}
	const { planches, lexique, reste } = (await Bun.file(fichierLot).json()) as {
		planches: Planche[];
		lexique: Terme[];
		reste: number;
	};
	if (planches.length === 0) {
		console.log("file vide — plus rien à traduire avec ces critères.");
		break;
	}
	console.log(
		`\n── lot ${lot} : ${planches.length} planches, ${lexique.length} termes de lexique, ${reste} en attente`
	);

	const lignes: string[] = [];
	for (const p of planches) {
		let fr: string;
		try {
			fr = await traduire(p, lexique);
		} catch (e) {
			echecs++;
			console.log(`  ✗ ${p.databookId}#${p.page} — ${e instanceof Error ? e.message : e}`);
			continue;
		}
		// Le juge UNIQUE de dépôt (`jugerTraduction`) : bruit OCR, copie, jeton non
		// restauré, doublons, kana résiduels, boucle, glose, troncature. Une sortie
		// refusée n'est pas déposée, et la planche reste dans la file pour une
		// passe de meilleure qualité.
		const verdict = jugerTraduction({
			databookId: p.databookId,
			numero: p.page,
			source: p.texte,
			traduction: fr,
		});
		if (!verdict.ok) {
			refusees++;
			console.log(`  − ${p.databookId}#${p.page} — ${verdict.motif}`);
			continue;
		}
		// `ja` voyage avec la traduction : `depose-traductions` ne la pose que sur
		// la planche qui porte encore ce texte source (anti-désalignement).
		lignes.push(JSON.stringify({ databookId: p.databookId, page: p.page, fr, ja: p.texte }));
	}

	if (lignes.length === 0) {
		console.log("  aucune traduction retenue sur ce lot.");
		// Ce lot ne doit pas être rejoué indéfiniment avec le même moteur. Les
		// pages sont exclues uniquement pour cette session et pourront être
		// retentées lors d'une prochaine passe avec un autre moteur/relecture.
		for (const p of planches) exclusions.add(clefPlanche(p));
		await sauvegardeExclusions();
		continue;
	}
	const fichierJsonl = join(tmpdir(), `traduction-boucle-${WORKER_ID}-lot-${lot}.jsonl`);
	await Bun.write(fichierJsonl, `${lignes.join("\n")}\n`);

	const argvDepot = [
		"bun",
		"apps/shenron/site/scripts/depose-traductions.ts",
		fichierJsonl,
		"--par",
		signature,
		...(APPLIQUER ? ["--appliquer"] : []),
	];
	const depot = await execute(argvDepot, 300_000);
	const resume = depot.sortie.trim().split("\n").at(-1) ?? "";
	console.log(`  ${APPLIQUER ? "dépôt" : "simulation"} : ${lignes.length} retenues · ${resume}`);
	if (APPLIQUER && depot.ok) deposees += lignes.length;
	if (depot.ok || !APPLIQUER) {
		for (const p of planches) exclusions.add(clefPlanche(p));
	} else {
		for (const p of planches) {
			if (!lignes.some((ligne) => ligne.includes(`\"databookId\":${p.databookId},\"page\":${p.page}`))) {
				exclusions.add(clefPlanche(p));
			}
		}
	}
	await sauvegardeExclusions();

	// Sans `--appliquer`, la file ne bouge pas : boucler dessus rejouerait le
	// même lot indéfiniment. On s'arrête après le premier, qui suffit à mesurer.
	if (!APPLIQUER) {
		console.log("\n→ simulation : un seul lot joué. Relancer avec --appliquer pour dérouler.");
		break;
	}
}

const fin = await avancement();
console.log(
	`\n${moteur} · ${deposees} déposées, ${refusees} refusées par le juge, ${echecs} en échec moteur`
);
console.log(
	`corpus : ${depart.traduites} → ${fin.traduites} / ${fin.transcrites} ` +
		`(${(depart.part * 100).toFixed(1)} % → ${(fin.part * 100).toFixed(1)} %)`
);
await sql.end();
