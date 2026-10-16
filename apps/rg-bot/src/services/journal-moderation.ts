/**
 * Journal de modération — la sanction, publiée là où le staff la lit.
 *
 * ── LA BOUCLE QUI RESTAIT OUVERTE ──────────────────────────────────────────
 * `/moderation moderation avertir`, `exclure`, `bannir` et leurs contraires
 * écrivaient déjà chacune leur ligne dans `admin_audit_log` — et cette ligne,
 * personne ne pouvait la lire depuis Discord. Le reste du staff apprenait donc
 * la sanction par la personne sanctionnée, ou pas du tout ; deux modérateurs
 * pouvaient traiter le même incident sans le savoir, et une récidive ne se
 * jugeait que si quelqu'un pensait à lancer `/moderation historique`.
 *
 * Le salon de journal ne remplace PAS `admin_audit_log` : la table reste la
 * source (elle survit à la purge d'un salon, elle se requête, elle sert au
 * site). Le salon en est la lecture immédiate, celle qui arrive sans qu'on la
 * demande.
 *
 * ── CE MODULE NE DÉCIDE RIEN ───────────────────────────────────────────────
 * La mise en forme est dans `lib/sanctions.ts` (module pur, testé) ; le salon
 * vient des réglages de la guilde. Ici on ne fait que résoudre le salon,
 * envoyer, et RENDRE COMPTE de l'échec.
 *
 * ── POURQUOI ÇA REND UNE PHRASE PLUTÔT QUE DE LEVER ────────────────────────
 * Une sanction déjà appliquée ne se rejoue pas : si le journal ne peut pas
 * être écrit, il est trop tard pour annuler quoi que ce soit. La seule chose
 * utile est de le DIRE à la personne qui vient de sanctionner, dans son accusé
 * de réception, pour qu'elle prévienne autrement — exactement ce que fait déjà
 * l'alerte de `admin_audit_log`. Une exception, elle, remonterait dans le
 * `catch` de la commande et ferait croire que la sanction a échoué.
 */
import type { Client } from "discord.js";

import { ligneJournal, type ActionJournalisee } from "../lib/sanctions";
import { fiche } from "../lib/ui";
import { reglagesDe } from "./communaute";

/**
 * Publie une action au salon de journal de la guilde.
 *
 * Rend `null` quand il n'y a rien à signaler — publication faite, ou journal
 * volontairement coupé (section inactive, aucun salon posé : c'est un choix de
 * configuration, pas une panne, et le signaler à chaque sanction transformerait
 * l'accusé de réception en rappel permanent). Rend la phrase d'alerte sinon.
 */
export async function publierAuJournal(
  client: Client,
  guildId: string,
  entree: ActionJournalisee,
): Promise<string | null> {
  let salonId: string | null = null;
  try {
    const reglages = await reglagesDe(guildId);
    if (!reglages.moderation.actif || !reglages.moderation.salonJournal) {
      return null;
    }
    salonId = reglages.moderation.salonJournal;
  } catch (err) {
    return `Les réglages de la guilde n'ont pas pu être lus : l'action n'est PAS au journal du serveur (${message(err)}).`;
  }

  const salon = await client.channels.fetch(salonId).catch(() => null);
  if (!salon || !salon.isTextBased() || !("send" in salon)) {
    return (
      `Le salon de journal <#${salonId}> est introuvable ou n'accepte pas de message : ` +
      `l'action n'y figure pas. Corrige le réglage de modération.`
    );
  }

  const ligne = ligneJournal(entree);
  const carte = fiche({
    icone: ligne.icone,
    intention: ligne.intention,
    titre: ligne.titre,
    description: ligne.description,
  });
  for (const champ of ligne.champs) {
    carte.champ(champ.nom, champ.valeur, { enLigne: champ.enLigne });
  }

  try {
    await salon.send({
      embeds: [carte.finir({ note: "consigné dans admin_audit_log" })],
      // Une mention posée DANS un embed ne notifie pas — mais la barrière
      // reste, parce qu'elle ne dépend alors plus de cette propriété-là de
      // l'API le jour où la carte gagne une ligne de texte hors embed.
      allowedMentions: { parse: [] },
    });
    return null;
  } catch (err) {
    return `Le salon de journal <#${salonId}> a refusé le message : l'action n'y figure pas (${message(err)}).`;
  }
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
