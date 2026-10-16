/**
 * VALIDATION HUMAINE AVANT ANNONCE — pièces PURES.
 *
 * ── POURQUOI CE PALIER EXISTE ──────────────────────────────────────────────
 * Le compte suivi ne publie pas que des annonces : il retweete, il répond, il
 * commente. Les deux formes les plus bruyantes sont écartées automatiquement
 * (`estRetweet`, `estReponse` dans `tweets-format.ts`), mais aucun filtre écrit
 * à l'avance ne dira jamais si un post donné MÉRITE de notifier deux mille
 * personnes — c'est un jugement éditorial, pas une règle. Un humain le rend en
 * une seconde ; c'est donc lui qui décide.
 *
 * ── L'ÉTAT TIENT DANS LE `customId`, COMME PARTOUT DANS CE BOT ─────────────
 * Aucune mémoire de processus : un redémarrage ne doit jamais laisser une carte
 * de validation avec des boutons morts. Discord borne le `customId` à 100
 * caractères — au-delà, le composant est REFUSÉ et c'est le message ENTIER qui
 * échoue, carte comprise. Le format ci-dessous tient largement (`vann|` + 19
 * chiffres + `|ok`), et `encoderValidation` rend `null` plutôt que de produire
 * un identifiant trop long.
 *
 * Ce module est PUR : ni discord.js, ni base, ni réseau. C'est ce qui permet de
 * tester la grammaire des identifiants, qui est la seule partie capable de
 * casser silencieusement.
 */

/** Préfixe des boutons de validation d'annonce. */
export const PREFIXE_VALIDATION = "vann";

/** Limite DURE de Discord sur un `customId`. */
export const MAX_CUSTOM_ID = 100;

/** Ce qu'un clic demande. */
export type DecisionAnnonce = "ok" | "non";

export interface EtatValidation {
  tweetId: string;
  decision: DecisionAnnonce;
}

/**
 * Identifiant d'un bouton de validation, ou `null` s'il ne tient pas.
 *
 * Rendre `null` plutôt que de tronquer : un identifiant coupé désignerait un
 * AUTRE post, et le clic annoncerait le mauvais tweet.
 */
export function encoderValidation(tweetId: string, decision: DecisionAnnonce): string | null {
  // Un identifiant de tweet est numérique. Refuser tout le reste évite qu'un
  // séparateur `|` glissé dans la valeur ne décale le décodage.
  if (!/^\d{1,25}$/.test(tweetId)) return null;
  const identifiant = `${PREFIXE_VALIDATION}|${tweetId}|${decision}`;
  return identifiant.length <= MAX_CUSTOM_ID ? identifiant : null;
}

/** Relit un identifiant de bouton, ou `null` s'il n'est pas des nôtres. */
export function decoderValidation(customId: string): EtatValidation | null {
  const parts = (customId || "").split("|");
  if (parts.length !== 3 || parts[0] !== PREFIXE_VALIDATION) return null;
  const [, tweetId, decision] = parts;
  if (!tweetId || !/^\d{1,25}$/.test(tweetId)) return null;
  if (decision !== "ok" && decision !== "non") return null;
  return { decision, tweetId };
}

/**
 * Ce que la carte de validation raconte.
 *
 * Le texte est délibérément court : la carte vit dans un salon de communauté, et
 * ce qui compte est ce que le post DIT — l'aperçu déplié par Discord juste
 * en dessous le montre déjà en entier.
 */
export function texteCarteValidation(options: { auteur: string; url: string; salonAnnonce: string }): string {
  return `Nouveau post de **@${options.auteur}** — on l'annonce dans <#${options.salonAnnonce}> ?\n${options.url}`;
}

/** Ce que la carte devient une fois tranchée : qui, quoi, quand. */
export function texteCarteTranchee(options: {
  auteur: string;
  url: string;
  decision: DecisionAnnonce;
  parQui: string;
  echec?: string | null;
}): string {
  if (options.decision === "non") {
    return `Post de **@${options.auteur}** écarté par <@${options.parQui}>.\n${options.url}`;
  }
  if (options.echec) {
    // ⚠ On ne dit PAS « annoncé » quand l'envoi a échoué. Une carte qui ment
    // sur son propre résultat fait croire l'annonce partie, et personne ne la
    // reprend.
    return `Post de **@${options.auteur}** validé par <@${options.parQui}>, mais l'annonce a échoué : ${options.echec}\n${options.url}`;
  }
  return `Post de **@${options.auteur}** annoncé par <@${options.parQui}>.\n${options.url}`;
}
