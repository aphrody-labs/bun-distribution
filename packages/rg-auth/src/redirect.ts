// Source owner moved from apps/rg-website/src/lib/achillea/auth-session.ts.
/**
 * Garde d'URL de retour après authentification Achilléa.
 *
 * POURQUOI CE FICHIER EXISTE
 * Le front Angular validait l'URL de retour avant de la transmettre à l'OAuth
 * Discord (`core/auth/auth-session.service.ts`). Le portage vers Next a repris
 * `login(returnUrl)` mais pas la garde : la valeur partait telle quelle dans
 * `client.auth.discordLoginUrl(returnUrl)`, qui ne valide rien non plus. Or
 * c'est l'API qui redirige vers cette valeur une fois l'OAuth terminé.
 *
 * Résultat sans garde : `…/auth/discord?state=https://exemple-malveillant`
 * renvoie l'utilisateur hors du site APRÈS une connexion réussie — une
 * redirection ouverte, d'autant plus crédible qu'elle suit un vrai écran
 * Discord. C'est la seule fonction du service Angular qui méritait d'être
 * conservée ; la voici, avec les cas qui l'ont motivée.
 */

/** Longueur au-delà de laquelle on ne cherche même pas à analyser. */
const LONGUEUR_MAX = 2048;

/**
 * Caractères de contrôle et espaces.
 *
 * Un saut de ligne dans une URL de redirection permet d'injecter un en-tête
 * supplémentaire ; un espace la tronque. Les deux sont refusés au même endroit.
 */
const caracteresInterdits = (value: string) =>
  Array.from(value).some((char) => {
    const code = char.charCodeAt(0);
    return code <= 0x20 || code === 0x7f;
  });

/**
 * Rend `valeur` si c'est un chemin interne sûr, sinon `repli`.
 *
 * Les refus, et pourquoi chacun compte :
 * - ce qui n'est pas une chaîne : un objet ou un nombre venu d'un query param ;
 * - `//exemple.com` : URL protocole-relative, donc externe malgré le `/` initial ;
 * - `\` : certains navigateurs le normalisent en `/`, d'où `/\exemple.com` ;
 * - les caractères de contrôle : coupent l'URL dans les en-têtes de redirection.
 */
export function safeReturnUrl(valeur: unknown, repli = "/achillea"): string {
  if (
    typeof valeur !== "string" ||
    valeur.length > LONGUEUR_MAX ||
    !valeur.startsWith("/") ||
    valeur.startsWith("//") ||
    valeur.includes("\\") ||
    caracteresInterdits(valeur)
  ) {
    return repli;
  }

  // Dernier filet : sur une base bidon, une URL résolue qui change d'origine
  // trahit un absolu déguisé.
  try {
    return new URL(valeur, "https://achillea.invalid").origin ===
      "https://achillea.invalid"
      ? valeur
      : repli;
  } catch {
    return repli;
  }
}
