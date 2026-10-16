/**
 * Collection — recruter des joueurs d'Inazuma Eleven avec ses jetons Kizuna.
 *
 * ── LE TIRAGE EST UNIFORME, ET C'EST TOUT L'INTÉRÊT ────────────────────────
 * Un gacha ordinaire annonce des taux (« 1 % de légendaire ») que personne ne
 * peut vérifier. Ici il n'y a AUCUN taux à annoncer : on tire un joueur au sort
 * parmi les 6 090 nommés des données du jeu, à égalité de chances. La rareté
 * d'une carte n'est donc pas décidée par nous, elle est celle du jeu — et elle
 * est vérifiable par n'importe qui, sur le wiki :
 *
 *   Normal        5 747  → 94,4 %
 *   Expérimenté     150  →  2,5 %
 *   Héros           122  →  2,0 %
 *   BASARA           71  →  1,2 %
 *
 * (relevé le 14/8/2026 : `select rarity, count(*) from inagle_characters
 * where name_fr is not null and name_fr <> '' group by 1` — 6 090 lignes sur
 * les 6 148 de la table, les 58 écartées n'ayant pas de nom français et ne
 * pouvant donc pas s'afficher. Les 122 Héros et 71 BASARA portent tous
 * `is_primary = false` : filtrer sur cette colonne les ferait TOUS disparaître
 * du tirage.)
 *
 * La seule entorse est la GARANTIE : un tirage sur dix ne peut pas rendre un
 * joueur Normal. Sans elle, 56 % des membres n'auraient toujours rien vu
 * d'autre qu'un Normal au bout de dix tirages — et un système où l'on paie dix
 * fois pour la même sensation n'anime rien du tout.
 *
 * ── UN DOUBLON N'EST JAMAIS PERDU ──────────────────────────────────────────
 * Retomber sur un joueur déjà recruté rembourse une partie de la mise, d'autant
 * plus que le joueur est rare. C'est ce qui rend le tirage jouable dans la
 * durée : sans remboursement, la fin de la collection ne serait qu'une suite de
 * dépenses sans effet.
 *
 * ── MODULE PUR ─────────────────────────────────────────────────────────────
 * Aucune E/S, aucun `discord.js`, aucun accès base. Le tirage lui-même est fait
 * par `services/communaute.ts` (un `ORDER BY random()` côté Postgres, qui ne
 * charge pas 6 148 lignes en mémoire pour en garder une).
 */
import { entierLisible } from "./ui/nombres";

// ─── Raretés ────────────────────────────────────────────────────────────────

/**
 * L'échelle du jeu. Le CODE est la valeur de `inagle_characters.rarity` (texte
 * en base : `'0'`, `'2'`, `'10'`, `'20'`), le libellé est celui des données
 * françaises — le même que sur les fiches du wiki.
 */
export interface Rarete {
  code: number;
  nom: string;
  /** Part remboursée quand le joueur est déjà dans la collection. */
  remboursement: number;
  /** Rôle de couleur du thème canvas (`lib/canvas/theme.ts`). */
  teinte: "texteAttenue" | "azalee" | "brique" | "or";
  /** Une prise assez rare pour être annoncée dans le salon, et pas seulement à l'intéressé. */
  remarquable: boolean;
}

export const RARETES: readonly Rarete[] = Object.freeze([
  { code: 0, nom: "Normal", remarquable: false, remboursement: 30, teinte: "texteAttenue" },
  { code: 2, nom: "Expérimenté", remarquable: false, remboursement: 100, teinte: "azalee" },
  { code: 10, nom: "Héros", remarquable: true, remboursement: 250, teinte: "brique" },
  { code: 20, nom: "BASARA", remarquable: true, remboursement: 600, teinte: "or" },
]);

/** Rareté d'un code de base. Inconnue → `Normal`, jamais `undefined`. */
export function rareteDe(code: unknown): Rarete {
  const valeur =
    typeof code === "number" ? code : typeof code === "string" && code.trim() !== "" ? Number(code) : Number.NaN;
  return RARETES.find(rarete => rarete.code === valeur) ?? (RARETES[0] as Rarete);
}

/** Position dans l'échelle, pour trier une collection du plus rare au plus commun. */
export function ordreRarete(code: unknown): number {
  return RARETES.findIndex(rarete => rarete.code === rareteDe(code).code);
}

// ─── Tarifs ─────────────────────────────────────────────────────────────────

export const TARIFS = Object.freeze({
  /** Un tirage. */
  tirage: 150,
  /** Dix tirages — le dixième est offert, et la garantie tombe dedans. */
  tirageDix: 1_350,
  /** Nombre de tirages d'une salve. */
  salve: 10,
  /**
   * Périodicité de la garantie : le Nᵉ tirage d'un membre ne peut pas être un
   * joueur Normal. Compté sur le TOTAL des tirages, pas sur la salve — sans
   * quoi tirer un par un donnerait moins qu'acheter la salve.
   */
  periodeGarantie: 10,
} as const);

/** Le prochain tirage est-il garanti « Expérimenté ou mieux » ? */
export function garantieAuTirage(tiragesDejaFaits: number): boolean {
  const faits = Number.isFinite(tiragesDejaFaits) ? Math.max(0, Math.floor(tiragesDejaFaits)) : 0;
  return (faits + 1) % TARIFS.periodeGarantie === 0;
}

/**
 * Indices (0 fondé) des tirages garantis dans une salve de `TARIFS.salve`.
 *
 * Rendu comme une liste plutôt que calculé dans la boucle du service : c'est la
 * règle du jeu, elle doit être testable sans base.
 */
export function garantiesDansSalve(tiragesDejaFaits: number, taille = TARIFS.salve): number[] {
  const garanties: number[] = [];
  for (let index = 0; index < Math.max(0, taille); index++) {
    if (garantieAuTirage(tiragesDejaFaits + index)) {
      garanties.push(index);
    }
  }
  return garanties;
}

/** Ce que rend un doublon. */
export function remboursementDoublon(code: unknown): number {
  return rareteDe(code).remboursement;
}

// ─── Plaques ────────────────────────────────────────────────────────────────

/**
 * Prix d'une plaque de nom, d'après son rang d'affichage dans le jeu
 * (`inagle_nameplates.sort_no`, 1 → 54).
 *
 * Le jeu classe ses plaques dans l'ordre où on les débloque : le rang est donc
 * une mesure de progression déjà faite pour nous, et bien meilleure qu'une
 * rareté inventée. Les paliers sont larges à dessein — une grille de 54 prix
 * distincts serait illisible dans une boutique.
 */
export const PALIERS_PLAQUE: ReadonlyArray<{ jusqua: number; prix: number; nom: string }> = Object.freeze([
  { jusqua: 10, nom: "Débutant", prix: 300 },
  { jusqua: 25, nom: "Confirmé", prix: 900 },
  { jusqua: 40, nom: "Vétéran", prix: 2_000 },
  { jusqua: Number.POSITIVE_INFINITY, nom: "Légende", prix: 4_500 },
]);

export function palierDePlaque(sortNo: unknown): { prix: number; nom: string } {
  const rang = typeof sortNo === "number" && Number.isFinite(sortNo) ? Math.max(1, Math.floor(sortNo)) : 1;
  const palier = PALIERS_PLAQUE.find(entree => rang <= entree.jusqua);
  return palier ?? (PALIERS_PLAQUE[PALIERS_PLAQUE.length - 1] as { prix: number; nom: string });
}

export function prixDePlaque(sortNo: unknown): number {
  return palierDePlaque(sortNo).prix;
}

// ─── Catégories ─────────────────────────────────────────────────────────────

/** Familles d'objets d'une collection — la colonne `bot_inventaire.categorie`. */
export const CATEGORIES = ["perso", "plaque"] as const;

export type Categorie = (typeof CATEGORIES)[number];

export function estCategorie(valeur: unknown): valeur is Categorie {
  return typeof valeur === "string" && (CATEGORIES as readonly string[]).includes(valeur);
}

const LIBELLES_CATEGORIE: Readonly<Record<Categorie, string>> = Object.freeze({
  perso: "Joueur",
  plaque: "Plaque de nom",
});

export function libelleCategorie(categorie: string): string {
  return estCategorie(categorie) ? LIBELLES_CATEGORIE[categorie] : categorie;
}

// ─── Équipe ─────────────────────────────────────────────────────────────────

/**
 * Onze titulaires — parce que c'est un jeu de football, et que toute autre
 * valeur demanderait qu'on explique pourquoi.
 */
export const EQUIPE_MAX = 11;

// ─── Résumé d'une collection ────────────────────────────────────────────────

export interface EntreeCollection {
  objetId: string;
  rarete: unknown;
}

export interface ResumeCollection {
  total: number;
  /** Décompte par rareté, dans l'ordre de l'échelle. */
  parRarete: Array<{ rarete: Rarete; nombre: number }>;
  /** Part de joueurs possédés sur le total recensé, de 0 à 1. */
  completion: number;
}

/**
 * Compte une collection, en gardant les raretés vides.
 *
 * Les faire disparaître donnerait un résumé qui change de forme selon le
 * membre : « Normal 12 · BASARA 1 » pour l'un, « Normal 4 » pour l'autre. On ne
 * peut alors plus les comparer d'un coup d'œil, ce qui est pourtant le seul
 * usage d'un résumé.
 */
export function resumerCollection(entrees: readonly EntreeCollection[], totalRecense: number): ResumeCollection {
  const compteurs = new Map<number, number>(RARETES.map(rarete => [rarete.code, 0]));
  for (const entree of entrees) {
    const rarete = rareteDe(entree.rarete);
    compteurs.set(rarete.code, (compteurs.get(rarete.code) ?? 0) + 1);
  }
  const total = entrees.length;
  const recense = Number.isFinite(totalRecense) && totalRecense > 0 ? totalRecense : 0;
  return {
    completion: recense === 0 ? 0 : Math.min(1, total / recense),
    parRarete: RARETES.map(rarete => ({ nombre: compteurs.get(rarete.code) ?? 0, rarete })),
    total,
  };
}

/** `12 joueurs sur 6 148 · 0,2 %` — la ligne d'en-tête d'une collection. */
export function libelleCompletion(resume: ResumeCollection, totalRecense: number): string {
  const pourcentage = (resume.completion * 100).toLocaleString("fr-FR", {
    maximumFractionDigits: 1,
  });
  return `${entierLisible(resume.total)} sur ${entierLisible(totalRecense)} · ${pourcentage} %`;
}
