#!/usr/bin/env bun
/**
 * Rapatrie les médias d'Achilléa du cloud vers le stockage local.
 *
 * LE PROBLÈME
 * Les 381 objets du bucket `images` d'Achilléa ont été migrés sur le VPS —
 * fichiers sous `/var/www/achillea-storage/images/`, métadonnées dans le schéma
 * `storage` de la base `rg`. Mais les URL ENREGISTRÉES EN BASE, elles, pointent
 * toujours vers le projet Supabase Cloud d'origine
 * (`https://<ref>.supabase.co/storage/v1/object/public/images/<fichier>`) : les
 * 69 avatars de clans, sept images et deux captures d'arbitrage.
 *
 * Le site affiche donc des images hébergées ailleurs, facturées ailleurs, et
 * qui disparaîtront le jour où ce projet cloud sera fermé — alors que les
 * mêmes octets sont déjà servis localement.
 *
 * CE QUE FAIT LE SCRIPT
 * Il réécrit ces URL vers le domaine public d'Achilléa, et UNIQUEMENT celles
 * dont le fichier existe réellement en local : une URL réécrite vers un fichier
 * absent afficherait une image cassée là où il y en avait une qui marchait.
 *
 *   bun scripts/ops/achillea-medias-locaux.ts            # inventaire, aucune écriture
 *   bun scripts/ops/achillea-medias-locaux.ts --appliquer
 */

import { $ } from "bun";

/** Colonnes qui portent une URL de média Achilléa. */
const COLONNES = [
	{ colonne: "clan_avatar_url", table: "clan" },
	{ colonne: "url", table: "image" },
	{ colonne: "screenshot_url", table: "lobby_user" },
] as const;

/** Racine publique qui remplace le domaine cloud. */
const BASE_PUBLIQUE = "https://achillea.rosegriffon.fr/storage/v1/object/public";

/** Où les fichiers vivent réellement sur le disque. */
const RACINE_DISQUE = "/var/www/achillea-storage";

async function psql(sql: string): Promise<string> {
	return (await $`sudo -u postgres psql -d rg -v ON_ERROR_STOP=1 -Atc ${sql}`.text()).trim();
}

/**
 * URL cloud → chemin relatif dans le bucket.
 *
 * `…/object/public/images/abc.png` rend `images/abc.png`, qui est à la fois la
 * clé de stockage et le chemin sur disque.
 */
function cheminDepuisUrl(url: string): string | null {
	const marqueur = "/object/public/";
	const position = url.indexOf(marqueur);
	return position === -1 ? null : url.slice(position + marqueur.length);
}

const appliquer = Bun.argv.includes("--appliquer");
let total = 0;
let reecrites = 0;
let absentes = 0;

for (const { table, colonne } of COLONNES) {
	const lignes = (
		await psql(
			`select ${colonne} from achillea."${table}" where ${colonne} like '%supabase.co%'`
		)
	)
		.split("\n")
		.filter(Boolean);

	for (const url of lignes) {
		total++;
		const chemin = cheminDepuisUrl(url);
		if (!chemin) {
			console.warn(`… URL inattendue, ignorée : ${url.slice(0, 60)}…`);
			continue;
		}

		const existe = await Bun.file(`${RACINE_DISQUE}/${chemin}`).exists();
		if (!existe) {
			absentes++;
			console.warn(`… ${chemin} absent du disque : URL laissée telle quelle`);
			continue;
		}

		const nouvelle = `${BASE_PUBLIQUE}/${chemin}`;
		if (appliquer) {
			await psql(
				`update achillea."${table}" set ${colonne} = '${nouvelle}' where ${colonne} = '${url}'`
			);
		}
		reecrites++;
	}
}

console.info(
	`${total} URL cloud — ${reecrites} ${appliquer ? "réécrites" : "réécrivables"}, ${absentes} sans fichier local`
);
if (!appliquer && reecrites > 0) {
	console.info("Relancer avec --appliquer pour écrire.");
}
