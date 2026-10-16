/**
 * Garde d'accès commune aux deux racines d'exploitation, `/staff` et
 * `/administration`.
 *
 * ── POURQUOI PAS `withRgAdmin` ─────────────────────────────────────────────
 * `lib/rbac.ts` expose `withRgAdmin`, qui enveloppe TOUT le corps de la
 * commande dans le même `try`. Conséquence mesurable : une panne Postgres au
 * milieu d'un traitement ressortait au membre en « 🚫 Erreur d'authentification
 * RG », un diagnostic faux qui envoie chercher au mauvais endroit. Ici la garde
 * ne couvre QUE la vérification de rôle ; ce qui casse après casse sous son
 * vrai nom.
 *
 * ── L'ORDRE COMPTE : DIFFÉRER D'ABORD ──────────────────────────────────────
 * Discord n'accorde que 3 secondes pour le premier accusé de réception, et
 * `requireRgAdmin` interroge Postgres (avec un cache de 60 s, donc froid au
 * premier appel après un redémarrage). Vérifier avant de différer, c'est
 * risquer de perdre l'interaction sur une base lente et de ne même pas pouvoir
 * dire pourquoi. On diffère donc TOUJOURS en premier, et le refus part par
 * `editReply`.
 *
 * ── POURQUOI `RepliableInteraction` ET NON `ChatInputCommandInteraction` ───
 * La garde ne lit que `interaction.user.id` et répond par `lib/ui`, qui accepte
 * déjà toute interaction répondable. Un clic sur un bouton de pagination d'une
 * surface d'exploitation doit être gardé exactement comme la commande qui l'a
 * produit — un `customId` est devinable, et un bouton n'hérite d'aucun droit de
 * celui qui l'a affiché. Le type étroit obligeait à un transtypage à chaque
 * appel depuis un bouton, c'est-à-dire à contourner la garde pour l'appeler.
 *
 * ── POURQUOI CE FICHIER VIT SOUS `staff/` ──────────────────────────────────
 * Les deux racines de cette unité en ont besoin. Le placer dans `lib/` aurait
 * demandé d'écrire hors du périmètre de l'unité ; le dupliquer aurait garanti
 * la divergence. `administration/` l'importe donc par `../staff/garde`.
 */
import { MessageFlags, type RepliableInteraction } from "discord.js";

import { NotAdminError, requireRgAdmin, requireRgAdminStrict, type RgAdmin } from "../../lib/rbac";
import { CronInjoignableError, cheminSocketCron } from "../../lib/cron-ipc";
import { ServiceIndisponibleError } from "../../lib/services";
import { refus as accesRefuse, repondre } from "../../lib/ui";

export type { RgAdmin };

/**
 * Diffère la réponse en mode éphémère.
 *
 * Toutes les surfaces d'exploitation sont personnelles : elles nomment des
 * unités systemd, des ports en boucle locale, des identifiants internes. Rien
 * de tout ça n'a à rester dans l'historique d'un salon.
 */
export async function differerEnPrive(interaction: RepliableInteraction): Promise<void> {
  if (!interaction.deferred && !interaction.replied) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  }
}

/**
 * Vérifie le rôle APRÈS que la réponse a été différée.
 *
 * @returns le profil administrateur, ou `null` si l'accès a été refusé — dans
 *          ce cas le refus a déjà été envoyé et l'appelant doit simplement
 *          revenir.
 */
export async function exigerDroits(
  interaction: RepliableInteraction,
  options: { strict?: boolean } = {},
): Promise<RgAdmin | null> {
  try {
    return options.strict ? await requireRgAdminStrict(interaction.user.id) : await requireRgAdmin(interaction.user.id);
  } catch (err) {
    const message =
      err instanceof NotAdminError
        ? err.message
        : "Impossible de vérifier tes droits : la base des profils n'a pas répondu.";
    await repondre(interaction, accesRefuse(message));
    return null;
  }
}

/**
 * Traduit une panne en phrase utile, sans jamais poser de pile d'appels dans
 * un salon.
 *
 * Le cas du cron est traité à part parce qu'il se confond facilement avec un
 * échec de la cible : quand `/staff web page` échoue faute de socket, ce n'est
 * PAS le site distant qui est en panne — c'est notre démon. Dire l'un pour
 * l'autre fait perdre une demi-heure à qui diagnostique.
 */
export function messagePanne(err: unknown): string {
  if (err instanceof CronInjoignableError) {
    return (
      `Le démon de tâches est injoignable (socket \`${cheminSocketCron()}\`, unité ` +
      "`rg-cron.service`). Ce n'est pas la cible qui est en panne : c'est notre pont. " +
      "La socket n'existe qu'après un redémarrage du démon avec le pont branché — " +
      "`sudo systemctl restart rg-cron.service`."
    );
  }
  if (err instanceof ServiceIndisponibleError) {
    return err.messageLisible;
  }
  return err instanceof Error ? err.message : String(err);
}

/**
 * Réponse d'échec d'un verbe de scraping servi par le cron.
 *
 * Le contrat de `packages/cron/src/tasks/ie-crawl/scrape-service.ts` garantit
 * que ces verbes ne lèvent JAMAIS : ils rendent `{ success: false, error, code }`.
 * Chaque code a une conséquence différente pour la personne en face — réessayer
 * plus tard, corriger sa saisie, ou renoncer parce que l'hôte ne peut pas.
 */
export function expliquerRefusScrape(code: unknown, erreur: unknown): string {
  const message = typeof erreur === "string" && erreur.length > 0 ? erreur : "Échec du scraping.";
  const conseils: Record<string, string> = {
    requete_invalide: "Corrige la saisie : l'adresse doit être publique, en http ou https.",
    occupe: "Un scraping du même type est déjà en vol. Réessaie dans quelques secondes.",
    trop_de_requetes: "Le plafond par minute est atteint. Réessaie dans une minute.",
    delai_depasse: "La cible n'a pas rendu la main à temps.",
    moteur_indisponible: "Le moteur nécessaire n'est pas exploitable depuis ce serveur.",
    introuvable: "La ressource demandée n'existe pas.",
    erreur_scraping: "",
    verbe_inconnu: "Le démon ne connaît pas ce verbe : il tourne sur une version antérieure.",
  };
  const conseil = typeof code === "string" ? (conseils[code] ?? "") : "";
  return conseil.length > 0 ? `${message}\n${conseil}` : message;
}
