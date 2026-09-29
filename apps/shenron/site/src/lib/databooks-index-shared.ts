/**
 * Index des databooks — la part PURE, partagée par le miroir Redis
 * (`databooks-redis.ts`, marqué `server-only`) et par le script de
 * reconstruction (`scripts/index-databooks-redis.ts`).
 *
 * Les deux écrivaient la même chose de deux façons : la première divergence
 * aurait produit un index reconstruit différent de l'index tenu à jour, sans
 * que rien ne le signale. Une seule définition, donc, et elle est testable.
 */
import { defautDePlanche } from "./databooks-defauts";

/**
 * Le corpus porte DEUX formes de transcription, héritées de deux passes de
 * dépôt : la chaîne nue et `{ kind, markdown }`. Une lecture qui n'en connaît
 * qu'une rend `null` sur des milliers de planches pourtant transcrites.
 */
function texteDeValeur(valeur: unknown): string {
	if (typeof valeur === "string") return valeur.trim();
	if (valeur && typeof valeur === "object" && "markdown" in valeur) {
		const md = (valeur as { markdown?: unknown }).markdown;
		if (typeof md === "string") return md.trim();
	}
	return "";
}

export interface TranscriptionsPlanche {
	/** Champs du hash Redis : `<n>` pour le japonais, `<n>:fr` pour la traduction. */
	champs: string[];
	transcrites: number;
	traduites: number;
	fautives: number;
}

/** Extrait les transcriptions d'un tableau `pages` et compte l'état du corpus. */
export function transcriptionsDe(pages: unknown[]): TranscriptionsPlanche {
	const champs: string[] = [];
	let transcrites = 0;
	let traduites = 0;
	let fautives = 0;
	for (let i = 0; i < pages.length; i++) {
		const p = pages[i];
		if (!p || typeof p !== "object") continue;
		const o = p as Record<string, unknown>;
		const n = Number(o.number);
		const numero = Number.isFinite(n) && n > 0 ? Math.trunc(n) : i + 1;
		const ja = texteDeValeur(o.text);
		if (ja) {
			transcrites++;
			// Le compte de fautives voyage avec la fiche : le back-office et la
			// sonde de santé le lisent sans avoir à rejuger 11 928 planches.
			if (defautDePlanche(o, ja) !== null) fautives++;
		}
		// La planche est indexée MÊME sans transcription (valeur vide) : sans ça,
		// une planche muette manquerait au hash, la lecture la croirait absente
		// de l'index et retomberait sur Postgres pour le lot entier — c'est-à-dire
		// presque toujours, puisque 1 716 planches n'ont pas de texte.
		champs.push(String(numero), ja);
		const fr = texteDeValeur(o.text_fr);
		if (fr) {
			traduites++;
			// Les traductions ne sont posées que sur 475 planches : les indexer
			// toutes (dont les vides) doublerait le hash pour rien. Corollaire
			// assumé : une lecture `fr` d'une planche non traduite retombe sur
			// Postgres, ce qui est le bon comportement tant que rien n'affiche
			// `text_fr` côté public.
			champs.push(`${numero}:fr`, fr);
		}
	}
	return { champs, transcrites, traduites, fautives };
}
