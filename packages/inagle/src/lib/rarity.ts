/**
 * @file rarity.ts
 * @description Source unique pour la conversion des codes de rareté de personnage.
 *
 * Ce module factorise deux fonctions auparavant dupliquées (et divergentes) dans
 * `parsers/star-sign.ts`, `parsers/chara-param.ts` et `stat-calculator.ts` :
 *   - `rarityCodeToName`   : code de rareté → label d'affichage français
 *   - `rarityToGrowthRank` : code de rareté → rang de la table de croissance (0-5)
 *
 * Les codes proviennent de `starSignCharaInfo.charaRarity` :
 *   0  = Normal        (EN: COMMON,    drop ~90%)
 *   2  = Expérimenté   (EN: ADVANCED,  drop ~9.5%)
 *   5/6/7 = Légendaire (EN: LEGENDARY, drop ~0.5%)
 *  20  = BASARA        (depuis basaraBuildInfo)
 *
 * NOTE: "Héros" (code 10) n'est PAS posé par le code de rareté starSign ; il est
 * appliqué par le script d'enrichissement match-heroes pour les personnages ayant
 * un chemin d'évolution héroïque (Fire/Black/Pink). On le gère ici pour rester
 * exhaustif côté affichage.
 *
 * Les codes 1 (En progression) et 3 (Émérite) sont des paliers d'amélioration,
 * jamais attribués comme rareté de base via la gacha.
 */

import { GACHA_GROWTH_RANKS, GACHA_RARITY_NAMES } from "../core/game-codes.js";

/** Alias explicite de la table StarSign/gacha pour les consommateurs avancés. */
export const RarityNames = GACHA_RARITY_NAMES;

/**
 * Convertit un code de rareté en label d'affichage français.
 *
 * Labels officiels (system_text NOUN_INFO 76-82) :
 *   EN: COMMON / GROWING / ADVANCED / TOP / LEGENDARY / HERO / FABLED
 *   FR: Normal / En progression / Expérimenté / Émérite / Légendaire / Héros / BASARA
 */
export function rarityCodeToName(code: number): string {
  return GACHA_RARITY_NAMES[code] ?? `Rank${code}`;
}

/**
 * Mappe un code de rareté vers le rang de la table de croissance (pour le calcul
 * des stats). La table de croissance utilise les rangs 0-5 pour `charaRank`.
 *
 * starSign codes : 0=N, 2=R, 5=UR, 6=LR, 7=Legend, 20=BASARA
 */
export function rarityToGrowthRank(code: number): number {
  // Rangs de la table de croissance : 0, 1, 2, 3, 4, 5.
  return GACHA_GROWTH_RANKS[code] ?? (code <= 5 ? code : 5);
}
