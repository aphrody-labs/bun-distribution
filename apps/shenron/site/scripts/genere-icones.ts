#!/usr/bin/env bun
/**
 * Rastérise l'icône Kinto-un (`src/lib/kinto-un.ts`) en favicons pour le site
 * ET le dashboard du bot, avec `sharp` seul — l'ICO multi-tailles est un simple
 * conteneur de PNG, écrit ici en quinze lignes plutôt qu'avec une dépendance.
 *
 * Sorties (site `apps/shenron/site/public/`, bot `apps/shenron/bot/public/`) :
 *   favicon.ico                16 + 32 + 48 (vrai ICO, plus un PNG déguisé)
 *   favicon-16/32/48/96.png    transparents
 *   apple-touch-icon.png       180, OPAQUE (iOS compose sur noir sinon)
 *   icon-192.png, icon-512.png `purpose: "any"`, transparents
 *   icon-maskable-512.png      OPAQUE, nuage réduit à 0,8 (zone sûre Android)
 *   mstile-150.png             tuile Windows, opaque
 *   + apps/shenron/bot/assets/logo.webp  1024, logo du dashboard bot
 *
 * Usage : bun scripts/genere-icones.ts
 */
import sharp from "sharp";
import { KINTO_UN_COULEURS, svgIcone, svgIllustration } from "../src/lib/kinto-un";

const site = new URL("../public/", import.meta.url).pathname;
const bot = new URL("../../bot/public/", import.meta.url).pathname;
const logoBot = new URL("../../bot/assets/logo.webp", import.meta.url).pathname;

/**
 * Favicon d'onglet : AUCUNE pastille. Une pastille sombre posait un carré noir
 * dans la barre d'onglets des navigateurs en thème clair — le fond du site n'a
 * rien à faire dans l'onglet du navigateur. Ce qui porte le contraste sur fond
 * blanc, c'est le trait d'encre du nuage, pas un aplat derrière lui.
 */
const transparente = Buffer.from(svgIcone({ pastille: null, echelle: 1.12 }));
/** Sous 64 px les volutes ne sont plus que du bruit : icône nue. */
const sansVolutes = Buffer.from(svgIcone({ pastille: null, echelle: 1.12, volutes: false }));
/** Les formats qui interdisent l'alpha reçoivent une pastille à coins carrés. */
const pleine = Buffer.from(svgIcone({ coins: 0 }));
/** Maskable : pastille pleine, nuage dans les 80 % centraux. */
const maskable = Buffer.from(svgIcone({ coins: 0, echelle: 0.8 }));

const png = (svg: Buffer, cote: number, opaque = false) => {
	let s = sharp(svg, { density: Math.max(72, (72 * cote) / 512) }).resize(cote, cote, {
		kernel: "lanczos3",
	});
	if (opaque) s = s.flatten({ background: KINTO_UN_COULEURS.pastille });
	return s.png({ compressionLevel: 9, palette: false }).toBuffer();
};

/** ICO = en-tête (6 o) + une entrée de 16 o par image + les PNG bout à bout. */
function ico(images: { cote: number; png: Buffer }[]): Buffer {
	const tete = Buffer.alloc(6);
	tete.writeUInt16LE(0, 0);
	tete.writeUInt16LE(1, 2);
	tete.writeUInt16LE(images.length, 4);
	const entrees: Buffer[] = [];
	let decalage = 6 + 16 * images.length;
	for (const { cote, png } of images) {
		const e = Buffer.alloc(16);
		e.writeUInt8(cote >= 256 ? 0 : cote, 0);
		e.writeUInt8(cote >= 256 ? 0 : cote, 1);
		e.writeUInt8(0, 2); // palette
		e.writeUInt8(0, 3); // réservé
		e.writeUInt16LE(1, 4); // plans
		e.writeUInt16LE(32, 6); // bits par pixel
		e.writeUInt32LE(png.length, 8);
		e.writeUInt32LE(decalage, 12);
		decalage += png.length;
		entrees.push(e);
	}
	return Buffer.concat([tete, ...entrees, ...images.map((i) => i.png)]);
}

const fichiers: Record<string, Buffer> = {};
for (const cote of [16, 32, 48, 96])
	fichiers[`favicon-${cote}.png`] = await png(cote < 64 ? sansVolutes : transparente, cote);
fichiers["favicon.ico"] = ico(
	[16, 32, 48].map((cote) => ({ cote, png: fichiers[`favicon-${cote}.png`] }))
);
fichiers["apple-touch-icon.png"] = await png(pleine, 180, true);
fichiers["icon-192.png"] = await png(transparente, 192);
fichiers["icon-512.png"] = await png(transparente, 512);
fichiers["icon-maskable-512.png"] = await png(maskable, 512, true);
fichiers["mstile-150.png"] = await png(pleine, 150, true);

for (const dossier of [site, bot]) {
	for (const [nom, contenu] of Object.entries(fichiers)) {
		await Bun.write(dossier + nom, contenu);
	}
	console.log(`${dossier} — ${Object.keys(fichiers).length} fichiers`);
}
for (const [nom, contenu] of Object.entries(fichiers))
	console.log(`  ${nom.padEnd(24)} ${contenu.length} o`);

const logo = await sharp(transparente, { density: 144 })
	.resize(1024, 1024)
	.webp({ quality: 92 })
	.toBuffer();
await Bun.write(logoBot, logo);
console.log(`${logoBot} — ${logo.length} o`);

/**
 * PNG de marque, à téléverser ailleurs (Discord, réseaux, presse). Ils vivent en
 * deux endroits parce qu'ils servent deux publics : `apps/shenron/site/public/dbz/marque/`
 * pour les liens publics, `apps/shenron/bot/assets/marque/` pour la galerie du dashboard
 * (le bot ne sert en statique que ce qui vit sous `assets/`).
 */
const marque = new URL("../public/dbz/marque/", import.meta.url).pathname;
const marqueBot = new URL("../../bot/assets/marque/", import.meta.url).pathname;
const ill = Buffer.from(svgIllustration());
const carreNu = Buffer.from(svgIcone({ pastille: null, echelle: 1.12 }));
const carrePlein = Buffer.from(svgIcone({ coins: 0.18 }));
const rendre = (buf: Buffer, w: number, h: number) =>
	sharp(buf, { density: 300 }).resize(w, h, {
		fit: "contain",
		background: { r: 0, g: 0, b: 0, alpha: 0 },
	});

const banniereNuage = await rendre(ill, 760, 428).png().toBuffer();
const pngMarque: Record<string, Buffer> = {
	"kinto-un-2048.png": await rendre(ill, 2048, 1154).png().toBuffer(),
	"kinto-un-1024.png": await rendre(ill, 1024, 577).png().toBuffer(),
	"avatar-1024-transparent.png": await rendre(carreNu, 1024, 1024).png().toBuffer(),
	"avatar-1024-fond-sombre.png": await rendre(carrePlein, 1024, 1024)
		.flatten({ background: KINTO_UN_COULEURS.pastille })
		.png()
		.toBuffer(),
	"banniere-960x540.png": await sharp({
		create: { width: 960, height: 540, channels: 4, background: KINTO_UN_COULEURS.pastille },
	})
		.composite([{ input: banniereNuage, left: 100, top: 56 }])
		.png()
		.toBuffer(),
	// Émoji : les volutes deviennent du bruit une fois réduites à 32 px dans un fil.
	"emoji-128.png": await rendre(
		Buffer.from(svgIcone({ pastille: null, echelle: 1.12, volutes: false })),
		128,
		128
	)
		.png({ compressionLevel: 9 })
		.toBuffer(),
};
for (const dossier of [marque, marqueBot]) {
	await Bun.$`mkdir -p ${dossier}`.quiet();
	for (const [nom, contenu] of Object.entries(pngMarque)) await Bun.write(dossier + nom, contenu);
	console.log(`${dossier} — ${Object.keys(pngMarque).length} PNG de marque`);
}
