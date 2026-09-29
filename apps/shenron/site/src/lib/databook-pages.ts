// SPDX-License-Identifier: Apache-2.0

/**
 * Transcriptions de planches de databook — lecture et écriture **ciblées**.
 *
 * Les 11 778 planches vivent dans un unique `jsonb` par ouvrage
 * (`bot.db_databooks.pages`), un tableau d'objets `{ number, image, text }`.
 * Le modèle de contribution du wiki vise un couple (table, ligne, colonne) : il
 * ne savait donc pas désigner UNE planche. Résultat, les **1 911 planches dont
 * `classerDefaut` dit qu'elles sont hallucinées** étaient signalées au lecteur
 * par un bandeau… sans qu'il puisse rien y faire. Ce module ouvre cette porte.
 *
 * La colonne prend la forme `pages#<numéro>` — le numéro ÉDITORIAL affiché sur
 * la planche, pas son index dans le tableau (les deux diffèrent dès qu'un
 * ouvrage saute une page).
 *
 * **L'écriture est chirurgicale** (`jsonb_set` sur le seul élément visé) et non
 * une réécriture du tableau entier. Ce n'est pas un détail de style : la
 * réécriture globale pratiquée par `scripts/depose-traductions.ts` écrase
 * silencieusement les planches qu'un autre dépôt vient d'écrire sur le même
 * ouvrage. Une correction communautaire, par définition concurrente, ne peut
 * pas se permettre ça.
 */
import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { assertDatabooksWritable } from "@/lib/databooks-freeze";

// Les fonctions PURES du ciblage vivent dans le module partagé : la modale de
// contribution en a besoin côté client, et une règle écrite deux fois finit
// toujours par diverger.
export {


	estCiblePlanche,
	numeroDePlanche,
} from "@/lib/databook-pages-shared";

/**
 * Index (0-based) de la planche portant ce numéro éditorial, `-1` si absente.
 *
 * Le repli sur la position est volontaire : quelques ouvrages n'ont pas de
 * `number` sur toutes leurs planches, et sans lui la correction serait
 * impossible précisément là où les transcriptions sont les plus abîmées.
 */
async function indexDePlanche(bookId: string, numero: number): Promise<number> {
	const [r] = (await db.execute(sql`
		select coalesce(
			(
				select (ord - 1)::int
				from bot.db_databooks d,
					 lateral jsonb_array_elements(d.pages) with ordinality as t(p, ord)
				where d.id = ${bookId}::bigint
				  and (t.p->>'number')::int = ${numero}
				limit 1
			),
			case
				when ${numero} <= (select jsonb_array_length(pages) from bot.db_databooks where id = ${bookId}::bigint)
				then ${numero} - 1
				else -1
			end
		) as idx
	`)) as unknown as Array<{ idx: number }>;
	return Number(r?.idx ?? -1);
}

/** Transcription courante d'une planche (`null` si la planche n'existe pas). */
export async function lireTranscription(bookId: string, numero: number): Promise<string | null> {
	const idx = await indexDePlanche(bookId, numero);
	if (idx < 0) return null;
	// `::int` OBLIGATOIRE sur l'index. Sans lui, le paramètre est lié en TEXTE
	// et `pages->$1` devient l'opérateur « clé d'objet », pas « élément de
	// tableau » : sur un tableau, il rend NULL, toujours. Cette lecture-là
	// renvoyait donc systématiquement `null` pour une planche pourtant
	// transcrite — le formulaire de correction publique s'ouvrait vide, et la
	// comparaison anti-conflit de l'acceptation ne comparait rien.
	const [r] = (await db.execute(sql`
		select pages->${idx}::int->>'text' as texte
		from bot.db_databooks
		where id = ${bookId}::bigint
	`)) as unknown as Array<{ texte: string | null }>;
	return r?.texte ?? null;
}

/**
 * Écrit la transcription d'UNE planche. Renvoie `false` si la planche n'existe
 * pas — jamais un faux succès, sinon le relecteur croirait avoir publié.
 */
export async function ecrireTranscription(
	bookId: string,
	numero: number,
	texte: string
): Promise<boolean> {
	assertDatabooksWritable();
	const idx = await indexDePlanche(bookId, numero);
	if (idx < 0) return false;
	const res = (await db.execute(sql`
		update bot.db_databooks
		set pages = jsonb_set(pages, ${`{${idx},text}`}::text[], to_jsonb(${texte}::text), true)
		where id = ${bookId}::bigint
		returning id
	`)) as unknown as Array<{ id: unknown }>;
	return res.length > 0;
}

/**
 * Lit la traduction française d'UNE planche (`null` si elle n'en a pas).
 */
async function lireTraduction(bookId: string, numero: number): Promise<string | null> {
	const idx = await indexDePlanche(bookId, numero);
	if (idx < 0) return null;
	const [r] = (await db.execute(sql`
		select pages->${idx}::int->>'text_fr' as texte
		from bot.db_databooks
		where id = ${bookId}::bigint
	`)) as unknown as Array<{ texte: string | null }>;
	return r?.texte ?? null;
}

/**
 * Écrit — ou retire — la traduction française d'UNE planche.
 *
 * `texte === null` retire les trois clés de traduction d'un coup : rétablir un
 * `text_fr` vide au lieu de l'effacer laisserait la planche pour traduite, et
 * elle ne ressortirait plus jamais dans la file de `planches-a-traduire.ts`.
 * Le japonais, lui, n'est jamais touché.
 */
export async function ecrireTraduction(
	bookId: string,
	numero: number,
	texte: string | null,
	par = "machine:sonnet"
): Promise<boolean> {
	assertDatabooksWritable();
	const idx = await indexDePlanche(bookId, numero);
	if (idx < 0) return false;
	const chemin = `{${idx}}`;
	const res = (await db.execute(
		texte === null
			? sql`
				update bot.db_databooks
				set pages = jsonb_set(
					pages, ${chemin}::text[],
					(pages->${idx}::int) - 'text_fr' - 'text_fr_by' - 'text_fr_at', true)
				where id = ${bookId}::bigint
				  and jsonb_typeof(pages->${idx}::int) = 'object'
				returning id`
			: sql`
				update bot.db_databooks
				set pages = jsonb_set(
					pages, ${chemin}::text[],
					(pages->${idx}::int) || jsonb_build_object(
						'text_fr', ${texte}::text,
						'text_fr_by', ${par}::text,
						'text_fr_at', ${Date.now()}::bigint), true)
				where id = ${bookId}::bigint
				  and jsonb_typeof(pages->${idx}::int) = 'object'
				returning id`
	)) as unknown as Array<{ id: unknown }>;
	return res.length > 0;
}

/**
 * Pose — ou retire — le drapeau « relue à l'image » sur UNE planche.
 *
 * Même écriture chirurgicale que la transcription, et pour la même raison : ce
 * geste arrive pendant qu'un dépôt de transcription tourne peut-être sur le
 * même ouvrage.
 *
 * Retirer le drapeau efface les trois clés au lieu d'écrire `false` : le juge
 * (`estPlancheVerifiee`) ne lit que la présence de `verifiee === true`, et
 * laisser derrière soi le nom du relecteur d'un acquittement annulé
 * raconterait une histoire fausse.
 */
async function marquerPlancheVerifiee(
	bookId: string,
	numero: number,
	verifiee: boolean,
	par: string
): Promise<boolean> {
	assertDatabooksWritable();
	const idx = await indexDePlanche(bookId, numero);
	if (idx < 0) return false;
	const chemin = `{${idx}}`;
	const res = (await db.execute(
		verifiee
			? sql`
				update bot.db_databooks
				set pages = jsonb_set(
					pages, ${chemin}::text[],
					(pages->${idx}::int) || jsonb_build_object(
						'verifiee', true,
						'verifiee_par', ${par}::text,
						'verifiee_le', ${Date.now()}::bigint), true)
				where id = ${bookId}::bigint
				  and jsonb_typeof(pages->${idx}::int) = 'object'
				returning id`
			: sql`
				update bot.db_databooks
				set pages = jsonb_set(
					pages, ${chemin}::text[],
					(pages->${idx}::int) - 'verifiee' - 'verifiee_par' - 'verifiee_le', true)
				where id = ${bookId}::bigint
				  and jsonb_typeof(pages->${idx}::int) = 'object'
				returning id`
	)) as unknown as Array<{ id: unknown }>;
	return res.length > 0;
}

/** La planche porte-t-elle le drapeau de relecture ? (`null` si elle n'existe pas) */
async function lireVerifiee(bookId: string, numero: number): Promise<boolean | null> {
	const idx = await indexDePlanche(bookId, numero);
	if (idx < 0) return null;
	const [r] = (await db.execute(sql`
		select (pages->${idx}::int->>'verifiee') = 'true' as verifiee
		from bot.db_databooks
		where id = ${bookId}::bigint
	`)) as unknown as Array<{ verifiee: boolean | null }>;
	return r?.verifiee === true;
}
