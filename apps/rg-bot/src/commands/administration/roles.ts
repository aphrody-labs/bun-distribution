/**
 * `/gestion roles` — les menus de rôles en libre-service, et leurs composants.
 *
 * ── LA SURFACE LA PLUS EXPOSÉE DU BOT ──────────────────────────────────────
 * Un menu de rôles donne un rôle à QUICONQUE clique, sans qu'un humain
 * intervienne, pendant des mois. C'est plus exposé qu'une récompense de niveau :
 * là au moins il fallait atteindre le niveau.
 *
 * Chaque rôle proposé passe donc par `verifierAttributionAutomatique`
 * (`lib/hierarchie.ts`), la même garde stricte que les récompenses — et il y
 * passe DEUX FOIS :
 *
 *   - à l'ajout au menu, pour refuser en expliquant ;
 *   - à chaque clic, parce qu'un rôle peut gagner des permissions APRÈS avoir
 *     été mis au menu, et que ce jour-là rien n'alerte personne.
 *
 * ── DISCRÉTION ─────────────────────────────────────────────────────────────
 * Le seul message public est le PANNEAU, posé une fois par le staff. Tous les
 * clics répondent en éphémère : sur un serveur de deux mille membres, confirmer
 * publiquement chaque prise de rôle produirait plus de bruit que les
 * conversations.
 */
import { ButtonComponent, Discord, SelectMenuComponent, Slash, SlashChoice, SlashGroup, SlashOption } from "discordx";
import {
  ActionRowBuilder,
  ApplicationCommandOptionType,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  MessageFlags,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type GuildMember,
  type GuildTextBasedChannel,
  type Role,
  type StringSelectMenuInteraction,
} from "discord.js";

import { logAdminAction } from "../../lib/audit";
import { sql } from "../../lib/db";
import { verifierAttributionAutomatique } from "../../lib/hierarchie";
import {
  entreePropre,
  identifiantBouton,
  identifiantMenu,
  lireComposant,
  lireEntrees,
  LONGUEURS,
  planDeBascule,
  planDeBouton,
  resumeBascule,
  ROLES_MAX,
  type EntreeMenu,
  type FormeMenu,
} from "../../lib/menus-roles";
import { attention, creerEmbed, echec, fiche, ilYA, pied, piedDeCommande, repondre, succes, vide } from "../../lib/ui";
import { differerEnPrive, exigerDroits, messagePanne } from "../staff/garde";
import "./racine-gestion";

// ─── Base ───────────────────────────────────────────────────────────────────

interface LigneMenu {
  id: string | number;
  guild_id: string;
  salon_id: string;
  message_id: string;
  titre: string;
  description: string | null;
  forme: string;
  choix_max: number;
  roles: unknown;
  cree_par: string;
  cree_le: Date;
}

export interface MenuRoles {
  id: number;
  guildId: string;
  salonId: string;
  messageId: string;
  titre: string;
  description: string | null;
  forme: FormeMenu;
  choixMax: number;
  entrees: EntreeMenu[];
  creePar: string;
  creeLe: Date;
}

function versMenu(ligne: LigneMenu): MenuRoles {
  return {
    choixMax: ligne.choix_max,
    creeLe: ligne.cree_le,
    creePar: ligne.cree_par,
    description: ligne.description,
    entrees: lireEntrees(ligne.roles),
    forme: ligne.forme === "boutons" ? "boutons" : "menu",
    guildId: ligne.guild_id,
    id: Number(ligne.id),
    messageId: ligne.message_id,
    salonId: ligne.salon_id,
    titre: ligne.titre,
  };
}

const COLONNES = sql`
	id, guild_id, salon_id, message_id, titre, description, forme, choix_max, roles,
	cree_par, cree_le
`;

async function menuDuMessage(messageId: string): Promise<MenuRoles | null> {
  const lignes = await sql<LigneMenu[]>`
		SELECT ${COLONNES} FROM bot_menus_roles WHERE message_id = ${messageId} LIMIT 1
	`;
  const ligne = lignes[0];
  return ligne ? versMenu(ligne) : null;
}

async function menusDe(guildId: string): Promise<MenuRoles[]> {
  const lignes = await sql<LigneMenu[]>`
		SELECT ${COLONNES} FROM bot_menus_roles
		 WHERE guild_id = ${guildId} ORDER BY cree_le DESC LIMIT 25
	`;
  return lignes.map(versMenu);
}

// ─── Composition du message ─────────────────────────────────────────────────

/**
 * Le panneau : un embed et ses composants.
 *
 * Exporté pour que la commande le publie ET le republie après modification :
 * un menu dont on retire un rôle doit voir son message changer, sinon le membre
 * clique sur une option qui ne fait plus rien.
 */
export function composerPanneau(menu: MenuRoles): {
  embeds: Array<ReturnType<typeof creerEmbed>>;
  components: Array<ActionRowBuilder<StringSelectMenuBuilder | ButtonBuilder>>;
} {
  const embed = creerEmbed({
    description: [
      menu.description,
      menu.entrees.length === 0
        ? "*Aucun rôle proposé pour l'instant.*"
        : menu.entrees
            .map(entree =>
              [entree.emoji, `**${entree.libelle}**`, entree.description ? `— ${entree.description}` : null]
                .filter(Boolean)
                .join(" "),
            )
            .join("\n"),
      menu.choixMax > 0
        ? `\n*${menu.choixMax === 1 ? "Un seul rôle" : `${menu.choixMax} rôles au maximum`} dans ce menu.*`
        : null,
    ]
      .filter(Boolean)
      .join("\n"),
    icone: "reglage",
    titre: menu.titre,
  });
  pied(embed, { note: "clique pour prendre ou rendre — la réponse n'est visible que de toi" });

  if (menu.entrees.length === 0) {
    return { components: [], embeds: [embed] };
  }

  if (menu.forme === "boutons") {
    const rangee = new ActionRowBuilder<ButtonBuilder>().addComponents(
      menu.entrees.slice(0, ROLES_MAX.boutons).map(entree => {
        const bouton = new ButtonBuilder()
          .setCustomId(identifiantBouton(menu.messageId, entree.roleId))
          .setLabel(entree.libelle.slice(0, 80))
          .setStyle(ButtonStyle.Secondary);
        if (entree.emoji) {
          bouton.setEmoji(entree.emoji);
        }
        return bouton;
      }),
    );
    return { components: [rangee], embeds: [embed] };
  }

  const deroulant = new StringSelectMenuBuilder()
    .setCustomId(identifiantMenu(menu.messageId))
    .setPlaceholder("Choisis tes rôles")
    // `minValues: 0` est ce qui rend le menu RÉVERSIBLE : sans lui, Discord
    // exige au moins une option et un membre ne peut jamais tout retirer.
    .setMinValues(0)
    .setMaxValues(
      menu.choixMax > 0 ? Math.min(menu.choixMax, menu.entrees.length) : Math.min(ROLES_MAX.menu, menu.entrees.length),
    )
    .addOptions(
      menu.entrees.slice(0, ROLES_MAX.menu).map(entree => {
        const option = new StringSelectMenuOptionBuilder().setLabel(entree.libelle).setValue(entree.roleId);
        if (entree.description) {
          option.setDescription(entree.description);
        }
        if (entree.emoji) {
          option.setEmoji(entree.emoji);
        }
        return option;
      }),
    );
  return {
    components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(deroulant)],
    embeds: [embed],
  };
}

/** Republie le message d'un menu après modification. Ne lève jamais. */
async function rafraichirPanneau(interaction: ChatInputCommandInteraction, menu: MenuRoles): Promise<boolean> {
  try {
    const salon = await interaction.client.channels.fetch(menu.salonId);
    if (!salon || !salon.isTextBased()) {
      return false;
    }
    const message = await salon.messages.fetch(menu.messageId);
    await message.edit(composerPanneau(menu));
    return true;
  } catch (err) {
    console.warn(`[roles] panneau ${menu.messageId} non rafraîchi :`, err instanceof Error ? err.message : err);
    return false;
  }
}

/** Faits d'un rôle, dans la forme attendue par `lib/hierarchie.ts`. */
function faitsDe(role: Role) {
  return {
    estEveryone: role.id === role.guild.id,
    gereParIntegration: role.managed,
    id: role.id,
    nom: role.name,
    permissions: role.permissions.bitfield.toString(),
    position: role.position,
  };
}

function faitsBotDe(role: Role) {
  const moi = role.guild.members.me;
  return {
    peutGererRoles: moi?.permissions.has("ManageRoles") ?? false,
    positionMax: moi?.roles.highest.position ?? 0,
  };
}

@Discord()
@SlashGroup({
  description: "Menus de rôles en libre-service",
  name: "roles",
  root: "gestion",
})
@SlashGroup("roles", "gestion")
export class GestionRolesCommand {
  @Slash({ description: "Créer un menu de rôles dans un salon", name: "creer" })
  async creer(
    @SlashOption({
      description: "Titre du panneau",
      maxLength: LONGUEURS.titre,
      minLength: 2,
      name: "titre",
      required: true,
      type: ApplicationCommandOptionType.String,
    })
    titre: string,
    @SlashOption({
      channelTypes: [ChannelType.GuildText, ChannelType.GuildAnnouncement],
      description: "Où publier le panneau",
      name: "salon",
      required: true,
      type: ApplicationCommandOptionType.Channel,
    })
    salon: GuildTextBasedChannel,
    @SlashOption({
      description: "Une phrase qui dit à quoi sert ce menu",
      maxLength: LONGUEURS.texte,
      name: "texte",
      required: false,
      type: ApplicationCommandOptionType.String,
    })
    texte: string | undefined,
    @SlashChoice({ name: "Menu déroulant (jusqu'à 25 rôles)", value: "menu" })
    @SlashChoice({ name: "Boutons (5 rôles au plus)", value: "boutons" })
    @SlashOption({
      description: "Forme du panneau (menu déroulant par défaut)",
      name: "forme",
      required: false,
      type: ApplicationCommandOptionType.String,
    })
    forme: string | undefined,
    @SlashOption({
      description: "Nombre de rôles cumulables dans ce menu (0 = sans limite)",
      maxValue: 25,
      minValue: 0,
      name: "maximum",
      required: false,
      type: ApplicationCommandOptionType.Integer,
    })
    maximum: number | undefined,
    interaction: ChatInputCommandInteraction,
  ) {
    await differerEnPrive(interaction);
    const admin = await exigerDroits(interaction);
    if (!admin) {
      return;
    }
    const guildId = interaction.guildId;
    if (!guildId) {
      await repondre(interaction, echec("Hors serveur", "Un menu de rôles vit sur un serveur."));
      return;
    }
    try {
      // Le message est posté AVANT la ligne : c'est son identifiant qui sert de
      // clé. Un menu vide est publiable — c'est même le cas normal, on y ajoute
      // les rôles ensuite avec `/gestion roles ajouter`.
      const provisoire: MenuRoles = {
        choixMax: Math.max(0, Math.floor(maximum ?? 0)),
        creeLe: new Date(),
        creePar: interaction.user.id,
        description: texte ?? null,
        entrees: [],
        forme: forme === "boutons" ? "boutons" : "menu",
        guildId,
        id: 0,
        messageId: "0",
        salonId: salon.id,
        titre,
      };
      const message = await salon.send(composerPanneau(provisoire));

      const [ligne] = await sql<LigneMenu[]>`
				INSERT INTO bot_menus_roles
					(guild_id, salon_id, message_id, titre, description, forme, choix_max, roles, cree_par)
				VALUES (${guildId}, ${salon.id}, ${message.id}, ${titre}, ${texte ?? null},
				        ${provisoire.forme}, ${provisoire.choixMax}, '[]'::jsonb, ${interaction.user.id})
				RETURNING ${COLONNES}
			`;
      if (!ligne) {
        await message.delete().catch(() => undefined);
        await repondre(
          interaction,
          echec("Menu non enregistré", "Le panneau a été retiré : un menu sans ligne ne répond pas."),
        );
        return;
      }
      // Le message porte l'identifiant définitif dans ses composants.
      await message.edit(composerPanneau(versMenu(ligne))).catch(() => undefined);

      await logAdminAction({
        action: "roles.menu.creer",
        adminId: admin.profileId,
        details: { forme: provisoire.forme, salon: salon.id, titre },
        discordId: interaction.user.id,
        targetId: message.id,
        targetType: "bot_menus_roles",
      });
      await repondre(
        interaction,
        succes("Menu créé", `${message.url}\nAjoute-y des rôles avec \`/gestion roles ajouter\`.`, { prive: true }),
      );
    } catch (err) {
      await repondre(interaction, echec("Création impossible", messagePanne(err)));
    }
  }

  @Slash({ description: "Ajouter un rôle à un menu existant", name: "ajouter" })
  async ajouter(
    @SlashOption({
      description: "Identifiant du message du menu (clic droit → Copier l'identifiant)",
      name: "menu",
      required: true,
      type: ApplicationCommandOptionType.String,
    })
    messageId: string,
    @SlashOption({
      description: "Le rôle proposé — jamais un rôle à permissions sensibles",
      name: "role",
      required: true,
      type: ApplicationCommandOptionType.Role,
    })
    role: Role,
    @SlashOption({
      description: "Libellé affiché (le nom du rôle par défaut)",
      maxLength: LONGUEURS.libelle,
      name: "libelle",
      required: false,
      type: ApplicationCommandOptionType.String,
    })
    libelle: string | undefined,
    @SlashOption({
      description: "Une ligne pour dire à quoi ce rôle sert",
      maxLength: LONGUEURS.description,
      name: "description",
      required: false,
      type: ApplicationCommandOptionType.String,
    })
    description: string | undefined,
    @SlashOption({
      description: "Émoji affiché devant (Unicode uniquement)",
      maxLength: 8,
      name: "emoji",
      required: false,
      type: ApplicationCommandOptionType.String,
    })
    emoji: string | undefined,
    interaction: ChatInputCommandInteraction,
  ) {
    await differerEnPrive(interaction);
    const admin = await exigerDroits(interaction);
    if (!admin) {
      return;
    }

    // LE VERROU. Un menu de rôles est en libre-service : la même règle que les
    // récompenses de niveau s'y applique, en plus strict encore.
    const verdict = verifierAttributionAutomatique(faitsDe(role), faitsBotDe(role));
    if (!verdict.ok) {
      await repondre(interaction, attention("Rôle refusé", verdict.motif, { prive: true }));
      return;
    }

    try {
      const menu = await menuDuMessage(messageId.trim());
      if (!menu || menu.guildId !== interaction.guildId) {
        await repondre(
          interaction,
          echec(
            "Menu introuvable",
            "Copie l'identifiant du message du panneau, ou retrouve-le avec `/gestion roles liste`.",
          ),
        );
        return;
      }

      const plafond = ROLES_MAX[menu.forme];
      if (menu.entrees.length >= plafond) {
        await repondre(
          interaction,
          attention(
            "Menu plein",
            `Cette forme accepte ${plafond} rôles au maximum. Crée un second menu, ou passe en menu déroulant.`,
            { prive: true },
          ),
        );
        return;
      }
      if (menu.entrees.some(entree => entree.roleId === role.id)) {
        await repondre(
          interaction,
          attention("Déjà proposé", `${role.toString()} est déjà dans ce menu.`, { prive: true }),
        );
        return;
      }

      const entree = entreePropre({
        description,
        emoji,
        libelle: libelle ?? role.name,
        roleId: role.id,
      });
      if (!entree) {
        await repondre(interaction, echec("Entrée invalide", "Le libellé ne peut pas être vide."));
        return;
      }

      const entrees = [...menu.entrees, entree];
      await sql`
				UPDATE bot_menus_roles
				   SET roles = ${entrees}::jsonb, maj_le = NOW()
				 WHERE id = ${menu.id}
			`;
      const rafraichi = await rafraichirPanneau(interaction, { ...menu, entrees });

      await logAdminAction({
        action: "roles.menu.ajouter",
        adminId: admin.profileId,
        details: { menu: menu.messageId, role: role.id },
        discordId: interaction.user.id,
        targetId: menu.messageId,
        targetType: "bot_menus_roles",
      });
      await repondre(
        interaction,
        succes(
          "Rôle ajouté",
          [
            `${role.toString()} est proposé dans « ${menu.titre} ».`,
            rafraichi ? null : "⚠️ Le panneau n'a pas pu être rafraîchi : republie-le.",
          ]
            .filter(Boolean)
            .join("\n"),
          { prive: true },
        ),
      );
    } catch (err) {
      await repondre(interaction, echec("Ajout impossible", messagePanne(err)));
    }
  }

  @Slash({ description: "Retirer un rôle d'un menu", name: "retirer" })
  async retirer(
    @SlashOption({
      description: "Identifiant du message du menu",
      name: "menu",
      required: true,
      type: ApplicationCommandOptionType.String,
    })
    messageId: string,
    @SlashOption({
      description: "Le rôle à retirer du menu",
      name: "role",
      required: true,
      type: ApplicationCommandOptionType.Role,
    })
    role: Role,
    interaction: ChatInputCommandInteraction,
  ) {
    await differerEnPrive(interaction);
    const admin = await exigerDroits(interaction);
    if (!admin) {
      return;
    }
    try {
      const menu = await menuDuMessage(messageId.trim());
      if (!menu || menu.guildId !== interaction.guildId) {
        await repondre(interaction, echec("Menu introuvable", "Vérifie l'identifiant du message."));
        return;
      }
      const entrees = menu.entrees.filter(entree => entree.roleId !== role.id);
      if (entrees.length === menu.entrees.length) {
        await repondre(
          interaction,
          attention("Rien à retirer", `${role.toString()} n'était pas dans ce menu.`, {
            prive: true,
          }),
        );
        return;
      }
      await sql`
				UPDATE bot_menus_roles
				   SET roles = ${entrees}::jsonb, maj_le = NOW()
				 WHERE id = ${menu.id}
			`;
      await rafraichirPanneau(interaction, { ...menu, entrees });
      await logAdminAction({
        action: "roles.menu.retirer",
        adminId: admin.profileId,
        details: { menu: menu.messageId, role: role.id },
        discordId: interaction.user.id,
        targetId: menu.messageId,
        targetType: "bot_menus_roles",
      });
      await repondre(
        interaction,
        succes(
          "Rôle retiré du menu",
          "Les membres qui l'avaient pris le GARDENT : le retirer du menu ne le retire de personne.",
          { prive: true },
        ),
      );
    } catch (err) {
      await repondre(interaction, echec("Retrait impossible", messagePanne(err)));
    }
  }

  @Slash({ description: "Les menus de rôles du serveur", name: "liste" })
  async liste(interaction: ChatInputCommandInteraction) {
    await differerEnPrive(interaction);
    if (!(await exigerDroits(interaction))) {
      return;
    }
    const guildId = interaction.guildId;
    if (!guildId) {
      await repondre(interaction, echec("Hors serveur", "Les menus vivent sur un serveur."));
      return;
    }
    try {
      const menus = await menusDe(guildId);
      if (menus.length === 0) {
        await repondre(interaction, vide("Aucun menu", "`/gestion roles creer` en pose un premier."));
        return;
      }
      const carte = fiche({ icone: "reglage", titre: `${menus.length} menu(s) de rôles` });
      for (const menu of menus) {
        carte.champ(
          menu.titre,
          [
            `<#${menu.salonId}> · \`${menu.messageId}\``,
            [
              menu.forme === "menu" ? "menu déroulant" : "boutons",
              `${menu.entrees.length} rôle(s)`,
              menu.choixMax > 0 ? `${menu.choixMax} au maximum` : null,
            ]
              .filter(Boolean)
              .join(" · "),
            menu.entrees.map(entree => `<@&${entree.roleId}>`).join(" ") || "*vide*",
            `créé ${ilYA(menu.creeLe)}`,
          ].join("\n"),
        );
      }
      await interaction.editReply({ embeds: [piedDeCommande(carte.embed, interaction)] });
    } catch (err) {
      await repondre(interaction, echec("Liste illisible", messagePanne(err)));
    }
  }

  @Slash({ description: "Supprimer un menu et son panneau", name: "supprimer" })
  async supprimer(
    @SlashOption({
      description: "Identifiant du message du menu",
      name: "menu",
      required: true,
      type: ApplicationCommandOptionType.String,
    })
    messageId: string,
    interaction: ChatInputCommandInteraction,
  ) {
    await differerEnPrive(interaction);
    const admin = await exigerDroits(interaction);
    if (!admin) {
      return;
    }
    try {
      // `RETURNING` : un DELETE qui ne touche rien ne doit pas produire une
      // confirmation mensongère.
      const lignes = await sql<Array<{ message_id: string; salon_id: string }>>`
				DELETE FROM bot_menus_roles
				 WHERE message_id = ${messageId.trim()} AND guild_id = ${interaction.guildId}
				RETURNING message_id, salon_id
			`;
      const supprime = lignes[0];
      if (!supprime) {
        await repondre(
          interaction,
          attention("Rien à supprimer", "Aucun menu ne porte cet identifiant.", { prive: true }),
        );
        return;
      }
      try {
        const salon = await interaction.client.channels.fetch(supprime.salon_id);
        if (salon?.isTextBased()) {
          const message = await salon.messages.fetch(supprime.message_id);
          await message.delete();
        }
      } catch {
        // Message déjà supprimé : la ligne est partie, c'est ce qui compte.
      }
      await logAdminAction({
        action: "roles.menu.supprimer",
        adminId: admin.profileId,
        details: { menu: supprime.message_id },
        discordId: interaction.user.id,
        targetId: supprime.message_id,
        targetType: "bot_menus_roles",
      });
      await repondre(
        interaction,
        succes("Menu supprimé", "Les rôles déjà pris restent en place : supprimer un menu ne dépouille personne.", {
          prive: true,
        }),
      );
    } catch (err) {
      await repondre(interaction, echec("Suppression impossible", messagePanne(err)));
    }
  }
}

/**
 * Applique un plan de bascule à un membre.
 *
 * Chaque rôle est REVÉRIFIÉ juste avant d'être posé : un rôle peut avoir gagné
 * des permissions depuis son ajout au menu, et ce jour-là rien n'alerte
 * personne. Un rôle refusé est simplement sauté, et dit.
 */
async function appliquer(
  membre: GuildMember,
  aPoser: readonly string[],
  aRetirer: readonly string[],
  raison: string,
): Promise<{ poses: string[]; retires: string[]; refuses: string[] }> {
  const poses: string[] = [];
  const retires: string[] = [];
  const refuses: string[] = [];

  for (const roleId of aPoser) {
    const role = membre.guild.roles.cache.get(roleId);
    if (!role) {
      refuses.push(roleId);
      continue;
    }
    const verdict = verifierAttributionAutomatique(faitsDe(role), faitsBotDe(role));
    if (!verdict.ok) {
      console.warn(`[roles] libre-service refusé sur ${role.name} : ${verdict.motif}`);
      refuses.push(roleId);
      continue;
    }
    try {
      await membre.roles.add(roleId, raison);
      poses.push(roleId);
    } catch (err) {
      console.warn(`[roles] pose de ${roleId} impossible :`, err instanceof Error ? err.message : err);
      refuses.push(roleId);
    }
  }

  // Le retrait n'est PAS soumis à la même garde : rendre un rôle qu'on porte
  // déjà ne peut pas être un danger, et le refuser piégerait le membre avec un
  // rôle devenu sensible entre-temps.
  for (const roleId of aRetirer) {
    try {
      await membre.roles.remove(roleId, raison);
      retires.push(roleId);
    } catch (err) {
      console.warn(`[roles] retrait de ${roleId} impossible :`, err instanceof Error ? err.message : err);
    }
  }
  return { poses, refuses, retires };
}

/** Les composants des panneaux. Sans décorateur de commande — juste des clics. */
@Discord()
export class MenusRolesComposants {
  @SelectMenuComponent({ id: /^roles:menu:/ })
  async surMenu(interaction: StringSelectMenuInteraction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    try {
      const composant = lireComposant(interaction.customId);
      const menu = composant ? await menuDuMessage(composant.messageId) : null;
      const membre = interaction.member as GuildMember | null;
      if (!menu || !membre) {
        await interaction.editReply(echec("Menu introuvable", "Ce panneau n'est plus rattaché à aucun menu."));
        return;
      }

      const plan = planDeBascule(menu.entrees, interaction.values, [...membre.roles.cache.keys()], menu.choixMax);
      if (plan.tropDeChoix) {
        await interaction.editReply(
          attention("Trop de rôles", `Ce menu en autorise ${menu.choixMax} au maximum.`, { prive: true }),
        );
        return;
      }

      const resultat = await appliquer(membre, plan.aPoser, plan.aRetirer, `Menu de rôles « ${menu.titre} »`);
      await interaction.editReply(
        succes(
          "Rôles à jour",
          resumeBascule({
            aPoser: resultat.poses,
            aRetirer: resultat.retires,
            tropDeChoix: false,
          }) +
            (resultat.refuses.length > 0
              ? "\n\n⚠️ Un rôle de ce menu n'a pas pu être posé — le staff en est informé."
              : ""),
          { prive: true },
        ),
      );
    } catch (err) {
      await interaction.editReply(echec("Changement impossible", err instanceof Error ? err.message : String(err)));
    }
  }

  @ButtonComponent({ id: /^roles:bouton:/ })
  async surBouton(interaction: ButtonInteraction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    try {
      const composant = lireComposant(interaction.customId);
      const menu = composant ? await menuDuMessage(composant.messageId) : null;
      const membre = interaction.member as GuildMember | null;
      if (!menu || !membre || !composant?.roleId) {
        await interaction.editReply(echec("Menu introuvable", "Ce bouton n'est plus rattaché à aucun menu."));
        return;
      }

      const plan = planDeBouton(menu.entrees, composant.roleId, [...membre.roles.cache.keys()], menu.choixMax);
      const resultat = await appliquer(membre, plan.aPoser, plan.aRetirer, `Menu de rôles « ${menu.titre} »`);
      await interaction.editReply(
        succes(
          "Rôles à jour",
          resumeBascule({
            aPoser: resultat.poses,
            aRetirer: resultat.retires,
            tropDeChoix: false,
          }),
          { prive: true },
        ),
      );
    } catch (err) {
      await interaction.editReply(echec("Changement impossible", err instanceof Error ? err.message : String(err)));
    }
  }
}
