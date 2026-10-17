/**
 * En-têtes de cache CDN des lectures publiques et anonymes (garde-fou Vercel Hobby).
 *
 * `s-maxage` : la réponse est servie par le CDN de Vercel (et par Cloudflare)
 * sans invoquer la fonction ni réveiller la base ; `stale-while-revalidate` :
 * passé ce délai, une copie périmée part tout de suite pendant qu'UNE requête
 * la régénère en arrière-plan. À réserver aux réponses identiques pour tous les
 * visiteurs : jamais une lecture qui dépend de la session.
 * Voir docs/aphrody/reference/infra/rg-free-tier-allocation.md.
 */
export function cachePublic(maxAge: number, stale = maxAge * 10): Record<string, string> {
  return { "Cache-Control": `public, s-maxage=${maxAge}, stale-while-revalidate=${stale}` };
}
