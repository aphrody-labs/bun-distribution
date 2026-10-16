/**
 * Liste des streamers Rose Griffon TV
 * Données centralisées pour faciliter la maintenance
 */

export interface Streamer {
  readonly name: string;
  readonly file: string;
  readonly slug: string;
  readonly fullName?: string;
}

export const STREAMERS: readonly Streamer[] = [
  {
    file: "bri.webp",
    fullName: "Bri",
    name: "Bri",
    slug: "bri",
  },
  {
    file: "ethan.webp",
    fullName: "Éthan",
    name: "Éthan",
    slug: "ethan",
  },
  {
    file: "huzby.webp",
    fullName: "Huzby",
    name: "Huzby",
    slug: "huzby",
  },
  {
    file: "ishido.webp",
    fullName: "Ishido",
    name: "Ishido",
    slug: "ishido",
  },
  {
    file: "mathuze.webp",
    fullName: "Mathuze",
    name: "Mathuze",
    slug: "mathuze",
  },
  {
    file: "shozuma.webp",
    fullName: "Shozuma",
    name: "Shozuma",
    slug: "shozuma",
  },
] as const;

export const STREAMERS_COUNT = STREAMERS.length;
