/**
 * `/patreon` — le soutien à Rose Griffon dans Discord.
 *
 *   /patreon etat   les paliers et leurs décomptes, AGRÉGÉS, visibles par tous
 *   /patreon moi    son propre statut, en réponse éphémère
 *
 * ── CE QUI NE SORT JAMAIS D'ICI ────────────────────────────────────────────
 * `patreon_memberships` porte des données personnelles : `patreon_email`,
 * `member_email`, `patreon_full_name`, `address` (jsonb), `note`, `patreon_url`.
 * AUCUNE de ces colonnes n'est sélectionnée par les requêtes de ce fichier —
 * pas « filtrée après coup » : jamais lue. `/patreon etat` ne remonte que des
 * décomptes ; `/patreon moi` ne montre à une personne que sa propre adhésion, en
 * éphémère, et sans son e-mail ni son adresse (le type `AdhesionPatreon` de
 * `lib/boutique-format.ts` ne les porte même pas, donc rien ne peut y échouer
 * par distraction).
 *
 * ── COMMENT ON RECONNAÎT QUELQU'UN ─────────────────────────────────────────
 * Deux rattachements existent, et il faut les deux :
 *   1. le compte RG lié à Discord par Better Auth
 *      (`account.provider_id = 'discord'` → `account.user_id` →
 *      `patreon_memberships.user_id`), le chemin qu'emprunte déjà `lib/rbac.ts` ;
 *   2. `patreon_memberships.discord_user_id`, rempli quand c'est Patreon lui-même
 *      qui connaît la connexion Discord du patron.
 * Relevé du 13/8/2026 : 2 des 11 adhésions se rattachent par le chemin (1),
 * `discord_user_id` est à NULL sur les 11. Interroger un seul des deux laisserait
 * donc des membres devant un « aucun soutien trouvé » mensonger.
 *
 * ── D'OÙ VIENNENT LES PALIERS ──────────────────────────────────────────────
 * `patreon_legacy_tiers` et `patreon_legacy_members` sont VIDES (0 ligne
 * chacune, mesuré le 13/8/2026). Les paliers sont donc reconstruits depuis les
 * colonnes tableau `tier_titles` / `tier_amounts_cents` de
 * `patreon_memberships`, seule source qui contienne réellement quelque chose.
 */
import { Discord, Slash, SlashGroup } from "discordx";
import { MessageFlags, type ChatInputCommandInteraction } from "discord.js";

import {
  accorderSoutiens,
  agregerPaliers,
  compterParStatut,
  formaterDateFr,
  lignePalier,
  resumerAdhesion,
  URL_PATREON,
  type AdhesionPatreon,
  type PalierAgrege,
  type StatutPatron,
} from "../lib/boutique-format";
import { cached } from "../lib/cache";
import { sql } from "../lib/db";
import { rgEmbed, truncate } from "../lib/embeds";

/** Limites DURES de Discord. */
const MAX_VALEUR_CHAMP = 1024;
const MAX_CHAMPS = 25;
const MAX_DESCRIPTION = 4096;

/** L'état public change au rythme de la synchronisation Patreon, pas à la seconde. */
const TTL_ETAT_MS = 5 * 60_000;

interface EtatPatreon {
  paliers: PalierAgrege[];
  statuts: Record<StatutPatron, number>;
  total: number;
  /** Dernière remontée depuis l'API Patreon, en ISO (le cache sérialise en JSON). */
  derniereSynchro: string | null;
}

/**
 * Décompte agrégé. La requête ne lit QUE des colonnes non personnelles — c'est
 * la garantie structurelle que cette commande publique ne peut rien divulguer.
 */
async function lireEtat(): Promise<EtatPatreon> {
  const lignes = await sql<
    Array<{
      patron_status: string | null;
      tier_titles: string[] | null;
      tier_amounts_cents: Array<number | string> | null;
      fetched_at: Date | string | null;
    }>
  >`
    SELECT patron_status, tier_titles, tier_amounts_cents, fetched_at
    FROM patreon_memberships
  `;

  const adhesions = lignes.map((ligne): AdhesionPatreon => ({
    currently_entitled_cents: null,
    is_free_trial: null,
    is_gifted: null,
    last_charge_date: null,
    last_charge_status: null,
    lifetime_support_cents: null,
    next_charge_date: null,
    patron_status: ligne.patron_status,
    pledge_cadence: null,
    pledge_start: null,
    tier_amounts_cents: ligne.tier_amounts_cents,
    tier_titles: ligne.tier_titles,
  }));

  let derniere = 0;
  for (const ligne of lignes) {
    const date = ligne.fetched_at instanceof Date ? ligne.fetched_at : new Date(ligne.fetched_at ?? "");
    const temps = date.getTime();
    if (Number.isFinite(temps) && temps > derniere) derniere = temps;
  }

  return {
    derniereSynchro: derniere > 0 ? new Date(derniere).toISOString() : null,
    paliers: agregerPaliers(adhesions),
    statuts: compterParStatut(adhesions),
    total: adhesions.length,
  };
}

@Discord()
@SlashGroup({
  description: "Le soutien Patreon à Rose Griffon : paliers, décomptes et statut personnel",
  name: "patreon",
})
@SlashGroup("patreon")
export class CommandesPatreon {
  @Slash({
    description: "Combien de soutiens par palier, agrégé — aucune identité n'est affichée",
    name: "etat",
  })
  async etat(interaction: ChatInputCommandInteraction): Promise<void> {
    await interaction.deferReply();

    let etat: EtatPatreon;
    try {
      etat = await cached("boutique:patreon:etat", TTL_ETAT_MS, lireEtat);
    } catch {
      await interaction.editReply({
        content: "❌ Impossible de lire les soutiens Patreon pour le moment. Réessaie plus tard.",
      });
      return;
    }

    const resume =
      etat.paliers.length > 0
        ? `${accorderSoutiens(etat.statuts.actif)} actif${etat.statuts.actif > 1 ? "s" : ""} sur ${etat.paliers.length} palier${etat.paliers.length > 1 ? "s" : ""}.`
        : "Aucun soutien actif pour l'instant.";

    const embed = rgEmbed()
      .setTitle("Soutien Patreon — Rose Griffon")
      .setURL(URL_PATREON)
      .setDescription(truncate(`${resume} Rejoindre : ${URL_PATREON}`, MAX_DESCRIPTION));

    embed.addFields({
      name: "Paliers actifs",
      value: truncate(
        etat.paliers.length > 0
          ? etat.paliers
              .slice(0, MAX_CHAMPS)
              .map(palier => lignePalier(palier))
              .join("\n")
          : "Aucun soutien actif pour l'instant.",
        MAX_VALEUR_CHAMP,
      ),
    });

    embed.addFields({
      name: "Communauté Patreon",
      value: truncate(
        [
          `Soutiens actifs : **${etat.statuts.actif}**`,
          etat.statuts.refuse > 0 ? `Paiements refusés : **${etat.statuts.refuse}**` : null,
          `Anciens soutiens : **${etat.statuts.ancien}**`,
          `Abonnés sans engagement : **${etat.statuts.abonne}**`,
          `Total suivi : **${etat.total}**`,
        ]
          .filter((ligne): ligne is string => typeof ligne === "string")
          .join("\n"),
        MAX_VALEUR_CHAMP,
      ),
    });

    const synchro = formaterDateFr(etat.derniereSynchro);
    if (synchro) {
      embed.addFields({ name: "Dernière synchronisation", value: synchro });
    }

    await interaction.editReply({ embeds: [embed] });
  }

  @Slash({
    description: "Ton propre statut de soutien — visible de toi seul",
    name: "moi",
  })
  async moi(interaction: ChatInputCommandInteraction): Promise<void> {
    // Éphémère dès l'accusé de réception : un `deferReply()` public ne peut plus
    // être rendu privé ensuite, et cette réponse ne regarde que son destinataire.
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const identifiant = interaction.user.id;
    let adhesion: AdhesionPatreon | undefined;
    try {
      const lignes = await sql<AdhesionPatreon[]>`
        SELECT m.patron_status,
               m.tier_titles,
               m.tier_amounts_cents,
               m.currently_entitled_cents,
               m.lifetime_support_cents,
               m.pledge_cadence,
               m.pledge_start,
               m.next_charge_date,
               m.last_charge_status,
               m.last_charge_date,
               m.is_free_trial,
               m.is_gifted
        FROM patreon_memberships m
        LEFT JOIN account a
          ON a.user_id = m.user_id::text
         AND a.provider_id = 'discord'
        WHERE a.account_id = ${identifiant}
           OR m.discord_user_id = ${identifiant}
        ORDER BY ((m.patron_status = 'active_patron') IS TRUE) DESC,
                 m.updated_at DESC NULLS LAST
        LIMIT 1
      `;
      adhesion = lignes[0];
    } catch {
      await interaction.editReply({
        content: "❌ Impossible de lire ton soutien Patreon pour le moment. Réessaie plus tard.",
      });
      return;
    }

    if (!adhesion) {
      await interaction.editReply({
        content: [
          "Aucun soutien Patreon n'est rattaché à ce compte Discord.",
          "Si tu soutiens déjà Rose Griffon, connecte-toi sur rosegriffon.fr avec Discord puis relie ton compte Patreon — la liaison se fera à la prochaine synchronisation.",
          `Pour nous soutenir : ${URL_PATREON}`,
        ].join("\n"),
      });
      return;
    }

    const embed = rgEmbed()
      .setTitle("Ton soutien Patreon")
      .setURL(URL_PATREON)
      .setDescription("Ces informations ne sont visibles que par toi.");

    for (const champ of resumerAdhesion(adhesion).slice(0, MAX_CHAMPS)) {
      embed.addFields({
        inline: true,
        name: champ.nom,
        value: truncate(champ.valeur, MAX_VALEUR_CHAMP),
      });
    }

    await interaction.editReply({ embeds: [embed] });
  }
}
