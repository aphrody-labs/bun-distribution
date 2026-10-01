#!/usr/bin/env bun
/**
 * Décline un SVG carré en jeu complet de favicons, pour tous les formats et
 * toutes les plateformes, avec `sharp` seul.
 *
 * Pourquoi pas de bibliothèque : mesuré sur le registre npm, `favicons` exige
 * son propre `sharp` (donc un second libvips), `to-ico` est abandonné depuis
 * 2017, `sharp-ico` dépend d'un `sharp: "*"` non épinglé, et `cli-real-favicon`
 * téléverse l'asset chez un tiers au moment du build. L'ICO n'est qu'un
 * conteneur de PNG : quinze lignes suffisent, et zéro dépendance ajoutée ne
 * casse jamais un déploiement.
 *
 * Usage :
 *   bun icones.ts icone.svg --sortie public/
 *   bun icones.ts icone.svg --sortie apps/site/public --sortie apps/bot/public
 *   bun icones.ts icone.svg --sortie public --fond "#0a0a0a" --logo assets/logo.webp
 *
 * Le SVG d'entrée doit être CARRÉ et déjà pensé pour les petites tailles
 * (silhouette simplifiée, trait épais, pastille de fond). Un downscale d'une
 * illustration large donne une lentille illisible à 16 px : dessiner la
 * variante carrée à part, ce n'est pas du zèle, c'est la seule chose qui marche.
 */
import sharp from "sharp";

const args = Bun.argv.slice(2);
const source = args.find((a) => !a.startsWith("--") && a.endsWith(".svg"));
if (!source) {
	console.error(
		"usage : bun icones.ts <icone.svg> --sortie DIR [--sortie DIR2] [--fond #0a0a0a] [--logo chemin.webp]"
	);
	process.exit(1);
}
const dossiers = args.flatMap((a, i) =>
	a === "--sortie" && args[i + 1] ? [args[i + 1].replace(/\/?$/, "/")] : []
);
if (!dossiers.length) {
	console.error("--sortie manquant");
	process.exit(1);
}
const opt = (nom: string, defaut: string | null = null) => {
	const i = args.indexOf(nom);
	return i >= 0 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : defaut;
};
const fond = opt("--fond", "#0a0a0a") as string;
const logo = opt("--logo");

const svg = Buffer.from(await Bun.file(source).bytes());
const meta = await sharp(svg).metadata();
if (meta.width !== meta.height) {
	console.warn(
		`⚠ ${source} n'est pas carré (${meta.width}×${meta.height}) : les icônes seront rognées ou marginées.`
	);
}

const png = async (cote: number, { opaque = false, echelle = 1 } = {}) => {
	const interne = Math.round(cote * echelle);
	let s = sharp(svg, { density: Math.max(72, (72 * interne) / (meta.width ?? 512)) }).resize(
		interne,
		interne,
		{
			fit: "contain",
			background: { r: 0, g: 0, b: 0, alpha: 0 },
		}
	);
	if (echelle !== 1) {
		const marge = Math.round((cote - interne) / 2);
		s = sharp(await s.png().toBuffer()).extend({
			top: marge,
			bottom: cote - interne - marge,
			left: marge,
			right: cote - interne - marge,
			background: opaque ? fond : { r: 0, g: 0, b: 0, alpha: 0 },
		});
	}
	if (opaque) s = s.flatten({ background: fond });
	return s.png({ compressionLevel: 9 }).toBuffer();
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
for (const cote of [16, 32, 48, 96]) fichiers[`favicon-${cote}.png`] = await png(cote);
fichiers["favicon.ico"] = ico(
	[16, 32, 48].map((cote) => ({ cote, png: fichiers[`favicon-${cote}.png`] }))
);
// iOS compose l'icône Apple sur du noir : transparente, elle sort sale.
fichiers["apple-touch-icon.png"] = await png(180, { opaque: true });
fichiers["icon-192.png"] = await png(192);
fichiers["icon-512.png"] = await png(512);
// Android rogne l'icône maskable en cercle : le dessin doit tenir dans 80 %.
fichiers["icon-maskable-512.png"] = await png(512, { opaque: true, echelle: 0.8 });
fichiers["mstile-150.png"] = await png(150, { opaque: true });

for (const dossier of dossiers) {
	await Bun.$`mkdir -p ${dossier}`.quiet();
	for (const [nom, contenu] of Object.entries(fichiers)) await Bun.write(dossier + nom, contenu);
	console.log(`${dossier} — ${Object.keys(fichiers).length} fichiers`);
}
for (const [nom, contenu] of Object.entries(fichiers))
	console.log(`  ${nom.padEnd(24)} ${contenu.length} o`);

if (logo) {
	const buf = await sharp(svg, { density: 144 })
		.resize(1024, 1024, { fit: "contain" })
		.webp({ quality: 92 })
		.toBuffer();
	await Bun.write(logo, buf);
	console.log(`${logo} — ${buf.length} o`);
}

console.log(`
À câbler côté page (Next : \`metadata.icons\`) :
  icon      /favicon.ico (sizes any) + favicon-16/32/48/96.png
  apple     /apple-touch-icon.png (180×180)
  other     mask-icon /safari-pinned-tab.svg (silhouette noire, à générer à part)
  meta      msapplication-TileColor ${fond} · msapplication-TileImage /mstile-150.png
Dans le manifest, séparer icon-512 (purpose "any") de icon-maskable-512 (purpose
"maskable") : un même fichier ne peut pas être les deux, et le déclarer "any
maskable" fait rogner le dessin par Android.

Vérifier ensuite :  file <sortie>/favicon.ico   → "MS Windows icon resource - 3 icons"`);
