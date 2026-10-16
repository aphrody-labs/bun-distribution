/**
 * `/administration stream` — les créneaux de `stream_schedules`.
 *
 * ── CE QUE CES LIGNES PILOTENT ─────────────────────────────────────────────
 * Sept créneaux actifs au 13/8/2026, du lundi au samedi. Ils alimentent le
 * planning de `rosegriffon.fr/rose-griffon-tv`, la route `/api/twitch/schedule`
 * et la commande publique `/agenda`. Les deux premières filtrent sur
 * `status = 'active'` : un créneau `inactive` existe en base sans que PERSONNE
 * ne le voie. C'est la raison d'être de l'option `statut` ici — retirer un
 * créneau du planning sans perdre l'horaire ni le nom du streamer, au lieu de
 * le supprimer et de le ressaisir la semaine suivante.
 *
 * ── CE QUE CETTE COMMANDE CORRIGE ──────────────────────────────────────────
 * Reprise de `/rg-stream-admin list|add|remove`, avec cinq défauts réparés :
 *
 *  1. `add` ne validait pas les heures. La saisie partait telle quelle dans une
 *     colonne `time without time zone` : « 21h30 » ou « 9:5 » faisait remonter
 *     une erreur Postgres brute dans le salon. `analyserHeure` (module pur)
 *     n'accepte que `HH:MM`, borne 23:59, et normalise sur deux chiffres.
 *
 *  2. Le jour se saisissait en NOMBRE, avec « 0=Dim, 1=Lun… » recopié dans la
 *     description de l'option. Discord sait proposer une liste : `CHOIX_JOUR_
 *     SEMAINE` la donne, déjà ordonnée du lundi au dimanche.
 *
 *  3. `list` triait par `day_of_week` brut, donc dimanche EN TÊTE d'une semaine
 *     française. `ordreAffichageJour` décale l'affichage sans toucher aux
 *     valeurs stockées (la convention Postgres 0 = dimanche reste intacte).
 *
 *  4. `remove` répondait « 🗑 supprimé » même sur un UUID inexistant, et
 *     journalisait cette suppression fantôme. On s'appuie sur `RETURNING`.
 *
 *  5. Il n'existait aucun moyen de CORRIGER un créneau : décaler un stream d'une
 *     heure imposait de le supprimer puis de le recréer, en perdant son
 *     identifiant. D'où `modifier`, où « - » vide explicitement un champ
 *     facultatif — ce que l'ancien `COALESCE` rendait impossible.
 */
import { Discord, Slash, SlashChoice, SlashGroup, SlashOption } from "discordx";
import {
  ApplicationCommandOptionType,
  type AutocompleteInteraction,
  type ChatInputCommandInteraction,
} from "discord.js";

import { logAdminAction } from "../../lib/audit";
import { cached, invalidate } from "../../lib/cache";
import { plageHoraire } from "../../lib/communaute-format";
import { sql } from "../../lib/db";
import { rgEmbed, truncate } from "../../lib/embeds";
import { borner } from "../staff/format";
import { differerEnPrive, exigerDroits, messagePanne } from "../staff/garde";
import {
  CHOIX_JOUR_SEMAINE,
  CHOIX_STATUT_CRENEAU,
  abregerIdentifiant,
  analyserHeure,
  estConfirme,
  estCreneauPublic,
  estJourSemaine,
  estStatutCreneau,
  estUuid,
  libelleJourSemaine,
  libelleStatutCreneau,
  lireChampTextuel,
  ordreAffichageJour,
} from "./valeurs";
import "./racine-gestion";
import { echec, pied, piedTexte, repondre } from "../../lib/ui";

/**
 * Les colonnes de `stream_schedules`.
 *
 * `start_time` et `end_time` sont des colonnes `time` : lues telles quelles,
 * elles arrivent en `21:00:00`. On les demande en `::text` pour éviter que le
 * pilote ne fabrique une date de 1970 autour d'une heure qui n'en a pas.
 */
interface CreneauAdmin {
  id: string;
  day_of_week: number;
  streamer_name: string;
  start_time: string | null;
  end_time: string | null;
  category: string | null;
  status: string | null;
  notes: string | null;
  updated_at: Date | string;
}

async function listerCreneaux(statut: string | null): Promise<CreneauAdmin[]> {
  // Le tri « lundi d'abord » est fait en SQL pour que la pagination éventuelle
  // et l'affichage voient exactement le même ordre.
  return await sql<CreneauAdmin[]>`
		SELECT id::text, day_of_week, streamer_name, start_time::text, end_time::text,
		       category, status, notes, updated_at
		FROM stream_schedules
		WHERE (${statut}::text IS NULL OR status = ${statut})
		ORDER BY ((day_of_week + 6) % 7), start_time NULLS LAST
	`;
}

/**
 * Index d'autocomplétion des créneaux.
 *
 * `liste` n'affiche que les huit premiers caractères d'un identifiant, alors que
 * `modifier` et `supprimer` exigent l'UUID complet : sans autocomplétion, on ne
 * pouvait pas enchaîner de l'un à l'autre depuis Discord. La valeur proposée est
 * l'UUID entier, le libellé porte jour, heure et streamer.
 */
const TTL_INDEX_MS = 30_000;
const CLEF_INDEX = "administration:stream:index";

async function indexCreneaux(): Promise<CreneauAdmin[]> {
  return await cached(CLEF_INDEX, TTL_INDEX_MS, async () => await listerCreneaux(null));
}

async function lireCreneau(id: string): Promise<CreneauAdmin | null> {
  const lignes = await sql<CreneauAdmin[]>`
		SELECT id::text, day_of_week, streamer_name, start_time::text, end_time::text,
		       category, status, notes, updated_at
		FROM stream_schedules
		WHERE id::text = ${id}
		LIMIT 1
	`;
  return lignes[0] ?? null;
}

/** Une ligne de planning : jour, horaire, streamer, catégorie, visibilité. */
function ligneCreneau(creneau: CreneauAdmin): string {
  const morceaux = [
    `**${libelleJourSemaine(creneau.day_of_week)}**`,
    plageHoraire(creneau.start_time, creneau.end_time),
    truncate(creneau.streamer_name, 40),
  ];
  if (creneau.category) {
    morceaux.push(`*${truncate(creneau.category, 30)}*`);
  }
  if (!estCreneauPublic(creneau.status)) {
    // Écrit en toutes lettres : c'est exactement la question qu'on se pose
    // quand un créneau n'apparaît pas sur le site.
    morceaux.push(`⚠ ${libelleStatutCreneau(creneau.status)} — masqué du planning public`);
  }
  const ligne = `• ${morceaux.join(" · ")} \`${abregerIdentifiant(creneau.id)}\``;
  return creneau.notes ? `${ligne}\n   ${truncate(creneau.notes, 120)}` : ligne;
}

/** Fiche d'un créneau, réutilisée par ajout et modification. */
function ficheCreneau(creneau: CreneauAdmin) {
  return rgEmbed()
    .setTitle(`${libelleJourSemaine(creneau.day_of_week)} — ${truncate(creneau.streamer_name, 100)}`)
    .addFields(
      { name: "Horaire", value: plageHoraire(creneau.start_time, creneau.end_time), inline: true },
      // Une catégorie vide (chaîne vide posée par le formulaire du site) ferait
      // rejeter l'embed ENTIER : Discord refuse un champ sans valeur.
      {
        name: "Catégorie",
        value: creneau.category?.trim() ? truncate(creneau.category, 900) : "*non renseignée*",
        inline: true,
      },
      {
        name: "Visibilité",
        value: estCreneauPublic(creneau.status)
          ? "Visible sur le planning public"
          : `${libelleStatutCreneau(creneau.status)} — masqué du site`,
        inline: true,
      },
      { name: "Notes", value: creneau.notes ? borner(creneau.notes, 1_000) : "*aucune*" },
      { name: "Identifiant", value: `\`${creneau.id}\`` },
    );
}

@Discord()
@SlashGroup({
  name: "stream",
  description: "Gérer les créneaux du planning Rose Griffon TV",
  root: "gestion",
})
@SlashGroup("stream", "gestion")
export class AdministrationStreamCommand {
  @Slash({ name: "liste", description: "Le planning complet, du lundi au dimanche" })
  async liste(
    @SlashChoice(...CHOIX_STATUT_CRENEAU)
    @SlashOption({
      name: "statut",
      description: "N'afficher qu'un état (par défaut : tous, masqués compris)",
      type: ApplicationCommandOptionType.String,
      required: false,
    })
    statut: string | undefined,
    interaction: ChatInputCommandInteraction,
  ) {
    await differerEnPrive(interaction);
    if (!(await exigerDroits(interaction))) {
      return;
    }
    try {
      const creneaux = await listerCreneaux(statut ?? null);
      if (creneaux.length === 0) {
        await interaction.editReply({
          content: statut
            ? `Aucun créneau à l'état « ${libelleStatutCreneau(statut)} ».`
            : "La table `stream_schedules` ne contient aucun créneau.",
        });
        return;
      }

      // Un titre par jour plutôt qu'une liste plate : c'est ainsi que le
      // planning se lit sur le site, et un embed tolère 25 champs — sept
      // jours tiennent largement.
      const parJour = new Map<number, CreneauAdmin[]>();
      for (const creneau of creneaux) {
        const bac = parJour.get(creneau.day_of_week);
        if (bac) {
          bac.push(creneau);
        } else {
          parJour.set(creneau.day_of_week, [creneau]);
        }
      }
      const jours = [...parJour.entries()].toSorted(([a], [b]) => ordreAffichageJour(a) - ordreAffichageJour(b));

      const publics = creneaux.filter(creneau => estCreneauPublic(creneau.status)).length;
      const embed = rgEmbed().setTitle(
        `Planning Rose Griffon TV — ${creneaux.length} créneau${creneaux.length > 1 ? "x" : ""}`,
      );
      for (const [jour, lignes] of jours) {
        embed.addFields({
          name: libelleJourSemaine(jour),
          value: borner(lignes.map(ligneCreneau).join("\n"), 1_000),
        });
      }
      pied(embed, {
        note: `${publics} visible${publics > 1 ? "s" : ""} du public sur ${creneaux.length} · rosegriffon.fr/rose-griffon-tv`,
      });
      await interaction.editReply({ embeds: [embed] });
    } catch (err) {
      await repondre(interaction, echec("Le service n'a pas répondu", messagePanne(err)));
    }
  }

  @Slash({ name: "ajouter", description: "Ajouter un créneau au planning" })
  async ajouter(
    @SlashChoice(...CHOIX_JOUR_SEMAINE)
    @SlashOption({
      name: "jour",
      description: "Jour du créneau",
      type: ApplicationCommandOptionType.Integer,
      required: true,
    })
    jour: number,
    @SlashOption({
      name: "streamer",
      description: "Nom du streamer, tel qu'il apparaîtra sur le site",
      type: ApplicationCommandOptionType.String,
      required: true,
      minLength: 1,
      maxLength: 80,
    })
    streamer: string,
    @SlashOption({
      name: "debut",
      description: "Heure de début, format HH:MM (ex. 21:00)",
      type: ApplicationCommandOptionType.String,
      required: false,
    })
    debut: string | undefined,
    @SlashOption({
      name: "fin",
      description: "Heure de fin, format HH:MM (facultative — les 7 créneaux actuels n'en ont pas)",
      type: ApplicationCommandOptionType.String,
      required: false,
    })
    fin: string | undefined,
    @SlashOption({
      name: "categorie",
      description: "Catégorie ou jeu",
      type: ApplicationCommandOptionType.String,
      required: false,
    })
    categorie: string | undefined,
    @SlashOption({
      name: "notes",
      description: "Notes affichées sous le créneau",
      type: ApplicationCommandOptionType.String,
      required: false,
    })
    notes: string | undefined,
    @SlashChoice(...CHOIX_STATUT_CRENEAU)
    @SlashOption({
      name: "statut",
      description: "Visibilité (par défaut : actif, donc visible du public)",
      type: ApplicationCommandOptionType.String,
      required: false,
    })
    statut: string | undefined,
    interaction: ChatInputCommandInteraction,
  ) {
    await differerEnPrive(interaction);
    const admin = await exigerDroits(interaction, { strict: true });
    if (!admin) {
      return;
    }

    if (!estJourSemaine(jour)) {
      await interaction.editReply({ content: "❌ Jour hors des sept jours de la semaine." });
      return;
    }
    const debutLu = debut === undefined ? null : analyserHeure(debut);
    const finLue = fin === undefined ? null : analyserHeure(fin);
    if ((debut !== undefined && !debutLu) || (fin !== undefined && !finLue)) {
      await interaction.editReply({ content: refusDHeure(debut, debutLu, fin, finLue) });
      return;
    }
    const statutFinal = statut ?? "active";
    if (!estStatutCreneau(statutFinal)) {
      await interaction.editReply({ content: "❌ État de créneau inconnu." });
      return;
    }

    try {
      const [cree] = await sql<CreneauAdmin[]>`
				INSERT INTO stream_schedules
					(day_of_week, streamer_name, start_time, end_time, category, notes, status)
				VALUES (${jour}, ${streamer.trim()}, ${debutLu}::time, ${finLue}::time,
				        ${lireChampTextuel(categorie).valeur}, ${lireChampTextuel(notes).valeur},
				        ${statutFinal})
				RETURNING id::text, day_of_week, streamer_name, start_time::text, end_time::text,
				          category, status, notes, updated_at
			`;
      if (!cree) {
        await interaction.editReply({
          content: "❌ La base n'a rendu aucune ligne à l'insertion.",
        });
        return;
      }

      await logAdminAction({
        adminId: admin.profileId,
        discordId: admin.discordId,
        action: "stream.ajouter",
        targetType: "stream_schedule",
        targetId: cree.id,
        details: {
          jour: cree.day_of_week,
          streamer: cree.streamer_name,
          debut: cree.start_time,
          fin: cree.end_time,
          categorie: cree.category,
          statut: cree.status,
        },
      });

      // Sans ça, le créneau tout juste créé n'apparaîtrait dans
      // l'autocomplétion de `modifier` qu'au bout de trente secondes.
      invalidate(CLEF_INDEX);

      const embed = ficheCreneau(cree).setFooter(
        piedTexte({
          note: estCreneauPublic(cree.status)
            ? "Créé et visible sur rosegriffon.fr/rose-griffon-tv"
            : "Créé mais MASQUÉ du planning public — passe-le en « Actif » pour l'afficher",
        }),
      );
      await interaction.editReply({ content: "✅ Créneau ajouté.", embeds: [embed] });
    } catch (err) {
      await repondre(interaction, echec("Le service n'a pas répondu", messagePanne(err)));
    }
  }

  @Slash({
    name: "modifier",
    description: "Changer un créneau — les champs omis restent inchangés, « - » les vide",
  })
  async modifier(
    @SlashOption({
      name: "identifiant",
      description: "Créneau à modifier (autocomplété) ou son UUID complet",
      type: ApplicationCommandOptionType.String,
      required: true,
      autocomplete: proposerCreneaux,
    })
    identifiant: string,
    @SlashChoice(...CHOIX_JOUR_SEMAINE)
    @SlashOption({
      name: "jour",
      description: "Nouveau jour",
      type: ApplicationCommandOptionType.Integer,
      required: false,
    })
    jour: number | undefined,
    @SlashOption({
      name: "streamer",
      description: "Nouveau nom de streamer",
      type: ApplicationCommandOptionType.String,
      required: false,
      minLength: 1,
      maxLength: 80,
    })
    streamer: string | undefined,
    @SlashOption({
      name: "debut",
      description: "Nouvelle heure de début (HH:MM), ou « - » pour l'effacer",
      type: ApplicationCommandOptionType.String,
      required: false,
    })
    debut: string | undefined,
    @SlashOption({
      name: "fin",
      description: "Nouvelle heure de fin (HH:MM), ou « - » pour l'effacer",
      type: ApplicationCommandOptionType.String,
      required: false,
    })
    fin: string | undefined,
    @SlashOption({
      name: "categorie",
      description: "Nouvelle catégorie, ou « - » pour l'effacer",
      type: ApplicationCommandOptionType.String,
      required: false,
    })
    categorie: string | undefined,
    @SlashOption({
      name: "notes",
      description: "Nouvelles notes, ou « - » pour les effacer",
      type: ApplicationCommandOptionType.String,
      required: false,
    })
    notes: string | undefined,
    @SlashChoice(...CHOIX_STATUT_CRENEAU)
    @SlashOption({
      name: "statut",
      description: "Nouvelle visibilité",
      type: ApplicationCommandOptionType.String,
      required: false,
    })
    statut: string | undefined,
    interaction: ChatInputCommandInteraction,
  ) {
    await differerEnPrive(interaction);
    const admin = await exigerDroits(interaction, { strict: true });
    if (!admin) {
      return;
    }

    const id = identifiant.trim();
    if (!estUuid(id)) {
      await interaction.editReply({
        content:
          "❌ L'identifiant doit être l'UUID complet du créneau (36 caractères). " +
          "Choisis le créneau dans l'autocomplétion : elle en pose la valeur exacte.",
      });
      return;
    }
    if (jour !== undefined && !estJourSemaine(jour)) {
      await interaction.editReply({ content: "❌ Jour hors des sept jours de la semaine." });
      return;
    }
    if (statut !== undefined && !estStatutCreneau(statut)) {
      await interaction.editReply({ content: "❌ État de créneau inconnu." });
      return;
    }

    // Les heures sont facultatives ET effaçables : « - » vide la colonne,
    // une heure la remplace, l'absence la laisse telle quelle.
    const debutLu = lireChampTextuel(debut);
    const finLue = lireChampTextuel(fin);
    const debutHeure = debutLu.valeur === null ? null : analyserHeure(debutLu.valeur);
    const finHeure = finLue.valeur === null ? null : analyserHeure(finLue.valeur);
    if ((debutLu.valeur !== null && !debutHeure) || (finLue.valeur !== null && !finHeure)) {
      await interaction.editReply({
        content: refusDHeure(debutLu.valeur, debutHeure, finLue.valeur, finHeure),
      });
      return;
    }
    const categorieLue = lireChampTextuel(categorie);
    const notesLues = lireChampTextuel(notes);
    const streamerLu = lireChampTextuel(streamer);
    if (streamerLu.fourni && streamerLu.valeur === null) {
      await interaction.editReply({
        content: "❌ Le nom du streamer ne peut pas être vidé : il est obligatoire.",
      });
      return;
    }
    const rienAFaire =
      jour === undefined &&
      statut === undefined &&
      !streamerLu.fourni &&
      !debutLu.fourni &&
      !finLue.fourni &&
      !categorieLue.fourni &&
      !notesLues.fourni;
    if (rienAFaire) {
      await interaction.editReply({
        content: "Aucun champ fourni : il n'y avait rien à modifier.",
      });
      return;
    }

    try {
      const avant = await lireCreneau(id);
      if (!avant) {
        await interaction.editReply({ content: `Aucun créneau sous \`${truncate(id, 40)}\`.` });
        return;
      }

      const [apres] = await sql<CreneauAdmin[]>`
				UPDATE stream_schedules SET
					day_of_week   = COALESCE(${jour ?? null}::smallint, day_of_week),
					streamer_name = COALESCE(${streamerLu.valeur}::text, streamer_name),
					start_time    = CASE WHEN ${debutLu.fourni}::boolean THEN ${debutHeure}::time ELSE start_time END,
					end_time      = CASE WHEN ${finLue.fourni}::boolean THEN ${finHeure}::time ELSE end_time END,
					category      = CASE WHEN ${categorieLue.fourni}::boolean THEN ${categorieLue.valeur}::text ELSE category END,
					notes         = CASE WHEN ${notesLues.fourni}::boolean THEN ${notesLues.valeur}::text ELSE notes END,
					status        = COALESCE(${statut ?? null}::text, status),
					updated_at    = NOW()
				WHERE id::text = ${id}
				RETURNING id::text, day_of_week, streamer_name, start_time::text, end_time::text,
				          category, status, notes, updated_at
			`;
      if (!apres) {
        await interaction.editReply({
          content: "Le créneau a disparu entre la lecture et l'écriture. Rien n'a été modifié.",
        });
        return;
      }

      await logAdminAction({
        adminId: admin.profileId,
        discordId: admin.discordId,
        action: "stream.modifier",
        targetType: "stream_schedule",
        targetId: apres.id,
        details: {
          jour_avant: avant.day_of_week,
          jour_apres: apres.day_of_week,
          streamer_avant: avant.streamer_name,
          streamer_apres: apres.streamer_name,
          debut_avant: avant.start_time,
          debut_apres: apres.start_time,
          fin_avant: avant.end_time,
          fin_apres: apres.end_time,
          statut_avant: avant.status,
          statut_apres: apres.status,
        },
      });

      invalidate(CLEF_INDEX);
      const embed = ficheCreneau(apres).setFooter(
        piedTexte({
          note:
            estCreneauPublic(avant.status) === estCreneauPublic(apres.status)
              ? "Modifié"
              : estCreneauPublic(apres.status)
                ? "Modifié · le créneau est désormais VISIBLE du public"
                : "Modifié · le créneau est désormais MASQUÉ du planning public",
        }),
      );
      await interaction.editReply({ content: "✅ Créneau mis à jour.", embeds: [embed] });
    } catch (err) {
      await repondre(interaction, echec("Le service n'a pas répondu", messagePanne(err)));
    }
  }

  @Slash({ name: "supprimer", description: "Retirer définitivement un créneau du planning" })
  async supprimer(
    @SlashOption({
      name: "identifiant",
      description: "Créneau à supprimer (autocomplété) ou son UUID complet",
      type: ApplicationCommandOptionType.String,
      required: true,
      autocomplete: proposerCreneaux,
    })
    identifiant: string,
    @SlashOption({
      name: "confirmation",
      description: "Tape « oui » — préfère « modifier statut: Inactif » pour un retrait temporaire",
      type: ApplicationCommandOptionType.String,
      required: true,
    })
    confirmation: string,
    interaction: ChatInputCommandInteraction,
  ) {
    await differerEnPrive(interaction);
    const admin = await exigerDroits(interaction, { strict: true });
    if (!admin) {
      return;
    }
    if (!estConfirme(confirmation)) {
      await interaction.editReply({
        content:
          "Suppression annulée : il faut écrire « oui » dans `confirmation`. " +
          "Pour un retrait temporaire, `/administration stream modifier statut: Inactif` " +
          "masque le créneau sans le détruire.",
      });
      return;
    }
    const id = identifiant.trim();
    if (!estUuid(id)) {
      await interaction.editReply({
        content:
          "❌ L'identifiant doit être l'UUID complet du créneau (36 caractères). " +
          "Choisis le créneau dans l'autocomplétion : elle en pose la valeur exacte.",
      });
      return;
    }

    try {
      const [supprime] = await sql<CreneauAdmin[]>`
				DELETE FROM stream_schedules
				WHERE id::text = ${id}
				RETURNING id::text, day_of_week, streamer_name, start_time::text, end_time::text,
				          category, status, notes, updated_at
			`;
      if (!supprime) {
        await interaction.editReply({
          content: `Aucun créneau sous \`${truncate(id, 40)}\` : rien n'a été supprimé.`,
        });
        return;
      }

      await logAdminAction({
        adminId: admin.profileId,
        discordId: admin.discordId,
        action: "stream.supprimer",
        targetType: "stream_schedule",
        targetId: supprime.id,
        details: {
          jour: supprime.day_of_week,
          streamer: supprime.streamer_name,
          debut: supprime.start_time,
          fin: supprime.end_time,
          categorie: supprime.category,
          statut: supprime.status,
        },
      });

      // Un créneau supprimé ne doit plus être proposé à la modification.
      invalidate(CLEF_INDEX);

      await interaction.editReply({
        content:
          `🗑 Créneau supprimé — **${libelleJourSemaine(supprime.day_of_week)}** ` +
          `${plageHoraire(supprime.start_time, supprime.end_time)} · ` +
          `${truncate(supprime.streamer_name, 60)}`,
      });
    } catch (err) {
      await repondre(interaction, echec("Le service n'a pas répondu", messagePanne(err)));
    }
  }
}

/**
 * Autocomplétion des créneaux, partagée par `modifier` et `supprimer`.
 *
 * La valeur rendue est l'UUID COMPLET (36 caractères, toujours sous les 100
 * qu'autorise Discord) ; le libellé porte jour, horaire et streamer, seuls
 * repères qui permettent de reconnaître un créneau. Les créneaux masqués sont
 * proposés eux aussi : ce sont justement ceux qu'on vient réactiver.
 */
async function proposerCreneaux(interaction: AutocompleteInteraction): Promise<void> {
  try {
    const saisie = String(interaction.options.getFocused() ?? "")
      .trim()
      .toLowerCase();
    const index = await indexCreneaux();
    const retenus = index
      .filter(
        creneau =>
          saisie.length === 0 ||
          creneau.streamer_name.toLowerCase().includes(saisie) ||
          libelleJourSemaine(creneau.day_of_week).toLowerCase().includes(saisie) ||
          creneau.id.startsWith(saisie),
      )
      .slice(0, 25);
    await interaction.respond(
      retenus.map(creneau => ({
        name: truncate(
          `${libelleJourSemaine(creneau.day_of_week)} ${plageHoraire(creneau.start_time, creneau.end_time)} — ` +
            `${creneau.streamer_name}${estCreneauPublic(creneau.status) ? "" : " (masqué)"}`,
          100,
        ),
        value: creneau.id,
      })),
    );
  } catch {
    await interaction.respond([]);
  }
}

/**
 * Message de refus qui désigne LAQUELLE des deux heures est illisible, et
 * rappelle le seul format accepté par une colonne `time`.
 */
function refusDHeure(
  debut: string | null | undefined,
  debutLu: string | null,
  fin: string | null | undefined,
  finLue: string | null,
): string {
  const fautives = [
    debut !== undefined && debut !== null && !debutLu ? "`debut`" : null,
    fin !== undefined && fin !== null && !finLue ? "`fin`" : null,
  ].filter((morceau): morceau is string => morceau !== null);
  return (
    `❌ Heure illisible : ${fautives.join(" et ")}. Format attendu : \`HH:MM\` ` +
    "sur 24 heures (ex. `21:00`, `09:30`). Pas de `21h00`, pas de secondes."
  );
}
