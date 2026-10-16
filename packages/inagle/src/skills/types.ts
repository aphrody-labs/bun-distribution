/**
 * Skill data types for IEVR
 * Based on skill_config and passive_skill_config dump structures
 */

import {
  CATEGORY_NAMES as CANONICAL_CATEGORY_NAMES,
  ELEMENT_NAMES as CANONICAL_ELEMENT_NAMES,
} from "../core/game-codes.ts";

/** Hissatsu lié à une aura, stocké dans les projections SQL JSONB. */
export interface AuraHissatsu {
  skillId: string;
  skillIdStr?: string;
  name?: string;
  name_EN?: string;
  name_JA?: string;
  type?: string;
  element?: string;
  power: { min: number; max: number };
}

/** Skill element enum - based on actual game data
 * Verified: Fire Tornado (whs00030) has element=3, so 3=Fire
 * Character elements use same IDs (see chara-param.ts elementIdToNames)
 */
export const ELEMENT_NAMES = CANONICAL_ELEMENT_NAMES;

/** Skill category enum - based on skillInfo dump and menu_text localization */
export const CATEGORY_NAMES = CANONICAL_CATEGORY_NAMES;

/** Passive skill scope - Team vs Player */
export type PassiveScope = "team" | "player" | "enemy" | "unknown";

/** Passive skill boost type */
export type PassiveBoostType =
  | "breach" // Brèche - Breakthrough rate
  | "justice" // Justice - Counter rate
  | "attack" // ATT - Attack stat
  | "defense" // DÉF - Defense stat
  | "shoot" // TIR - Shoot stat
  | "dribble" // DRB - Dribble stat
  | "block" // BLC - Block stat
  | "catch" // ART - Catch/Stop stat
  | "speed" // VIT - Speed stat
  | "stamina" // END - Stamina stat
  | "confrontation" // Affrontement - Confrontation ATT/DEF
  | "tension" // Tension - Tension gain
  | "recovery" // Récup - Recovery
  | "mixed" // Multiple stats combined
  | "special" // Special effects (debuff enemy, zone control, etc.)
  | "unknown";

/** Passive skill scope names */
export const PASSIVE_SCOPE_NAMES: Record<PassiveScope, { en: string; fr: string }> = {
  team: { en: "Team", fr: "Équipe" },
  player: { en: "Player", fr: "Joueur" },
  enemy: { en: "Enemy", fr: "Adversaire" },
  unknown: { en: "Unknown", fr: "Inconnu" },
};

/** Passive skill boost type names */
export const PASSIVE_BOOST_NAMES: Record<PassiveBoostType, { en: string; fr: string }> = {
  breach: { en: "Breach", fr: "Brèche" },
  justice: { en: "Justice", fr: "Justice" },
  attack: { en: "Attack", fr: "Attaque" },
  defense: { en: "Defense", fr: "Défense" },
  shoot: { en: "Shoot", fr: "Tir" },
  dribble: { en: "Dribble", fr: "Dribble" },
  block: { en: "Block", fr: "Défense" },
  catch: { en: "Catch", fr: "Arrêt" },
  speed: { en: "Speed", fr: "Vitesse" },
  stamina: { en: "Stamina", fr: "Physique" },
  confrontation: { en: "Confrontation", fr: "Affrontement" },
  tension: { en: "Tension", fr: "Tension" },
  recovery: { en: "Recovery", fr: "Récupération" },
  mixed: { en: "Mixed", fr: "Mixte" },
  special: { en: "Special", fr: "Spécial" },
  unknown: { en: "Unknown", fr: "Inconnu" },
};

/** Team Passive (Tactics/Buffs) */
export interface TeamPassive {
  id: string;
  effectId: string;
  effectValueMin: number;
  effectValueMax: number;
  textId: string;
  name: {
    en?: string;
    fr?: string;
  };
}
