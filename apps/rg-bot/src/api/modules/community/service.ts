import type { Kysely } from "kysely";
import type { Database } from "@rosegriffon/db/schema";

const EMOTES = [
  {
    name: "gaelle-coeur",
    path: "/emote/RG_Gaelle_coeur1.webp",
    character: "gaelle",
    category: "emotion",
    alt: "Gaëlle avec un cœur",
  },
  {
    name: "gaelle-fiere",
    path: "/emote/RG_Gaelle_fiere.webp",
    character: "gaelle",
    category: "reaction",
    alt: "Gaëlle fière",
  },
  {
    name: "roy-pouce",
    path: "/emote/RG_Roy_pouce1.webp",
    character: "roy",
    category: "reaction",
    alt: "Roy pouce en l'air",
  },
  { name: "roy-rire", path: "/emote/RG_Roy_rire1.webp", character: "roy", category: "emotion", alt: "Roy qui rit" },
];

export abstract class CommunityService {
  public static getInfo() {
    return {
      name: "Rose Griffon",
      slogan: "La communauté française dans ce qu'elle a d'entier.",
      contact: "rosegriffonfr@gmail.com",
      website: "https://www.rosegriffon.fr",
      colors: {
        primary: "#a14b3f",
        secondary: "#2f6e9c",
      },
      structure: {
        achillea: "E-Sport / Compétition",
        azalee: "Média / Actualités",
        rose_griffon: "Cœur / Communauté / Art",
      },
    };
  }

  public static getEmotes(baseUrl = "https://www.rosegriffon.fr") {
    const data = EMOTES.map(e => ({
      ...e,
      fullPath: `${baseUrl}${e.path}`,
    }));
    return {
      success: true,
      count: data.length,
      data,
    };
  }

  public static async getPopularTags(db: Kysely<Database>, limit = 15): Promise<Array<{ tag: string; count: number }>> {
    try {
      // En attendant le typage strict des articles dans db, fallback sécurisé ou requête brute
      return [
        { tag: "victory-road", count: 12 },
        { tag: "inazuma-eleven", count: 8 },
        { tag: "guide", count: 5 },
      ].slice(0, limit);
    } catch {
      return [];
    }
  }
}
