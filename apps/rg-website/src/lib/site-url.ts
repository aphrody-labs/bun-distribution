/**
 * @license
 * Copyright 2026 Rose Griffon
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Origine canonique unique pour tout ce qui construit une URL SEO absolue
 * (canonical, Open Graph, sitemap, robots).
 *
 * `robots.ts`, `sitemap.ts` et `wiki/sitemap.ts` lisaient chacun
 * `NEXT_PUBLIC_BASE_URL` (avec repli sur `https://rosegriffon.fr` et
 * normalisation `www.` → apex) en recopiant la même expression trois fois ;
 * `shop/sitemap.ts` et `news/[slug]/page.tsx` avaient chacun leur propre
 * constante figée, la seconde carrément fausse (`azalee.rosegriffon.fr`, un
 * sous-domaine qui ne sert plus jamais `/news`). Un seul point de vérité
 * évite qu'une future page reproduise l'une ou l'autre erreur.
 */
export const SITE_URL: string = (process.env.NEXT_PUBLIC_BASE_URL || "https://rosegriffon.fr").replace(
  "://www.",
  "://",
);

/** Joint `SITE_URL` à un chemin absolu (`/wiki/chara`) sans double slash. */
export function absoluteUrl(path: string): string {
  return `${SITE_URL}${path.startsWith("/") ? path : `/${path}`}`;
}
