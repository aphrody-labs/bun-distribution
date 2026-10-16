import type { ImageLoaderProps } from "next/image";
/**
 * Cdn-loader.js — passthrough vers cdn.rosegriffon.fr (website)
 *
 * Activé via next.config.mjs si NEXT_PUBLIC_CDN_URL est défini :
 *   images: { loader: 'custom', loaderFile: './cdn-loader.js' }
 *
 * Comportement :
 *   - src commence par "/" → préfixe avec ${CDN}/public${src} (assets public/)
 *   - src absolue (http(s)://) → renvoyée telle quelle (déjà sur le CDN ou ailleurs)
 *
 * Note : bypass /_next/image — nginx CDN sert les fichiers tels quels (immutable, gzip_static).
 *        Pré-générer les tailles multiples côté build si besoin.
 */
export default function cdnLoader({ src, width, quality }: ImageLoaderProps): string {
  const cdn = process.env.NEXT_PUBLIC_CDN_URL;
  if (!cdn) {
    return src;
  }
  if (/^https?:\/\//i.test(src)) {
    return src;
  }
  const path = src.startsWith("/") ? src : `/${src}`;
  const q = quality ?? 75;
  return `${cdn}/public${path}?w=${width}&q=${q}`;
}
