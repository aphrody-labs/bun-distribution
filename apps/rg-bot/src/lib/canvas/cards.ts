/**
 * Cartes images envoyées par le bot dans Discord.
 *
 * Toute la DA vient de `theme.ts`, lui-même alimenté par `@rosegriffon/ui/tokens` :
 * aucun hexadécimal n'est écrit ici. Les mises en page sont calculées (hauteurs
 * dynamiques, largeurs disponibles déduites des pastilles réellement mesurées)
 * plutôt que posées à coups de constantes, pour qu'un pseudo long, une bio vide
 * ou une liste de 25 membres ne fassent jamais déborder une carte.
 */

import { type Canvas, createCanvas, type SKRSContext2D } from "@aphrody/canvas";

import {
	BORDURE_OR,
	ensureFonts,
	MARGE,
	MARQUE_CANVAS,
	OMBRE_DURE,
	PALETTE,
	POLICES,
	RAYONS,
	VISUELS,
} from "./theme";
import { assainir, decouperEnLignes, initiale, premierTexteUtilisable, tronquer } from "./texte";
import {
	dessinerFilet,
	dessinerFond,
	dessinerPanneau,
	dessinerPastille,
	dessinerPictogramme,
	dessinerTitreCartoon,
	drawCircularImage,
	drawCoveredImage,
	fillRoundedRect,
	largeurPastille,
	type NomPictogramme,
	roundedRect,
	strokeRoundedRect,
} from "./utils";

const L = 1200;
const HAUTEUR_ENTETE = 152;
const HAUTEUR_PIED = 58;
/** Marge intérieure des panneaux. */
const RESPIRATION = 28;

// ─── Chrome commun ─────────────────────────────────────────────────────────

export interface OptionsEnTete {
	titre: string;
	sousTitre?: string;
	badge?: string;
}

function dessinerEnTete(ctx: SKRSContext2D, opts: OptionsEnTete): void {
	const titre = assainir(opts.titre, POLICES.display) || "Rose Griffon";

	// Pastille de comptage d'abord : elle borne la largeur disponible du titre.
	let largeurBadge = 0;
	if (opts.badge) {
		largeurBadge = largeurPastille(ctx, opts.badge, 18, POLICES.corps) + 24;
	}

	ctx.save();
	ctx.textAlign = "left";
	ctx.font = `bold 14px ${POLICES.corps}`;
	ctx.fillStyle = PALETTE.or;
	ctx.textBaseline = "alphabetic";
	ctx.fillText(MARQUE_CANVAS.surtitre, MARGE, 46);

	dessinerTitreCartoon(ctx, titre, MARGE, 96, {
		taille: 50,
		police: POLICES.display,
		remplissage: PALETTE.surFond,
		largeurMax: L - MARGE * 2 - largeurBadge,
	});

	const sousTitre = assainir(opts.sousTitre, POLICES.corps);
	if (sousTitre) {
		ctx.font = `20px ${POLICES.corps}`;
		ctx.fillStyle = PALETTE.or;
		ctx.fillText(tronquer(ctx, sousTitre, L - MARGE * 2 - largeurBadge), MARGE, 126);
	}

	if (opts.badge) {
		const largeur = largeurPastille(ctx, opts.badge, 18, POLICES.corps);
		dessinerPastille(ctx, L - MARGE - largeur, 40, opts.badge, {
			fond: PALETTE.or,
			texte: PALETTE.surOr,
			taillePolice: 18,
			police: POLICES.corps,
			hauteur: 38,
			largeurMax: L / 3,
		});
	}

	// Filet or de séparation, doublé d'un tronçon brique à gauche : le motif de
	// la page design-system.
	ctx.fillStyle = PALETTE.or;
	ctx.fillRect(MARGE, HAUTEUR_ENTETE - 14, L - MARGE * 2, 3);
	ctx.fillStyle = PALETTE.briqueClair;
	ctx.fillRect(MARGE, HAUTEUR_ENTETE - 14, 140, 3);
	ctx.restore();
}

function dessinerPied(ctx: SKRSContext2D, hauteur: number, note?: string): void {
	const y = hauteur - HAUTEUR_PIED + 20;
	ctx.save();
	ctx.textAlign = "left";
	ctx.textBaseline = "alphabetic";
	ctx.fillStyle = PALETTE.or;
	ctx.fillRect(MARGE, y - 14, L - MARGE * 2, 2);
	ctx.font = `bold 17px ${POLICES.corps}`;
	ctx.fillText(MARQUE_CANVAS.domaine, MARGE, y + 14);
	const propre = assainir(note, POLICES.corps);
	if (propre) {
		ctx.font = `16px ${POLICES.corps}`;
		ctx.fillStyle = PALETTE.surFond;
		ctx.textAlign = "right";
		ctx.fillText(tronquer(ctx, propre, L / 2), L - MARGE, y + 14);
		ctx.textAlign = "left";
	}
	ctx.restore();
}

/** Hauteur du panneau « rien à afficher ». Partagée par toutes les listes. */
export const HAUTEUR_ETAT_VIDE = 232;

/**
 * Panneau « rien à afficher », avec la mascotte, au lieu d'une zone vide.
 * Le bloc (mascotte + message) est centré verticalement dans la hauteur reçue :
 * sans ce calcul, le message tombait sous le panneau et chevauchait le pied.
 */
async function dessinerEtatVide(
	ctx: SKRSContext2D,
	x: number,
	y: number,
	largeur: number,
	hauteur: number,
	message: string
): Promise<void> {
	dessinerPanneau(ctx, x, y, largeur, hauteur, { fond: PALETTE.carteCreuse });

	ctx.save();
	ctx.textAlign = "center";
	ctx.textBaseline = "alphabetic";
	ctx.fillStyle = PALETTE.texteAttenue;
	ctx.font = `22px ${POLICES.corps}`;
	const lignes = decouperEnLignes(ctx, message, { largeurMax: largeur - 80, maxLignes: 2 });
	const hauteurTexte = lignes.length * 30;
	const cote = Math.max(0, Math.min(124, hauteur - hauteurTexte - 72));
	const hauteurBloc = (cote > 0 ? cote + 26 : 0) + hauteurTexte;
	const haut = y + Math.max(20, (hauteur - hauteurBloc) / 2);

	if (cote > 0) {
		// Sans masque circulaire : la mascotte est déjà détourée, l'arrondi lui
		// coupait la tête et le ballon.
		await drawCoveredImage(ctx, VISUELS.emote, x + largeur / 2 - cote / 2, haut, cote, cote);
	}
	const baseTexte = haut + (cote > 0 ? cote + 26 : 0) + 22;
	for (const [index, ligne] of lignes.entries()) {
		ctx.fillText(ligne, x + largeur / 2, baseTexte + index * 30);
	}
	ctx.textAlign = "left";
	ctx.restore();
}

/** Avatar rond avec anneau or et ombre dure ; repli sur l'initiale du nom. */
async function dessinerAvatar(
	ctx: SKRSContext2D,
	source: string | null | undefined,
	cx: number,
	cy: number,
	rayon: number,
	nom: string
): Promise<void> {
	ctx.save();
	ctx.beginPath();
	ctx.fillStyle = OMBRE_DURE.couleur;
	ctx.arc(cx + OMBRE_DURE.x, cy + OMBRE_DURE.y, rayon + 3, 0, Math.PI * 2);
	ctx.fill();
	ctx.restore();

	const dessine = source ? await drawCircularImage(ctx, source, cx, cy, rayon) : false;
	if (!dessine) {
		// Avatar absent ou 404 : pastille brique et initiale cartoon.
		ctx.save();
		ctx.beginPath();
		ctx.fillStyle = PALETTE.brique;
		ctx.arc(cx, cy, rayon, 0, Math.PI * 2);
		ctx.fill();
		ctx.fillStyle = PALETTE.surBrique;
		ctx.font = `${Math.round(rayon * 1.05)}px ${POLICES.display}`;
		ctx.textAlign = "center";
		ctx.textBaseline = "middle";
		ctx.fillText(initiale(nom, POLICES.display), cx, cy + rayon * 0.06);
		ctx.textAlign = "left";
		ctx.textBaseline = "alphabetic";
		ctx.restore();
	}

	ctx.save();
	ctx.beginPath();
	ctx.strokeStyle = PALETTE.or;
	ctx.lineWidth = Math.max(3, rayon * 0.09);
	ctx.arc(cx, cy, rayon + ctx.lineWidth / 2, 0, Math.PI * 2);
	ctx.stroke();
	ctx.restore();
}

/** Ligne « pictogramme + texte », tronquée à la largeur disponible. */
function dessinerLigneIcone(
	ctx: SKRSContext2D,
	nom: NomPictogramme,
	texte: string,
	x: number,
	y: number,
	largeurMax: number,
	options: { taille: number; couleurIcone: string; couleurTexte: string }
): number {
	const cote = options.taille + 2;
	dessinerPictogramme(ctx, nom, x, y - cote + 2, cote, options.couleurIcone);
	ctx.save();
	ctx.font = `${options.taille}px ${POLICES.corps}`;
	ctx.fillStyle = options.couleurTexte;
	ctx.textBaseline = "alphabetic";
	const decalage = cote + 10;
	const rendu = tronquer(ctx, texte, largeurMax - decalage);
	ctx.fillText(rendu, x + decalage, y);
	const largeur = decalage + ctx.measureText(rendu).width;
	ctx.restore();
	return largeur;
}

async function encoder(canvas: Canvas): Promise<Buffer> {
	return await canvas.encode("png");
}

// ─── Grille d'équipe ───────────────────────────────────────────────────────

export interface TeamCardData {
	name: string;
	role: string;
	image_url: string | null;
}

export interface PlanGrille {
	colonnes: number;
	lignes: number;
	largeurCarte: number;
	hauteurCarte: number;
	hauteurImage: number;
}

const ECART = 24;
/** Bandeau + avatar + nom, avant les lignes de rôle. */
const HAUT_CARTE_EQUIPE = 196;
const INTERLIGNE_ROLE = 26;
export const MAX_LIGNES_ROLE = 3;

/**
 * Découpe de la grille d'équipe. Une seule colonne sous 2 membres (une carte
 * pleine largeur vaut mieux qu'une demi-carte suivie d'un trou), deux jusqu'à
 * 4, trois au-delà. La hauteur de carte suit le nombre de lignes de rôle
 * réellement rendues : à hauteur fixe, une équipe aux intitulés courts laissait
 * un tiers de carte vide.
 */
export function planifierGrilleEquipe(total: number, lignesRole = 1): PlanGrille {
	const affiches = Math.max(total, 0);
	const colonnes = affiches <= 1 ? 1 : affiches <= 4 ? 2 : 3;
	const lignes = Math.max(1, Math.ceil(affiches / colonnes));
	const largeurCarte = (L - MARGE * 2 - ECART * (colonnes - 1)) / colonnes;
	const hauteurCarte =
		HAUT_CARTE_EQUIPE +
		Math.min(Math.max(lignesRole, 1), MAX_LIGNES_ROLE) * INTERLIGNE_ROLE +
		RESPIRATION;
	const corps = affiches === 0 ? HAUTEUR_ETAT_VIDE : lignes * (hauteurCarte + ECART) - ECART;
	return {
		colonnes,
		lignes,
		largeurCarte,
		hauteurCarte,
		hauteurImage: HAUTEUR_ENTETE + RESPIRATION + corps + RESPIRATION + HAUTEUR_PIED,
	};
}

export async function renderTeamGrid(
	members: TeamCardData[],
	title: string,
	subtitle?: string
): Promise<Buffer> {
	ensureFonts();

	// Passe de mesure : on découpe les rôles avant de fixer la hauteur des cartes.
	const provisoire = planifierGrilleEquipe(members.length, MAX_LIGNES_ROLE);
	const mesure = createCanvas(L, 10).getContext("2d");
	mesure.font = `18px ${POLICES.corps}`;
	const rolesDecoupes = members.map((membre) =>
		decouperEnLignes(mesure, assainir(membre.role, POLICES.corps) || "Rôle non renseigné", {
			largeurMax: provisoire.largeurCarte - 48,
			maxLignes: MAX_LIGNES_ROLE,
		})
	);
	const lignesRoleMax = rolesDecoupes.reduce((max, lignes) => Math.max(max, lignes.length), 1);
	const plan = planifierGrilleEquipe(members.length, lignesRoleMax);

	const canvas = createCanvas(L, plan.hauteurImage);
	const ctx = canvas.getContext("2d");

	await dessinerFond(ctx, L, plan.hauteurImage);
	dessinerEnTete(ctx, {
		titre: title,
		sousTitre: subtitle,
		badge: `${members.length} membre${members.length > 1 ? "s" : ""}`,
	});

	const hautCorps = HAUTEUR_ENTETE + RESPIRATION;

	if (members.length === 0) {
		await dessinerEtatVide(
			ctx,
			MARGE,
			hautCorps,
			L - MARGE * 2,
			HAUTEUR_ETAT_VIDE,
			"Aucun membre actif dans cette équipe pour le moment."
		);
		dessinerPied(ctx, plan.hauteurImage);
		return await encoder(canvas);
	}

	for (const [index, membre] of members.entries()) {
		const colonne = index % plan.colonnes;
		const ligne = Math.floor(index / plan.colonnes);
		const x = MARGE + colonne * (plan.largeurCarte + ECART);
		const y = hautCorps + ligne * (plan.hauteurCarte + ECART);
		const centre = x + plan.largeurCarte / 2;
		const nom = premierTexteUtilisable([membre.name], POLICES.display, "Membre");

		dessinerPanneau(ctx, x, y, plan.largeurCarte, plan.hauteurCarte, { rayon: RAYONS.xl });
		// Bandeau haut brique, coupé à l'arrondi de la carte…
		ctx.save();
		roundedRect(ctx, x, y, plan.largeurCarte, plan.hauteurCarte, RAYONS.xl);
		ctx.clip();
		ctx.fillStyle = PALETTE.brique;
		ctx.fillRect(x, y, plan.largeurCarte, 74);
		ctx.restore();
		// …puis liseré or retracé par-dessus : le bandeau l'écrasait sur le haut
		// de la carte, qui se retrouvait sans bordure.
		strokeRoundedRect(
			ctx,
			x + BORDURE_OR / 2,
			y + BORDURE_OR / 2,
			plan.largeurCarte - BORDURE_OR,
			plan.hauteurCarte - BORDURE_OR,
			RAYONS.xl,
			PALETTE.or,
			BORDURE_OR
		);

		await dessinerAvatar(ctx, membre.image_url, centre, y + 84, 52, nom);

		ctx.save();
		ctx.textAlign = "center";
		ctx.textBaseline = "alphabetic";
		ctx.font = `26px ${POLICES.display}`;
		ctx.fillStyle = PALETTE.texte;
		ctx.fillText(tronquer(ctx, nom, plan.largeurCarte - 40), centre, y + 174);

		ctx.font = `18px ${POLICES.corps}`;
		ctx.fillStyle = PALETTE.texteAttenue;
		for (const [i, texte] of (rolesDecoupes[index] ?? []).entries()) {
			ctx.fillText(texte, centre, y + HAUT_CARTE_EQUIPE + 8 + i * INTERLIGNE_ROLE);
		}
		ctx.textAlign = "left";
		ctx.restore();
	}

	dessinerPied(ctx, plan.hauteurImage);
	return await encoder(canvas);
}

// ─── Profil ────────────────────────────────────────────────────────────────

export interface ProfileCardData {
	username: string | null;
	full_name: string | null;
	avatar_url: string | null;
	banner_url: string | null;
	bio: string | null;
	role: string | null;
	twitter_handle?: string | null;
	website?: string | null;
	discord_id?: string | null;
}

const HAUTEUR_BANNIERE = 214;
const RAYON_AVATAR = 86;
const MAX_LIGNES_BIO = 6;

/**
 * Ordonnée du filet qui sépare l'identité (nom, pseudo, rôle) du corps de la
 * carte. Calculée pour ne jamais passer sous l'avatar, ni laisser un vide quand
 * le profil n'a ni pseudo ni rôle — l'ancienne carte réservait la place dans
 * tous les cas.
 */
function ordonneeFiletProfil(yCarte: number, avecPseudo: boolean, avecRole: boolean): number {
	let bas = yCarte;
	if (avecPseudo) bas = yCarte + 66;
	if (avecRole) bas = (avecPseudo ? yCarte + 78 : yCarte + 44) + 34;
	// L'avatar déborde du haut de la carte : le filet doit passer sous lui.
	return Math.max(bas + 24, yCarte + RAYON_AVATAR + 26);
}

export async function renderProfileCard(p: ProfileCardData): Promise<Buffer> {
	ensureFonts();

	const nom = premierTexteUtilisable(
		[p.full_name, p.username, p.discord_id],
		POLICES.display,
		"Membre Rose Griffon"
	);
	const pseudo = assainir(p.username, POLICES.corps);
	const role = assainir(p.role, POLICES.corps);
	const bio = assainir(p.bio, POLICES.corps);

	const liens: { icone: NomPictogramme; texte: string }[] = [];
	const twitter = assainir(p.twitter_handle, POLICES.corps);
	if (twitter) liens.push({ icone: "croix", texte: `@${twitter.replace(/^@/, "")}` });
	const site = assainir(p.website, POLICES.corps);
	if (site) liens.push({ icone: "globe", texte: site.replace(/^https?:\/\//, "") });
	const discord = assainir(p.discord_id, POLICES.corps);
	if (discord) liens.push({ icone: "lien", texte: `Discord ${discord}` });

	// Passe de mesure : la hauteur de l'image dépend du nombre de lignes de bio
	// réellement produites. Sans elle, une bio longue passait sous la ligne de
	// liens (l'ancienne carte avait une hauteur figée à 540 px).
	const mesure = createCanvas(L, 10).getContext("2d");
	const yCarte = HAUTEUR_BANNIERE - 48;
	const largeurInterne = L - MARGE * 2 - RESPIRATION * 2;
	mesure.font = `22px ${POLICES.corps}`;
	const lignesBio = bio
		? decouperEnLignes(mesure, bio, { largeurMax: largeurInterne, maxLignes: MAX_LIGNES_BIO })
		: [];
	const hauteurBio = bio ? Math.max(1, lignesBio.length) * 34 : 76;
	const hauteurLiens = liens.length > 0 ? 56 : 0;
	const yFilet = ordonneeFiletProfil(yCarte, pseudo.length > 0, role.length > 0);
	const hauteurCarte = yFilet - yCarte + 40 + hauteurBio + hauteurLiens + RESPIRATION;
	const hauteur = yCarte + hauteurCarte + 24 + HAUTEUR_PIED;

	const canvas = createCanvas(L, hauteur);
	const ctx = canvas.getContext("2d");
	await dessinerFond(ctx, L, hauteur);

	// Bannière : image de couverture, ou dégradé brique de repli.
	const banniere = p.banner_url
		? await drawCoveredImage(ctx, p.banner_url, 0, 0, L, HAUTEUR_BANNIERE)
		: false;
	if (!banniere) {
		const degrade = ctx.createLinearGradient(0, 0, L, HAUTEUR_BANNIERE);
		degrade.addColorStop(0, PALETTE.brique);
		degrade.addColorStop(1, PALETTE.briqueClair);
		ctx.fillStyle = degrade;
		ctx.fillRect(0, 0, L, HAUTEUR_BANNIERE);
	}
	// Voile marine en bas de bannière : garantit la lisibilité quelle que soit
	// l'image téléversée par le membre.
	const voile = ctx.createLinearGradient(0, HAUTEUR_BANNIERE - 130, 0, HAUTEUR_BANNIERE);
	voile.addColorStop(0, "rgba(10, 21, 44, 0)");
	voile.addColorStop(1, "rgba(10, 21, 44, 0.92)");
	ctx.fillStyle = voile;
	ctx.fillRect(0, HAUTEUR_BANNIERE - 130, L, 130);
	ctx.fillStyle = PALETTE.or;
	ctx.fillRect(0, HAUTEUR_BANNIERE - 4, L, 4);

	// Voile haut + surtitre : la banniere occupait 214 px sans rien dire, et un
	// visuel clair rendait illisible tout texte pose dessus.
	const voileHaut = ctx.createLinearGradient(0, 0, 0, 108);
	voileHaut.addColorStop(0, "rgba(10, 21, 44, 0.75)");
	voileHaut.addColorStop(1, "rgba(10, 21, 44, 0)");
	ctx.fillStyle = voileHaut;
	ctx.fillRect(0, 0, L, 108);
	// Le nom est aligné sur la colonne de texte de la carte, à droite de la place
	// que prendra l'avatar : posé dans la marge, il passait sous le médaillon.
	const xTexte = MARGE + 110 + RAYON_AVATAR + 40;
	const largeurTexte = L - MARGE - RESPIRATION - xTexte;

	ctx.save();
	ctx.textAlign = "left";
	ctx.textBaseline = "alphabetic";
	ctx.font = `bold 14px ${POLICES.corps}`;
	ctx.fillStyle = PALETTE.or;
	ctx.fillText("ROSE GRIFFON \u00b7 PROFIL", xTexte, 62);
	ctx.restore();
	dessinerTitreCartoon(ctx, nom, xTexte, 116, {
		taille: 42,
		police: POLICES.display,
		remplissage: PALETTE.surFond,
		largeurMax: largeurTexte,
	});

	dessinerPanneau(ctx, MARGE, yCarte, L - MARGE * 2, hauteurCarte, { rayon: RAYONS.xl });

	await dessinerAvatar(ctx, p.avatar_url, MARGE + 110, yCarte, RAYON_AVATAR, nom);

	if (pseudo) {
		ctx.save();
		ctx.textAlign = "left";
		ctx.textBaseline = "alphabetic";
		ctx.font = `26px ${POLICES.corps}`;
		ctx.fillStyle = PALETTE.texteAttenue;
		ctx.fillText(tronquer(ctx, `@${pseudo}`, largeurTexte), xTexte, yCarte + 56);
		ctx.restore();
	}

	if (role) {
		dessinerPastille(ctx, xTexte, pseudo ? yCarte + 78 : yCarte + 44, role, {
			fond: PALETTE.or,
			texte: PALETTE.surOr,
			taillePolice: 17,
			police: POLICES.corps,
			hauteur: 34,
			largeurMax: largeurTexte,
		});
	}

	const xInterne = MARGE + RESPIRATION;
	let y = yFilet;
	dessinerFilet(ctx, xInterne, y, largeurInterne);
	y += 40;

	ctx.save();
	ctx.textAlign = "left";
	ctx.textBaseline = "alphabetic";
	if (bio) {
		ctx.font = `22px ${POLICES.corps}`;
		ctx.fillStyle = PALETTE.texte;
		for (const [index, ligne] of lignesBio.entries()) {
			ctx.fillText(ligne, xInterne, y + index * 34 + 16);
		}
	} else {
		// État vide explicite : l'ancienne carte affichait un simple tiret cadratin.
		fillRoundedRect(ctx, xInterne, y - 12, largeurInterne, 64, RAYONS.md, PALETTE.carteCreuse);
		ctx.font = `20px ${POLICES.corps}`;
		ctx.fillStyle = PALETTE.texteAttenue;
		ctx.fillText("Ce membre n'a pas encore rédigé de présentation.", xInterne + 20, y + 26);
	}
	ctx.restore();

	y += hauteurBio + 12;

	if (liens.length > 0) {
		dessinerFilet(ctx, xInterne, y, largeurInterne);
		let x = xInterne;
		const restant = () => largeurInterne - (x - xInterne);
		for (const lien of liens) {
			if (restant() < 120) break;
			const largeur = dessinerLigneIcone(ctx, lien.icone, lien.texte, x, y + 36, restant(), {
				taille: 18,
				couleurIcone: PALETTE.brique,
				couleurTexte: PALETTE.texteAttenue,
			});
			x += largeur + 34;
		}
	}

	dessinerPied(ctx, hauteur, pseudo ? `rosegriffon.fr/profil/${pseudo}` : undefined);
	return await encoder(canvas);
}

// ─── Événements ────────────────────────────────────────────────────────────

export interface EventCardData {
	title: string;
	description: string | null;
	start_time: Date | string;
	location: string | null;
	image_url: string | null;
}

function versDate(valeur: Date | string | null | undefined): Date | null {
	if (!valeur) return null;
	const date = typeof valeur === "string" ? new Date(valeur) : valeur;
	return Number.isNaN(date.getTime()) ? null : date;
}

function formaterDateHeure(valeur: Date | string): string {
	const date = versDate(valeur);
	if (!date) return "Date à confirmer";
	return date.toLocaleString("fr-FR", {
		weekday: "long",
		day: "2-digit",
		month: "long",
		hour: "2-digit",
		minute: "2-digit",
	});
}

const HAUTEUR_CARTE_EVENEMENT = 176;

export async function renderEventList(events: EventCardData[]): Promise<Buffer> {
	ensureFonts();
	const corps =
		events.length === 0
			? HAUTEUR_ETAT_VIDE
			: events.length * (HAUTEUR_CARTE_EVENEMENT + ECART) - ECART;
	const hauteur = HAUTEUR_ENTETE + RESPIRATION + corps + RESPIRATION + HAUTEUR_PIED;

	const canvas = createCanvas(L, hauteur);
	const ctx = canvas.getContext("2d");
	await dessinerFond(ctx, L, hauteur);
	dessinerEnTete(ctx, {
		titre: "Événements à venir",
		sousTitre: "L'agenda de l'association",
		badge: `${events.length}`,
	});

	const largeur = L - MARGE * 2;
	const hautCorps = HAUTEUR_ENTETE + RESPIRATION;

	if (events.length === 0) {
		await dessinerEtatVide(
			ctx,
			MARGE,
			hautCorps,
			largeur,
			HAUTEUR_ETAT_VIDE,
			"Aucun événement à venir — rendez-vous très vite !"
		);
		dessinerPied(ctx, hauteur);
		return await encoder(canvas);
	}

	for (const [index, evenement] of events.entries()) {
		const y = hautCorps + index * (HAUTEUR_CARTE_EVENEMENT + ECART);
		dessinerPanneau(ctx, MARGE, y, largeur, HAUTEUR_CARTE_EVENEMENT, {
			rayon: RAYONS.lg,
			fond: index % 2 === 0 ? PALETTE.carte : PALETTE.carteAlt,
		});

		const cadreX = MARGE + 20;
		const cadreY = y + 20;
		const cadreL = 216;
		const cadreH = HAUTEUR_CARTE_EVENEMENT - 40;
		const vignette = evenement.image_url
			? await drawCoveredImage(ctx, evenement.image_url, cadreX, cadreY, cadreL, cadreH, RAYONS.md)
			: false;
		if (!vignette) {
			fillRoundedRect(ctx, cadreX, cadreY, cadreL, cadreH, RAYONS.md, PALETTE.carteCreuse);
			dessinerPictogramme(
				ctx,
				"calendrier",
				cadreX + cadreL / 2 - 28,
				cadreY + cadreH / 2 - 28,
				56,
				PALETTE.brique
			);
		}
		strokeRoundedRect(
			ctx,
			cadreX + 1,
			cadreY + 1,
			cadreL - 2,
			cadreH - 2,
			RAYONS.md,
			PALETTE.or,
			BORDURE_OR
		);

		const xTexte = cadreX + cadreL + 24;
		const largeurTexte = L - MARGE - RESPIRATION - xTexte;

		ctx.save();
		ctx.textAlign = "left";
		ctx.textBaseline = "alphabetic";
		ctx.font = `28px ${POLICES.display}`;
		ctx.fillStyle = PALETTE.texte;
		const titre = premierTexteUtilisable([evenement.title], POLICES.display, "Événement");
		ctx.fillText(tronquer(ctx, titre, largeurTexte), xTexte, y + 54);
		ctx.restore();

		const dateTexte = formaterDateHeure(evenement.start_time);
		dessinerPastille(ctx, xTexte, y + 68, dateTexte, {
			fond: PALETTE.brique,
			texte: PALETTE.surBrique,
			taillePolice: 16,
			police: POLICES.corps,
			hauteur: 32,
			largeurMax: largeurTexte,
		});

		const lieu = assainir(evenement.location, POLICES.corps);
		if (lieu) {
			dessinerLigneIcone(ctx, "epingle", lieu, xTexte, y + 126, largeurTexte, {
				taille: 17,
				couleurIcone: PALETTE.brique,
				couleurTexte: PALETTE.texteAttenue,
			});
		}

		// La description a sa propre ligne : la coller à droite du lieu produisait
		// deux colonnes de texte sans rapport, illisibles.
		const description = assainir(evenement.description, POLICES.corps);
		if (description) {
			ctx.save();
			ctx.font = `16px ${POLICES.corps}`;
			ctx.fillStyle = PALETTE.texteAttenue;
			ctx.textBaseline = "alphabetic";
			ctx.fillText(tronquer(ctx, description, largeurTexte), xTexte, y + (lieu ? 154 : 126));
			ctx.restore();
		}
	}

	dessinerPied(ctx, hauteur);
	return await encoder(canvas);
}

// ─── Chroniques ────────────────────────────────────────────────────────────

export interface ChroniqueCardData {
	title: string;
	slug: string;
	excerpt: string | null;
	category: string;
	views_count: number | null;
	featured_image: string | null;
	created_at: Date | string | null;
}

const HAUTEUR_CARTE_CHRONIQUE = 190;

export async function renderChroniqueList(
	rows: ChroniqueCardData[],
	filterLabel?: string
): Promise<Buffer> {
	ensureFonts();
	const corps =
		rows.length === 0 ? HAUTEUR_ETAT_VIDE : rows.length * (HAUTEUR_CARTE_CHRONIQUE + ECART) - ECART;
	const hauteur = HAUTEUR_ENTETE + RESPIRATION + corps + RESPIRATION + HAUTEUR_PIED;

	const canvas = createCanvas(L, hauteur);
	const ctx = canvas.getContext("2d");
	await dessinerFond(ctx, L, hauteur);
	dessinerEnTete(ctx, {
		titre: "Chroniques",
		sousTitre: filterLabel ?? "Dernières publications",
		badge: `${rows.length}`,
	});

	const largeur = L - MARGE * 2;
	const hautCorps = HAUTEUR_ENTETE + RESPIRATION;

	if (rows.length === 0) {
		await dessinerEtatVide(
			ctx,
			MARGE,
			hautCorps,
			largeur,
			HAUTEUR_ETAT_VIDE,
			"Aucune chronique publiée pour cette sélection."
		);
		dessinerPied(ctx, hauteur);
		return await encoder(canvas);
	}

	for (const [index, chronique] of rows.entries()) {
		const y = hautCorps + index * (HAUTEUR_CARTE_CHRONIQUE + ECART);
		dessinerPanneau(ctx, MARGE, y, largeur, HAUTEUR_CARTE_CHRONIQUE, {
			rayon: RAYONS.lg,
			fond: index % 2 === 0 ? PALETTE.carte : PALETTE.carteAlt,
		});

		const cadreX = MARGE + 20;
		const cadreY = y + 20;
		const cadreL = 240;
		const cadreH = HAUTEUR_CARTE_CHRONIQUE - 40;
		const vignette = chronique.featured_image
			? await drawCoveredImage(
					ctx,
					chronique.featured_image,
					cadreX,
					cadreY,
					cadreL,
					cadreH,
					RAYONS.md
				)
			: false;
		if (!vignette) {
			fillRoundedRect(ctx, cadreX, cadreY, cadreL, cadreH, RAYONS.md, PALETTE.carteCreuse);
			dessinerPictogramme(
				ctx,
				"etoile",
				cadreX + cadreL / 2 - 26,
				cadreY + cadreH / 2 - 26,
				52,
				PALETTE.or
			);
		}
		strokeRoundedRect(
			ctx,
			cadreX + 1,
			cadreY + 1,
			cadreL - 2,
			cadreH - 2,
			RAYONS.md,
			PALETTE.or,
			BORDURE_OR
		);

		const xTexte = cadreX + cadreL + 24;
		const largeurTexte = L - MARGE - RESPIRATION - xTexte;

		const categorie = assainir(chronique.category, POLICES.corps);
		if (categorie) {
			dessinerPastille(ctx, xTexte, y + 22, categorie, {
				fond: PALETTE.brique,
				texte: PALETTE.surBrique,
				taillePolice: 14,
				police: POLICES.corps,
				hauteur: 28,
				largeurMax: largeurTexte,
			});
		}

		ctx.save();
		ctx.textAlign = "left";
		ctx.textBaseline = "alphabetic";
		ctx.font = `28px ${POLICES.display}`;
		ctx.fillStyle = PALETTE.texte;
		const titre = premierTexteUtilisable(
			[chronique.title, chronique.slug],
			POLICES.display,
			"Chronique"
		);
		ctx.fillText(tronquer(ctx, titre, largeurTexte), xTexte, y + 92);

		const extrait = assainir(chronique.excerpt, POLICES.corps);
		if (extrait) {
			ctx.font = `18px ${POLICES.corps}`;
			ctx.fillStyle = PALETTE.texteAttenue;
			const lignes = decouperEnLignes(ctx, extrait, { largeurMax: largeurTexte, maxLignes: 2 });
			for (const [i, ligne] of lignes.entries()) {
				ctx.fillText(ligne, xTexte, y + 122 + i * 26);
			}
		}
		ctx.restore();

		const date = versDate(chronique.created_at);
		const meta = date ? date.toLocaleDateString("fr-FR") : "Date inconnue";
		const largeurMeta = dessinerLigneIcone(
			ctx,
			"calendrier",
			meta,
			xTexte,
			y + HAUTEUR_CARTE_CHRONIQUE - 24,
			largeurTexte,
			{ taille: 15, couleurIcone: PALETTE.or, couleurTexte: PALETTE.texteAttenue }
		);
		dessinerLigneIcone(
			ctx,
			"oeil",
			`${chronique.views_count ?? 0}`,
			xTexte + largeurMeta + 28,
			y + HAUTEUR_CARTE_CHRONIQUE - 24,
			largeurTexte - largeurMeta - 28,
			{ taille: 15, couleurIcone: PALETTE.or, couleurTexte: PALETTE.texteAttenue }
		);
	}

	dessinerPied(ctx, hauteur);
	return await encoder(canvas);
}

// ─── Membres Discord ───────────────────────────────────────────────────────

export interface MemberCardData {
	username: string;
	display_name: string | null;
	avatar_url: string | null;
	roles_count: number;
	joined_at: Date | string | null;
}

export interface PlanListeMembres {
	colonnes: number;
	lignes: number;
	largeurCarte: number;
	hauteurLigne: number;
	affiches: number;
	hauteurImage: number;
}

const HAUTEUR_LIGNE_MEMBRE = 104;
/** Au-delà, l'image devient trop haute pour être lisible dans Discord. */
export const MAX_MEMBRES_AFFICHES = 30;
/** Seuil de passage en deux colonnes. */
const SEUIL_DEUX_COLONNES = 12;

/**
 * Découpe de la liste de membres. Une longue liste passe en deux colonnes :
 * en une seule, 25 membres produisaient une image de plus de 2 600 px de haut,
 * que Discord réduit à une bande illisible.
 */
export function planifierListeMembres(total: number): PlanListeMembres {
	const affiches = Math.min(Math.max(total, 0), MAX_MEMBRES_AFFICHES);
	const colonnes = affiches > SEUIL_DEUX_COLONNES ? 2 : 1;
	const lignes = Math.max(1, Math.ceil(affiches / colonnes));
	const largeurCarte = (L - MARGE * 2 - ECART * (colonnes - 1)) / colonnes;
	const corps = affiches === 0 ? HAUTEUR_ETAT_VIDE : lignes * (HAUTEUR_LIGNE_MEMBRE + 12) - 12;
	return {
		colonnes,
		lignes,
		largeurCarte,
		hauteurLigne: HAUTEUR_LIGNE_MEMBRE,
		affiches,
		hauteurImage: HAUTEUR_ENTETE + RESPIRATION + corps + RESPIRATION + HAUTEUR_PIED,
	};
}

export async function renderMemberList(rows: MemberCardData[]): Promise<Buffer> {
	ensureFonts();
	const plan = planifierListeMembres(rows.length);
	const visibles = rows.slice(0, plan.affiches);
	const canvas = createCanvas(L, plan.hauteurImage);
	const ctx = canvas.getContext("2d");

	await dessinerFond(ctx, L, plan.hauteurImage);
	dessinerEnTete(ctx, {
		titre: "Membres Discord",
		sousTitre:
			rows.length > plan.affiches
				? `${plan.affiches} affichés sur ${rows.length} résultats`
				: "Communauté Rose Griffon",
		badge: `${rows.length}`,
	});

	const hautCorps = HAUTEUR_ENTETE + RESPIRATION;

	if (visibles.length === 0) {
		await dessinerEtatVide(
			ctx,
			MARGE,
			hautCorps,
			L - MARGE * 2,
			HAUTEUR_ETAT_VIDE,
			"Aucun membre ne correspond à cette recherche."
		);
		dessinerPied(ctx, plan.hauteurImage);
		return await encoder(canvas);
	}

	for (const [index, membre] of visibles.entries()) {
		const colonne = index % plan.colonnes;
		const ligne = Math.floor(index / plan.colonnes);
		const x = MARGE + colonne * (plan.largeurCarte + ECART);
		const y = hautCorps + ligne * (plan.hauteurLigne + 12);

		dessinerPanneau(ctx, x, y, plan.largeurCarte, plan.hauteurLigne, {
			rayon: RAYONS.lg,
			fond: ligne % 2 === 0 ? PALETTE.carte : PALETTE.carteAlt,
			ombre: { x: 0, y: 3, couleur: OMBRE_DURE.couleur },
		});

		const nom = premierTexteUtilisable(
			[membre.display_name, membre.username],
			POLICES.display,
			"Membre"
		);
		await dessinerAvatar(ctx, membre.avatar_url, x + 62, y + plan.hauteurLigne / 2, 34, nom);

		// La pastille est mesurée AVANT le nom : sans cela, un pseudo long passait
		// sous le badge de rôles au lieu d'être tronqué.
		const libelleRoles = `${membre.roles_count} rôle${membre.roles_count > 1 ? "s" : ""}`;
		const largeurRoles = largeurPastille(ctx, libelleRoles, 14, POLICES.corps);
		dessinerPastille(
			ctx,
			x + plan.largeurCarte - largeurRoles - 20,
			y + plan.hauteurLigne / 2 - 15,
			libelleRoles,
			{
				fond: PALETTE.carteCreuse,
				texte: PALETTE.texte,
				taillePolice: 14,
				police: POLICES.corps,
				hauteur: 30,
				largeurMax: plan.largeurCarte / 3,
			}
		);

		const xTexte = x + 108;
		const largeurTexte = plan.largeurCarte - 108 - largeurRoles - 36;

		ctx.save();
		ctx.textAlign = "left";
		ctx.textBaseline = "alphabetic";
		ctx.font = `23px ${POLICES.display}`;
		ctx.fillStyle = PALETTE.texte;
		ctx.fillText(tronquer(ctx, nom, largeurTexte), xTexte, y + 46);

		const pseudo = assainir(membre.username, POLICES.corps);
		const arrivee = versDate(membre.joined_at);
		const meta = [
			membre.display_name && pseudo ? `@${pseudo}` : null,
			arrivee ? `arrivé·e le ${arrivee.toLocaleDateString("fr-FR")}` : null,
		]
			.filter(Boolean)
			.join(" · ");
		if (meta) {
			ctx.font = `16px ${POLICES.corps}`;
			ctx.fillStyle = PALETTE.texteAttenue;
			ctx.fillText(tronquer(ctx, meta, largeurTexte), xTexte, y + 74);
		}
		ctx.restore();
	}

	dessinerPied(ctx, plan.hauteurImage);
	return await encoder(canvas);
}
