/**
 * Partie CLIENT-SAFE de la section « Boutiques » (`/boutique`).
 *
 * Contient UNIQUEMENT les types et la constante de libellés de catégories
 * — aucune dépendance Supabase / SQLite / Node. Importable depuis un composant
 * client. Le data-fetch serveur vit dans `wiki/shops.ts`
 * (sous-chemin serveur de la lib).
 */

export type { ShopDetail, ShopItem, ShopSummary } from "./types.js";

/** Libellés FR de catégories d'objets (réutilisés par la carte). */
export const SHOP_CATEGORY_FR: Record<string, string> = {
  accessory: "Pendentifs",
  animal: "Animaux",
  consume: "Consommables",
  costume: "Costumes",
  craft_obj: "Matériaux",
  emblem: "Emblèmes",
  fashion: "Mode",
  important: "Objets-clés",
  kizuna_link: "Liens Kizuna",
  misanga: "Bracelets",
  name_plate: "Plaques",
  performance: "Performances",
  shoes: "Chaussures",
  special: "Spéciaux",
  special_tactics: "Tactiques spéciales",
  super_tactics: "Super tactiques",
  title: "Titres",
};
