/**
 * `/agenda` — le calendrier de l'association dans Discord.
 *
 * ── POURQUOI CETTE COMMANDE EXISTE ─────────────────────────────────────────
 * `/event` (les rendez-vous) et `/planning` (les streams) étaient deux racines
 * pour une seule question : « qu'est-ce qui se passe et quand ? ». Elles
 * deviennent les deux sous-commandes d'`/agenda`.
 *
 * ── D'OÙ VIENNENT LES ÉVÉNEMENTS ───────────────────────────────────────────
 * Pas de la table `events` : elle compte **0 ligne** (mesuré le 13/8/2026), ce
 * qui rendait `/event` structurellement muette. La source réelle est la route
 * `/api/calendar-events` du site — la même que la page publique
 * `rosegriffon.fr/evenements`. Elle lit `events` D'ABORD et retombe sur Google
 * Agenda quand la table est vide ; c'est ce repli qui sert aujourd'hui les
 * 5 événements réels. Passer par la route plutôt que par la table, c'est
 * afficher dans Discord exactement ce que voit le public, sans dupliquer la
 * règle de repli dans le bot.
 *
 * Les événements Discord programmés du serveur ont été écartés après mesure :
 * `GET /guilds/<id>/scheduled-events` renvoie `[]`.
 *
 * ── POURQUOI UN EMBED ET PAS LA CARTE IMAGE ────────────────────────────────
 * `renderEventList` formate ses dates avec heure et minute. Or 4 des 5
 * événements réels sont des « journées entières » venues de Google Agenda :
 * Epitanime se serait affiché « samedi 17 mai 2025 à 02:00 », une heure que
 * personne n'a jamais saisie. Un embed rendu par `formaterPlageEvenement` dit
 * « du 17 mai 2025 au 18 mai 2025 », ce qui est la donnée. On préfère la
 * justesse au pixel.
 */
import { Discord, Slash, SlashChoice, SlashGroup, SlashOption } from "discordx";
import { ApplicationCommandOptionType, type ChatInputCommandInteraction, type EmbedBuilder } from "discord.js";

import { cached } from "../lib/cache";
import {
  choisirEvenements,
  formaterPlageEvenement,
  grouperParJour,
  libelleJour,
  ligneStream,
  nettoyerHtml,
  normaliserEvenement,
  type EvenementCalendrier,
  type LigneStream,
  type PeriodeAgenda,
} from "../lib/communaute-format";
import { sql } from "../lib/db";
import { rgEmbed, truncate } from "../lib/embeds";
import { appelService, ServiceIndisponibleError } from "../lib/services";
import { pied } from "../lib/ui";

/** Enveloppe de `apiSuccess()` côté site : `{ success, data: { events } }`. */
interface ReponseCalendrier {
  success?: boolean;
  data?: { events?: EvenementCalendrier[] } | null;
}

const URL_EVENEMENTS = "https://rosegriffon.fr/evenements";
const URL_STREAMS = "https://rosegriffon.fr/rose-griffon-tv";

/** L'agenda bouge à l'échelle de la semaine : 10 minutes de cache sont sans risque. */
const TTL_AGENDA_MS = 10 * 60_000;

/**
 * Budget global d'un embed, marge de sûreté comprise.
 *
 * Discord additionne titre + description + NOM ET VALEUR DE TOUS LES CHAMPS +
 * pied ; au-delà de 6 000 caractères il rejette le message ENTIER, pas le champ
 * fautif. Borner chaque champ ne suffit donc pas : dix événements à 250 + 1 000
 * caractères font 12 500. On garde 200 caractères de marge pour le pied et les
 * séparateurs que Discord compte à sa façon.
 */
const BUDGET_EMBED = 5800;

interface ChampEmbed {
  name: string;
  value: string;
}

/**
 * Ajoute des champs à un embed tant que le budget total le permet.
 *
 * Renvoie le nombre de champs réellement posés, pour que l'appelant puisse le
 * dire au lecteur plutôt que de laisser croire à une liste complète.
 */
function ajouterChamps(embed: EmbedBuilder, champs: readonly ChampEmbed[], deja: number): number {
  let reste = BUDGET_EMBED - deja;
  let poses = 0;
  for (const champ of champs) {
    if (poses >= 25) break;
    const cout = champ.name.length + champ.value.length;
    if (cout > reste) break;
    reste -= cout;
    embed.addFields({ ...champ, inline: false });
    poses++;
  }
  return poses;
}

async function agendaDuSite(): Promise<EvenementCalendrier[]> {
  return await cached("agenda:evenements", TTL_AGENDA_MS, async () => {
    const reponse = await appelService<ReponseCalendrier>("site", "/api/calendar-events");
    return reponse.data?.events ?? [];
  });
}

async function planningActif(jour: number | null): Promise<LigneStream[]> {
  if (jour === null) {
    return await sql<LigneStream[]>`
			SELECT day_of_week, streamer_name, start_time::text, end_time::text, category, notes
			FROM stream_schedules
			WHERE status = 'active'
			ORDER BY day_of_week, start_time
		`;
  }
  return await sql<LigneStream[]>`
		SELECT day_of_week, streamer_name, start_time::text, end_time::text, category, notes
		FROM stream_schedules
		WHERE status = 'active' AND day_of_week = ${jour}
		ORDER BY start_time
	`;
}

function messageErreur(err: unknown): string {
  if (err instanceof ServiceIndisponibleError) return err.messageLisible;
  return `Impossible de lire l'agenda : ${err instanceof Error ? err.message : String(err)}`;
}

@Discord()
@SlashGroup({
  name: "agenda",
  description: "Les rendez-vous de l'association et le planning des streams",
})
@SlashGroup("agenda")
export class AgendaCommand {
  @Slash({
    name: "evenements",
    description: "Les rendez-vous Rose Griffon (conventions, meet-ups)",
  })
  async evenements(
    @SlashChoice(
      { name: "À venir", value: "a-venir" },
      { name: "Passés", value: "passes" },
      { name: "Tous", value: "tous" },
    )
    @SlashOption({
      name: "periode",
      description: "Quels événements afficher (par défaut : à venir)",
      type: ApplicationCommandOptionType.String,
      required: false,
    })
    periode: string | undefined,
    @SlashOption({
      name: "nombre",
      description: "Nombre d'événements (1 à 10, 5 par défaut)",
      type: ApplicationCommandOptionType.Integer,
      required: false,
      minValue: 1,
      maxValue: 10,
    })
    nombre: number | undefined,
    interaction: ChatInputCommandInteraction,
  ) {
    await interaction.deferReply();
    try {
      const brut = await agendaDuSite();
      const tous = brut.map(normaliserEvenement).filter(e => e !== null);
      const demande: PeriodeAgenda = periode === "passes" ? "passes" : periode === "tous" ? "tous" : "a-venir";
      const choix = choisirEvenements(tous, demande, nombre ?? 5, new Date());

      if (choix.evenements.length === 0) {
        await interaction.editReply({
          content: "L'agenda de l'association est vide pour le moment.",
        });
        return;
      }

      const titre =
        choix.periode === "a-venir"
          ? "Prochains rendez-vous Rose Griffon"
          : choix.periode === "tous"
            ? "Agenda Rose Griffon"
            : "Derniers rendez-vous Rose Griffon";

      const embed = rgEmbed().setTitle(titre).setURL(URL_EVENEMENTS);

      // Le repli est ANNONCÉ : sans cette phrase, un membre qui demande « à
      // venir » et reçoit des dates de 2025 croit à un bug d'affichage.
      const avertissement = choix.repli
        ? "Aucun rendez-vous à venir n'est encore inscrit à l'agenda. Voici les derniers passés."
        : "";
      if (avertissement) embed.setDescription(avertissement);

      const champs = choix.evenements.map(evenement => {
        const details = [formaterPlageEvenement(evenement)];
        if (evenement.lieu) details.push(`📍 ${evenement.lieu}`);
        const description = nettoyerHtml(evenement.description);
        if (description) details.push(description);
        return {
          name: truncate(evenement.titre, 250),
          value: truncate(details.join("\n"), 1000),
        };
      });
      const poses = ajouterChamps(embed, champs, titre.length + avertissement.length);

      // Le pied dit ce qui est affiché ET ce qui existe : une liste tronquée
      // par le budget de l'embed ne doit pas passer pour l'agenda complet.
      const reste = champs.length - poses;
      pied(embed, {
        note: truncate(
          `${choix.total} événement${choix.total > 1 ? "s" : ""} à l'agenda${reste > 0 ? ` · ${reste} non affiché${reste > 1 ? "s" : ""}, faute de place` : ""} · rosegriffon.fr`,
          2000,
        ),
      });
      await interaction.editReply({ embeds: [embed] });
    } catch (err) {
      await interaction.editReply({ content: messageErreur(err) });
    }
  }

  @Slash({ name: "streams", description: "Le planning hebdomadaire de Rose Griffon TV" })
  async streams(
    @SlashChoice(
      { name: "Lundi", value: 1 },
      { name: "Mardi", value: 2 },
      { name: "Mercredi", value: 3 },
      { name: "Jeudi", value: 4 },
      { name: "Vendredi", value: 5 },
      { name: "Samedi", value: 6 },
      { name: "Dimanche", value: 0 },
    )
    @SlashOption({
      name: "jour",
      description: "N'afficher qu'un jour (par défaut : la semaine entière)",
      type: ApplicationCommandOptionType.Integer,
      required: false,
    })
    jour: number | undefined,
    interaction: ChatInputCommandInteraction,
  ) {
    await interaction.deferReply();
    try {
      const lignes = await planningActif(jour ?? null);
      if (lignes.length === 0) {
        await interaction.editReply({
          content:
            jour === undefined
              ? "Aucun stream n'est programmé pour l'instant."
              : `Aucun stream programmé le ${libelleJour(jour).toLowerCase()}.`,
        });
        return;
      }

      const titre = jour === undefined ? "Planning hebdomadaire" : `Planning — ${libelleJour(jour)}`;
      const embed = rgEmbed().setTitle(titre).setURL(URL_STREAMS);

      // Un champ par jour : au pire 7, très loin des 25 autorisés, chacun borné
      // à 1 024 caractères — et l'ensemble borné au budget global de l'embed,
      // car 7 × 1 024 dépasserait les 6 000 caractères tolérés au total.
      const sections = grouperParJour(lignes);
      const poses = ajouterChamps(
        embed,
        sections.map(section => ({
          name: section.libelle,
          value: truncate(section.lignes.map(ligneStream).join("\n"), 1000),
        })),
        titre.length,
      );
      const reste = sections.length - poses;
      pied(embed, {
        note: truncate(
          `${lignes.length} stream${lignes.length > 1 ? "s" : ""} programmé${lignes.length > 1 ? "s" : ""}${reste > 0 ? ` · ${reste} jour${reste > 1 ? "s" : ""} non affiché${reste > 1 ? "s" : ""}, faute de place` : ""} · rosegriffon.fr`,
          2000,
        ),
      });

      await interaction.editReply({ embeds: [embed] });
    } catch (err) {
      await interaction.editReply({ content: messageErreur(err) });
    }
  }
}
