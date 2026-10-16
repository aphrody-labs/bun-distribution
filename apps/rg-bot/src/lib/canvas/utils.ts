/**
 * Primitives de dessin de la DA Rose Griffon.
 *
 * Ce qui distingue cette DA d'un rendu Material : l'ombre portée est DURE
 * (une copie décalée de la forme, pas un flou), les bordures sont en or de 2 px,
 * les fonds portent des arcs diagonaux et le logo griffon en filigrane.
 */

import { type Image, loadImage, type SKRSContext2D } from "@aphrody/canvas";

import { BORDURE_OR, OMBRE_DURE, PALETTE, RAYONS, VISUELS } from "./theme";
import { tronquer } from "./texte";

export function roundedRect(
	ctx: SKRSContext2D,
	x: number,
	y: number,
	w: number,
	h: number,
	r: number
): void {
	const radius = Math.max(0, Math.min(r, w / 2, h / 2));
	ctx.beginPath();
	ctx.moveTo(x + radius, y);
	ctx.lineTo(x + w - radius, y);
	ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
	ctx.lineTo(x + w, y + h - radius);
	ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
	ctx.lineTo(x + radius, y + h);
	ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
	ctx.lineTo(x, y + radius);
	ctx.quadraticCurveTo(x, y, x + radius, y);
	ctx.closePath();
}

export function fillRoundedRect(
	ctx: SKRSContext2D,
	x: number,
	y: number,
	w: number,
	h: number,
	r: number,
	fill: string
): void {
	ctx.save();
	ctx.fillStyle = fill;
	roundedRect(ctx, x, y, w, h, r);
	ctx.fill();
	ctx.restore();
}

export function strokeRoundedRect(
	ctx: SKRSContext2D,
	x: number,
	y: number,
	w: number,
	h: number,
	r: number,
	stroke: string,
	lineWidth = 1
): void {
	ctx.save();
	ctx.strokeStyle = stroke;
	ctx.lineWidth = lineWidth;
	roundedRect(ctx, x, y, w, h, r);
	ctx.stroke();
	ctx.restore();
}

// ─── Chrome de la DA ───────────────────────────────────────────────────────

export interface OptionsCarte {
	rayon?: number;
	fond?: string;
	bordure?: string;
	epaisseur?: number;
	/** Décalage de l'ombre dure ; `null` pour ne pas en poser. */
	ombre?: { x: number; y: number; couleur: string } | null;
}

/**
 * Panneau de la DA : ombre dure décalée, aplat, puis liseré or.
 * Le liseré est tracé à l'intérieur du rectangle pour qu'aucun demi-pixel ne
 * déborde de la boîte calculée par la mise en page.
 */
export function dessinerPanneau(
	ctx: SKRSContext2D,
	x: number,
	y: number,
	w: number,
	h: number,
	options: OptionsCarte = {}
): void {
	const rayon = options.rayon ?? RAYONS.lg;
	const epaisseur = options.epaisseur ?? BORDURE_OR;
	const ombre = options.ombre === undefined ? OMBRE_DURE : options.ombre;
	if (ombre) fillRoundedRect(ctx, x + ombre.x, y + ombre.y, w, h, rayon, ombre.couleur);
	fillRoundedRect(ctx, x, y, w, h, rayon, options.fond ?? PALETTE.carte);
	strokeRoundedRect(
		ctx,
		x + epaisseur / 2,
		y + epaisseur / 2,
		w - epaisseur,
		h - epaisseur,
		rayon,
		options.bordure ?? PALETTE.or,
		epaisseur
	);
}

/**
 * Pastille arrondie avec son libellé — largeur calculée à partir du texte.
 * La troncature est faite ICI, une fois `ctx.font` positionné : tronquer avant
 * l'appel mesurait le texte avec la police en cours, pas celle de la pastille.
 */
export function dessinerPastille(
	ctx: SKRSContext2D,
	x: number,
	y: number,
	libelle: string,
	options: {
		fond: string;
		texte: string;
		taillePolice: number;
		police: string;
		hauteur?: number;
		largeurMax?: number;
	}
): number {
	const hauteur = options.hauteur ?? options.taillePolice + 16;
	ctx.save();
	ctx.font = `bold ${options.taillePolice}px ${options.police}`;
	const rendu =
		options.largeurMax === undefined
			? libelle
			: tronquer(ctx, libelle, Math.max(0, options.largeurMax - 26));
	const largeur = Math.ceil(ctx.measureText(rendu).width) + 26;
	fillRoundedRect(ctx, x, y, largeur, hauteur, hauteur / 2, options.fond);
	ctx.fillStyle = options.texte;
	ctx.textBaseline = "middle";
	ctx.textAlign = "left";
	ctx.fillText(rendu, x + 13, y + hauteur / 2 + 1);
	ctx.restore();
	return largeur;
}

/** Largeur qu'occupera une pastille, sans la dessiner (pour réserver la place). */
export function largeurPastille(
	ctx: SKRSContext2D,
	libelle: string,
	taillePolice: number,
	police: string
): number {
	ctx.save();
	ctx.font = `bold ${taillePolice}px ${police}`;
	const largeur = Math.ceil(ctx.measureText(libelle).width) + 26;
	ctx.restore();
	return largeur;
}

/**
 * Titre cartoon : contour noir épais puis remplissage, précédé d'une ombre
 * dure. C'est la signature typographique de la DA.
 */
export function dessinerTitreCartoon(
	ctx: SKRSContext2D,
	texte: string,
	x: number,
	y: number,
	options: {
		taille: number;
		police: string;
		remplissage: string;
		contour?: string;
		largeurMax?: number;
	}
): void {
	ctx.save();
	ctx.font = `${options.taille}px ${options.police}`;
	// Troncature après avoir posé la police du titre : mesurée avec la police en
	// cours d'appel, un nom long passait le contrôle puis débordait de l'image.
	const rendu = options.largeurMax === undefined ? texte : tronquer(ctx, texte, options.largeurMax);
	ctx.textBaseline = "alphabetic";
	ctx.textAlign = "left";
	ctx.lineJoin = "round";
	ctx.miterLimit = 2;
	ctx.fillStyle = OMBRE_DURE.couleur;
	ctx.fillText(rendu, x + OMBRE_DURE.x, y + OMBRE_DURE.y);
	ctx.strokeStyle = options.contour ?? PALETTE.ombre;
	ctx.lineWidth = Math.max(3, options.taille * 0.12);
	ctx.strokeText(rendu, x, y);
	ctx.fillStyle = options.remplissage;
	ctx.fillText(rendu, x, y);
	ctx.restore();
}

/** Filet or horizontal — séparateur interne des cartes. */
export function dessinerFilet(
	ctx: SKRSContext2D,
	x: number,
	y: number,
	largeur: number,
	couleur = PALETTE.filet
): void {
	ctx.save();
	ctx.strokeStyle = couleur;
	ctx.lineWidth = 2;
	ctx.beginPath();
	ctx.moveTo(x, y + 1);
	ctx.lineTo(x + largeur, y + 1);
	ctx.stroke();
	ctx.restore();
}

/**
 * Fond des images : aplat marine, halos brique et or, arcs diagonaux, logo
 * griffon en filigrane. Le filigrane échoue silencieusement si le fichier est
 * absent — un fond sans mascotte reste correct.
 */
export async function dessinerFond(ctx: SKRSContext2D, w: number, h: number): Promise<void> {
	ctx.save();
	ctx.fillStyle = PALETTE.fond;
	ctx.fillRect(0, 0, w, h);

	const halo = ctx.createLinearGradient(0, 0, w, h);
	halo.addColorStop(0, PALETTE.fondClair);
	halo.addColorStop(0.55, PALETTE.fond);
	halo.addColorStop(1, PALETTE.fondClair);
	ctx.globalAlpha = 0.85;
	ctx.fillStyle = halo;
	ctx.fillRect(0, 0, w, h);
	ctx.globalAlpha = 1;

	// Arcs diagonaux : deux grands cercles tracés hors cadre, qui traversent
	// l'image en biais comme sur la page design-system.
	ctx.globalAlpha = 0.5;
	ctx.lineWidth = 3;
	for (const arc of [
		{ cx: -w * 0.15, cy: h * 0.1, r: w * 0.62, couleur: PALETTE.brique },
		{ cx: w * 1.1, cy: h * 0.95, r: w * 0.5, couleur: PALETTE.or },
		{ cx: w * 1.25, cy: h * 0.2, r: w * 0.45, couleur: PALETTE.briqueClair },
	]) {
		ctx.strokeStyle = arc.couleur;
		ctx.beginPath();
		ctx.arc(arc.cx, arc.cy, arc.r, 0, Math.PI * 2);
		ctx.stroke();
	}
	ctx.globalAlpha = 1;
	ctx.restore();

	await dessinerFiligrane(ctx, w, h);
}

/** Logo griffon en filigrane, centré, très peu opaque. */
export async function dessinerFiligrane(
	ctx: SKRSContext2D,
	w: number,
	h: number
): Promise<boolean> {
	try {
		const logo = await loadImage(VISUELS.griffon);
		const taille = Math.min(w, h) * 0.85;
		ctx.save();
		ctx.globalAlpha = 0.06;
		ctx.drawImage(logo, (w - taille) / 2, (h - taille) / 2, taille, taille);
		ctx.restore();
		return true;
	} catch {
		return false;
	}
}

// ─── Images ────────────────────────────────────────────────────────────────

export async function drawCircularImage(
	ctx: SKRSContext2D,
	src: string,
	cx: number,
	cy: number,
	radius: number
): Promise<boolean> {
	try {
		const img = await loadImage(src);
		ctx.save();
		ctx.beginPath();
		ctx.arc(cx, cy, radius, 0, Math.PI * 2);
		ctx.closePath();
		ctx.clip();
		// Couverture centrée : une image non carrée ne doit pas être écrasée.
		const ratio = Math.max((radius * 2) / img.width, (radius * 2) / img.height);
		const nw = img.width * ratio;
		const nh = img.height * ratio;
		ctx.drawImage(img, cx - nw / 2, cy - nh / 2, nw, nh);
		ctx.restore();
		return true;
	} catch {
		return false;
	}
}

export async function drawCoveredImage(
	ctx: SKRSContext2D,
	src: string,
	x: number,
	y: number,
	w: number,
	h: number,
	radius = 0
): Promise<boolean> {
	try {
		const img = await loadImage(src);
		ctx.save();
		if (radius > 0) {
			roundedRect(ctx, x, y, w, h, radius);
			ctx.clip();
		} else {
			ctx.beginPath();
			ctx.rect(x, y, w, h);
			ctx.clip();
		}
		const ratio = Math.max(w / img.width, h / img.height);
		const nw = img.width * ratio;
		const nh = img.height * ratio;
		ctx.drawImage(img, x + (w - nw) / 2, y + (h - nh) / 2, nw, nh);
		ctx.restore();
		return true;
	} catch {
		return false;
	}
}

// ─── Pictogrammes vectoriels ───────────────────────────────────────────────

/**
 * Les pictogrammes sont tracés, jamais écrits en emoji : le VPS n'a aucune
 * police emoji, les « 📅 » et « 📍 » de l'ancienne version sortaient en carrés.
 */
export type NomPictogramme =
	| "calendrier"
	| "epingle"
	| "oeil"
	| "globe"
	| "lien"
	| "etoile"
	| "croix";

export function dessinerPictogramme(
	ctx: SKRSContext2D,
	nom: NomPictogramme,
	x: number,
	y: number,
	taille: number,
	couleur: string
): void {
	const u = taille / 16;
	ctx.save();
	ctx.translate(x, y);
	ctx.strokeStyle = couleur;
	ctx.fillStyle = couleur;
	ctx.lineWidth = Math.max(1.5, 1.6 * u);
	ctx.lineCap = "round";
	ctx.lineJoin = "round";

	switch (nom) {
		case "calendrier": {
			ctx.beginPath();
			ctx.rect(1.5 * u, 3 * u, 13 * u, 11.5 * u);
			ctx.stroke();
			ctx.beginPath();
			ctx.moveTo(1.5 * u, 6.5 * u);
			ctx.lineTo(14.5 * u, 6.5 * u);
			ctx.stroke();
			ctx.beginPath();
			ctx.moveTo(5 * u, 1.5 * u);
			ctx.lineTo(5 * u, 4 * u);
			ctx.moveTo(11 * u, 1.5 * u);
			ctx.lineTo(11 * u, 4 * u);
			ctx.stroke();
			break;
		}
		case "epingle": {
			ctx.beginPath();
			ctx.moveTo(8 * u, 15 * u);
			ctx.bezierCurveTo(8 * u, 15 * u, 13.5 * u, 9.5 * u, 13.5 * u, 6.5 * u);
			ctx.arc(8 * u, 6.5 * u, 5.5 * u, 0, Math.PI, true);
			ctx.bezierCurveTo(2.5 * u, 9.5 * u, 8 * u, 15 * u, 8 * u, 15 * u);
			ctx.closePath();
			ctx.stroke();
			ctx.beginPath();
			ctx.arc(8 * u, 6.3 * u, 2 * u, 0, Math.PI * 2);
			ctx.fill();
			break;
		}
		case "oeil": {
			ctx.beginPath();
			ctx.moveTo(1 * u, 8 * u);
			ctx.quadraticCurveTo(8 * u, 1.5 * u, 15 * u, 8 * u);
			ctx.quadraticCurveTo(8 * u, 14.5 * u, 1 * u, 8 * u);
			ctx.closePath();
			ctx.stroke();
			ctx.beginPath();
			ctx.arc(8 * u, 8 * u, 2.4 * u, 0, Math.PI * 2);
			ctx.fill();
			break;
		}
		case "globe": {
			ctx.beginPath();
			ctx.arc(8 * u, 8 * u, 6.5 * u, 0, Math.PI * 2);
			ctx.stroke();
			ctx.beginPath();
			ctx.moveTo(1.5 * u, 8 * u);
			ctx.lineTo(14.5 * u, 8 * u);
			ctx.stroke();
			ctx.beginPath();
			ctx.ellipse(8 * u, 8 * u, 3 * u, 6.5 * u, 0, 0, Math.PI * 2);
			ctx.stroke();
			break;
		}
		case "lien": {
			// Maillon de chaîne : deux capsules imbriquées, inclinées à 45°.
			ctx.translate(8 * u, 8 * u);
			ctx.rotate(-Math.PI / 4);
			roundedRect(ctx, -6.4 * u, -2.7 * u, 7.4 * u, 5.4 * u, 2.7 * u);
			ctx.stroke();
			roundedRect(ctx, -1 * u, -2.7 * u, 7.4 * u, 5.4 * u, 2.7 * u);
			ctx.stroke();
			break;
		}
		case "croix": {
			// Logo « X » (ex-Twitter) : deux traits croisés, dessinés plutôt
			// qu'écrits — le caractère 𝕏 n'existe pas dans toutes les polices.
			ctx.lineWidth = Math.max(2, 2.1 * u);
			ctx.beginPath();
			ctx.moveTo(2.5 * u, 2.5 * u);
			ctx.lineTo(13.5 * u, 13.5 * u);
			ctx.moveTo(13.5 * u, 2.5 * u);
			ctx.lineTo(2.5 * u, 13.5 * u);
			ctx.stroke();
			break;
		}
		case "etoile": {
			ctx.beginPath();
			for (let i = 0; i < 10; i++) {
				const rayon = i % 2 === 0 ? 7 * u : 3 * u;
				const angle = -Math.PI / 2 + (i * Math.PI) / 5;
				const px = 8 * u + Math.cos(angle) * rayon;
				const py = 8 * u + Math.sin(angle) * rayon;
				if (i === 0) ctx.moveTo(px, py);
				else ctx.lineTo(px, py);
			}
			ctx.closePath();
			ctx.fill();
			break;
		}
	}
	ctx.restore();
}

export type { Image };
