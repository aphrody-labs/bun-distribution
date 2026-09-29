import { CLE_VERIFIEE } from "./databooks-defauts";
import { publicDatabookImage } from "./databook-media";

/**
 * Databooks — règles pures, sans dépendance serveur.
 *
 * Extrait de `lib/databooks.ts` (marqué `server-only`, donc inimportable depuis
 * `bun test` : même piège que `ratings-rules.ts`). Ces deux règles sont partagées
 * par le module d'accès, les routes API et la page détail — une seule définition,
 * réellement testable.
 */

/** Une page de lecteur : image et/ou texte transcrit. */
export interface DatabookPageInput {
	number: number;
	image: string | null;
	text: string | null;
	/**
	 * Transcription acquittée à la main : les signatures de défaut se taisent.
	 * Cf. `estPlancheVerifiee` — sans ce drapeau, une planche dont la lecture
	 * est courte mais exacte reste éternellement « à vérifier ».
	 */
	verifiee: boolean;
}

/**
 * Normalise `bot.db_databooks.pages`.
 *
 * C'est un jsonb : il a déjà été écrit en scalaire corrompu par le passé (piège
 * `sql.json`), et 21 des 318 fiches n'ont aucune page. Le lecteur ne doit jamais
 * recevoir autre chose qu'un tableau de pages exploitables.
 */
export function normalizePages(raw: unknown): DatabookPageInput[] {
	if (!Array.isArray(raw)) return [];
	const out: DatabookPageInput[] = [];
	for (let i = 0; i < raw.length; i++) {
		const p = raw[i];
		if (!p || typeof p !== "object") continue;
		const o = p as Record<string, unknown>;
		const n = Number(o.number);
		out.push({
			number: Number.isFinite(n) && n > 0 ? Math.trunc(n) : i + 1,
			image: typeof o.image === "string" && o.image.trim() ? o.image.trim() : null,
			text: typeof o.text === "string" && o.text.trim() ? o.text.trim() : null,
			verifiee: o[CLE_VERIFIEE] === true,
		});
	}
	return out;
}

/**
 * Identifiant de fiche, ou `null` si le segment n'en est pas un.
 *
 * `parseInt("abc")` vaut `NaN`, et la requête partait quand même : Postgres
 * rejette `NaN` sur une colonne `bigint`. L'erreur était rattrapée plus haut —
 * un 404 finissait par s'afficher — mais après un aller-retour base inutile et
 * une ligne d'erreur au journal pour chaque URL malformée (les crawlers en
 * produisent en continu). On tranche avant la base.
 */
export function parseDatabookId(brut: string): number | null {
	if (!/^\d+$/.test(brut)) return null;
	const n = Number(brut);
	return Number.isSafeInteger(n) && n > 0 ? n : null;
}

/** En deçà, une description ne dit rien d'utile (souvent « — » ou un mot). */
const DESCRIPTION_MIN = 40;

/**
 * La fiche a-t-elle assez de substance pour mériter d'être indexée ?
 *
 * 21 des 318 fiches n'ont NI planche NI description — dont les 5 interviews en
 * entier. Elles n'affichent qu'un titre et une couverture : rien qui réponde à
 * une recherche. Les laisser indexables, c'est publier 21 pages minces et
 * décevoir le visiteur qui clique.
 *
 * La règle se répare seule : dès qu'une transcription ou une description arrive,
 * la fiche redevient indexable au prochain rendu. Elle reste navigable dans tous
 * les cas — on retire l'indexation, pas la page.
 */
export function isDatabookIndexable(fiche: {
	description?: string | null;
	pages?: { image?: string | null; text?: string | null }[] | null;
}): boolean {
	const pages = Array.isArray(fiche.pages) ? fiche.pages : [];
	const aDuContenu = pages.some(
		(p) => Boolean(publicDatabookImage(p?.image)) || (p?.text ?? "").trim() !== ""
	);
	if (aDuContenu) return true;
	return (fiche.description ?? "").trim().length >= DESCRIPTION_MIN;
}
