/**
 * @file lib/wiki/trophies-shared.ts
 * @description Types et helpers PURS (client-safe) de la section « Succès ».
 *
 * Aucun accès DB / `bun:sqlite` ici : ce module est importable depuis un îlot
 * `"use client"`. L'accès data réel vit dans `wiki/trophies.ts` (serveur).
 *
 * Source : table `inagle_trophies` (228 lignes). Le `code` encode la catégorie via
 * son préfixe : `trophy_*` = succès officiels (trophées du jeu), `activity_*` =
 * objectifs d'activité in-game (collecte, exploration, mini-quêtes). Le 2e segment
 * du code donne un sous-groupe (`story`, `collection`, `battle`, `whole`, …).
 */

/** Catégorie de haut niveau dérivée du préfixe du `code`. */
import type { LocalizedText, Trophy, TrophyCategory } from "./types.js";
export type { LocalizedText, Trophy, TrophyCategory };

/** Libellés FR des catégories de haut niveau. */
export const CATEGORY_LABELS: Record<TrophyCategory, string> = {
  trophy: "Trophées",
  activity: "Activités",
};

/** Libellés FR des sous-groupes connus (2e segment du code). */
const GROUP_LABELS: Record<string, string> = {
  story: "Histoire",
  main: "Histoire principale",
  collection: "Collection",
  battle: "Combats",
  chronicle: "Chroniques",
  town: "Ville",
  complete: "Complétion",
  whole: "Progression globale",
  explore: "Exploration",
  miniquest: "Mini-quêtes",
  achieve: "Accomplissements",
};

/** Premier segment du `code` → catégorie de haut niveau. */
export function trophyCategory(code: string): TrophyCategory {
  return code.startsWith("trophy") ? "trophy" : "activity";
}

/** 2e segment du `code` (sous-groupe brut), `""` si le code n'a qu'un segment. */
export function trophyGroup(code: string): string {
  const parts = code.split("_");
  return parts.length > 1 ? parts[1] : "";
}

/** Libellé FR lisible d'un sous-groupe (repli : segment capitalisé). */
export function groupLabel(group: string): string {
  if (!group) return "Divers";
  return GROUP_LABELS[group] ?? group.charAt(0).toUpperCase() + group.slice(1);
}
