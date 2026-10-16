/**
 * `/administration equipe` — les 127 membres de `team_members`, les dix équipes
 * affichées sur rosegriffon.fr/equipe.
 *
 * ── CE QUE CETTE COMMANDE REMPLACE ─────────────────────────────────────────
 * `/rg-team-admin` (`commands/admin/team.ts`), reprise et corrigée :
 *
 *   1. ELLE ÉCRIVAIT DES LIGNES INCOHÉRENTES. L'`INSERT` ne renseignait ni
 *      `team_name` ni `display_index`. Or les 127 lignes existantes portent
 *      toutes un `team_name` (un seul libellé par équipe) et le site trie sur
 *      `display_index`, NULL en dernier : un membre ajouté depuis Discord
 *      atterrissait en fin de page avec une équipe sans nom. On renseigne les
 *      deux — `display_index` est calculé en base, `max + 1` pour l'équipe.
 *   2. SON LIBELLÉ D'ÉQUIPE MENTAIT. Elle proposait « Association » pour
 *      `assoteam`, là où la base et le site écrivent « Membres de
 *      l'Association ». Source unique désormais : `NOM_EQUIPE_EN_BASE`.
 *   3. ELLE EXIGEAIT DES UUID TAPÉS À LA MAIN. `edit`, `deactivate` et
 *      `delete` demandaient un `id` en clair, sans aucun moyen de le trouver
 *      depuis Discord. Ici, l'option `membre` est autocomplétée sur le nom et
 *      le rôle — et l'équipe figure dans la proposition, parce que trois
 *      personnes s'appellent « Kenway » dans trois équipes différentes.
 *   4. ELLE NE VALIDAIT RIEN. Une URL sans schéma, un `display_index` à 40 000
 *      (la colonne est un `smallint`) ou un identifiant Discord fantaisiste
 *      partaient en base et remontaient en message d'erreur Postgres brut dans
 *      le salon. Les bornes viennent maintenant du formulaire du site.
 *   5. SA SUPPRESSION SE CONFIRMAIT EN TAPANT « oui » DANS UNE OPTION —
 *      c'est-à-dire au même moment que la commande, donc pas du tout. La
 *      confirmation est maintenant un second geste, sur un bouton.
 *
 * ── CE QUI N'EST PAS ICI ───────────────────────────────────────────────────
 * L'ancienne `/rg-team-admin audit` listait le journal d'administration : c'est
 * une CONSULTATION, elle relève de `/staff`, pas de cette racine.
 *
 * ── POURQUOI TOUTES LES SOUS-COMMANDES SONT EN GARDE STRICTE ───────────────
 * Les cinq écrivent dans `team_members`, la table qui compose la page
 * /equipe du site public. `requireRgAdmin` (garde simple) accepte aussi le rôle
 * `staff` — c'est-à-dire, précisément, les gens qui FIGURENT sur cette page.
 * Laisser un membre d'équipe modifier ou masquer la fiche d'un autre depuis un
 * salon Discord n'est pas un droit d'exploitation, c'est un droit d'édition du
 * site. La consultation reste ouverte à `staff` sous `/staff`, l'écriture non.
 */
import { Discord, Slash, SlashChoice, SlashGroup, SlashOption } from "discordx";
import {
  ApplicationCommandOptionType,
  type AutocompleteInteraction,
  type ChatInputCommandInteraction,
} from "discord.js";

import { logAdminAction } from "../../lib/audit";
import { sql } from "../../lib/db";
import { rgEmbed } from "../../lib/embeds";
import { borner, echapperMarkdown, formaterDuree, horodatageRelatif } from "../staff/format";
import { differerEnPrive, exigerDroits, messagePanne, type RgAdmin } from "../staff/garde";
import { demanderConfirmation } from "./utilisateur";
import {
  EQUIPES_RG,
  LIMITES_MEMBRE_EQUIPE,
  abregerIdentifiant,
  decrireChangement,
  estUuid,
  libelleEquipeRg,
  validerIdentifiantDiscordFacultatif,
  validerOrdreAffichage,
  validerTexteMembre,
  validerUrlMembre,
  type ResultatValidation,
} from "./valeurs";
import "./racine";
import { echec, piedTexte, refus as accesRefuse, repondre } from "../../lib/ui";

/**
 * Valeur écrite dans `team_members.source`.
 *
 * La colonne distingue déjà `cosmic_js_migration` (85), `discord-sync` (39) et
 * `manual_migration` (1). Garder une valeur propre au bot permet de savoir d'où
 * vient une ligne quand elle pose question, six mois plus tard.
 */
const SOURCE_BOT = "discord-bot";

/** Les dix équipes, nommées comme la base les nomme. */
const CHOIX_EQUIPE = EQUIPES_RG.map(equipe => ({
  name: libelleEquipeRg(equipe.valeur),
  value: equipe.valeur,
}));

interface MembreEquipe {
  id: string;
  team_id: string;
  team_name: string | null;
  name: string;
  role: string;
  image_url: string | null;
  member_link: string | null;
  discord_user_id: string | null;
  display_index: number | null;
  is_active: boolean | null;
  source: string | null;
  updated_at: Date | null;
}

/** Lit un membre par son uuid. `null` s'il n'existe pas (ou plus). */
async function lireMembre(id: string): Promise<MembreEquipe | null> {
  const lignes = await sql<MembreEquipe[]>`
		SELECT id, team_id, team_name, name, role, image_url, member_link, discord_user_id,
		       display_index, is_active, source, updated_at
		FROM team_members
		WHERE id = ${id}
		LIMIT 1
	`;
  return lignes[0] ?? null;
}

/**
 * Résout l'option `membre` : un uuid, éventuellement choisi dans
 * l'autocomplétion. Rend le membre, ou la phrase à afficher.
 */
async function resoudreMembre(saisie: string): Promise<ResultatValidation<MembreEquipe>> {
  const propre = saisie.trim();
  if (!estUuid(propre)) {
    return {
      ok: false,
      raison:
        "Choisis un membre dans la liste proposée : elle rend l'identifiant attendu. " +
        "Une saisie libre ne suffit pas, plusieurs personnes portent le même nom.",
    };
  }
  const membre = await lireMembre(propre);
  if (!membre) {
    return { ok: false, raison: "Ce membre d'équipe n'existe pas (ou plus)." };
  }
  return { ok: true, valeur: membre };
}

/**
 * Autocomplétion sur le nom ET le rôle.
 *
 * L'équipe figure dans le libellé : « Kenway » existe trois fois, dans
 * `achilleateam`, `productionteam` et `dessinateurteam`. Sans elle, on désactive
 * la mauvaise personne. Les membres actifs remontent en premier — ce sont eux
 * qu'on administre au quotidien.
 *
 * Discord n'accepte que 25 propositions, et un nom de proposition est plafonné
 * à 100 caractères : au-delà, l'autocomplétion entière est refusée et le champ
 * reste désespérément vide.
 */
async function proposerMembres(interaction: AutocompleteInteraction): Promise<void> {
  const saisie = String(interaction.options.getFocused() ?? "").trim();
  const motif = `%${saisie}%`;
  try {
    const lignes = await sql<
      Array<{ id: string; name: string; role: string; team_id: string; is_active: boolean | null }>
    >`
			SELECT id, name, role, team_id, is_active
			FROM team_members
			WHERE ${saisie === ""} OR name ILIKE ${motif} OR role ILIKE ${motif}
			ORDER BY is_active DESC NULLS LAST, name
			LIMIT 25
		`;
    await interaction.respond(
      lignes.map(ligne => ({
        name: borner(
          `${ligne.is_active === false ? "⏸ " : ""}${ligne.name} — ${ligne.role} · ${libelleEquipeRg(ligne.team_id)}`,
          100,
        ),
        value: ligne.id,
      })),
    );
  } catch {
    // Une autocomplétion qui lève laisse le champ vide sans rien dire : mieux
    // vaut répondre une liste vide, la commande dira ensuite ce qui manque.
    await interaction.respond([]);
  }
}

/**
 * « - » vaut « efface cette valeur ».
 *
 * Sans convention explicite, il est impossible de retirer un lien devenu mort :
 * une option omise et une option vidée arrivent toutes les deux en `undefined`.
 */
function effacer(valeur: string | undefined): string | undefined {
  return valeur?.trim() === "-" ? "" : valeur;
}

/** Résumé d'un membre, pour l'écran de confirmation. */
function resumerMembre(membre: MembreEquipe): string {
  return [
    `**${echapperMarkdown(membre.name)}** — ${echapperMarkdown(membre.role)}`,
    `Équipe : ${libelleEquipeRg(membre.team_id)}`,
    `État : ${membre.is_active === false ? "désactivé" : "actif"}`,
    membre.discord_user_id ? `Discord : <@${membre.discord_user_id}>` : null,
    `Identifiant : \`${membre.id}\``,
    `Modifié : ${horodatageRelatif(membre.updated_at)}`,
  ]
    .filter((ligne): ligne is string => ligne !== null)
    .join("\n");
}

@Discord()
@SlashGroup({
  name: "equipe",
  description: "Membres des dix équipes affichées sur le site",
  root: "administration",
})
@SlashGroup("equipe", "administration")
export class AdministrationEquipeCommand {
  @Slash({ name: "ajouter", description: "Ajoute un membre dans une équipe" })
  async ajouter(
    @SlashChoice(...CHOIX_EQUIPE)
    @SlashOption({
      name: "equipe",
      description: "L'équipe d'accueil",
      type: ApplicationCommandOptionType.String,
      required: true,
    })
    equipe: string,
    @SlashOption({
      name: "nom",
      description: "Le nom affiché sur le site",
      type: ApplicationCommandOptionType.String,
      required: true,
      maxLength: 80,
    })
    nom: string,
    @SlashOption({
      name: "role",
      description: "Le rôle tenu dans l'équipe (Monteur, Illustrateur…)",
      type: ApplicationCommandOptionType.String,
      required: true,
      maxLength: 80,
    })
    role: string,
    @SlashOption({
      name: "discord",
      description: "Identifiant Discord — permet la reprise automatique de l'avatar",
      type: ApplicationCommandOptionType.String,
      required: false,
      maxLength: 20,
    })
    discord: string | undefined,
    @SlashOption({
      name: "image",
      description: "URL du portrait (à défaut : l'avatar Discord, via /administration equipe actualiser-photos)",
      type: ApplicationCommandOptionType.String,
      required: false,
      maxLength: 1000,
    })
    image: string | undefined,
    @SlashOption({
      name: "lien",
      description: "Lien externe (X, portfolio…)",
      type: ApplicationCommandOptionType.String,
      required: false,
      maxLength: 500,
    })
    lien: string | undefined,
    @SlashOption({
      name: "ordre",
      description: "Ordre d'affichage dans l'équipe (par défaut : à la suite)",
      type: ApplicationCommandOptionType.Integer,
      required: false,
      minValue: 0,
      maxValue: 32767,
    })
    ordre: number | undefined,
    interaction: ChatInputCommandInteraction,
  ) {
    await differerEnPrive(interaction);
    const acteur = await exigerDroits(interaction, { strict: true });
    if (!acteur) {
      return;
    }

    const controles = [
      validerTexteMembre("nom", nom),
      validerTexteMembre("role", role),
      validerUrlMembre("image", image),
      validerUrlMembre("lien", lien),
      validerIdentifiantDiscordFacultatif(discord),
      validerOrdreAffichage(ordre),
    ];
    const refus = controles.find(controle => !controle.ok);
    if (refus && !refus.ok) {
      await repondre(interaction, accesRefuse(refus.raison));
      return;
    }
    const [nomValide, roleValide, imageValide, lienValide, discordValide, ordreValide] = controles as [
      ResultatValidation<string> & { ok: true },
      ResultatValidation<string> & { ok: true },
      ResultatValidation<string | null> & { ok: true },
      ResultatValidation<string | null> & { ok: true },
      ResultatValidation<string | null> & { ok: true },
      ResultatValidation<number | null> & { ok: true },
    ];

    try {
      // `display_index` est calculé EN BASE : le lire puis l'écrire depuis le
      // bot laisserait deux ajouts simultanés se donner le même rang.
      const lignes = await sql<Array<{ id: string; display_index: number | null }>>`
				INSERT INTO team_members
					(team_id, team_name, name, role, image_url, member_link, discord_user_id,
					 is_active, source, display_index)
				VALUES (
					${equipe},
					${libelleEquipeRg(equipe)},
					${nomValide.valeur},
					${roleValide.valeur},
					${imageValide.valeur},
					${lienValide.valeur},
					${discordValide.valeur},
					true,
					${SOURCE_BOT},
					COALESCE(
						${ordreValide.valeur}::smallint,
						-- LEAST parce que la colonne est un smallint : collabteam porte
						-- déjà un rang 999, et rien n'empêche une équipe d'atteindre
						-- 32 767. Sans borne, MAX + 1 déborderait et l'ajout échouerait
						-- sur une erreur Postgres brute, pour une valeur que personne
						-- n'a saisie.
						(SELECT LEAST(COALESCE(MAX(display_index), 0) + 1, ${LIMITES_MEMBRE_EQUIPE.ordreMax})::smallint
						   FROM team_members WHERE team_id = ${equipe})
					)
				)
				RETURNING id, display_index
			`;
      const cree = lignes[0]!;

      await logAdminAction({
        adminId: acteur.profileId,
        discordId: acteur.discordId,
        action: "equipe.ajouter",
        targetType: "team_member",
        targetId: cree.id,
        details: {
          team_id: equipe,
          name: nomValide.valeur,
          role: roleValide.valeur,
          display_index: cree.display_index,
          discord_user_id: discordValide.valeur,
        },
      });

      await interaction.editReply({
        embeds: [
          rgEmbed()
            .setTitle("Membre ajouté")
            .setDescription(
              [
                `**${echapperMarkdown(nomValide.valeur)}** — ${echapperMarkdown(roleValide.valeur)}`,
                `Équipe : ${libelleEquipeRg(equipe)}`,
                `Ordre d'affichage : \`${cree.display_index ?? "—"}\``,
                `Identifiant : \`${cree.id}\``,
              ].join("\n"),
            )
            .setFooter(
              piedTexte({
                note: imageValide.valeur
                  ? "Le site reprendra la fiche à sa prochaine revalidation."
                  : "Sans portrait : /administration equipe actualiser-photos ira chercher l'avatar Discord.",
              }),
            ),
        ],
      });
    } catch (err) {
      await repondre(interaction, echec("Le service n'a pas répondu", messagePanne(err)));
    }
  }

  @Slash({
    name: "modifier",
    description: "Modifie un membre — les champs laissés vides ne bougent pas",
  })
  async modifier(
    @SlashOption({
      name: "membre",
      description: "Cherche par nom ou par rôle",
      type: ApplicationCommandOptionType.String,
      required: true,
      autocomplete: proposerMembres,
    })
    membre: string,
    @SlashOption({
      name: "nom",
      description: "Nouveau nom affiché",
      type: ApplicationCommandOptionType.String,
      required: false,
      maxLength: 80,
    })
    nom: string | undefined,
    @SlashOption({
      name: "role",
      description: "Nouveau rôle dans l'équipe",
      type: ApplicationCommandOptionType.String,
      required: false,
      maxLength: 80,
    })
    role: string | undefined,
    @SlashChoice(...CHOIX_EQUIPE)
    @SlashOption({
      name: "equipe",
      description: "Déplacer vers une autre équipe",
      type: ApplicationCommandOptionType.String,
      required: false,
    })
    equipe: string | undefined,
    @SlashOption({
      name: "image",
      description: "Nouveau portrait — « - » pour l'effacer",
      type: ApplicationCommandOptionType.String,
      required: false,
      maxLength: 1000,
    })
    image: string | undefined,
    @SlashOption({
      name: "lien",
      description: "Nouveau lien externe — « - » pour l'effacer",
      type: ApplicationCommandOptionType.String,
      required: false,
      maxLength: 500,
    })
    lien: string | undefined,
    @SlashOption({
      name: "ordre",
      description: "Nouvel ordre d'affichage dans l'équipe",
      type: ApplicationCommandOptionType.Integer,
      required: false,
      minValue: 0,
      maxValue: 32767,
    })
    ordre: number | undefined,
    interaction: ChatInputCommandInteraction,
  ) {
    await differerEnPrive(interaction);
    const acteur = await exigerDroits(interaction, { strict: true });
    if (!acteur) {
      return;
    }

    try {
      const resolution = await resoudreMembre(membre);
      if (!resolution.ok) {
        await repondre(interaction, accesRefuse(resolution.raison));
        return;
      }
      const cible = resolution.valeur;

      const changements: string[] = [];
      const details: Record<string, unknown> = {};

      let nomValide: string | null = null;
      if (nom !== undefined) {
        const controle = validerTexteMembre("nom", nom);
        if (!controle.ok) {
          await repondre(interaction, accesRefuse(controle.raison));
          return;
        }
        nomValide = controle.valeur;
        changements.push(`Nom : ${decrireChangement(cible.name, nomValide)}`);
        details.name = nomValide;
      }

      let roleValide: string | null = null;
      if (role !== undefined) {
        const controle = validerTexteMembre("role", role);
        if (!controle.ok) {
          await repondre(interaction, accesRefuse(controle.raison));
          return;
        }
        roleValide = controle.valeur;
        changements.push(`Rôle : ${decrireChangement(cible.role, roleValide)}`);
        details.role = roleValide;
      }

      let imageValide: string | null | undefined;
      if (image !== undefined) {
        const controle = validerUrlMembre("image", effacer(image));
        if (!controle.ok) {
          await repondre(interaction, accesRefuse(controle.raison));
          return;
        }
        imageValide = controle.valeur;
        changements.push(`Portrait : ${controle.valeur ? "remplacé" : "effacé"}`);
        details.image_url = controle.valeur;
      }

      let lienValide: string | null | undefined;
      if (lien !== undefined) {
        const controle = validerUrlMembre("lien", effacer(lien));
        if (!controle.ok) {
          await repondre(interaction, accesRefuse(controle.raison));
          return;
        }
        lienValide = controle.valeur;
        changements.push(`Lien : ${controle.valeur ? "remplacé" : "effacé"}`);
        details.member_link = controle.valeur;
      }

      let ordreValide: number | null = null;
      if (ordre !== undefined) {
        const controle = validerOrdreAffichage(ordre);
        if (!controle.ok) {
          await repondre(interaction, accesRefuse(controle.raison));
          return;
        }
        ordreValide = controle.valeur;
        changements.push(`Ordre : ${decrireChangement(cible.display_index, ordreValide)}`);
        details.display_index = ordreValide;
      }

      if (equipe !== undefined) {
        changements.push(`Équipe : ${decrireChangement(libelleEquipeRg(cible.team_id), libelleEquipeRg(equipe))}`);
        details.team_id = equipe;
      }

      if (changements.length === 0) {
        await interaction.editReply({
          content: "Aucun champ à modifier : renseigne au moins une option.",
        });
        return;
      }

      // `team_name` suit toujours `team_id` : le laisser en arrière ferait de
      // cette ligne la seule de son équipe à porter un autre libellé.
      await sql`
				UPDATE team_members SET
					name = COALESCE(${nomValide}::text, name),
					role = COALESCE(${roleValide}::text, role),
					team_id = COALESCE(${equipe ?? null}::text, team_id),
					team_name = COALESCE(${equipe === undefined ? null : libelleEquipeRg(equipe)}::text, team_name),
					image_url = CASE WHEN ${image !== undefined} THEN ${imageValide ?? null}::text ELSE image_url END,
					member_link = CASE WHEN ${lien !== undefined} THEN ${lienValide ?? null}::text ELSE member_link END,
					display_index = COALESCE(${ordreValide}::smallint, display_index),
					updated_at = NOW()
				WHERE id = ${cible.id}
			`;

      await logAdminAction({
        adminId: acteur.profileId,
        discordId: acteur.discordId,
        action: "equipe.modifier",
        targetType: "team_member",
        targetId: cible.id,
        details: {
          ...details,
          // L'état d'AVANT, limité aux champs réellement touchés. Sans lui, le
          // journal ne dit que la valeur d'arrivée : on sait que quelqu'un a
          // effacé un portrait, jamais lequel — donc on ne peut pas revenir en
          // arrière, ce qui est exactement ce qu'on demande à un journal.
          avant: Object.fromEntries(
            Object.keys(details).map(champ => [champ, (cible as unknown as Record<string, unknown>)[champ] ?? null]),
          ),
        },
      });

      await interaction.editReply({
        embeds: [
          rgEmbed()
            .setTitle(`Membre modifié — ${borner(echapperMarkdown(cible.name), 80)}`)
            .setDescription(borner(changements.join("\n"), 4_000))
            .setFooter(piedTexte({ note: `Identifiant ${abregerIdentifiant(cible.id)}` })),
        ],
      });
    } catch (err) {
      await repondre(interaction, echec("Le service n'a pas répondu", messagePanne(err)));
    }
  }

  @Slash({
    name: "activer",
    description: "Affiche ou retire un membre du site, sans rien supprimer",
  })
  async activer(
    @SlashOption({
      name: "membre",
      description: "Cherche par nom ou par rôle",
      type: ApplicationCommandOptionType.String,
      required: true,
      autocomplete: proposerMembres,
    })
    membre: string,
    @SlashOption({
      name: "actif",
      description: "Vrai = visible sur le site, faux = masqué",
      type: ApplicationCommandOptionType.Boolean,
      required: true,
    })
    actif: boolean,
    interaction: ChatInputCommandInteraction,
  ) {
    await differerEnPrive(interaction);
    const acteur = await exigerDroits(interaction, { strict: true });
    if (!acteur) {
      return;
    }

    try {
      const resolution = await resoudreMembre(membre);
      if (!resolution.ok) {
        await repondre(interaction, accesRefuse(resolution.raison));
        return;
      }
      const cible = resolution.valeur;

      if ((cible.is_active ?? true) === actif) {
        await interaction.editReply({
          content: `**${echapperMarkdown(cible.name)}** est déjà ${actif ? "actif" : "désactivé"}.`,
        });
        return;
      }

      await sql`
				UPDATE team_members SET is_active = ${actif}, updated_at = NOW() WHERE id = ${cible.id}
			`;
      await logAdminAction({
        adminId: acteur.profileId,
        discordId: acteur.discordId,
        action: actif ? "equipe.activer" : "equipe.desactiver",
        targetType: "team_member",
        targetId: cible.id,
        details: {
          team_id: cible.team_id,
          name: cible.name,
          avant: { is_active: cible.is_active },
          apres: { is_active: actif },
        },
      });

      await interaction.editReply({
        content:
          `✓ **${echapperMarkdown(cible.name)}** (${libelleEquipeRg(cible.team_id)}) est ` +
          `désormais ${actif ? "visible sur le site" : "masqué du site"}.`,
      });
    } catch (err) {
      await repondre(interaction, echec("Le service n'a pas répondu", messagePanne(err)));
    }
  }

  @Slash({
    name: "supprimer",
    description: "SUPPRIME définitivement un membre (confirmation, journalisé)",
  })
  async supprimer(
    @SlashOption({
      name: "membre",
      description: "Cherche par nom ou par rôle",
      type: ApplicationCommandOptionType.String,
      required: true,
      autocomplete: proposerMembres,
    })
    membre: string,
    interaction: ChatInputCommandInteraction,
  ) {
    await differerEnPrive(interaction);
    const acteur = await exigerDroits(interaction, { strict: true });
    if (!acteur) {
      return;
    }

    try {
      const resolution = await resoudreMembre(membre);
      if (!resolution.ok) {
        await repondre(interaction, accesRefuse(resolution.raison));
        return;
      }
      const cible = resolution.valeur;

      await demanderConfirmation(interaction, {
        titre: "Supprimer définitivement ce membre ?",
        description: [
          resumerMembre(cible),
          "",
          "La suppression est **irréversible**. Pour retirer quelqu'un du site sans perdre " +
            "sa fiche, utilise plutôt `/administration equipe activer` avec `actif: faux`.",
        ].join("\n"),
        libelle: "Supprimer",
        resume: `suppression de ${cible.name}`,
        executer: async (confirmant: RgAdmin) => {
          const lignes = await sql<Array<{ id: string }>>`
						DELETE FROM team_members WHERE id = ${cible.id} RETURNING id
					`;
          if (lignes.length === 0) {
            return "⚠ Rien n'a été supprimé : ce membre n'existe déjà plus.";
          }
          await logAdminAction({
            adminId: confirmant.profileId,
            discordId: confirmant.discordId,
            action: "equipe.supprimer",
            targetType: "team_member",
            targetId: cible.id,
            details: {
              team_id: cible.team_id,
              name: cible.name,
              role: cible.role,
              discord_user_id: cible.discord_user_id,
            },
          });
          return `🗑 **${echapperMarkdown(cible.name)}** a été supprimé de ${libelleEquipeRg(cible.team_id)}.`;
        },
      });
    } catch (err) {
      await repondre(interaction, echec("Le service n'a pas répondu", messagePanne(err)));
    }
  }

  @Slash({
    // `photos` nommait une ressource pour une action ponctuelle. Kebab-case pour
    // le mot composé, comme les options (cf. `docs/bot-commandes.md`).
    name: "actualiser-photos",
    description: "Reprend les avatars Discord des membres actifs qui en ont un",
  })
  async photos(interaction: ChatInputCommandInteraction) {
    await differerEnPrive(interaction);
    const acteur = await exigerDroits(interaction, { strict: true });
    if (!acteur) {
      return;
    }

    try {
      // Import différé : ce service parcourt les membres un par un via la
      // passerelle Discord. Le charger au démarrage pour une commande lancée
      // quelques fois par an n'a pas de sens.
      const { syncStaffPhotos } = await import("../../services/teamPhotos");
      const rapport = await syncStaffPhotos(interaction.client);

      await logAdminAction({
        adminId: acteur.profileId,
        discordId: acteur.discordId,
        action: "equipe.photos",
        targetType: "team_members",
        details: {
          total: rapport.total,
          mises_a_jour: rapport.updated,
          inchangees: rapport.unchanged,
          echecs: rapport.errors.length,
          duree_ms: rapport.durationMs,
        },
      });

      const embed = rgEmbed()
        .setTitle("Avatars repris depuis Discord")
        .setDescription(
          [
            `**${rapport.updated}** mis à jour · ${rapport.unchanged} inchangés · ${rapport.errors.length} en échec`,
            `${rapport.total} membres actifs porteurs d'un identifiant Discord · ${formaterDuree(rapport.durationMs)}`,
          ].join("\n"),
        );

      if (rapport.errors.length > 0) {
        embed.addFields({
          name: "En échec",
          value: borner(
            rapport.errors
              .slice(0, 10)
              .map(echec => `• ${echapperMarkdown(echec.name)} — ${borner(echec.reason, 80)}`)
              .join("\n"),
            1_000,
          ),
        });
      }

      await interaction.editReply({ embeds: [embed] });
    } catch (err) {
      await repondre(interaction, echec("Le service n'a pas répondu", messagePanne(err)));
    }
  }
}
