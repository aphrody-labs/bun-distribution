#!/usr/bin/env bun
/**
 * Écrit les SVG du Kinto-un depuis la géométrie de `src/lib/kinto-un.ts` :
 *   public/dbz/kinto-un.svg          illustration 1200 × 648
 *   public/dbz/kinto-un-icone.svg    icône carrée 512, pastille sombre
 *   public/safari-pinned-tab.svg     silhouette monochrome (mask-icon)
 *
 * Rien n'est décalqué : seules les MESURES relevées sur les cels Toei sont
 * reprises (cf. docs/kinto-un-analyse-visuelle.md). Les favicons raster se
 * font ensuite avec `bun scripts/genere-icones.ts`.
 *
 * Usage :
 *   bun scripts/genere-kinto-un.ts            # écrit les SVG
 *   bun scripts/genere-kinto-un.ts --rendu    # + PNG de contrôle dans /tmp
 */
import { svgIcone, svgIllustration, svgMonochrome } from "../src/lib/kinto-un";

const racine = new URL("../public/", import.meta.url).pathname;
const sorties: [string, string][] = [
	["dbz/kinto-un.svg", svgIllustration()],
	["dbz/kinto-un-icone.svg", svgIcone()],
	["safari-pinned-tab.svg", svgMonochrome()],
];
for (const [nom, svg] of sorties) {
	await Bun.write(racine + nom, svg);
	console.log(`public/${nom} — ${svg.length} octets`);
}

if (Bun.argv.includes("--rendu")) {
	const sharp = (await import("sharp")).default;
	for (const largeur of [1200, 256, 64]) {
		const sortie = `/tmp/kinto-un-${largeur}.png`;
		await sharp(Buffer.from(svgIllustration())).resize({ width: largeur }).png().toFile(sortie);
		console.log(sortie);
	}
	for (const cote of [512, 96, 48, 32, 16]) {
		const sortie = `/tmp/kinto-un-icone-${cote}.png`;
		await sharp(Buffer.from(svgIcone())).resize(cote, cote).png().toFile(sortie);
		console.log(sortie);
	}
}
