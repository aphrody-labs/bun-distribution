import type { Command } from "./types.ts";

/** Lazy registry: each command module default-exports a Command. */
export const registry: Record<string, () => Promise<{ default: Command }>> = {
  challonge: () => import("./challonge.ts"),
  "wiki-images": () => import("./wiki-images.ts"),
  "adobe-clean": () => import("./adobe-clean.ts"),
  "disk-clean": () => import("./disk-clean.ts"),
  "img-compress": () => import("./img-compress.ts"),
  "video-translate": () => import("./video-translate.ts"),
  "self-update": () => import("./self-update.ts"),
};

export const summaries: Record<string, string> = {
  challonge: "Créer et lancer un tournoi Challonge (CLI + bot Discord)",
  "wiki-images":
    "Télécharger les images d'une page, galerie ou catégorie de wiki (MediaWiki / Fandom)",
  "adobe-clean": "Libérer la RAM et les caches des logiciels Adobe",
  "disk-clean":
    "Analyser et nettoyer le stockage (caches, temporaires, gros fichiers, doublons)",
  "img-compress": "Compresser des images en local (JPEG, PNG, WebP, AVIF)",
  "video-translate":
    "Transcrire et traduire une vidéo vers l'anglais (sous-titres idiomatiques)",
  "self-update":
    "Mettre creator-kit à jour (automatique en arrière-plan pour le .exe)",
};
