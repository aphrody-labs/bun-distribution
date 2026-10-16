/**
 * Configuration des emotes Rose Griffon
 * Emotes disponibles pour utilisation sur le site
 */

export interface Emote {
  name: string;
  path: string;
  character: "gaelle" | "roy" | "rg" | "other";
  category: "reaction" | "greeting" | "emotion";
  alt: string;
  author?: string;
  authorUrl?: string;
}

export const EMOTES: Record<string, Emote> = {
  // Gaëlle
  "gaelle-coeur": {
    alt: "Gaëlle avec un cœur",
    author: "Dleez",
    category: "emotion",
    character: "gaelle",
    name: "gaelle-coeur",
    path: "/emote/RG_Gaelle_coeur1.webp",
  },
  "gaelle-fiere": {
    alt: "Gaëlle fière",
    author: "Yafl1n",
    authorUrl: "https://x.com/Yaaflin",
    category: "reaction",
    character: "gaelle",
    name: "gaelle-fiere",
    path: "/emote/RG_Gaelle_fiere.webp",
  },
  "gaelle-perplexe": {
    alt: "Gaëlle perplexe",
    author: "Dleez",
    category: "reaction",
    character: "gaelle",
    name: "gaelle-perplexe",
    path: "/emote/RG_Gaelle_perplexe.webp",
  },
  "gaelle-salut": {
    alt: "Gaëlle fait un salut",
    author: "Dleez",
    category: "greeting",
    character: "gaelle",
    name: "gaelle-salut",
    path: "/emote/RG_Gaelle_salut.webp",
  },
  "gaelle-surprise": {
    alt: "Gaëlle surprise",
    author: "Yafl1n",
    authorUrl: "https://x.com/Yaaflin",
    category: "reaction",
    character: "gaelle",
    name: "gaelle-surprise",
    path: "/emote/RG_Gaelle_surprise.webp",
  },
  "gaelle-sweat": {
    alt: "Gaëlle gênée",
    author: "Dleez",
    category: "reaction",
    character: "gaelle",
    name: "gaelle-sweat",
    path: "/emote/RG_gaelle_sweat.webp",
  },
  "gaelle-yeux": {
    alt: "Gaëlle avec des yeux",
    category: "reaction",
    character: "gaelle",
    name: "gaelle-yeux",
    path: "/emote/RG_gaelle_yeux3.webp",
  },

  // Roy
  "roy-coeur": {
    alt: "Roy avec un cœur",
    author: "Dleez",
    category: "emotion",
    character: "roy",
    name: "roy-coeur",
    path: "/emote/RG_Roy_coeur1.webp",
  },
  "roy-degout": {
    alt: "Roy dégoûté",
    author: "Yafl1n",
    authorUrl: "https://x.com/Yaaflin",
    category: "reaction",
    character: "roy",
    name: "roy-degout",
    path: "/emote/RG_Roy_degout.webp",
  },
  "roy-evil": {
    alt: "Roy maléfique",
    author: "Yafl1n",
    authorUrl: "https://x.com/Yaaflin",
    category: "reaction",
    character: "roy",
    name: "roy-evil",
    path: "/emote/RG_Roy_evil.webp",
  },
  "roy-pensif": {
    alt: "Roy pensif",
    author: "Dleez",
    category: "reaction",
    character: "roy",
    name: "roy-pensif",
    path: "/emote/RG_Roy_pensif.webp",
  },
  "roy-salut": {
    alt: "Roy fait un salut",
    author: "Dleez",
    category: "greeting",
    character: "roy",
    name: "roy-salut",
    path: "/emote/RG_Roy_salut.webp",
  },
  "roy-sweat": {
    alt: "Roy gêné",
    author: "Dleez",
    category: "reaction",
    character: "roy",
    name: "roy-sweat",
    path: "/emote/RG_roy_sweat.webp",
  },
  "roy-yeux": {
    alt: "Roy avec des yeux",
    category: "reaction",
    character: "roy",
    name: "roy-yeux",
    path: "/emote/RG_roy_yeux.webp",
  },
  "roy-fine": {
    alt: "Roy content",
    author: "Dleez",
    category: "emotion",
    character: "roy",
    name: "roy-fine",
    path: "/emote/RG_roy_fine.webp",
  },

  // Rose Griffon
  "rg-funny": {
    alt: "Rose Griffon drôle",
    author: "Dleez",
    category: "reaction",
    character: "rg",
    name: "rg-funny",
    path: "/emote/RG_funny.webp",
  },
};

/**
 * Obtenir une emote par son nom
 */
export function getEmote(name: string): Emote | undefined {
  return EMOTES[name];
}

/**
 * Obtenir toutes les emotes d'un personnage
 */
export function getEmotesByCharacter(character: "gaelle" | "roy" | "rg"): Emote[] {
  return Object.values(EMOTES).filter(emote => emote.character === character);
}

/**
 * Obtenir toutes les emotes d'une catégorie
 */
export function getEmotesByCategory(category: "reaction" | "greeting" | "emotion"): Emote[] {
  return Object.values(EMOTES).filter(emote => emote.category === category);
}

/**
 * Obtenir une emote aléatoire
 */
export function getRandomEmote(): Emote {
  const emotes = Object.values(EMOTES);
  return emotes[Math.floor(Math.random() * emotes.length)]!;
}

/**
 * Obtenir une emote aléatoire d'un personnage
 */
export function getRandomEmoteByCharacter(character: "gaelle" | "roy" | "rg"): Emote {
  const emotes = getEmotesByCharacter(character);
  return emotes[Math.floor(Math.random() * emotes.length)]!;
}
