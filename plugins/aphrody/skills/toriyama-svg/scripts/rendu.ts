#!/usr/bin/env bun
/**
 * Rastérise un SVG à plusieurs tailles et monte une planche de contrôle sur
 * fond clair et sur fond sombre — l'image qu'on ouvre ensuite pour REGARDER
 * le dessin.
 *
 * Regarder est la moitié du travail : un SVG qui semble juste dans le code peut
 * s'effondrer à 32 px, avoir un trait qui disparaît, ou révéler une ombre qui
 * flotte. Les petites tailles sont zoomées au plus proche voisin pour rendre
 * visible ce que le navigateur affichera vraiment.
 *
 * Usage :
 *   bun rendu.ts dessin.svg                       # 512, 128, 64, 32, 16
 *   bun rendu.ts dessin.svg --tailles 1200 256 64
 *   bun rendu.ts dessin.svg --compare reference.png
 *   bun rendu.ts dessin.svg --sortie /tmp/controle
 */
import sharp from "sharp";

const args = Bun.argv.slice(2);
const source = args.find((a) => !a.startsWith("--"));
if (!source) {
	console.error(
		"usage : bun rendu.ts <fichier.svg> [--tailles …] [--compare ref.png] [--sortie DIR]"
	);
	process.exit(1);
}
const lire = (nom: string, defaut: string) => {
	const i = args.indexOf(nom);
	return i >= 0 && args[i + 1] ? args[i + 1] : defaut;
};
const sortie = lire("--sortie", "/tmp/rendu");
const iT = args.indexOf("--tailles");
const tailles =
	iT >= 0
		? args
				.slice(iT + 1)
				.filter((a) => /^\d+$/.test(a))
				.map(Number)
		: [512, 128, 64, 32, 16];
const comparaison = args.indexOf("--compare") >= 0 ? args[args.indexOf("--compare") + 1] : null;

const svg = await Bun.file(source).bytes();
const meta = await sharp(svg).metadata();
const ratio = (meta.width ?? 1) / (meta.height ?? 1);

await Bun.$`mkdir -p ${sortie}`.quiet();

/** Chaque taille est rendue nativement puis agrandie au plus proche voisin :
 *  on voit les pixels réels, pas une interpolation qui flatte le dessin. */
const CIBLE = 220;
const vignettes: { taille: number; buf: Buffer }[] = [];
for (const t of tailles) {
	const h = Math.max(1, Math.round(t / ratio));
	const rendu = await sharp(svg, { density: Math.max(72, (72 * t) / (meta.width ?? t)) })
		.resize(t, h, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
		.png()
		.toBuffer();
	await Bun.write(`${sortie}/rendu-${t}.png`, rendu);
	const facteur = Math.max(1, Math.floor(CIBLE / t));
	vignettes.push({
		taille: t,
		buf: await sharp(rendu)
			.resize(t * facteur, h * facteur, { kernel: facteur > 1 ? "nearest" : "lanczos3" })
			.png()
			.toBuffer(),
	});
}

async function planche(fond: string, nom: string) {
	const marge = 12;
	const hauteurs = await Promise.all(
		vignettes.map(async (v) => (await sharp(v.buf).metadata()).height ?? 0)
	);
	const largeurs = await Promise.all(
		vignettes.map(async (v) => (await sharp(v.buf).metadata()).width ?? 0)
	);
	const H = Math.max(...hauteurs) + marge * 2;
	const W = largeurs.reduce((s, l) => s + l + marge, marge);
	let x = marge;
	const calques = vignettes.map((v, i) => {
		const left = x;
		x += largeurs[i] + marge;
		return { input: v.buf, left, top: Math.round((H - hauteurs[i]) / 2) };
	});
	await sharp({ create: { width: W, height: H, channels: 4, background: fond } })
		.composite(calques)
		.png()
		.toFile(`${sortie}/${nom}`);
}

await planche("#ffffff", "planche-clair.png");
await planche("#0a0a0a", "planche-sombre.png");

if (comparaison) {
	// Côte à côte à hauteur égale : c'est la seule comparaison honnête, l'œil
	// ne sait pas corriger une différence d'échelle.
	const h = 420;
	const a = await sharp(svg)
		.resize({ height: h })
		.flatten({ background: "#ffffff" })
		.png()
		.toBuffer();
	const b = await sharp(comparaison)
		.resize({ height: h })
		.flatten({ background: "#ffffff" })
		.png()
		.toBuffer();
	const la = (await sharp(a).metadata()).width ?? 0;
	const lb = (await sharp(b).metadata()).width ?? 0;
	await sharp({
		create: { width: la + lb + 24, height: h + 16, channels: 4, background: "#ffffff" },
	})
		.composite([
			{ input: a, left: 8, top: 8 },
			{ input: b, left: la + 16, top: 8 },
		])
		.png()
		.toFile(`${sortie}/comparaison.png`);
}

console.log(`viewBox ${meta.width}×${meta.height} — ratio ${ratio.toFixed(3)}`);
console.log(`tailles : ${tailles.join(", ")}`);
console.log(`${sortie}/planche-clair.png`);
console.log(`${sortie}/planche-sombre.png`);
if (comparaison) console.log(`${sortie}/comparaison.png`);
console.log(
	"→ ouvrir ces planches avec l'outil de lecture d'image AVANT de conclure quoi que ce soit."
);
