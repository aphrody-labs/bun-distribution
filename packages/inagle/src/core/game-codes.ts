/**
 * Tables de codes partagées par les projections IEVR.
 *
 * Les éléments et catégories ont un espace de codes commun. La rareté est
 * différente : `charaRarity` (tirage/StarSign) et `charaRank` (progression)
 * réutilisent des entiers avec des significations différentes. Les deux tables
 * restent donc séparées au lieu de masquer cette différence derrière un enum
 * unique.
 */

export interface LocalizedCodeName {
  en: string;
  ja: string;
  fr: string;
}

/** Codes d'élément du jeu (partagés par personnages, techniques et BASARA). */
export const ELEMENT_NAMES: Record<number, LocalizedCodeName> = {
  0: { en: "Void", ja: "なし", fr: "Néant" },
  1: { en: "Wind", ja: "風", fr: "Vent" },
  2: { en: "Forest", ja: "林", fr: "Forêt" },
  3: { en: "Fire", ja: "火", fr: "Feu" },
  4: { en: "Mountain", ja: "山", fr: "Montagne" },
  5: { en: "Void", ja: "無", fr: "Néant" },
};

/** Catégories des techniques, y compris les catégories internes. */
export const CATEGORY_NAMES: Record<number, LocalizedCodeName> = {
  0: { en: "None", ja: "なし", fr: "Aucun" },
  1: { en: "Shoot", ja: "シュート", fr: "Tir" },
  2: { en: "Dribble", ja: "ドリブル", fr: "Dribble" },
  3: { en: "Block", ja: "ブロック", fr: "Défense" },
  4: { en: "Catch", ja: "キャッチ", fr: "Arrêt" },
  5: { en: "Special", ja: "スペシャル", fr: "Spécial" },
  6: { en: "Passive", ja: "パッシブ", fr: "Passif" },
  9: { en: "Stat Boost", ja: "ステータス", fr: "Boost Stats" },
};

/**
 * Labels des codes `charaRarity` observés dans StarSign et les données gacha.
 * Les codes 5/6/7 sont tous affichés « Légendaire » dans cette source ; le
 * code 10 est le résultat de l'enrichissement des héros.
 */
export const GACHA_RARITY_NAMES: Record<number, string> = {
  0: "Normal",
  1: "Normal",
  2: "Expérimenté",
  3: "Émérite",
  4: "Normal",
  5: "Légendaire",
  6: "Légendaire",
  7: "Légendaire",
  10: "Héros",
  20: "BASARA",
};

/**
 * Labels de l'espace de codes de progression exposé par `core/types`.
 * Cette table est volontairement distincte de `GACHA_RARITY_NAMES` : les
 * valeurs d'un fichier StarSign ne sont pas des niveaux de progression.
 */
export const RANK_RARITY_NAMES: Record<number, string> = {
  0: "Normal",
  1: "En progression",
  2: "Expérimenté",
  3: "Émérite",
  4: "Légendaire",
  5: "Héros",
  6: "Héros",
  7: "Héros",
  10: "Héros",
  20: "BASARA",
};

/** Rangs de croissance utilisés par la table `charaRank` (0 à 5). */
export const GACHA_GROWTH_RANKS: Record<number, number> = {
  0: 0,
  2: 2,
  3: 3,
  4: 4,
  5: 5,
  6: 5,
  7: 5,
  20: 5,
};
