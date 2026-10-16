import "server-only";

// Lectures publiques des sondages Discord — Postgres DIRECT (pas de PostgREST).
//
// Même parti pris que `./queries.ts` : la page ne dépend pas de la disponibilité
// du Data API, et les garde-fous de la RLS sont retranscrits ici en SQL. La
// policy « Lecture publique des sondages » n'autorise un sondage que si son
// salon est `suivi` ; le pool serveur se connecte en rôle propriétaire (donc
// hors RLS), c'est donc à ces requêtes de ne jamais publier plus qu'un visiteur
// anonyme n'aurait le droit de lire.
//
// ─── LIGNE ROUGE ────────────────────────────────────────────────────────────
// La table des votes NOMINATIFS (celle qui dit qui a voté quoi) est non
// publique par décision explicite : aucune policy de lecture n'existe dessus,
// et aucune requête de ce fichier ne la touche — ni en JOIN, ni en
// sous-requête, ni en `count(*)`. Son nom n'apparaît volontairement nulle part
// ici : un contrôle mécanique (`grep` sur `apps/website/src`) doit rester muet.
// Aucun agrégat croisé non plus (« N membres du rôle X ont voté Y ») : sur un
// salon de quelques dizaines de comptes actifs, un tel croisement ré-identifie.
// Si vous complétez ce module de bonne foi, cette interdiction tient toujours.
// ────────────────────────────────────────────────────────────────────────────

import { getPgPool } from "@/lib/db/pg";
import { SITE_URL } from "@/lib/site-url";

import { CONTEXTE_MENTIONS_VIDE, type ContexteMentions } from "./markdown-ast";
import type { OptionSondage, Sondage, VisuelSondage } from "./polls-types";
import { construireContexteMentions } from "./queries";
import { type MessageDiscord, normaliserMessage } from "./types";

/** Sondages affichés par page de liste. */
export const SONDAGES_PAR_PAGE = 12;

/** Borne dure : personne ne demande 10 000 sondages via `?parPage=`. */
const SONDAGES_PAR_PAGE_MAX = 48;

/** Longueur maximale acceptée pour la recherche (au-delà, on tronque). */
const RECHERCHE_MAX = 120;

/*
 * ⚠ « EN COURS » EXIGE UNE DATE DE FIN, PAS SEULEMENT `ended = false`.
 * `discord_polls.ended` est `not null default false` : il vaut donc `false`
 * autant pour un sondage qui tourne que pour les 25 sondages de 2023-2024
 * reconstitués depuis les réactions, dont l'encart n'a jamais publié de clôture.
 * Les compter « en cours » faisait annoncer « 25 en cours » en août 2026 sur des
 * sondages clos depuis deux ans. Le marqueur qui distingue les deux est
 * `ends_at` : présente sur les 26 encarts complets, absente sur les 25 autres.
 * Même règle que `etatSondage()` dans `polls-types.ts` — les deux doivent bouger
 * ensemble.
 */
export type StatutSondage = "tous" | "en-cours" | "termines";

const STATUTS: readonly StatutSondage[] = ["tous", "en-cours", "termines"];

/** Valide un statut venu de l'URL contre la liste blanche (défaut : « tous »). */
export function normaliserStatut(valeur: unknown): StatutSondage {
	return typeof valeur === "string" && (STATUTS as readonly string[]).includes(valeur)
		? (valeur as StatutSondage)
		: "tous";
}

/**
 * Identifiant de sondage acceptable : identifiant court EasyPoll (hexadécimal)
 * ou snowflake Discord pour un sondage natif. Tout le reste part en 404 sans
 * même toucher la base.
 */
export function estIdentifiantSondage(valeur: string): boolean {
	return /^[0-9a-f]{6,32}$/.test(valeur) || /^\d{15,25}$/.test(valeur);
}

// ── Origine publique des visuels ────────────────────────────────────────────

/*
 * `NEXT_PUBLIC_SUPABASE_URL` vaut l'origine publique de l'app
 * (« https://rosegriffon.fr »). On a déjà vu cette variable écrasée par un blob
 * de secret scellé (« eyJ2Ijo… ») ; sans garde-fou, toutes les images de la
 * page pointeraient vers du JSON. Le repli interne `http://127.0.0.1:8811` est
 * neutralisé lui aussi : c'est la valeur du `.env` du cron, injouable dans un
 * navigateur. Cette origine est déjà autorisée dans `images.remotePatterns`.
 */
const ORIGINE_STOCKAGE = (() => {
	const brut = process.env.NEXT_PUBLIC_SUPABASE_URL;
	if (!brut || brut.startsWith("eyJ2Ijo") || brut.startsWith("http://127.")) {
		return SITE_URL;
	}
	return brut.replace(/\/+$/, "");
})();

/**
 * URL publique d'un visuel ré-hébergé. On ne sert JAMAIS l'URL Discord
 * d'origine : elle est signée et expire en moins de 24 h (vérifié : URL signée
 * → 200, la même sans sa query → 404). Le cron a recopié l'image dans le bucket
 * public `assets`, c'est ce chemin-là que la base conserve.
 */
function urlVisuel(chemin: string): string {
	return `${ORIGINE_STOCKAGE}/storage/v1/object/public/assets/${chemin}`;
}

// ── Normalisation défensive des lignes ──────────────────────────────────────

interface LigneSondage {
	poll_id: string;
	provider: string | null;
	source: string | null;
	language: string | null;
	message_id: string | null;
	channel_id: string;
	guild_id: string;
	question: string;
	message_content: string | null;
	creator_username: string | null;
	command: string | null;
	max_choices: number | string | null;
	locked: boolean;
	ended: boolean;
	ends_at: Date | string | null;
	created_at: Date | string;
	total_votes: number | string | null;
	total_voters: number | string | null;
	results_hidden: boolean;
	visual_path: string | null;
	visual_width: number | string | null;
	visual_height: number | string | null;
	visual_alt: string | null;
	visual_message_id: string | null;
	options: unknown;
	total?: number | string;
}

function entierOuNull(valeur: unknown): number | null {
	if (typeof valeur === "number") return Number.isFinite(valeur) ? Math.trunc(valeur) : null;
	if (typeof valeur === "string" && valeur.trim().length > 0) {
		const nombre = Number(valeur);
		return Number.isFinite(nombre) ? Math.trunc(nombre) : null;
	}
	return null;
}

function nombreOuNull(valeur: unknown): number | null {
	if (typeof valeur === "number") return Number.isFinite(valeur) ? valeur : null;
	// `numeric(5,2)` remonte en chaîne avec le pilote `pg` : « 25.80 ».
	if (typeof valeur === "string" && valeur.trim().length > 0) {
		const nombre = Number(valeur);
		return Number.isFinite(nombre) ? nombre : null;
	}
	return null;
}

function isoOuNull(valeur: unknown): string | null {
	if (valeur instanceof Date) return Number.isNaN(valeur.getTime()) ? null : valeur.toISOString();
	if (typeof valeur === "string" && valeur.length > 0) {
		const date = new Date(valeur);
		return Number.isNaN(date.getTime()) ? null : date.toISOString();
	}
	return null;
}

function normaliserOptions(valeur: unknown): OptionSondage[] {
	const brut: unknown = typeof valeur === "string" ? safeJson(valeur) : valeur;
	if (!Array.isArray(brut)) return [];
	return brut
		.map((entree): OptionSondage | null => {
			if (typeof entree !== "object" || entree === null) return null;
			const ligne = entree as Record<string, unknown>;
			const position = entierOuNull(ligne.position);
			if (position === null) return null;
			return {
				emoji: typeof ligne.emoji === "string" && ligne.emoji.length > 0 ? ligne.emoji : null,
				label: typeof ligne.label === "string" ? ligne.label : "",
				percentage: nombreOuNull(ligne.percentage),
				position,
				votes: entierOuNull(ligne.votes),
			};
		})
		.filter((option): option is OptionSondage => option !== null)
		.toSorted((a, b) => a.position - b.position);
}

function safeJson(valeur: string): unknown {
	try {
		return JSON.parse(valeur);
	} catch {
		return null;
	}
}

/**
 * Chapô affichable : le texte posté avec l'encart, privé de ses mentions de
 * rôle nues. Une dizaine de messages ne contiennent QUE `<@&…>` (le ping du
 * rôle notifié) : republier « @Sondages » tout seul n'apporte rien.
 */
function chapoUtilisable(contenu: string | null): string | null {
	if (!contenu) return null;
	const nettoye = contenu.replace(/<@&\d+>/g, "").trim();
	return nettoye.length > 0 ? nettoye : null;
}

function normaliserSondage(ligne: LigneSondage): Sondage {
	const visuel: VisuelSondage | null = ligne.visual_path
		? {
				alt: ligne.visual_alt && ligne.visual_alt.trim().length > 0 ? ligne.visual_alt : null,
				height: entierOuNull(ligne.visual_height),
				message_id: ligne.visual_message_id,
				url: urlVisuel(ligne.visual_path),
				width: entierOuNull(ligne.visual_width),
			}
		: null;

	return {
		chapo: chapoUtilisable(ligne.message_content),
		channel_id: ligne.channel_id,
		command: ligne.command,
		created_at: isoOuNull(ligne.created_at) ?? new Date(0).toISOString(),
		creator_username: ligne.creator_username,
		ended: ligne.ended === true,
		ends_at: isoOuNull(ligne.ends_at),
		guild_id: ligne.guild_id,
		language: ligne.language === "fr" || ligne.language === "en" ? ligne.language : null,
		locked: ligne.locked === true,
		max_choices: entierOuNull(ligne.max_choices) ?? 1,
		message_id: ligne.message_id,
		options: normaliserOptions(ligne.options),
		poll_id: ligne.poll_id,
		provider: ligne.provider === "discord" ? "discord" : "easypoll",
		question: ligne.question,
		results_hidden: ligne.results_hidden === true,
		source:
			ligne.source === "reactions" ? "reactions" : ligne.source === "api" ? "api" : "embed",
		total_votes: entierOuNull(ligne.total_votes),
		total_voters: entierOuNull(ligne.total_voters),
		visuel,
	};
}

// Colonnes communes aux deux lectures — `p.*` serait fragile : une colonne
// ajoutée demain (par exemple un identifiant de votant) ne doit pas se
// retrouver publiée par accident.
const COLONNES_SONDAGE = `
	p.poll_id, p.provider, p.source, p.language, p.message_id, p.channel_id, p.guild_id,
	p.question, p.creator_username, p.command, p.max_choices, p.locked, p.ended,
	p.ends_at, p.created_at, p.total_votes, p.total_voters, p.results_hidden,
	p.visual_path, p.visual_width, p.visual_height, p.visual_alt, p.visual_message_id
`;

// Les choix sont agrégés en JSON dans le même aller-retour : une page de 12
// sondages ne fait pas 13 requêtes. `alias` = table portant `poll_id`.
const lateralOptions = (alias: string) => `
	LEFT JOIN LATERAL (
		SELECT jsonb_agg(
			jsonb_build_object(
				'position', op.position, 'emoji', op.emoji, 'label', op.label,
				'votes', op.votes, 'percentage', op.percentage
			) ORDER BY op.position
		) AS options
		FROM discord_poll_options op
		WHERE op.poll_id = ${alias}.poll_id
	) o ON true
`;

// ── Lectures ────────────────────────────────────────────────────────────────

export interface OptionsListeSondages {
	/** Page 1-indexée. */
	page?: number;
	/** Recherche simple sur le texte de la question. */
	q?: string;
	statut?: StatutSondage;
	parPage?: number;
}

export interface ResultatListeSondages {
	sondages: Sondage[];
	total: number;
}

/**
 * Sondages visibles, du plus récent au plus ancien.
 * En cas de panne de base : liste vide, jamais une page en erreur.
 */
export async function listerSondages(
	options: OptionsListeSondages = {}
): Promise<ResultatListeSondages> {
	const parPage = Math.min(
		Math.max(Math.trunc(options.parPage ?? SONDAGES_PAR_PAGE) || SONDAGES_PAR_PAGE, 1),
		SONDAGES_PAR_PAGE_MAX
	);
	const page = Math.max(Math.trunc(options.page ?? 1) || 1, 1);
	const statut = normaliserStatut(options.statut);

	// `%` et `_` sont des jokers ILIKE : une recherche « 100_% » ne doit pas se
	// transformer en motif. On échappe, puis on borne la longueur.
	const recherche =
		typeof options.q === "string" && options.q.trim().length > 0
			? options.q.trim().slice(0, RECHERCHE_MAX).replace(/[\\%_]/g, "\\$&")
			: null;

	try {
		const { rows } = await getPgPool().query<LigneSondage>(
			`WITH base AS (
				SELECT ${COLONNES_SONDAGE}, m.content AS message_content
				FROM discord_polls p
				JOIN discord_channels c ON c.channel_id = p.channel_id AND c.suivi = true
				LEFT JOIN discord_messages m
					ON m.message_id = p.message_id AND m.deleted_at IS NULL
				WHERE ($1::text IS NULL OR p.question ILIKE '%' || $1 || '%')
					AND (
						$2::text = 'tous'
						OR ($2::text = 'en-cours' AND p.ended = false AND p.ends_at IS NOT NULL)
						OR ($2::text = 'termines' AND p.ended = true)
					)
			)
			SELECT (SELECT count(*) FROM base) AS total, b.*, o.options
			FROM base b
			${lateralOptions("b")}
			ORDER BY b.created_at DESC, b.poll_id
			LIMIT $3 OFFSET $4`,
			[recherche, statut, parPage, (page - 1) * parPage]
		);

		return {
			sondages: rows.map((ligne) => normaliserSondage(ligne)),
			total: entierOuNull(rows[0]?.total) ?? 0,
		};
	} catch (error) {
		console.error("[sondages] lecture de la liste impossible", error);
		return { sondages: [], total: 0 };
	}
}

export interface CompteursSondages {
	total: number;
	enCours: number;
	termines: number;
	/** Sondages dont l'encart n'a jamais publié d'état (ni clôture, ni date de fin). */
	etatInconnu: number;
}

/** Compteurs d'en-tête, en une seule requête. */
export async function compterSondages(): Promise<CompteursSondages> {
	try {
		const { rows } = await getPgPool().query<{
			total: string;
			en_cours: string;
			termines: string;
			etat_inconnu: string;
		}>(
			`SELECT count(*) AS total,
				count(*) FILTER (WHERE p.ended = false AND p.ends_at IS NOT NULL) AS en_cours,
				count(*) FILTER (WHERE p.ended = true) AS termines,
				count(*) FILTER (WHERE p.ended = false AND p.ends_at IS NULL) AS etat_inconnu
			FROM discord_polls p
			JOIN discord_channels c ON c.channel_id = p.channel_id AND c.suivi = true`
		);
		return {
			enCours: entierOuNull(rows[0]?.en_cours) ?? 0,
			etatInconnu: entierOuNull(rows[0]?.etat_inconnu) ?? 0,
			termines: entierOuNull(rows[0]?.termines) ?? 0,
			total: entierOuNull(rows[0]?.total) ?? 0,
		};
	} catch (error) {
		console.error("[sondages] comptage impossible", error);
		return { enCours: 0, etatInconnu: 0, termines: 0, total: 0 };
	}
}

/**
 * Un sondage précis. Renvoie `null` aussi bien pour un identifiant inconnu que
 * pour un sondage dont le salon n'est plus suivi : les deux donnent un 404
 * propre côté page, jamais une page vide.
 */
export async function lireSondage(pollId: string): Promise<Sondage | null> {
	if (!estIdentifiantSondage(pollId)) return null;
	try {
		const { rows } = await getPgPool().query<LigneSondage>(
			`SELECT ${COLONNES_SONDAGE}, m.content AS message_content, o.options
			FROM discord_polls p
			JOIN discord_channels c ON c.channel_id = p.channel_id AND c.suivi = true
			LEFT JOIN discord_messages m
				ON m.message_id = p.message_id AND m.deleted_at IS NULL
			${lateralOptions("p")}
			WHERE p.poll_id = $1`,
			[pollId]
		);
		return rows[0] ? normaliserSondage(rows[0]) : null;
	} catch (error) {
		console.error("[sondages] lecture du sondage impossible", error);
		return null;
	}
}

/** Identifiants de tous les sondages visibles — pour `generateStaticParams`. */
export async function listerIdentifiantsSondages(): Promise<string[]> {
	try {
		const { rows } = await getPgPool().query<{ poll_id: string }>(
			`SELECT p.poll_id
			FROM discord_polls p
			JOIN discord_channels c ON c.channel_id = p.channel_id AND c.suivi = true
			ORDER BY p.created_at DESC`
		);
		return rows.map((ligne) => ligne.poll_id);
	} catch (error) {
		console.error("[sondages] lecture des identifiants impossible", error);
		return [];
	}
}

export interface VoisinSondage {
	poll_id: string;
	question: string;
}

export interface VoisinsSondage {
	/** Sondage publié juste après celui-ci. */
	plusRecent: VoisinSondage | null;
	/** Sondage publié juste avant celui-ci. */
	plusAncien: VoisinSondage | null;
}

/** Sondages voisins dans l'ordre chronologique, pour la navigation de détail. */
export async function lireVoisins(pollId: string): Promise<VoisinsSondage> {
	const vide: VoisinsSondage = { plusAncien: null, plusRecent: null };
	if (!estIdentifiantSondage(pollId)) return vide;
	try {
		const { rows } = await getPgPool().query<{
			recent_id: string | null;
			recent_question: string | null;
			ancien_id: string | null;
			ancien_question: string | null;
		}>(
			`WITH visibles AS (
				SELECT p.poll_id, p.question, p.created_at
				FROM discord_polls p
				JOIN discord_channels c ON c.channel_id = p.channel_id AND c.suivi = true
			),
			voisins AS (
				SELECT poll_id,
					lag(poll_id) OVER (ORDER BY created_at DESC, poll_id) AS recent_id,
					lag(question) OVER (ORDER BY created_at DESC, poll_id) AS recent_question,
					lead(poll_id) OVER (ORDER BY created_at DESC, poll_id) AS ancien_id,
					lead(question) OVER (ORDER BY created_at DESC, poll_id) AS ancien_question
				FROM visibles
			)
			SELECT recent_id, recent_question, ancien_id, ancien_question
			FROM voisins WHERE poll_id = $1`,
			[pollId]
		);
		const ligne = rows[0];
		if (!ligne) return vide;
		return {
			plusAncien:
				ligne.ancien_id && ligne.ancien_question !== null
					? { poll_id: ligne.ancien_id, question: ligne.ancien_question }
					: null,
			plusRecent:
				ligne.recent_id && ligne.recent_question !== null
					? { poll_id: ligne.recent_id, question: ligne.recent_question }
					: null,
		};
	} catch (error) {
		console.error("[sondages] lecture des voisins impossible", error);
		return vide;
	}
}

/**
 * Résout EN UNE FOIS les pseudos / rôles / salons mentionnés dans les questions
 * et les chapôs. On réutilise `construireContexteMentions()` — elle balaie déjà
 * ce type de texte — en lui présentant chaque sondage comme un message minimal :
 * rien à redupliquer, une seule implémentation à maintenir.
 *
 * Nécessaire : une question au moins contient une mention de rôle que la colonne
 * `mentions` des messages EasyPoll ne résout pas (elle vaut `{"roles":[]…}`), la
 * résolution passe donc forcément par la table `discord_roles`.
 */
export async function construireContexteSondages(
	sondages: Sondage[]
): Promise<ContexteMentions> {
	if (sondages.length === 0) return CONTEXTE_MENTIONS_VIDE;

	const messages = sondages
		.map((sondage) =>
			normaliserMessage({
				// Un identifiant de message valide est exigé par le normaliseur ; celui
				// de l'encart fait l'affaire, à défaut celui du salon.
				channel_id: sondage.channel_id,
				content: [
					sondage.question,
					sondage.chapo ?? "",
					...sondage.options.map((option) => `${option.emoji ?? ""} ${option.label}`),
				].join("\n"),
				message_id: sondage.message_id ?? sondage.channel_id,
			})
		)
		.filter((message): message is MessageDiscord => message !== null);

	return construireContexteMentions(messages);
}
