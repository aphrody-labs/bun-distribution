/**
 * Accès partagé de la chaîne databooks : base de données, jeton, chemin des
 * planches.
 *
 * Chaque script de la chaîne re-résolvait ces trois choses pour son compte, et
 * pas tout à fait de la même façon. Le piège est connu et coûteux :
 * `apps/site/.env` porte DEUX lignes `DATABASE_URL`, l'ancienne base Neon
 * (décommissionnée) en commentaire AVANT la locale — un `grep | head -1` tape
 * la base morte. Une seule lecture, ici, ancrée et prenant la DERNIÈRE.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import type postgres from "postgres";
import { loadDatabaseUrl } from "@shenron/db/env";
import { createSql } from "@shenron/db/sql";
import { defautCertain, signalArtefactsConnus } from "../src/lib/databooks-audit-traductions";
import { intraduisible, refus } from "../src/lib/databooks-traduction";
import { contientJaponais } from "../src/lib/ja/normalisation";
import { jetonsResiduels } from "../src/lib/ja/traduction";
import {
	DATABOOKS_FREEZE_EXIT_CODE,
	DATABOOKS_FREEZE_FILE,
	databooksFreeze,
} from "../src/lib/databooks-freeze";

/** Racine du dépôt (ce fichier vit dans `apps/site/scripts/`). */
export const RACINE_SITE = join(import.meta.dir, "..");

/**
 * Gel des écrivains databooks : tant que `<dépôt>/.coord/FREEZE-databooks.json`
 * existe, aucun script de la chaîne n'écrit en base.
 *
 * Motif (2026-09-14) : `massive-translate-worker.ts` était relancé à distance
 * après chaque mise en quarantaine et reposait des `text_fr` corrompus. Le gel
 * est vérifié en tête de chaque écrivain ET dans le chemin d'écriture partagé
 * (`ecrirePlanche`), pour qu'un écrivain oublié ne passe pas au travers.
 */
export const FICHIER_GEL_DATABOOKS = DATABOOKS_FREEZE_FILE;

/** Le gel en cours (raison lisible), ou `null` si les écritures sont permises. */
export function gelDatabooks(): { raison: string } | null {
	const freeze = databooksFreeze();
	return freeze ? { raison: freeze.reason } : null;
}

/** Code de sortie d'un écrivain arrêté par le gel. */
export const CODE_SORTIE_GEL = DATABOOKS_FREEZE_EXIT_CODE;

/** Arrête le processus (code 3) si le gel est actif. À appeler AVANT toute écriture. */
export function arretSiGel(ecrivain: string): void {
	const gel = gelDatabooks();
	if (!gel) return;
	console.error(`✗ ${ecrivain} : écritures databooks gelées (${FICHIER_GEL_DATABOOKS}).`);
	console.error(`  Raison : ${gel.raison}`);
	process.exit(CODE_SORTIE_GEL);
}

/**
 * Où vivent RÉELLEMENT les images des planches.
 *
 * Le chemin stocké en base (`./assets/wiki/databooks/<uuid>.jpg`) n'est pas un
 * chemin de disque : `serveAsset` (apps/bot) route tout `assets/wiki/*` vers le
 * `public/wiki/` du SITE. Un contrôle d'intégrité mené depuis `apps/bot/`
 * déclare donc des milliers d'images manquantes alors qu'aucune ne l'est.
 */
export const RACINE_PLANCHES = join(RACINE_SITE, "public", "wiki");

/** Chemin de disque d'une image de planche, ou `null` si la forme est inconnue. */
export function cheminPlanche(image: string | null | undefined): string | null {
	const brut = (image ?? "").trim();
	if (!brut) return null;
	const m = /assets\/wiki\/(.+)$/.exec(brut.replace(/\\/g, "/"));
	if (!m) return null;
	return join(RACINE_PLANCHES, m[1]!);
}

/** L'URL de la base du site, lue une seule fois et correctement. */
export async function urlBase(): Promise<string> {
	// Ordre : `DATABASE_URL` de l'environnement, puis `REMOTE_DATABASE_URL` de
	// `<dépôt>/.env.remote-db`, puis `DATABASE_URL` de `apps/site/.env`.
	// Le PostgreSQL local historique (5432) peut être occupé par une autre
	// application sur les postes de travail. Le tunnel DB du dépôt est alors la
	// seule route qui mène réellement à `shenron_site`; il doit donc précéder le
	// vieux `apps/site/.env`. `REMOTE_DATABASE_URL` reste un secret local, lu
	// ici sans jamais être affiché. Dans chaque fichier, la DERNIÈRE ligne active
	// gagne (`loadDatabaseUrl`) : `apps/site/.env` garde l'URL Neon d'avant la
	// migration, en commentaire, plus haut.
	const resultat = loadDatabaseUrl({
		fallbackFiles: [
			{ path: join(RACINE_SITE, "..", "..", ".env.remote-db"), varName: "REMOTE_DATABASE_URL" },
			{ path: join(RACINE_SITE, ".env"), varName: "DATABASE_URL" },
		],
	});
	if (!resultat.ok) {
		throw new Error(
			`DATABASE_URL introuvable : exporte-la, ou vérifie apps/site/.env (ancrage ^DATABASE_URL=). ${resultat.reason}`
		);
	}
	return resultat.url;
}

/** Une connexion à la base du site. À fermer par l'appelant (`sql.end()`). */
export async function connecte(): Promise<postgres.Sql> {
	return createSql({ url: await urlBase(), max: 4, applicationName: "shenron-databooks-scripts" });
}

/**
 * Le jeton d'écriture de l'API databooks.
 *
 * Les scripts de dépôt exigeaient qu'on l'exporte à la main avant chaque
 * lancement, alors qu'il est dans `apps/site/.env` à deux pas — une friction
 * pure, qui poussait à recopier le secret dans un shell d'historique.
 */
export async function jetonApi(): Promise<string> {
	const direct = (process.env.DATABOOKS_API_TOKEN ?? process.env.SHENRON_ADMIN_TOKEN ?? "").trim();
	if (direct) return direct;
	const texte = await Bun.file(join(RACINE_SITE, ".env"))
		.text()
		.catch(() => "");
	for (const nom of ["DATABOOKS_API_TOKEN", "SHENRON_ADMIN_TOKEN"]) {
		const ligne = texte
			.split("\n")
			.filter((l) => l.startsWith(`${nom}=`))
			.pop();
		const valeur = ligne
			?.slice(nom.length + 1)
			.trim()
			.replace(/^["']|["']$/g, "");
		if (valeur) return valeur;
	}
	throw new Error("jeton absent : exporte DATABOOKS_API_TOKEN ou SHENRON_ADMIN_TOKEN");
}

/** Le texte d'une planche, quelle que soit la forme sous laquelle il est stocké. */
export function texteDePlanche(page: unknown): string {
	const t = (page as { text?: unknown })?.text;
	if (typeof t === "string") return t;
	if (t && typeof t === "object" && "markdown" in t) {
		const md = (t as { markdown?: unknown }).markdown;
		return typeof md === "string" ? md : "";
	}
	return "";
}

/** La traduction française d'une planche, si elle en porte une. */
export function traductionDePlanche(page: unknown): string {
	const t = (page as { text_fr?: unknown })?.text_fr;
	if (typeof t === "string") return t;
	if (t && typeof t === "object" && "markdown" in t) {
		const md = (t as { markdown?: unknown }).markdown;
		return typeof md === "string" ? md : "";
	}
	return "";
}

/** Une planche telle qu'elle vit dans le jsonb `pages`. */
export type PlancheBrute = {
	image?: string;
	number?: number | string;
	text?: unknown;
	verifiee?: boolean;
	text_fr?: unknown;
	text_fr_by?: string;
	text_fr_at?: string;
};

/** Un ouvrage, réduit à ce dont la chaîne a besoin. */
export type Ouvrage = {
	id: number;
	title: string | null;
	category: string | null;
	visible: boolean | null;
	cover: string | null;
	pages: PlancheBrute[];
};

/** Charge les ouvrages qui portent des planches, filtrés au besoin. */
export async function chargeOuvrages(
	sql: postgres.Sql,
	filtre: { ids?: number[]; categorie?: string | null } = {}
): Promise<Ouvrage[]> {
	const { ids, categorie } = filtre;
	const lignes = await sql<
		{
			id: string | number;
			title: string | null;
			category: string | null;
			visible: boolean | null;
			cover: string | null;
			pages: PlancheBrute[] | null;
		}[]
	>`
		select id, title, category, visible, cover, pages
		from bot.db_databooks
		where pages is not null
		  ${ids?.length ? sql`and id in ${sql(ids)}` : sql``}
		  ${categorie ? sql`and category = ${categorie}` : sql``}
		order by id`;
	// `Number()` obligatoire : postgres-js rend les bigint en CHAÎNES, et une
	// comparaison lexicographique fait passer "163" pour plus petit que "35".
	return lignes.map((l) => ({
		id: Number(l.id),
		title: l.title,
		category: l.category,
		visible: l.visible,
		cover: l.cover,
		pages: Array.isArray(l.pages) ? l.pages : [],
	}));
}

/** Vrai si le fichier image d'une planche est réellement sur le disque. */
export function imagePresente(page: PlancheBrute): boolean {
	const chemin = cheminPlanche(page.image);
	return chemin !== null && existsSync(chemin);
}

// ════════════════════════════════════════════════════════════════════════════
// Garde-fou qualité avant TOUTE écriture de `text_fr`
// ════════════════════════════════════════════════════════════════════════════
//
// Relevé le 2026-09-14 sur `bot.db_databooks`, par signature d'écrivain :
//   - `shenron-massive-vps` (2 081 planches) : du bruit OCR traduit mot à mot
//     (« 的 あ 无 » → « cible Ah Non »), 567 jetons « Zêta010 » en clair ;
//   - `shenron-vps-agent` : « Terre Terre », « Capsule Cell Corporation » ;
//   - `traducteur-officiel-shenron` : le français d'une AUTRE planche ;
//   - `tesseract-5-fra` : 143 planches sur 149 dont `text_fr` est la copie
//     exacte de `text`.
// Chaque écrivain avait son juge, ou n'en avait pas. Celui-ci est unique, et
// `deposerTraduction` l'applique sans échappatoire.

const CJK = /[぀-ヿ㐀-䶿一-鿿豈-﫿]/u;

/**
 * La source est-elle du bruit d'OCR plutôt qu'un texte ? `null` si elle est saine.
 *
 * Deux signatures, mesurées sur les planches rejetées à la main :
 *   - une colonne de lignes d'un ou deux signes (cases de cartes, furigana
 *     détachés, lettres de décor lues une à une) ;
 *   - des caractères CJK isolés entre espaces (« 的 あ 无 »), que le moteur
 *     traduit un par un en une suite de mots sans lien.
 */
export function bruitOcr(source: string): string | null {
	const lignes = source
		.split(/\r?\n/)
		.map((l) => l.trim())
		.filter(Boolean);
	const courtes = lignes.filter((l) => [...l].length <= 2).length;
	if (lignes.length >= 8 && courtes / lignes.length > SEUIL_LIGNES_COURTES) {
		return `bruit OCR : ${courtes}/${lignes.length} lignes d'un ou deux signes`;
	}
	const mots = source.split(/\s+/u).filter(Boolean);
	const isoles = mots.filter((m) => [...m].length === 1 && CJK.test(m)).length;
	if (isoles >= 5 && isoles / mots.length >= SEUIL_CJK_ISOLES) {
		return `bruit OCR : ${isoles} caractères CJK isolés sur ${mots.length} mots`;
	}
	return null;
}
/**
 * Part de lignes d'un ou deux signes au-delà de laquelle la source est du bruit
 * (strictement plus de la moitié, sur 8 lignes au moins).
 */
export const SEUIL_LIGNES_COURTES = 0.5;
/** Part de mots réduits à un caractère CJK à partir de laquelle la source est du bruit. */
export const SEUIL_CJK_ISOLES = 0.3;

/**
 * Jetons de masquage qui ont fui dans la traduction : la forme maison
 * (`Zeta010`, `Zêta010`, `ZETA 010`) ET toute forme `<lettres><3 chiffres>`
 * absente de la source — un autre module de protection, un autre préfixe, la
 * même panne.
 */
export function jetonsFuyants(traduction: string, source: string): string[] {
	const fuites = new Set(jetonsResiduels(traduction));
	const src = source.toLowerCase();
	for (const m of traduction.matchAll(/(?<![\p{L}\p{N}])\p{L}{2,}\d{3}(?![\p{L}\p{N}])/gu)) {
		if (!src.includes(m[0].toLowerCase())) fuites.add(m[0]);
	}
	return [...fuites];
}

/**
 * Répétitions françaises légitimes (« nous nous battons », « non non ! »).
 * Tout le reste, doublé d'affilée sans l'être dans la source, est un artefact
 * de substitution ou de boucle.
 */
const DOUBLONS_LEGITIMES = new Set([
	"nous",
	"vous",
	"non",
	"oui",
	"si",
	"très",
	"ah",
	"oh",
	"eh",
	"ha",
	"hé",
	"he",
	"hi",
	"ho",
	"bla",
	"vite",
	"allez",
	"encore",
	"bon",
	"tic",
	"toc",
	"pan",
	"boum",
	"go",
]);

/**
 * Redoublement dans la source : « タオパイパイ », « プイプイ », « ハローハロー ».
 * Les noms de Toriyama redoublent souvent (Tao Pai Pai, Pui Pui, Kaï Kaï,
 * Shun Shun) : mesuré sur les traductions relues, c'était l'essentiel des faux
 * positifs du contrôle des doublons.
 */
const REDOUBLEMENT_SOURCE = /([ぁ-ゖァ-ヺー]{2,})[・･·\s]?\1|([一-鿿])\2|[一-鿿]々/u;

/**
 * Noms officiels redoublés du lexique (`data/lexique-db-canonique.json`) :
 * « Tao Pai Pai » s'écrit 桃白白, sans kana à redoubler.
 */
const NOMS_REDOUBLES = new Set(["pai", "pui", "muchy", "poko", "shun", "haru", "kai", "kaï", "giri"]);

/** Mots doublés d'affilée dans la traduction, absents doublés de la source. */
export function motsDoublesAjoutes(traduction: string, source: string): string[] {
	const src = source.toLowerCase();
	const redoublementSource = REDOUBLEMENT_SOURCE.test(source);
	const doublons: string[] = [];
	for (const m of traduction.matchAll(/(?<![\p{L}\p{N}])(\p{L}{2,})[ \t]+\1(?![\p{L}\p{N}])/giu)) {
		const mot = m[1]!.toLowerCase();
		// Insensible à la casse : « Terre terre » est le même artefact.
		if (DOUBLONS_LEGITIMES.has(mot) || NOMS_REDOUBLES.has(mot)) continue;
		if (src.includes(`${mot} ${mot}`)) continue;
		// Un nom redoublé court (« Pai Pai ») face à un redoublement de la source.
		if (redoublementSource && [...mot].length <= 5) continue;
		doublons.push(m[0]);
	}
	return doublons;
}

const normalise = (s: string) => s.replace(/\s+/g, " ").trim();

/** Ce qu'un écrivain s'apprête à déposer, et d'où il croit le tenir. */
export interface TravailTraduction {
	databookId: number;
	/** Numéro éditorial de la planche visée (`pages[].number`). */
	numero: number;
	/** Image de la planche au moment où le travail a été préparé. */
	image?: string | null;
	/** Texte source (`text`) au moment où le travail a été préparé. */
	source: string;
	/** Traduction française proposée. */
	traduction: string;
}

/** La planche réellement visée, telle que relue en base. */
export interface PlancheCible {
	numero: number;
	image?: string | null;
	texte: string;
}

export type Verdict = { ok: true } | { ok: false; motif: string };

/**
 * Le juge unique de dépôt d'une traduction. Refuse, dans l'ordre :
 *   1. une traduction vide ;
 *   2. une source sans japonais (ouvrage français ou page latine : rien à
 *      traduire — l'OCR d'un ouvrage français va dans `text`) ;
 *   3. une traduction identique à sa source (la copie `tesseract-5-fra`) ;
 *   4. une source bruitée (`bruitOcr`) ou intraduisible (`intraduisible`) ;
 *   5. un désalignement : numéro, image ou texte de la planche visée qui ne
 *      correspondent plus au travail préparé ;
 *   6. un jeton de masquage resté en clair (`jetonsFuyants`) ;
 *   7. les refus historiques (`refus` : japonais résiduel, boucle, rapport de
 *      longueur absurde) ;
 *   8. des mots doublés absents de la source (« Terre Terre »).
 */
export function jugerTraduction(
	travail: TravailTraduction,
	cible?: PlancheCible,
	options: {
		/**
		 * La source a été relue à l'image par un humain ou un agent de relecture :
		 * les juges de SOURCE (bruit, intraduisible) sont levés, jamais ceux de la
		 * traduction (fuite de jeton, copie, doublons, désalignement).
		 */
		sourceRelue?: boolean;
	} = {}
): Verdict {
	const fr = travail.traduction.trim();
	const source = travail.source.trim();
	if (!fr) return { ok: false, motif: "traduction vide" };
	if (!contientJaponais(source)) {
		return { ok: false, motif: "source sans japonais : pas de text_fr (l'OCR va dans text)" };
	}
	if (normalise(fr) === normalise(source)) {
		return { ok: false, motif: "traduction identique à la source (copie)" };
	}
	if (!options.sourceRelue) {
		const bruit = bruitOcr(source);
		if (bruit) return { ok: false, motif: bruit };
		const anomalie = intraduisible(source);
		if (anomalie) return { ok: false, motif: `source intraduisible (${anomalie})` };
	}
	if (cible) {
		if (cible.numero !== travail.numero) {
			return {
				ok: false,
				motif: `désalignement : planche ${cible.numero} au lieu de ${travail.numero}`,
			};
		}
		if (travail.image !== undefined && (cible.image ?? "") !== (travail.image ?? "")) {
			return { ok: false, motif: "désalignement : l'image de la planche a changé" };
		}
		if (cible.texte.trim() !== source) {
			return { ok: false, motif: "désalignement : le texte source de la planche a changé" };
		}
	}
	const fuites = jetonsFuyants(fr, source);
	if (fuites.length) {
		return { ok: false, motif: `jeton de masquage non restauré (${fuites.slice(0, 3).join(", ")})` };
	}
	// Détecteurs de l'audit a posteriori (`databooks-audit-traductions.ts`) : ce
	// qui met une planche en quarantaine ne doit pas pouvoir y être redéposé.
	const certain = defautCertain(fr, source) ?? signalArtefactsConnus(fr);
	if (certain) return { ok: false, motif: certain.detail };
	const defaut = refus(fr, source);
	if (defaut) return { ok: false, motif: defaut };
	const doublons = motsDoublesAjoutes(fr, source);
	if (doublons.length) {
		return { ok: false, motif: `mots doublés absents de la source (${doublons.slice(0, 3).join(", ")})` };
	}
	return { ok: true };
}

// ════════════════════════════════════════════════════════════════════════════
// Écriture atomique d'UNE planche
// ════════════════════════════════════════════════════════════════════════════
//
// Le motif fautif, présent dans six écrivains : lire `pages`, modifier la copie
// JS, puis `UPDATE … SET pages = <tableau entier>`. Deux écrivains concurrents
// sur un même ouvrage s'écrasent : le second réécrit l'état d'AVANT le premier.
// Et un index calculé sur une lecture périmée pose la traduction sur la
// mauvaise planche.
//
// Ici, une seule instruction SQL : la planche est trouvée par son numéro, dans
// la version de la ligne que l'UPDATE modifie, et la condition
// `pages -> idx = <élément lu>` est réévaluée par PostgreSQL si une transaction
// concurrente a modifié la ligne entre-temps (READ COMMITTED, recheck de
// l'UPDATE) : l'écriture échoue proprement au lieu d'écraser.

/** Gardes optimistes : l'écriture n'a lieu que si la planche est encore telle qu'on l'a lue. */
export interface GardePlanche {
	/** `text` attendu (comparé espaces de bord retirés). `""` = doit être vide. */
	texte?: string;
	/** `text_fr` attendu (comparé espaces de bord retirés). `""` = doit être vide. */
	traduction?: string;
	/** `image` attendue. */
	image?: string | null;
}

export interface ResultatEcriture {
	applique: boolean;
	/** Index 0-based de la planche dans le tableau, si trouvée. */
	index: number | null;
	/** Valeurs avant écriture (si appliquée). */
	avant: { texte: string; traduction: string } | null;
	/** Pourquoi l'écriture n'a pas eu lieu. */
	motif?: string;
}

/** Une connexion ou une transaction. */
type Sql = postgres.Sql | postgres.TransactionSql;

/**
 * Pose (et/ou retire) des clés sur UNE planche, en une instruction SQL, sous
 * gardes optimistes. Ne lève pas sur un conflit : rend `applique: false` et le
 * motif.
 *
 * `options.table` n'existe que pour les tests (table temporaire).
 */
export async function ecrirePlanche(
	connexion: Sql,
	cible: { databookId: number; numero: number },
	modification: { poser?: Record<string, unknown>; retirer?: string[] },
	garde: GardePlanche = {},
	options: { table?: string } = {}
): Promise<ResultatEcriture> {
	// Gel : jamais d'écriture sur `bot.db_databooks` tant que le fichier existe.
	// Seule la table temporaire des tests (`options.table`) y échappe.
	if (!options.table) arretSiGel("ecrirePlanche");
	// Même interface d'appel pour une connexion et une transaction ; les types de
	// postgres-js ne les rendent pas assignables l'une à l'autre.
	const sql = connexion as postgres.Sql;
	if (!Number.isInteger(cible.numero) || cible.numero < 0) {
		return { applique: false, index: null, avant: null, motif: "numéro de planche invalide" };
	}
	const table = sql(options.table ?? "bot.db_databooks");
	const poser = modification.poser ?? {};
	const retirer = modification.retirer ?? [];
	const nouvelElement = retirer.reduce(
		(acc, cle) => sql`(${acc} - ${cle}::text)`,
		sql`c.p`
	);
	const texteDe = (col: postgres.PendingQuery<postgres.Row[]>) => sql`regexp_replace(coalesce(
		case jsonb_typeof(${col}->'text') when 'string' then ${col}->>'text'
			when 'object' then ${col}->'text'->>'markdown' end, ''),
		'^[[:space:]]+|[[:space:]]+$', '', 'g')`;
	const traductionDe = (col: postgres.PendingQuery<postgres.Row[]>) => sql`regexp_replace(coalesce(
		case jsonb_typeof(${col}->'text_fr') when 'string' then ${col}->>'text_fr'
			when 'object' then ${col}->'text_fr'->>'markdown' end, ''),
		'^[[:space:]]+|[[:space:]]+$', '', 'g')`;
	const cp = sql`c.p`;

	const lignes = await sql<{ idx: number; texte_avant: string; traduction_avant: string }[]>`
		with cible as (
			select d.id, (t.ord - 1)::int as idx, t.p
			from ${table} d
			cross join lateral jsonb_array_elements(
				case jsonb_typeof(d.pages) when 'array' then d.pages else '[]'::jsonb end
			) with ordinality as t(p, ord)
			where d.id = ${cible.databookId}
			  and jsonb_typeof(t.p) = 'object'
			  and case when (t.p->>'number') ~ '^[0-9]+$'
			           then (t.p->>'number')::numeric = ${cible.numero}
			           else false end
		)
		update ${table} d
		set pages = jsonb_set(d.pages, array[c.idx::text], ${nouvelElement} || ${sql.json(poser as postgres.JSONValue)}, false)
		from cible c
		where d.id = c.id
		  and (select count(*) from cible) = 1
		  and d.pages -> c.idx = c.p
		  ${garde.texte !== undefined ? sql`and ${texteDe(cp)} = ${garde.texte.trim()}` : sql``}
		  ${garde.traduction !== undefined ? sql`and ${traductionDe(cp)} = ${garde.traduction.trim()}` : sql``}
		  ${garde.image !== undefined ? sql`and coalesce(c.p->>'image', '') = ${garde.image ?? ""}` : sql``}
		returning c.idx, ${texteDe(cp)} as texte_avant, ${traductionDe(cp)} as traduction_avant`;

	const ligne = lignes[0];
	if (ligne) {
		return {
			applique: true,
			index: Number(ligne.idx),
			avant: { texte: ligne.texte_avant, traduction: ligne.traduction_avant },
		};
	}

	// Rien d'écrit : on dit pourquoi, sinon l'appelant ne sait pas s'il doit
	// relire, réessayer ou abandonner.
	const etat = await sql<{ n: number; idx: number | null; texte: string; traduction: string; image: string }[]>`
		select count(*)::int as n, min(t.ord - 1)::int as idx,
			min(${texteDe(sql`t.p`)}) as texte, min(${traductionDe(sql`t.p`)}) as traduction,
			min(coalesce(t.p->>'image', '')) as image
		from ${table} d
		cross join lateral jsonb_array_elements(
			case jsonb_typeof(d.pages) when 'array' then d.pages else '[]'::jsonb end
		) with ordinality as t(p, ord)
		where d.id = ${cible.databookId}
		  and jsonb_typeof(t.p) = 'object'
		  and case when (t.p->>'number') ~ '^[0-9]+$'
		           then (t.p->>'number')::numeric = ${cible.numero}
		           else false end`;
	const e = etat[0];
	let motif = "écriture concurrente : planche modifiée entre la lecture et l'écriture";
	if (!e || e.n === 0) motif = "planche absente de l'ouvrage";
	else if (e.n > 1) motif = `numéro de planche ambigu (${e.n} planches)`;
	else if (garde.image !== undefined && e.image !== (garde.image ?? "")) motif = "garde image : la planche a changé d'image";
	else if (garde.texte !== undefined && e.texte !== garde.texte.trim()) motif = "garde texte : le texte source a changé";
	else if (garde.traduction !== undefined && e.traduction !== garde.traduction.trim()) {
		motif = garde.traduction.trim() === "" ? "garde traduction : planche déjà traduite" : "garde traduction : la traduction a changé";
	}
	return { applique: false, index: e?.idx ?? null, avant: null, motif };
}

export type StatutDepot = "ecrite" | "rejetee" | "conflit";

export interface ResultatDepot {
	statut: StatutDepot;
	motif?: string;
	/** Traduction précédente (si écrite), pour la révision wiki. */
	avant?: string;
	/** Traduction effectivement posée (si écrite). */
	apres?: string;
}

/**
 * Dépose la traduction d'UNE planche : juge (`jugerTraduction`) puis écriture
 * atomique sous gardes (texte source, image, traduction précédente).
 *
 * Par défaut, `traductionAttendue = ""` : on ne remplit qu'une planche non
 * traduite. Une relecture qui remplace une traduction passe la valeur lue.
 *
 * Une planche rejetée est journalisée et sautée, jamais écrite.
 */
export async function deposerTraduction(
	sql: Sql,
	travail: TravailTraduction & { par: string; traductionAttendue?: string },
	options: { table?: string; journal?: (ligne: string) => void; sourceRelue?: boolean } = {}
): Promise<ResultatDepot> {
	const journal = options.journal ?? ((l: string) => console.warn(l));
	const verdict = jugerTraduction(travail, undefined, { sourceRelue: options.sourceRelue });
	if (!verdict.ok) {
		journal(`  [rejet] #${travail.databookId} p.${travail.numero} — ${verdict.motif}`);
		return { statut: "rejetee", motif: verdict.motif };
	}
	const fr = travail.traduction.trim();
	const res = await ecrirePlanche(
		sql,
		{ databookId: travail.databookId, numero: travail.numero },
		{ poser: { text_fr: fr, text_fr_by: travail.par, text_fr_at: Date.now() } },
		{
			texte: travail.source,
			traduction: travail.traductionAttendue ?? "",
			...(travail.image !== undefined ? { image: travail.image } : {}),
		},
		{ table: options.table }
	);
	if (!res.applique) {
		journal(`  [conflit] #${travail.databookId} p.${travail.numero} — ${res.motif}`);
		return { statut: "conflit", motif: res.motif };
	}
	return { statut: "ecrite", avant: res.avant?.traduction ?? "", apres: fr };
}

/**
 * Dépose une transcription OCR dans `text` — le champ que le lecteur du wiki
 * affiche, pour un ouvrage japonais comme pour un ouvrage français.
 *
 * Par défaut `texteAttendu = ""` : on ne remplit qu'une planche vide, jamais on
 * n'écrase une transcription existante par une lecture de confiance inconnue.
 */
export async function deposerTranscription(
	sql: Sql,
	travail: {
		databookId: number;
		numero: number;
		image?: string | null;
		texte: string;
		texteAttendu?: string;
		poserEnPlus?: Record<string, unknown>;
	},
	options: { table?: string; journal?: (ligne: string) => void } = {}
): Promise<ResultatDepot> {
	const journal = options.journal ?? ((l: string) => console.warn(l));
	const texte = travail.texte.trim();
	const motifRejet =
		texte.length < 5 ? "transcription vide ou trop courte" : bruitOcr(texte);
	if (motifRejet) {
		journal(`  [rejet] #${travail.databookId} p.${travail.numero} — ${motifRejet}`);
		return { statut: "rejetee", motif: motifRejet };
	}
	const res = await ecrirePlanche(
		sql,
		{ databookId: travail.databookId, numero: travail.numero },
		{ poser: { ...travail.poserEnPlus, text: texte } },
		{
			texte: travail.texteAttendu ?? "",
			...(travail.image !== undefined ? { image: travail.image } : {}),
		},
		options
	);
	if (!res.applique) {
		journal(`  [conflit] #${travail.databookId} p.${travail.numero} — ${res.motif}`);
		return { statut: "conflit", motif: res.motif };
	}
	return { statut: "ecrite", avant: res.avant?.texte ?? "", apres: texte };
}
