import type { BaseCharacter, Character } from "../core/types.js";

export interface CharacterFilter {
  position?: "GK" | "FW" | "MF" | "DF";
  element?: 0 | 1 | 2 | 3;
  minRarity?: number;
  maxRarity?: number;
  gender?: 0 | 1;
  hasNames?: boolean;
}

export interface CharacterStatsSummary {
  total: number;
  byPosition: Record<string, number>;
  byElement: Record<string, number>;
  byRarity: Record<string, number>;
  withNames: number;
  withStats: number;
}

export interface BaseCharacterStats {
  totalBaseCharacters: number;
  totalVariants: number;
  avgVariantsPerCharacter: number;
  maxVariants: number;
  maxVariantsCharacter?: string;
  basaraCount: number;
  byBestRarity: Record<string, number>;
}

export type { BaseCharacter, Character };
