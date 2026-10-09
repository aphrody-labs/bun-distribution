/**
 * Palette Rose Griffon — référence officielle.
 *
 * `icon` pointe vers un fichier de `public/emote/` : les quatre visuels
 * sont réutilisés entre les cinq thèmes. `RG_Reika_zukan.webp` est l'icône
 * zukan de Reika, la mascotte d'Azalée.
 */
import type { ThemeId } from "@rosegriffon/preferences";

export const THEMES = {
  roy: {
    name: "Roy",
    icon: "/emote/RG_Roy_salut.webp",
    colors: {
      primary: "#344E8C", // Bleu Roy
      secondary: "#243D5B", // Bleu foncé
      accent: "#FFC46E", // Doré
      background: "#F2F6F7", // Blanc
      text: "#373434", // Noir
    },
  },
  gaelle: {
    name: "Gaëlle",
    icon: "/emote/RG_Gaelle_salut.webp",
    colors: {
      primary: "#B03519", // Vermillon
      secondary: "#770007", // Rouge
      accent: "#FFC46E", // Doré
      background: "#F2F6F7", // Blanc
      text: "#373434", // Noir
    },
  },
  "azalee-light": {
    name: "Azalée clair",
    icon: "/emote/RG_Reika_zukan.webp",
    colors: {
      primary: "#F2A93B",
      secondary: "#A92335",
      accent: "#F2A93B",
      background: "#FFF8F5",
      text: "#241A15",
    },
  },
  "azalee-dark": {
    name: "Azalée",
    icon: "/emote/RG_Reika_zukan.webp",
    colors: {
      primary: "#FFC66C",
      secondary: "#FFB2BE",
      accent: "#FFDEA6",
      background: "#1A120D",
      text: "#EDE0DB",
    },
  },
  achillea: {
    name: "Achilléa",
    icon: "/achillea/logo1.svg",
    colors: {
      primary: "#6D00CE",
      secondary: "#DFFF57",
      accent: "#DFFF57",
      background: "#0D0814",
      text: "#F3EDF7",
    },
  },
} as const satisfies Record<
  ThemeId,
  {
    name: string;
    icon: string;
    colors: {
      primary: string;
      secondary: string;
      accent: string;
      background: string;
      text: string;
    };
  }
>;

export type ThemeType = ThemeId;
