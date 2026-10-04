/**
 * rend-icones — contrôle visuel du jeu de glyphes maison.
 *
 * Rastérise chaque géométrie de `@shenron/ui/icones`
 * (`m3/packages/shenron-ui/src/icones/geometries.ts`) en PNG à 16, 24 et 32 px
 * (les trois tailles réellement utilisées par l'interface) et compose une
 * planche de contact par taille, pour qu'un défaut se voie à l'œil plutôt que
 * de se deviner dans un `d=`. Une icône au trait qui devient une bouillie à
 * 16 px est à redessiner : c'est là que se prennent les décisions de dessin
 * (nombre de fentes de la corbeille, taille de la pupille, écart des pointes).
 *
 * `sharp` vit dans le `node_modules` RACINE (cf. docs/pieges.md) — ne jamais
 * l'installer depuis `apps/shenron/site`, cela dé-hoiste `next` et casse le déploiement.
 *
 *   bun apps/shenron/site/scripts/rend-icones.ts [dossier]     (défaut : /tmp/icones)
 *   bun apps/shenron/site/scripts/rend-icones.ts --dry-run     (rend tout en mémoire, n'écrit rien)
 */

import { tempPath } from "@aphrody/paths";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import {
	GEOMETRIES,
	NOMS_ICONES,
	svgIcone,
	type GeometrieIcone,
	type NomIcone,
} from "@shenron/ui/icones";

/** Tailles de rendu réellement employées par l'interface. */
const TAILLES = [16, 24, 32] as const;

/** Facteur de zoom de la planche de contact : le contrôle se fait à l'œil. */
const ZOOM = 6;

async function main() {
	const args = process.argv.slice(2);
	const essai = args.includes("--dry-run");
	const sortie = args.find((a) => !a.startsWith("--")) ?? tempPath("icones");
	if (!essai) mkdirSync(sortie, { recursive: true });

	for (const taille of TAILLES) {
		const vignettes: { input: Buffer; left: number; top: number }[] = [];
		const pas = taille * ZOOM + 8;

		for (const [i, nom] of NOMS_ICONES.entries()) {
			// Rendu à la taille réelle, puis agrandi au plus proche voisin : on
			// regarde les pixels tels que le navigateur les produira, pas une
			// version relissée qui masquerait l'empâtement.
			const png = await sharp(Buffer.from(svgIcone(nom as NomIcone, { taille })), { density: 72 })
				.png()
				.toBuffer();
			if (!essai) await sharp(png).toFile(join(sortie, `${nom}-${taille}.png`));

			const zoome = await sharp(png)
				.resize(taille * ZOOM, taille * ZOOM, { kernel: "nearest" })
				.flatten({ background: "#FEFDFD" })
				.png()
				.toBuffer();
			vignettes.push({ input: zoome, left: (i % 5) * pas + 4, top: Math.floor(i / 5) * pas + 4 });
		}

		const colonnes = Math.min(5, NOMS_ICONES.length);
		const lignes = Math.ceil(NOMS_ICONES.length / 5);
		const planche = join(sortie, `planche-${taille}.png`);
		const composee = sharp({
			create: {
				width: colonnes * pas + 8,
				height: lignes * pas + 8,
				channels: 3,
				background: "#DFDFCE",
			},
		})
			.composite(vignettes)
			.png();
		if (essai) await composee.toBuffer();
		else await composee.toFile(planche);
		console.log(
			`${taille} px → ${essai ? "(essai, rien écrit)" : planche} (${NOMS_ICONES.length} glyphes, ${colonnes}×${lignes})`
		);
	}

	// Même relecture par le contrat commun que dans `Glyphe.tsx` : `GEOMETRIES`
	// est un `as const`, donc son type est l'UNION des treize littéraux, et
	// `traits`/`aplats` n'existent pas sur toutes les branches.
	const sansDessin = NOMS_ICONES.filter((n) => {
		const geo: GeometrieIcone = GEOMETRIES[n];
		return (geo.traits?.length ?? 0) + (geo.aplats?.length ?? 0) === 0;
	});
	if (sansDessin.length > 0) throw new Error(`géométrie vide : ${sansDessin.join(", ")}`);
}

await main();
