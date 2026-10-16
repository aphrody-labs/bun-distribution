import type { ItemCategory } from "../parsers/item-config.js";

/** Canonical display labels for SQL item categories. */
export const ITEM_CATEGORY_NAMES: Record<ItemCategory, { en: string; ja: string; fr: string }> = {
  consume: { en: "Consumable", ja: "消費アイテム", fr: "Consommable" },
  shoes: { en: "Shoes", ja: "シューズ", fr: "Chaussures" },
  misanga: { en: "Bracelet", ja: "ミサンガ", fr: "Bracelet" },
  accessory: { en: "Accessory", ja: "アクセサリー", fr: "Accessoire" },
  special: { en: "Special", ja: "スペシャル", fr: "Spécial" },
  formation: { en: "Formation", ja: "フォーメーション", fr: "Formation" },
  special_tactics: { en: "Sp. Tactics", ja: "必殺タクティクス", fr: "Tact. spéciale" },
  super_tactics: { en: "Super Tactics", ja: "超必殺タクティクス", fr: "Super tactique" },
  special_skill: { en: "Special Skill", ja: "とくぎ", fr: "Compétence sp." },
  title: { en: "Title", ja: "称号", fr: "Titre" },
  fashion: { en: "Fashion", ja: "ファッション", fr: "Mode" },
  costume: { en: "Costume", ja: "コスチューム", fr: "Costume" },
  emblem: { en: "Emblem", ja: "エンブレム", fr: "Emblème" },
  unique: { en: "Unique", ja: "ユニーク", fr: "Unique" },
  craft_obj: { en: "Craft", ja: "クラフト", fr: "Fabrication" },
  animal: { en: "Animal", ja: "動物", fr: "Animal" },
  kizuna_link: { en: "Kizuna Link", ja: "キズナリンク", fr: "Lien Kizuna" },
  name_plate: { en: "Name Plate", ja: "ネームプレート", fr: "Plaque" },
  performance: { en: "Performance", ja: "パフォーマンス", fr: "Performance" },
  important: { en: "Important", ja: "重要", fr: "Important" },
};
