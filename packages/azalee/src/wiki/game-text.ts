/**
 * Couche de résolution de texte de jeu pour les pages wiki (RSC).
 *
 * Façade serveur au-dessus de la projection PostgreSQL `inagle_game_text`.
 *
 * ⚠ module **serveur** : accès PostgreSQL. NE JAMAIS importer depuis un composant
 * `"use client"`. Les types purs vivent dans `game-text/shared.ts`.
 */

import { getText, getTextLocale, getTexts } from "../game-text/index";
import type { GameTextLocale, GameTextLocalized } from "../game-text/shared";

// --- Réexports de la couche index (un seul point d'entrée « game-text » wiki) ---

export { categoryStats, getText, getTextLocale, getTexts, listCategory, searchText } from "../game-text/index";
export type { GameText, GameTextLocalized } from "../game-text/shared";

// --- Résolution texte (hashId) ---------------------------------------------

/**
 * Résout un `hashId` vers son texte dans une langue (repli fr → en → ja).
 * `undefined` si le hashId est inconnu de l'index. Alias clair `resolveText`
 * demandé par les pages wiki (sucre sur `getTextLocale`).
 */
export async function resolveText(hashId: string | number, locale: GameTextLocale = "fr"): Promise<string | undefined> {
  return await getTextLocale(hashId, locale);
}

/** Résout un `hashId` dans les 3 langues (+ catégorie). `undefined` si inconnu. */
export async function resolveTextAll(hashId: string | number): Promise<GameTextLocalized | undefined> {
  return await getText(hashId);
}

/** Résout un lot de `hashId` d'un coup (lookup groupé, repli par langue côté caller). */
export async function resolveTexts(hashIds: Array<string | number>): Promise<Map<string, GameTextLocalized>> {
  return await getTexts(hashIds);
}
