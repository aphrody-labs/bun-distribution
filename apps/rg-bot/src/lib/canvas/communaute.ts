/**
 * Cartes de la vie de communauté : profil, classement, recrutement.
 *
 * ── CE QUI DISTINGUE CES CARTES DE CELLES DE TOUS LES AUTRES BOTS ──────────
 * Elles sont peintes avec les assets RÉELS du jeu, servis par
 * `cdn.rosegriffon.fr` qui décode les CPK en direct :
 *
 *   - le fond de la carte de profil est une **plaque de nom** d'Inazuma Eleven
 *     Victory Road (`inagle_nameplates`, 54 plaques, achetées avec des jetons
 *     Kizuna) ;
 *   - le portrait du **joueur fétiche** vient de `200_icon/10_icon_chr/face/` ;
 *   - le **rang** porte le libellé exact de l'échelle de rareté du jeu
 *     (Normal · Expérimenté · Héros · BASARA).
 *
 * Une carte de niveau ordinaire montre un dégradé et un compteur. Celle-ci
 * montre quelque chose qui n'existe que sur ce serveur.
 *
 * ── LE RÉSEAU N'EST JAMAIS BLOQUANT ────────────────────────────────────────
 * Chaque image distante passe par `drawCoveredImage`/`drawCircularImage`, qui
 * rendent `false` au lieu de lever. Une plaque absente, un portrait en 404, un
 * CDN lent : la carte sort quand même, avec son repli. Une carte de profil qui
 * échoue parce qu'une texture manque serait une régression sur un simple
 * `/profil`.
 */

import { createCanvas, type SKRSContext2D } from "@aphrody/canvas";

import { entierLisible, formaterNombre } from "../ui/nombres";
import { rangDe, type Progression } from "../experience";
import { rareteDe } from "../collection";
import { BORDURE_OR, ensureFonts, MARGE, MARQUE_CANVAS, OMBRE_DURE, PALETTE, POLICES, RAYONS } from "./theme";
import { assainir, decouperEnLignes, initiale, tronquer } from "./texte";
import {
  dessinerFilet,
  dessinerFond,
  dessinerPanneau,
  dessinerPastille,
  dessinerTitreCartoon,
  drawCircularImage,
  drawCoveredImage,
  fillRoundedRect,
  largeurPastille,
  roundedRect,
  strokeRoundedRect,
} from "./utils";

const L = 1200;
const RESPIRATION = 28;
const HAUTEUR_PIED = 58;

/** Les teintes que les modules purs demandent, résolues sur la palette. */
const TEINTES = {
  azalee: PALETTE.azalee,
  brique: PALETTE.brique,
  or: PALETTE.or,
  texteAttenue: PALETTE.texteAttenue,
} as const;

function teinte(nom: keyof typeof TEINTES): string {
  return TEINTES[nom];
}

/**
 * Pied commun à ces cartes.
 *
 * Repris de `cards.ts` plutôt qu'importé : `dessinerPied` y est privé, et
 * l'exporter obligerait à en figer la signature pour six cartes qui n'ont pas
 * les mêmes besoins. Les six lignes dupliquées coûtent moins qu'un couplage.
 */
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

/**
 * Barre de progression, avec sa graduation.
 *
 * Le remplissage est borné à un MINIMUM VISIBLE quand la progression n'est pas
 * nulle : à 0,3 % d'un niveau, un rectangle de deux pixels de large disparaît
 * sous l'arrondi et la barre paraît vide alors qu'elle ne l'est pas.
 */
function dessinerBarre(
  ctx: SKRSContext2D,
  x: number,
  y: number,
  largeur: number,
  hauteur: number,
  ratio: number,
  couleur: string,
): void {
  const borne = Number.isFinite(ratio) ? Math.min(1, Math.max(0, ratio)) : 0;
  fillRoundedRect(ctx, x, y, largeur, hauteur, hauteur / 2, PALETTE.carteCreuse);
  if (borne > 0) {
    const remplissage = Math.max(hauteur, largeur * borne);
    const degrade = ctx.createLinearGradient(x, y, x + remplissage, y);
    degrade.addColorStop(0, couleur);
    degrade.addColorStop(1, PALETTE.or);
    fillRoundedRect(ctx, x, y, remplissage, hauteur, hauteur / 2, degrade as unknown as string);
  }
  strokeRoundedRect(ctx, x + 1, y + 1, largeur - 2, hauteur - 2, hauteur / 2, PALETTE.filet, 1);
}

// ─── Carte de profil ────────────────────────────────────────────────────────

export interface DonneesCarteProfil {
  pseudo: string;
  avatarUrl: string | null;
  /** URL CDN de la plaque de nom équipée, `null` pour le fond par défaut. */
  plaqueUrl: string | null;
  progression: Progression;
  jetons: number;
  jetonsGagnes: number;
  messages: number;
  /** Position au classement d'XP, `null` si le membre n'est pas classé. */
  rang: number | null;
  total: number;
  /** Joueur fétiche : portrait, nom, rareté. */
  favori: { nom: string; portraitUrl: string | null; rarete: unknown } | null;
  /** Résumé de collection, déjà mis en forme (`12 sur 6 090 · 0,2 %`). */
  collection: string | null;
  /** Série de passages quotidiens en cours. */
  serie: number;
}

const HAUTEUR_PLAQUE = 190;
const RAYON_AVATAR = 78;

/**
 * Repères verticaux de la carte de profil, comptés depuis le haut du panneau.
 *
 * Ils sont nommés parce que la hauteur du panneau se calcule À PARTIR d'eux :
 * la première version additionnait des constantes écrites à deux endroits, et
 * la ligne de collection tombait deux pixels SOUS le panneau — visible sur la
 * carte finale, invisible dans le code.
 */
const REPERES_PROFIL = {
  /**
   * Haut de la barre d'XP.
   *
   * 162 et pas moins : la ligne « NIVEAU 32 » est écrite 26 px au-dessus, en
   * 44 px de police display, et son jambage haut remontait dans les
   * descendantes du pseudo (42 px, ligne de base à +74). Les deux se
   * chevauchaient sur toutes les cartes.
   */
  barre: 162,
  /** Filet de séparation des chiffres. */
  chiffres: 162 + 84,
  /** Haut du bloc « joueur fétiche ». */
  bas: 162 + 84 + 74,
  /** Hauteur du bloc « joueur fétiche », gouttière comprise. */
  blocFavori: 96 + 22,
  /** Hauteur réservée à la ligne de collection. */
  ligneCollection: 30,
  /** Respiration sous le dernier élément. */
  pied: 16,
} as const;

/**
 * Titre cartoon CENTRÉ sur une abscisse.
 *
 * `dessinerTitreCartoon` impose `textAlign = "left"` (le contour et l'ombre
 * doivent être tracés au même point que le remplissage). On mesure donc le
 * texte avec la police du titre — et non celle en cours — avant de décaler.
 */
function titreCentre(
  ctx: SKRSContext2D,
  texte: string,
  cx: number,
  y: number,
  options: { taille: number; police: string; remplissage: string; largeurMax: number },
): void {
  ctx.save();
  ctx.font = `${options.taille}px ${options.police}`;
  const rendu = tronquer(ctx, texte, options.largeurMax);
  const largeur = ctx.measureText(rendu).width;
  ctx.restore();
  dessinerTitreCartoon(ctx, rendu, cx - largeur / 2, y, options);
}

/**
 * La carte de profil.
 *
 * Mise en page calculée, jamais figée : la hauteur dépend de la présence d'un
 * joueur fétiche et d'une ligne de collection. Une carte à hauteur fixe laisse
 * un vide chez le membre qui n'a rien, et déborde chez celui qui a tout.
 */
export async function renderCarteProfil(donnees: DonneesCarteProfil): Promise<Buffer> {
  ensureFonts();

  const pseudo = assainir(donnees.pseudo, POLICES.display) || "Membre";
  const rang = rangDe(donnees.progression.niveau);
  const avecFavori = donnees.favori !== null;

  const yCarte = HAUTEUR_PLAQUE - 44;
  const hauteurCarte =
    REPERES_PROFIL.bas +
    (avecFavori ? REPERES_PROFIL.blocFavori : 0) +
    (donnees.collection ? REPERES_PROFIL.ligneCollection : 0) +
    REPERES_PROFIL.pied;
  const hauteur = yCarte + hauteurCarte + 24 + HAUTEUR_PIED;

  const canvas = createCanvas(L, hauteur);
  const ctx = canvas.getContext("2d");
  await dessinerFond(ctx, L, hauteur);

  // ── Bandeau : la plaque de nom du jeu, ou le dégradé de repli ─────────────
  const plaque = donnees.plaqueUrl ? await drawCoveredImage(ctx, donnees.plaqueUrl, 0, 0, L, HAUTEUR_PLAQUE) : false;
  if (!plaque) {
    const degrade = ctx.createLinearGradient(0, 0, L, HAUTEUR_PLAQUE);
    degrade.addColorStop(0, PALETTE.brique);
    degrade.addColorStop(1, PALETTE.briqueClair);
    ctx.fillStyle = degrade;
    ctx.fillRect(0, 0, L, HAUTEUR_PLAQUE);
  }
  // Voile marine : une plaque du jeu est claire et chargée ; sans voile, le
  // pseudo posé dessus devient illisible sur la moitié des 54 plaques.
  const voile = ctx.createLinearGradient(0, HAUTEUR_PLAQUE - 130, 0, HAUTEUR_PLAQUE);
  voile.addColorStop(0, "rgba(10, 21, 44, 0)");
  voile.addColorStop(1, "rgba(10, 21, 44, 0.92)");
  ctx.fillStyle = voile;
  ctx.fillRect(0, HAUTEUR_PLAQUE - 130, L, 130);

  ctx.save();
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.font = `bold 14px ${POLICES.corps}`;
  ctx.fillStyle = PALETTE.or;
  ctx.fillText(MARQUE_CANVAS.surtitre, MARGE, 40);
  ctx.restore();

  // ── Panneau principal ────────────────────────────────────────────────────
  dessinerPanneau(ctx, MARGE, yCarte, L - MARGE * 2, hauteurCarte, { rayon: RAYONS.xl });

  const xInterne = MARGE + RESPIRATION;
  const largeurInterne = L - MARGE * 2 - RESPIRATION * 2;

  // Avatar, à cheval sur le bandeau et le panneau.
  const cxAvatar = xInterne + RAYON_AVATAR;
  const cyAvatar = yCarte + 12;
  ctx.save();
  ctx.beginPath();
  ctx.fillStyle = OMBRE_DURE.couleur;
  ctx.arc(cxAvatar + OMBRE_DURE.x, cyAvatar + OMBRE_DURE.y, RAYON_AVATAR + 3, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  const avatar = donnees.avatarUrl
    ? await drawCircularImage(ctx, donnees.avatarUrl, cxAvatar, cyAvatar, RAYON_AVATAR)
    : false;
  if (!avatar) {
    ctx.save();
    ctx.beginPath();
    ctx.fillStyle = PALETTE.brique;
    ctx.arc(cxAvatar, cyAvatar, RAYON_AVATAR, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = PALETTE.surBrique;
    ctx.font = `${Math.round(RAYON_AVATAR * 1.05)}px ${POLICES.display}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(initiale(pseudo, POLICES.display), cxAvatar, cyAvatar + RAYON_AVATAR * 0.06);
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    ctx.restore();
  }
  ctx.save();
  ctx.beginPath();
  ctx.strokeStyle = teinte(rang.teinte);
  ctx.lineWidth = Math.max(4, RAYON_AVATAR * 0.1);
  ctx.arc(cxAvatar, cyAvatar, RAYON_AVATAR + ctx.lineWidth / 2, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();

  // ── Identité ─────────────────────────────────────────────────────────────
  const xTexte = cxAvatar + RAYON_AVATAR + 30;
  const largeurTexte = L - MARGE - RESPIRATION - xTexte;

  // La pastille de rang d'abord : elle borne la largeur du pseudo.
  ctx.save();
  const largeurRang = largeurPastille(ctx, rang.nom, 18, POLICES.corps);
  dessinerPastille(ctx, L - MARGE - RESPIRATION - largeurRang, yCarte + 34, rang.nom, {
    fond: teinte(rang.teinte),
    hauteur: 36,
    largeurMax: 260,
    police: POLICES.corps,
    taillePolice: 18,
    texte: rang.teinte === "texteAttenue" ? PALETTE.carte : PALETTE.surOr,
  });
  ctx.restore();

  dessinerTitreCartoon(ctx, pseudo, xTexte, yCarte + 74, {
    largeurMax: largeurTexte - largeurRang - 20,
    police: POLICES.display,
    remplissage: PALETTE.texte,
    taille: 42,
  });

  // ── Niveau et barre d'XP ─────────────────────────────────────────────────
  const p = donnees.progression;
  const yBarre = yCarte + REPERES_PROFIL.barre;

  ctx.save();
  ctx.textBaseline = "alphabetic";
  // Même ligne de base pour le libellé et le nombre : décalés, ils donnaient
  // l'impression d'un défaut d'alignement sur toutes les cartes.
  ctx.font = `bold 20px ${POLICES.corps}`;
  ctx.fillStyle = PALETTE.texteAttenue;
  ctx.fillText("NIVEAU", xTexte, yBarre - 26);
  const largeurLibelle = ctx.measureText("NIVEAU").width;
  ctx.font = `bold 44px ${POLICES.display}`;
  ctx.fillStyle = PALETTE.texte;
  ctx.fillText(String(p.niveau), xTexte + largeurLibelle + 14, yBarre - 26);

  // À droite de la même ligne : la position au classement.
  if (donnees.rang !== null) {
    ctx.textAlign = "right";
    ctx.font = `bold 26px ${POLICES.display}`;
    ctx.fillStyle = PALETTE.or;
    ctx.fillText(`#${entierLisible(donnees.rang)}`, L - MARGE - RESPIRATION, yBarre - 26);
    ctx.font = `15px ${POLICES.corps}`;
    ctx.fillStyle = PALETTE.texteAttenue;
    ctx.fillText(`sur ${entierLisible(donnees.total)}`, L - MARGE - RESPIRATION, yBarre - 6);
    ctx.textAlign = "left";
  }
  ctx.restore();

  dessinerBarre(ctx, xInterne, yBarre + 8, largeurInterne, 26, p.ratio, teinte(rang.teinte));

  ctx.save();
  ctx.font = `16px ${POLICES.corps}`;
  ctx.fillStyle = PALETTE.texteAttenue;
  ctx.textBaseline = "alphabetic";
  ctx.fillText(
    p.auMaximum
      ? `${entierLisible(p.xp)} XP — plafond du jeu atteint`
      : `${entierLisible(p.xpDansNiveau)} / ${entierLisible(p.xpDuNiveau)} XP`,
    xInterne,
    yBarre + 58,
  );
  ctx.textAlign = "right";
  ctx.fillText(
    p.auMaximum ? "niveau 100" : `${entierLisible(p.restant)} XP avant le niveau ${p.niveau + 1}`,
    L - MARGE - RESPIRATION,
    yBarre + 58,
  );
  ctx.textAlign = "left";
  ctx.restore();

  // ── Trois chiffres ───────────────────────────────────────────────────────
  const yChiffres = yCarte + REPERES_PROFIL.chiffres;
  dessinerFilet(ctx, xInterne, yChiffres, largeurInterne);
  const colonnes: Array<[string, string]> = [
    ["Jetons Kizuna", entierLisible(donnees.jetons)],
    ["Gagnés en tout", entierLisible(donnees.jetonsGagnes)],
    ["Messages comptés", entierLisible(donnees.messages)],
  ];
  if (donnees.serie > 0) {
    colonnes.push(["Série quotidienne", `${donnees.serie} j`]);
  }
  const largeurColonne = largeurInterne / colonnes.length;
  ctx.save();
  ctx.textBaseline = "alphabetic";
  colonnes.forEach(([libelle, valeur], index) => {
    const x = xInterne + largeurColonne * index;
    ctx.font = `14px ${POLICES.corps}`;
    ctx.fillStyle = PALETTE.texteAttenue;
    ctx.fillText(tronquer(ctx, libelle, largeurColonne - 12), x, yChiffres + 28);
    ctx.font = `bold 26px ${POLICES.display}`;
    ctx.fillStyle = PALETTE.texte;
    ctx.fillText(valeur, x, yChiffres + 58);
  });
  ctx.restore();

  // ── Joueur fétiche ───────────────────────────────────────────────────────
  let yBas = yCarte + REPERES_PROFIL.bas;
  if (donnees.favori) {
    const rarete = rareteDe(donnees.favori.rarete);
    const hauteurBloc = 96;
    fillRoundedRect(ctx, xInterne, yBas, largeurInterne, hauteurBloc, RAYONS.md, PALETTE.carteAlt);
    const cote = hauteurBloc - 20;
    const portrait = donnees.favori.portraitUrl
      ? await drawCoveredImage(ctx, donnees.favori.portraitUrl, xInterne + 10, yBas + 10, cote, cote, RAYONS.sm)
      : false;
    if (!portrait) {
      fillRoundedRect(ctx, xInterne + 10, yBas + 10, cote, cote, RAYONS.sm, PALETTE.carteCreuse);
    }
    ctx.save();
    ctx.textBaseline = "alphabetic";
    ctx.font = `13px ${POLICES.corps}`;
    ctx.fillStyle = PALETTE.texteAttenue;
    ctx.fillText("JOUEUR FÉTICHE", xInterne + cote + 26, yBas + 32);
    ctx.font = `bold 26px ${POLICES.display}`;
    ctx.fillStyle = PALETTE.texte;
    ctx.fillText(
      tronquer(ctx, assainir(donnees.favori.nom, POLICES.display) || "Joueur", largeurInterne - cote - 200),
      xInterne + cote + 26,
      yBas + 64,
    );
    ctx.restore();
    const largeurRarete = largeurPastille(ctx, rarete.nom, 15, POLICES.corps);
    dessinerPastille(ctx, xInterne + largeurInterne - largeurRarete - 14, yBas + hauteurBloc / 2 - 15, rarete.nom, {
      fond: teinte(rarete.teinte),
      hauteur: 30,
      largeurMax: 220,
      police: POLICES.corps,
      taillePolice: 15,
      texte: rarete.teinte === "texteAttenue" ? PALETTE.carte : PALETTE.surOr,
    });
    yBas += REPERES_PROFIL.blocFavori;
  }

  if (donnees.collection) {
    ctx.save();
    ctx.font = `15px ${POLICES.corps}`;
    ctx.fillStyle = PALETTE.texteAttenue;
    ctx.textBaseline = "alphabetic";
    ctx.fillText(tronquer(ctx, `Collection : ${donnees.collection}`, largeurInterne), xInterne, yBas + 8);
    ctx.restore();
  }

  dessinerPied(ctx, hauteur, `${pseudo} · niveau ${p.niveau}`);
  return await canvas.encode("png");
}

// ─── Classement ─────────────────────────────────────────────────────────────

export interface LigneCarteClassement {
  position: number;
  pseudo: string;
  avatarUrl: string | null;
  niveau: number;
  xp: number;
  ratio: number;
  /** Mis en évidence : la ligne du membre qui a lancé la commande. */
  moi?: boolean;
}

const HAUTEUR_ENTETE_CLASSEMENT = 152;
const HAUTEUR_LIGNE = 84;

/** Les trois premiers portent une couleur, les autres non. C'est un podium. */
function couleurPosition(position: number): string {
  if (position === 1) return PALETTE.or;
  if (position === 2) return PALETTE.texteAttenue;
  if (position === 3) return PALETTE.brique;
  return PALETTE.filet;
}

export async function renderCarteClassement(
  titre: string,
  lignes: readonly LigneCarteClassement[],
  options: { note?: string; unite?: string } = {},
): Promise<Buffer> {
  ensureFonts();

  const visibles = lignes.slice(0, 10);
  const hauteurListe = Math.max(1, visibles.length) * HAUTEUR_LIGNE + RESPIRATION * 2;
  const hauteur = HAUTEUR_ENTETE_CLASSEMENT + hauteurListe + 24 + HAUTEUR_PIED;

  const canvas = createCanvas(L, hauteur);
  const ctx = canvas.getContext("2d");
  await dessinerFond(ctx, L, hauteur);

  ctx.save();
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.font = `bold 14px ${POLICES.corps}`;
  ctx.fillStyle = PALETTE.or;
  ctx.fillText(MARQUE_CANVAS.surtitre, MARGE, 46);
  dessinerTitreCartoon(ctx, assainir(titre, POLICES.display) || "Classement", MARGE, 100, {
    largeurMax: L - MARGE * 2,
    police: POLICES.display,
    remplissage: PALETTE.surFond,
    taille: 46,
  });
  ctx.fillStyle = PALETTE.or;
  ctx.fillRect(MARGE, HAUTEUR_ENTETE_CLASSEMENT - 22, L - MARGE * 2, 3);
  ctx.fillStyle = PALETTE.briqueClair;
  ctx.fillRect(MARGE, HAUTEUR_ENTETE_CLASSEMENT - 22, 140, 3);
  ctx.restore();

  const yListe = HAUTEUR_ENTETE_CLASSEMENT;
  dessinerPanneau(ctx, MARGE, yListe, L - MARGE * 2, hauteurListe, { rayon: RAYONS.lg });

  if (visibles.length === 0) {
    ctx.save();
    ctx.textAlign = "center";
    ctx.font = `22px ${POLICES.corps}`;
    ctx.fillStyle = PALETTE.texteAttenue;
    const lignesVide = decouperEnLignes(
      ctx,
      "Personne n'est encore classé. Le premier message compté ouvrira le classement.",
      { largeurMax: L - MARGE * 2 - 80, maxLignes: 2 },
    );
    lignesVide.forEach((texte, index) => {
      ctx.fillText(texte, L / 2, yListe + hauteurListe / 2 + index * 30);
    });
    ctx.textAlign = "left";
    ctx.restore();
    dessinerPied(ctx, hauteur, options.note);
    return await canvas.encode("png");
  }

  const xInterne = MARGE + RESPIRATION;
  const largeurInterne = L - MARGE * 2 - RESPIRATION * 2;

  for (const [index, ligne] of visibles.entries()) {
    const y = yListe + RESPIRATION + index * HAUTEUR_LIGNE;
    const hauteurLigne = HAUTEUR_LIGNE - 12;

    if (ligne.moi) {
      // La ligne du demandeur : un liseré, jamais un aplat — un aplat sur une
      // carte claire écrase le contraste du texte qu'il est censé mettre en
      // avant.
      fillRoundedRect(ctx, xInterne - 12, y - 4, largeurInterne + 24, hauteurLigne + 8, RAYONS.md, PALETTE.carteAlt);
      strokeRoundedRect(
        ctx,
        xInterne - 12,
        y - 4,
        largeurInterne + 24,
        hauteurLigne + 8,
        RAYONS.md,
        PALETTE.or,
        BORDURE_OR,
      );
    }

    // Position
    ctx.save();
    ctx.textBaseline = "middle";
    ctx.font = `bold 30px ${POLICES.display}`;
    ctx.fillStyle = couleurPosition(ligne.position);
    ctx.textAlign = "right";
    ctx.fillText(String(ligne.position), xInterne + 44, y + hauteurLigne / 2);
    ctx.textAlign = "left";
    ctx.restore();

    // Avatar
    const rayon = 26;
    const cx = xInterne + 44 + 20 + rayon;
    const cy = y + hauteurLigne / 2;
    const avatar = ligne.avatarUrl ? await drawCircularImage(ctx, ligne.avatarUrl, cx, cy, rayon) : false;
    if (!avatar) {
      ctx.save();
      ctx.beginPath();
      ctx.fillStyle = PALETTE.brique;
      ctx.arc(cx, cy, rayon, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = PALETTE.surBrique;
      ctx.font = `${Math.round(rayon)}px ${POLICES.display}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(initiale(ligne.pseudo, POLICES.display), cx, cy + 1);
      ctx.textAlign = "left";
      ctx.textBaseline = "alphabetic";
      ctx.restore();
    }

    // Pseudo + valeur
    const xNom = cx + rayon + 18;
    const largeurValeur = 240;
    ctx.save();
    ctx.textBaseline = "alphabetic";
    ctx.font = `bold 22px ${POLICES.corps}`;
    ctx.fillStyle = PALETTE.texte;
    ctx.fillText(
      tronquer(
        ctx,
        assainir(ligne.pseudo, POLICES.corps) || "Membre",
        largeurInterne - (xNom - xInterne) - largeurValeur,
      ),
      xNom,
      cy - 4,
    );
    ctx.font = `14px ${POLICES.corps}`;
    ctx.fillStyle = PALETTE.texteAttenue;
    ctx.fillText(`Niveau ${ligne.niveau}`, xNom, cy + 18);

    ctx.textAlign = "right";
    ctx.font = `bold 22px ${POLICES.display}`;
    ctx.fillStyle = PALETTE.or;
    ctx.fillText(`${formaterNombre(ligne.xp)} ${options.unite ?? "XP"}`, xInterne + largeurInterne, cy - 4);
    ctx.textAlign = "left";
    ctx.restore();

    // Mini-barre de progression sous le pseudo.
    dessinerBarre(
      ctx,
      xNom,
      cy + 26,
      largeurInterne - (xNom - xInterne) - largeurValeur,
      8,
      ligne.ratio,
      teinte(rangDe(ligne.niveau).teinte),
    );
  }

  dessinerPied(ctx, hauteur, options.note);
  return await canvas.encode("png");
}

// ─── Accueil ────────────────────────────────────────────────────────────────

export interface DonneesCarteAccueil {
  pseudo: string;
  avatarUrl: string | null;
  /** Rang d'arrivée : « 1 903ᵉ membre ». */
  rang: number;
  /** Nom du serveur, affiché en surtitre. */
  serveur: string;
  /** Ligne libre du staff, `null` pour la phrase par défaut. */
  message: string | null;
}

/**
 * La carte d'accueil d'un nouveau membre.
 *
 * ── FORMAT LARGE ET COURT ──────────────────────────────────────────────────
 * 1 200 × 420. Une carte d'accueil est vue une seconde, dans un salon où elle
 * défile : elle doit tenir en un coup d'œil, sans que personne n'ait à cliquer
 * pour l'agrandir. Tout ce qui n'est pas le pseudo et l'avatar y est
 * secondaire.
 */
export async function renderCarteAccueil(donnees: DonneesCarteAccueil): Promise<Buffer> {
  ensureFonts();

  const largeur = L;
  const hauteur = 420;
  const canvas = createCanvas(largeur, hauteur);
  const ctx = canvas.getContext("2d");
  await dessinerFond(ctx, largeur, hauteur);

  const pseudo = assainir(donnees.pseudo, POLICES.display) || "Nouveau membre";
  const rayon = 96;
  const cx = MARGE + RESPIRATION + rayon;
  const cy = hauteur / 2 - 14;

  ctx.save();
  ctx.beginPath();
  ctx.fillStyle = OMBRE_DURE.couleur;
  ctx.arc(cx + OMBRE_DURE.x, cy + OMBRE_DURE.y, rayon + 4, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  const avatar = donnees.avatarUrl ? await drawCircularImage(ctx, donnees.avatarUrl, cx, cy, rayon) : false;
  if (!avatar) {
    ctx.save();
    ctx.beginPath();
    ctx.fillStyle = PALETTE.brique;
    ctx.arc(cx, cy, rayon, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = PALETTE.surBrique;
    ctx.font = `${Math.round(rayon * 1.05)}px ${POLICES.display}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(initiale(pseudo, POLICES.display), cx, cy + rayon * 0.06);
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    ctx.restore();
  }
  ctx.save();
  ctx.beginPath();
  ctx.strokeStyle = PALETTE.or;
  ctx.lineWidth = 8;
  ctx.arc(cx, cy, rayon + 4, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();

  const xTexte = cx + rayon + 44;
  const largeurTexte = largeur - MARGE - RESPIRATION - xTexte;

  ctx.save();
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.font = `bold 16px ${POLICES.corps}`;
  ctx.fillStyle = PALETTE.or;
  ctx.fillText(
    tronquer(ctx, (assainir(donnees.serveur, POLICES.corps) || "Rose Griffon").toUpperCase(), largeurTexte),
    xTexte,
    cy - 74,
  );
  ctx.restore();

  dessinerTitreCartoon(ctx, pseudo, xTexte, cy - 12, {
    largeurMax: largeurTexte,
    police: POLICES.display,
    remplissage: PALETTE.surFond,
    taille: 54,
  });

  ctx.save();
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.font = `22px ${POLICES.corps}`;
  ctx.fillStyle = PALETTE.surFond;
  const lignes = decouperEnLignes(ctx, assainir(donnees.message, POLICES.corps) || "Bienvenue parmi nous !", {
    largeurMax: largeurTexte,
    maxLignes: 2,
  });
  lignes.forEach((ligne, index) => {
    ctx.fillText(ligne, xTexte, cy + 30 + index * 32);
  });
  ctx.restore();

  const libelleRang = `${entierLisible(donnees.rang)}ᵉ membre`;
  const largeurRang = largeurPastille(ctx, libelleRang, 18, POLICES.corps);
  dessinerPastille(ctx, largeur - MARGE - largeurRang, MARGE, libelleRang, {
    fond: PALETTE.or,
    hauteur: 38,
    largeurMax: 300,
    police: POLICES.corps,
    taillePolice: 18,
    texte: PALETTE.surOr,
  });

  dessinerPied(ctx, hauteur, "/profil pour ta carte de progression");
  return await canvas.encode("png");
}

// ─── Collection ─────────────────────────────────────────────────────────────

export interface CaseCollection {
  nom: string;
  portraitUrl: string | null;
  rarete: unknown;
  element: string | null;
}

/** Six colonnes : c'est ce qui tient en 1 200 px avec un portrait encore lisible. */
export const COLONNES_COLLECTION = 6;
/** Quatre rangées : au-delà, l'image dépasse la hauteur affichée par Discord sans clic. */
export const RANGEES_COLLECTION = 4;
/** Joueurs par carte. Le reste part sur la page suivante. */
export const CASES_PAR_CARTE = COLONNES_COLLECTION * RANGEES_COLLECTION;

const COTE_CASE = 168;
const GOUTTIERE = 16;
const HAUTEUR_CASE = COTE_CASE + 46;

/**
 * La collection en grille, portraits réels du jeu.
 *
 * ── POURQUOI UNE GRILLE ET PAS UNE LISTE ───────────────────────────────────
 * Une collection se REGARDE. Écrite en liste de noms dans un embed, elle ne dit
 * rien : « Rumba Mansurov · Kanchu Ko · Janus » ne se distingue pas d'une liste
 * de courses. En grille de portraits, la rareté saute aux yeux (c'est la couleur
 * du cadre), les doublons de série se voient, et le membre reconnaît ses prises.
 *
 * Chaque portrait est chargé depuis le CDN qui décode les CPK en direct. Un
 * portrait manquant laisse une case vide encadrée, jamais un trou : la grille
 * garde sa forme même si le CDN est lent.
 */
export async function renderCarteCollection(
  pseudo: string,
  cases: readonly CaseCollection[],
  options: { note?: string; completion?: string } = {},
): Promise<Buffer> {
  ensureFonts();

  const visibles = cases.slice(0, CASES_PAR_CARTE);
  const rangees = Math.max(1, Math.ceil(visibles.length / COLONNES_COLLECTION));
  const hauteurGrille = rangees * HAUTEUR_CASE + (rangees - 1) * GOUTTIERE + RESPIRATION * 2;
  const hauteur = HAUTEUR_ENTETE_CLASSEMENT + hauteurGrille + 24 + HAUTEUR_PIED;

  const canvas = createCanvas(L, hauteur);
  const ctx = canvas.getContext("2d");
  await dessinerFond(ctx, L, hauteur);

  ctx.save();
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.font = `bold 14px ${POLICES.corps}`;
  ctx.fillStyle = PALETTE.or;
  ctx.fillText(MARQUE_CANVAS.surtitre, MARGE, 46);
  dessinerTitreCartoon(ctx, `Collection de ${assainir(pseudo, POLICES.display) || "Membre"}`, MARGE, 100, {
    largeurMax: L - MARGE * 2,
    police: POLICES.display,
    remplissage: PALETTE.surFond,
    taille: 42,
  });
  if (options.completion) {
    ctx.font = `18px ${POLICES.corps}`;
    ctx.fillStyle = PALETTE.or;
    ctx.textAlign = "right";
    ctx.fillText(options.completion, L - MARGE, 100);
    ctx.textAlign = "left";
  }
  ctx.fillStyle = PALETTE.or;
  ctx.fillRect(MARGE, HAUTEUR_ENTETE_CLASSEMENT - 22, L - MARGE * 2, 3);
  ctx.fillStyle = PALETTE.briqueClair;
  ctx.fillRect(MARGE, HAUTEUR_ENTETE_CLASSEMENT - 22, 140, 3);
  ctx.restore();

  const yGrille = HAUTEUR_ENTETE_CLASSEMENT;
  dessinerPanneau(ctx, MARGE, yGrille, L - MARGE * 2, hauteurGrille, { rayon: RAYONS.lg });

  // La grille est centrée dans le panneau : une dernière rangée incomplète
  // reste alignée à gauche, comme le reste, plutôt que de flotter au milieu.
  const largeurGrille = COLONNES_COLLECTION * COTE_CASE + (COLONNES_COLLECTION - 1) * GOUTTIERE;
  const xGrille = MARGE + (L - MARGE * 2 - largeurGrille) / 2;

  for (const [index, joueur] of visibles.entries()) {
    const colonne = index % COLONNES_COLLECTION;
    const rangee = Math.floor(index / COLONNES_COLLECTION);
    const x = xGrille + colonne * (COTE_CASE + GOUTTIERE);
    const y = yGrille + RESPIRATION + rangee * (HAUTEUR_CASE + GOUTTIERE);
    const rarete = rareteDe(joueur.rarete);
    const couleur = teinte(rarete.teinte);

    fillRoundedRect(ctx, x, y, COTE_CASE, COTE_CASE, RAYONS.md, PALETTE.carteAlt);
    const dessine = joueur.portraitUrl
      ? await drawCoveredImage(ctx, joueur.portraitUrl, x, y, COTE_CASE, COTE_CASE, RAYONS.md)
      : false;
    if (!dessine) {
      ctx.save();
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.font = `${Math.round(COTE_CASE * 0.4)}px ${POLICES.display}`;
      ctx.fillStyle = PALETTE.texteAttenue;
      ctx.fillText(initiale(joueur.nom, POLICES.display), x + COTE_CASE / 2, y + COTE_CASE / 2);
      ctx.textAlign = "left";
      ctx.textBaseline = "alphabetic";
      ctx.restore();
    }
    // Le cadre porte la rareté : c'est la seule information qu'on lit sur une
    // grille de vingt-quatre portraits.
    strokeRoundedRect(ctx, x + 1.5, y + 1.5, COTE_CASE - 3, COTE_CASE - 3, RAYONS.md, couleur, 3);

    ctx.save();
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    ctx.font = `15px ${POLICES.corps}`;
    ctx.fillStyle = PALETTE.texte;
    ctx.fillText(
      tronquer(ctx, assainir(joueur.nom, POLICES.corps) || "Joueur", COTE_CASE),
      x + COTE_CASE / 2,
      y + COTE_CASE + 22,
    );
    ctx.font = `13px ${POLICES.corps}`;
    ctx.fillStyle = couleur;
    ctx.fillText(
      tronquer(ctx, joueur.element ? `${rarete.nom} · ${joueur.element}` : rarete.nom, COTE_CASE),
      x + COTE_CASE / 2,
      y + COTE_CASE + 40,
    );
    ctx.textAlign = "left";
    ctx.restore();
  }

  dessinerPied(ctx, hauteur, options.note);
  return await canvas.encode("png");
}

// ─── Recrutement ────────────────────────────────────────────────────────────

export interface DonneesCarteTirage {
  nom: string;
  portraitUrl: string | null;
  rarete: unknown;
  element: string | null;
  position: string | null;
  doublon: boolean;
  rembourse: number;
  garanti: boolean;
  solde: number;
}

/**
 * La carte d'un recrutement.
 *
 * Format portrait (800 × 620) et non paysage : elle montre UNE chose — le
 * joueur tiré — et une image large obligerait à remplir les côtés avec du vide
 * ou du bavardage.
 */
export async function renderCarteTirage(donnees: DonneesCarteTirage): Promise<Buffer> {
  ensureFonts();

  const largeur = 800;
  const hauteur = 620;
  const rarete = rareteDe(donnees.rarete);
  const couleur = teinte(rarete.teinte);

  const canvas = createCanvas(largeur, hauteur);
  const ctx = canvas.getContext("2d");
  await dessinerFond(ctx, largeur, hauteur);

  // Halo de rareté : c'est la seule information qu'on lit à un mètre.
  const halo = ctx.createRadialGradient(largeur / 2, hauteur * 0.42, 40, largeur / 2, hauteur * 0.42, largeur * 0.55);
  halo.addColorStop(0, couleur);
  halo.addColorStop(1, "rgba(0,0,0,0)");
  ctx.save();
  ctx.globalAlpha = 0.35;
  ctx.fillStyle = halo as unknown as string;
  ctx.fillRect(0, 0, largeur, hauteur);
  ctx.restore();

  const cote = 300;
  const xPortrait = (largeur - cote) / 2;
  const yPortrait = 90;
  ctx.save();
  roundedRect(ctx, xPortrait - 6, yPortrait - 6, cote + 12, cote + 12, RAYONS.lg);
  ctx.fillStyle = PALETTE.carte;
  ctx.fill();
  ctx.restore();
  const portrait = donnees.portraitUrl
    ? await drawCoveredImage(ctx, donnees.portraitUrl, xPortrait, yPortrait, cote, cote, RAYONS.md)
    : false;
  if (!portrait) {
    fillRoundedRect(ctx, xPortrait, yPortrait, cote, cote, RAYONS.md, PALETTE.carteCreuse);
  }
  strokeRoundedRect(ctx, xPortrait - 6, yPortrait - 6, cote + 12, cote + 12, RAYONS.lg, couleur, 4);

  ctx.save();
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  ctx.font = `bold 15px ${POLICES.corps}`;
  ctx.fillStyle = PALETTE.or;
  ctx.fillText(donnees.garanti ? "RECRUTEMENT GARANTI" : "RECRUTEMENT", largeur / 2, 52);
  ctx.restore();

  const largeurRarete = largeurPastille(ctx, rarete.nom, 17, POLICES.corps);
  dessinerPastille(ctx, (largeur - largeurRarete) / 2, yPortrait + cote + 22, rarete.nom, {
    fond: couleur,
    hauteur: 34,
    largeurMax: largeur - 80,
    police: POLICES.corps,
    taillePolice: 17,
    texte: rarete.teinte === "texteAttenue" ? PALETTE.carte : PALETTE.surOr,
  });

  titreCentre(ctx, assainir(donnees.nom, POLICES.display) || "Joueur", largeur / 2, yPortrait + cote + 108, {
    largeurMax: largeur - 80,
    police: POLICES.display,
    remplissage: PALETTE.surFond,
    taille: 40,
  });
  ctx.save();
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  ctx.font = `18px ${POLICES.corps}`;
  ctx.fillStyle = PALETTE.or;
  const details = [donnees.element, donnees.position].filter(Boolean).join(" · ");
  if (details) {
    ctx.fillText(details, largeur / 2, yPortrait + cote + 140);
  }

  ctx.font = `16px ${POLICES.corps}`;
  ctx.fillStyle = PALETTE.surFond;
  ctx.fillText(
    donnees.doublon
      ? `Déjà dans la collection — ${entierLisible(donnees.rembourse)} jetons rendus`
      : "Nouveau dans la collection",
    largeur / 2,
    yPortrait + cote + 168,
  );
  ctx.restore();

  ctx.save();
  ctx.textAlign = "center";
  ctx.font = `14px ${POLICES.corps}`;
  ctx.fillStyle = PALETTE.or;
  ctx.fillText(`${entierLisible(donnees.solde)} jetons Kizuna restants`, largeur / 2, hauteur - 26);
  ctx.restore();

  return await canvas.encode("png");
}
