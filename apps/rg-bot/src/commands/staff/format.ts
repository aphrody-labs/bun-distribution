/**
 * Mise en forme des surfaces `/staff` — module PUR.
 *
 * ── POURQUOI UN MODULE À PART ──────────────────────────────────────────────
 * Les commandes d'exploitation passent leur temps à traduire des scalaires en
 * phrases : une latence en millisecondes, un poids en octets, un identifiant de
 * version de 40 caractères, une liste de technologies. Écrite dans le corps
 * d'un `@Slash`, cette logique n'est atteignable qu'en lançant un bot et en
 * cliquant dans Discord — donc jamais testée, donc fausse tôt ou tard.
 *
 * Ici : aucune base, aucun réseau, aucun `discord.js`. Tout se vérifie dans
 * `format.test.ts`, en millisecondes.
 *
 * ── LES LIMITES DISCORD SONT DURES ─────────────────────────────────────────
 * 25 champs par embed, 1024 caractères par champ, 4096 pour la description,
 * 6000 au total. Un seul dépassement fait échouer l'envoi ENTIER (le membre ne
 * voit rien, pas même une erreur partielle). `decouperEnChamps` existe pour
 * ça : une longue liste devient plusieurs champs bornés plutôt qu'un champ
 * refusé.
 */

import type { SondeService } from "../../lib/services";

import {
	formaterDuree as formaterDureeUi,
	formaterLatence as formaterLatenceUi,
	formaterNombre as formaterNombreUi,
	formaterOctets as formaterOctetsUi,
} from "../../lib/ui/nombres";
import { borner as bornerUi, decouper, echapper, ilYA, leJour } from "../../lib/ui/texte";

/** Vert quand ça répond, rouge sinon. Le texte reste lisible sans la couleur. */
export function pastilleEtat(ok: boolean): string {
	return ok ? "🟢" : "🔴";
}

/**
 * Latence lisible. Au-delà de la seconde, les millisecondes ne disent plus
 * rien d'utile : on passe aux secondes avec une décimale.
 */
export function formaterLatence(ms: number): string {
	return formaterLatenceUi(ms);
}

/** Durée lisible pour une exécution de tâche (jusqu'aux minutes). */
export function formaterDuree(ms: number | null | undefined): string {
	return formaterDureeUi(ms);
}

/** Entier en français (espace insécable fine entre les milliers). */
export function formaterNombre(valeur: number | null | undefined): string {
	return formaterNombreUi(valeur);
}

/** Poids en unités binaires françaises (Ko = 1024 octets, usage informatique). */
export function formaterOctets(octets: number | null | undefined): string {
	return formaterOctetsUi(octets);
}

/**
 * Horodatage relatif natif de Discord (`<t:…:R>`), qui se recalcule côté client.
 *
 * Écrire « il y a 3 minutes » en dur donnerait une phrase fausse dès que
 * quelqu'un relit le message : un embed reste affiché des heures.
 */
export function horodatageRelatif(valeur: string | Date | null | undefined): string {
	return ilYA(valeur);
}

/** Horodatage absolu natif de Discord (fuseau du lecteur). */
export function horodatageAbsolu(valeur: string | Date | null | undefined): string {
	return leJour(valeur, "f");
}

export interface VersionDeployee {
	/** Identifiant complet, tel qu'il figure dans `state.json`. */
	readonly identifiant: string;
	/** Instant d'assemblage extrait de l'identifiant, ou `null` s'il est illisible. */
	readonly assembleeLe: Date | null;
	/** Suffixe = `BUILD_ID` de Next. Peut commencer par un tiret. */
	readonly buildId: string;
}

/**
 * Décompose un identifiant de version produit par `scripts/ops/deploy.ts`.
 *
 * Forme réelle mesurée sur le VPS : `2026-08-13T00-34-03-769-Va8uc-iExl92JKgLHQVQ0`
 * et `2026-08-13T04-30-50-225--vqFzJdyvSX8PnQUwsi1a` — le `BUILD_ID` de Next
 * peut lui-même commencer par un tiret (alphabet base64url), d'où le double
 * tiret. Découper sur le dernier `-` donnerait donc un identifiant tronqué.
 */
export function analyserRelease(identifiant: string | null | undefined): VersionDeployee | null {
	if (typeof identifiant !== "string" || identifiant.trim().length === 0) {
		return null;
	}
	const brut = identifiant.trim();
	const trouve = /^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})-(.*)$/.exec(brut);
	if (!trouve) {
		return { identifiant: brut, assembleeLe: null, buildId: brut };
	}
	const [, jour, heures, minutes, secondes, millisecondes, buildId] = trouve;
	const instant = new Date(`${jour}T${heures}:${minutes}:${secondes}.${millisecondes}Z`);
	return {
		identifiant: brut,
		assembleeLe: Number.isNaN(instant.getTime()) ? null : instant,
		buildId: buildId ?? "",
	};
}

/** Une ligne d'état de service, prête à empiler dans une description d'embed. */
export function ligneSonde(sonde: SondeService): string {
	const tete = `${pastilleEtat(sonde.ok)} \`${sonde.service.nom}\` — ${sonde.service.titre}`;
	const mesure = sonde.ok ? formaterLatence(sonde.latenceMs) : (sonde.erreur ?? "injoignable");
	const unite = sonde.service.unite ? ` · \`${sonde.service.unite}\`` : "";
	const detail = sonde.ok && sonde.detail ? `\n   └ ${sonde.detail}` : "";
	return `${tete} · ${mesure}${unite}${detail}`;
}

/**
 * Découpe un texte long en plusieurs valeurs de champ d'embed.
 *
 * La coupe se fait sur les sauts de ligne : couper au milieu d'un mot produit
 * des lignes illisibles, et couper au milieu d'un lien Markdown produit un
 * embed refusé par l'API.
 */
export function decouperEnChamps(texte: string, limite = 1_024, maxChamps = 5): string[] {
	return decouper(texte, limite, maxChamps);
}

/**
 * Bloc de code JSON borné.
 *
 * La clôture ``` ``` `` est comptée AVANT de tronquer : sinon une charge à la
 * limite exacte perdait sa clôture et le reste de l'embed passait en code.
 */
export function blocJson(valeur: unknown, limite = 1_400): string {
	let texte: string;
	try {
		texte = JSON.stringify(valeur, null, 2) ?? String(valeur);
	} catch {
		texte = String(valeur);
	}
	const enveloppe = "```json\n\n```".length;
	const utile = Math.max(0, limite - enveloppe);
	const coupe = texte.length > utile ? `${texte.slice(0, Math.max(0, utile - 1))}…` : texte;
	return `\`\`\`json\n${coupe}\n\`\`\``;
}

/** Coupe un texte sans jamais dépasser la limite, ellipse comprise. */
export function borner(texte: string | null | undefined, limite: number): string {
	return bornerUi(texte, limite);
}

/**
 * Neutralise le Markdown d'un texte venu de l'extérieur (page web, post X).
 *
 * Sans ça, un titre contenant `**` ou `[texte](url)` réécrit la mise en forme de
 * l'embed, et un `](` bien placé fabrique un lien vers n'importe où.
 */
export function echapperMarkdown(texte: string | null | undefined): string {
	return echapper(texte);
}

export interface ResultatRechercheWeb {
	titre?: unknown;
	url?: unknown;
	extrait?: unknown;
}

/** Une ligne de résultat de recherche web : titre cliquable + extrait. */
export function ligneResultatWeb(resultat: ResultatRechercheWeb, rang: number): string {
	const url = typeof resultat.url === "string" ? resultat.url : "";
	const titre = borner(
		echapperMarkdown(typeof resultat.titre === "string" && resultat.titre ? resultat.titre : url),
		120
	);
	const extrait = borner(
		echapperMarkdown(typeof resultat.extrait === "string" ? resultat.extrait : ""),
		200
	);
	const entete = url ? `**${rang}.** [${titre}](${url})` : `**${rang}.** ${titre}`;
	return extrait.length > 0 ? `${entete}\n   ${extrait}` : entete;
}

/**
 * Normalise un pseudo X comme le fait le service de scraping.
 *
 * Le contrat de `validerPseudo` (`scrape-service.ts`) n'accepte que
 * `[A-Za-z0-9_]{1,15}`. Le bot doit appliquer la MÊME règle avant de fabriquer
 * une URL de repli : `setURL("https://x.com/toto tata")` fait lever
 * `EmbedBuilder`, et l'embed entier est perdu là où l'appel, lui, avait réussi.
 *
 * @returns le pseudo sans `@` ni préfixe d'URL, ou `""` s'il est inexploitable.
 */
export function normaliserPseudoX(brut: unknown): string {
	if (typeof brut !== "string") {
		return "";
	}
	const nettoye = brut
		.trim()
		.replace(/^https?:\/\/(?:www\.)?(?:x|twitter)\.com\//i, "")
		.replace(/[/?#].*$/, "")
		.replace(/^@/, "");
	return /^[A-Za-z0-9_]{1,15}$/.test(nettoye) ? nettoye : "";
}

export interface PostXAffichable {
	id?: unknown;
	url?: unknown;
	auteur?: unknown;
	auteurNom?: unknown;
	date?: unknown;
	texte?: unknown;
	likes?: unknown;
	retweets?: unknown;
	reponses?: unknown;
	vues?: unknown;
	medias?: unknown;
}

/** Une ligne de post X : auteur, date relative, texte borné, portée. */
export function lignePostX(post: PostXAffichable): string {
	const auteur =
		typeof post.auteur === "string" && post.auteur ? `@${post.auteur}` : "compte inconnu";
	const url = typeof post.url === "string" ? post.url : "";
	const entete = url ? `[${auteur}](${url})` : auteur;
	const quand = typeof post.date === "string" ? ` · ${horodatageRelatif(post.date)}` : "";
	const texte = borner(echapperMarkdown(typeof post.texte === "string" ? post.texte : ""), 300);
	const portee = formaterPortee(post);
	return `**${entete}**${quand}\n${texte || "*(sans texte)*"}\n${portee}`;
}

/**
 * Trie des posts X du plus récent au plus ancien.
 *
 * ── POURQUOI CE TRI EXISTE ─────────────────────────────────────────────────
 * X ne rend PAS une chronologie triée : il place d'abord le post ÉPINGLÉ, puis
 * le reste. `verbeXPosts` le dit noir sur blanc (« X sert la chronologie avec
 * ses épingles ») et ne trie pas non plus. Mesuré le 13/8/2026 sur
 * `@inazuma_project` : le premier post rendu datait du 6/7/2026, le second du
 * 12/8/2026. Une commande qui s'appelle « derniers posts » affichait donc un
 * post plus ancien en tête — la donnée était juste, la lecture était fausse.
 *
 * Les posts sans date lisible partent à la fin plutôt que de se retrouver
 * arbitrairement en tête : une date absente n'est pas une date récente.
 */
export function trierPostsParDate<T extends PostXAffichable>(posts: readonly T[]): T[] {
	// Un repère FINI, pas `-Infinity` : deux posts sans date donneraient
	// `-Infinity - -Infinity = NaN`, et un comparateur qui rend NaN laisse le tri
	// au bon vouloir du moteur.
	const SANS_DATE = Number.MIN_SAFE_INTEGER;
	function instant(post: T): number {
		if (typeof post.date !== "string") {
			return SANS_DATE;
		}
		const valeur = new Date(post.date).getTime();
		return Number.isNaN(valeur) ? SANS_DATE : valeur;
	}
	return posts.toSorted((a, b) => instant(b) - instant(a));
}

/** Compteurs d'un post X, en une ligne. Omet ce que X n'a pas renvoyé. */
export function formaterPortee(post: PostXAffichable): string {
	const morceaux: string[] = [];
	if (typeof post.likes === "number") {
		morceaux.push(`❤ ${formaterNombre(post.likes)}`);
	}
	if (typeof post.retweets === "number") {
		morceaux.push(`🔁 ${formaterNombre(post.retweets)}`);
	}
	if (typeof post.reponses === "number") {
		morceaux.push(`💬 ${formaterNombre(post.reponses)}`);
	}
	if (typeof post.vues === "number") {
		morceaux.push(`👁 ${formaterNombre(post.vues)}`);
	}
	if (typeof post.medias === "number" && post.medias > 0) {
		morceaux.push(`🖼 ${post.medias}`);
	}
	return morceaux.join(" · ");
}

/** En-têtes HTTP d'infrastructure, en bloc `clé : valeur` borné. */
export function formaterEnTetes(entetes: unknown, limite = 900): string {
	if (!entetes || typeof entetes !== "object") {
		return "*aucun*";
	}
	const lignes = Object.entries(entetes as Record<string, unknown>)
		.filter(([, valeur]) => typeof valeur === "string")
		.map(([clef, valeur]) => `\`${clef}\` : ${borner(String(valeur), 90)}`);
	if (lignes.length === 0) {
		return "*aucun*";
	}
	return borner(lignes.join("\n"), limite);
}

/** Liste courte séparée par des points médians, bornée en nombre ET en longueur. */
export function listeCourte(
	valeurs: unknown,
	maximum = 12,
	limite = 900,
	vide = "*aucune*"
): string {
	if (!Array.isArray(valeurs) || valeurs.length === 0) {
		return vide;
	}
	const propres = valeurs.filter((v): v is string => typeof v === "string" && v.length > 0);
	if (propres.length === 0) {
		return vide;
	}
	const gardees = propres.slice(0, maximum);
	const reste = propres.length - gardees.length;
	const texte = gardees.join(" · ") + (reste > 0 ? ` … +${reste}` : "");
	return borner(texte, limite);
}
