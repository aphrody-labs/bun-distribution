#!/usr/bin/env bun
/**
 * Découpe une planche de databook en tuiles lisibles, pour la relecture.
 *
 * Une planche de databook est un scan pleine page couvert de texte japonais
 * vertical en corps 6. Ouverte entière, elle est illisible : le titre passe,
 * les légendes et les tableaux non — et c'est précisément là que le modèle
 * d'OCR a halluciné. Découpée en quatre et agrandie, la même planche se lit
 * sans effort, y compris sur un scan de 1 000 px de large.
 *
 * Les tuiles se **chevauchent de 4 %** : une ligne qui tombe pile sur la
 * découpe reste entière dans l'une des deux moitiés. Sans ce recouvrement, on
 * perd une ligne par frontière, et c'est invisible à la relecture — le pire
 * défaut possible pour un outil censé fiabiliser une transcription.
 *
 * Usage :
 *   bun scripts/decoupe-planche.ts <image> <préfixe de sortie> [colonnes] [lignes]
 *   bun scripts/decoupe-planche.ts public/wiki/databooks/ab…jpg /tmp/p 2 2
 *
 * Écrit `<préfixe>-<ligne><colonne>.png` et imprime les chemins produits.
 * PNG et non JPEG : on relit du texte, un artefact de compression sur un kanji
 * de 12 px se paie en faute de lecture.
 */
import sharp from "sharp";

const [source, prefixe, colonnesArg = "2", lignesArg = "2"] = process.argv.slice(2);

if (!source || !prefixe) {
	console.error("usage : bun scripts/decoupe-planche.ts <image> <préfixe> [colonnes] [lignes]");
	process.exit(2);
}

const colonnes = Math.max(1, Number(colonnesArg));
const lignes = Math.max(1, Number(lignesArg));
/** Recouvrement de chaque tuile sur ses voisines, en fraction de tuile. */
const CHEVAUCHEMENT = 0.04;
/** Largeur maximale d'une tuile : au-delà, on paie des pixels sans rien gagner. */
const LARGEUR_MAX = 1500;

const { width = 0, height = 0 } = await sharp(source).metadata();
if (!width || !height) {
	console.error(`✗ image illisible : ${source}`);
	process.exit(1);
}

const largeurTuile = Math.floor(width / colonnes);
const hauteurTuile = Math.floor(height / lignes);

for (let y = 0; y < lignes; y++) {
	for (let x = 0; x < colonnes; x++) {
		const gauche = Math.max(0, Math.round(x * largeurTuile - largeurTuile * CHEVAUCHEMENT));
		const haut = Math.max(0, Math.round(y * hauteurTuile - hauteurTuile * CHEVAUCHEMENT));
		const largeur = Math.min(width - gauche, Math.round(largeurTuile * (1 + 2 * CHEVAUCHEMENT)));
		const hauteur = Math.min(height - haut, Math.round(hauteurTuile * (1 + 2 * CHEVAUCHEMENT)));
		const sortie = `${prefixe}-${y + 1}${x + 1}.png`;
		await sharp(source)
			.extract({ left: gauche, top: haut, width: largeur, height: hauteur })
			// Agrandissement volontaire (`withoutEnlargement: false`) : c'est lui qui
			// rend lisible le petit texte d'un scan basse définition.
			.resize({ width: Math.min(LARGEUR_MAX, largeur * 2), withoutEnlargement: false })
			.png()
			.toFile(sortie);
		console.log(sortie);
	}
}
