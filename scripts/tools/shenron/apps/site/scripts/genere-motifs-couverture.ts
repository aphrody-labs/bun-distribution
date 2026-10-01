#!/usr/bin/env bun
import { tempPath } from "@aphrody/paths";
/**
 * Écrit les motifs de couverture depuis la géométrie de `src/lib/couverture.ts` :
 *   public/dbz/marque/banc-nuage.svg   tuile de volutes, répétable en x
 *
 * Rien n'est décalqué ni vectorisé : seules les MESURES relevées sur la
 * couverture du tome sont reprises (cf. docs/couverture-analyse-visuelle.md,
 * « Les quatre éléments de décor »). Le fichier statique porte les aplats
 * mesurés parce qu'un `background-image` n'hérite d'aucune variable CSS ; dans
 * l'interface, `<BancNuages>` prend les jetons du thème.
 *
 * Usage :
 *   bun scripts/genere-motifs-couverture.ts            # écrit le SVG
 *   bun scripts/genere-motifs-couverture.ts --rendu    # + PNG de contrôle dans /tmp
 */
import {
	BANC_NUAGE,
	PASTILLE,
	anneauPastille,
	etoilePath,
	etoileViewBox,
	svgBancNuage,
} from "../src/lib/couverture";

const racine = new URL("../public/", import.meta.url).pathname;
const sorties: [string, string][] = [["dbz/marque/banc-nuage.svg", svgBancNuage()]];
for (const [nom, svg] of sorties) {
	await Bun.write(racine + nom, svg);
	console.log(`public/${nom} — ${svg.length} octets`);
}

if (Bun.argv.includes("--rendu")) {
	const sharp = (await import("sharp")).default;
	// Planche de contrôle : les trois motifs dessinés, aux aplats MESURÉS (les
	// jetons CSS n'existent pas hors navigateur), sur fond sombre du site.
	const a = anneauPastille();
	const e = etoileViewBox(50);
	const planche = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 720 460">
<rect width="720" height="460" fill="#0a0a0a"/>
<g transform="translate(20 20)">
  <rect x="0" y="0" width="240" height="118" fill="#3760B2"/>
  <g>${svgBancNuage().replace(/<svg[^>]*>|<\/svg>|<title[^>]*>.*?<\/title>|<desc>.*?<\/desc>/g, "")}</g>
</g>
<g transform="translate(300 20)">
  <rect x="0" y="0" width="240" height="118" fill="#3760B2"/>
  <g transform="translate(240 0)">${svgBancNuage().replace(/<svg[^>]*>|<\/svg>|<title[^>]*>.*?<\/title>|<desc>.*?<\/desc>/g, "")}</g>
  <g>${svgBancNuage().replace(/<svg[^>]*>|<\/svg>|<title[^>]*>.*?<\/title>|<desc>.*?<\/desc>/g, "")}</g>
</g>
<g transform="translate(40 170)">
  <defs><radialGradient id="p" cx="50%" cy="50%" r="50%">
  ${PASTILLE.degradeMesure.map(([o, c]) => `<stop offset="${o * 100}%" stop-color="${c}"/>`).join("")}
  </radialGradient></defs>
  <circle cx="${a.centre}" cy="${a.centre}" r="${a.rayon}" fill="url(#p)" stroke="#131b08" stroke-width="${a.cerne}"/>
  <text x="${a.centre}" y="${a.centre}" text-anchor="middle" dominant-baseline="central" font-family="sans-serif" font-weight="900" font-size="${PASTILLE.diametre * 0.68}" fill="#131b08">1</text>
</g>
<g transform="translate(220 170)">
  <svg viewBox="${e.viewBox}" width="113" height="113"><path d="${etoilePath(e.cx, e.cy, 50)}" fill="#BA151C"/></svg>
</g>
<g transform="translate(380 170)">
  <rect x="0" y="0" width="180" height="240" fill="#1a1a1a"/>
  <rect x="-1" y="-1" width="182" height="242" fill="none" stroke="#131b08" stroke-width="2"/>
  <rect x="-4" y="-4" width="188" height="248" fill="none" stroke="#fefd03" stroke-width="4"/>
  <rect x="-7" y="-7" width="194" height="254" fill="none" stroke="#131b08" stroke-width="2"/>
</g>
</svg>`;
	for (const largeur of [1440, 720, 360]) {
		const sortie = `/tmp/couverture-motifs-${largeur}.png`;
		await sharp(Buffer.from(planche)).resize({ width: largeur }).png().toFile(sortie);
		console.log(sortie);
	}
	const tuile = svgBancNuage(BANC_NUAGE);
	await sharp(Buffer.from(tuile))
		.resize({ width: 960 })
		.png()
		.toFile(tempPath("couverture-banc-nuage.png"));
	console.log(tempPath("couverture-banc-nuage.png"));
}
