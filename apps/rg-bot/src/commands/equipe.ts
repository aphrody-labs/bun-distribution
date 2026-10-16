/**
 * `/equipe carte` — la carte image des équipes de l'association.
 *
 * ── POURQUOI CETTE COMMANDE EXISTE ─────────────────────────────────────────
 * C'est l'ancienne `/staff`, renommée. Le nom `/staff` devient la racine des
 * commandes de CONSULTATION réservées à l'équipe : le laisser désigner en même
 * temps « la carte publique des équipes » et « les outils du staff » plaçait
 * l'anodin et le réservé sous le même mot.
 *
 * ── CE QUI EST CORRIGÉ AU PASSAGE ──────────────────────────────────────────
 *  1. Les libellés étaient réécrits dans le bot et divergeaient de la base :
 *     `assoteam` s'affichait « Association » là où `team_members.team_name` dit
 *     « Membres de l'Association ». Les dix libellés viennent maintenant de
 *     `lib/communaute-format.ts`, alignés sur la colonne.
 *  2. La carte n'affiche que 24 membres, et l'ancienne commande ne le disait
 *     QUE hors filtre : « Équipe Achilléa » (28 actifs) semblait n'en compter
 *     que 24 dès qu'un rôle était saisi. `sousTitreEquipe` annonce désormais la
 *     troncature dans tous les cas.
 *  3. Les effectifs sont réels et vérifiés (13/8/2026) : bureau 5, association
 *     24, Azalée 9, Achilléa 28, lore 10, dessinateurs 18, production 7,
 *     réseaux 11, médiation 8, partenaires 2 — 122 membres actifs.
 */
import { Discord, Slash, SlashChoice, SlashGroup, SlashOption } from "discordx";
import { ApplicationCommandOptionType, AttachmentBuilder, type ChatInputCommandInteraction } from "discord.js";

import { cached } from "../lib/cache";
import { renderTeamGrid } from "../lib/canvas/cards";
import { EQUIPE_PAR_DEFAUT, libelleEquipe, motifRecherche, sousTitreEquipe } from "../lib/communaute-format";
import { sql } from "../lib/db";

/** Ce que la carte dessine, et rien de plus : ni lien, ni identifiant Discord. */
interface MembreEquipe {
  name: string;
  role: string;
  image_url: string | null;
}

/** Nombre de vignettes que `renderTeamGrid` accepte avant de tronquer. */
const MAX_VIGNETTES = 24;

/** La composition d'une équipe change à l'échelle du mois. */
const TTL_EQUIPE_MS = 5 * 60_000;

async function membresEquipe(equipe: string, role: string | null): Promise<MembreEquipe[]> {
  if (role) {
    // Pas de cache sur le filtre libre : la clé serait aussi variée que la
    // saisie, pour un gain nul.
    return await sql<MembreEquipe[]>`
			SELECT name, role, image_url
			FROM team_members
			WHERE team_id = ${equipe} AND is_active = true AND role ILIKE ${motifRecherche(role)}
			ORDER BY order_index, display_index NULLS LAST, name
		`;
  }
  return await cached<MembreEquipe[]>(`equipe:${equipe}`, TTL_EQUIPE_MS, async () => {
    return await sql<MembreEquipe[]>`
			SELECT name, role, image_url
			FROM team_members
			WHERE team_id = ${equipe} AND is_active = true
			ORDER BY order_index, display_index NULLS LAST, name
		`;
  });
}

@Discord()
@SlashGroup({ name: "equipe", description: "Les équipes qui font vivre Rose Griffon" })
@SlashGroup("equipe")
export class EquipeCommand {
  @Slash({ name: "carte", description: "La carte illustrée des membres d'une équipe" })
  async carte(
    @SlashChoice(
      { name: "Bureau de l'Association", value: "bureauteam" },
      { name: "Membres de l'Association", value: "assoteam" },
      { name: "Équipe Azalée", value: "azaleeteam" },
      { name: "Équipe Achilléa", value: "achilleateam" },
      { name: "Équipe Lore", value: "loreteam" },
      { name: "Équipe Dessinateur", value: "dessinateurteam" },
      { name: "Équipe Production", value: "productionteam" },
      { name: "Équipe Réseaux", value: "socialteam" },
      { name: "Cellule de Médiation", value: "mediationteam" },
      { name: "Partenaires & Collaborateurs", value: "collabteam" },
    )
    @SlashOption({
      name: "nom",
      description: "Quelle équipe afficher (par défaut : le bureau)",
      type: ApplicationCommandOptionType.String,
      required: false,
    })
    nom: string | undefined,
    @SlashOption({
      name: "role",
      description: "Ne garder que les membres dont le rôle contient ce texte",
      type: ApplicationCommandOptionType.String,
      required: false,
    })
    role: string | undefined,
    interaction: ChatInputCommandInteraction,
  ) {
    await interaction.deferReply();
    const equipe = nom ?? EQUIPE_PAR_DEFAUT;
    const titre = libelleEquipe(equipe);
    const filtre = role?.trim() || null;

    try {
      const membres = await membresEquipe(equipe, filtre);
      if (membres.length === 0) {
        await interaction.editReply({
          content: filtre
            ? `Personne dans **${titre}** n'a un rôle contenant « ${filtre} ».`
            : `**${titre}** ne compte aucun membre actif.`,
        });
        return;
      }

      const visibles = membres.slice(0, MAX_VIGNETTES);
      const png = await renderTeamGrid(visibles, titre, sousTitreEquipe(membres.length, visibles.length, filtre));
      await interaction.editReply({
        files: [new AttachmentBuilder(png, { name: `rg-${equipe}.png` })],
      });
    } catch (err) {
      await interaction.editReply({
        content: `Impossible de dessiner la carte de **${titre}** : ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  }
}
