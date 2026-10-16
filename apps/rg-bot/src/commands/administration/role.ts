/**
 * `/administration role` — la distribution des rôles Discord.
 *
 * ── CE QUE CE FICHIER OUVRE ────────────────────────────────────────────────
 * Le bot porte la permission « Administrateur » sur le serveur Rose Griffon
 * depuis toujours, et ce pouvoir n'était exploité NULLE PART : distribuer un
 * rôle à 200 personnes se faisait à la main, un clic à la fois, dans la liste
 * des membres. Six verbes suffisent à couvrir le besoin réel — `donner`,
 * `retirer`, `creer`, `supprimer`, `renommer`, `masse`.
 *
 * ── POURQUOI LES RÔLES SONT LE CAS LE PLUS PIÉGEUX ─────────────────────────
 * Pour bannir, Discord compare le bot au MEMBRE visé. Pour un rôle, il compare
 * le bot au RÔLE : donner un rôle situé au-dessus du sien est refusé même quand
 * la personne visée vient d'arriver. Trois autres refus n'ont rien à voir avec
 * la hiérarchie et se ressemblent pourtant tous sous la forme d'un `50013` :
 * `@everyone` n'est pas attribuable, un rôle `managed` (posé par un bot, un
 * boost ou un abonnement) ne l'est pas non plus, et un rôle porteur
 * d'« Administrateur » ne doit jamais transiter par une commande de salon —
 * ce serait faire du jeton du bot un chemin d'escalade vers le serveur entier.
 * `empechementRole()` rejoue ces quatre règles AVANT l'appel, et
 * `expliquerEmpechementRole()` dit laquelle a mordu.
 *
 * ── POURQUOI L'OPTION `role` EST DU TEXTE, PAS UN `Role` ───────────────────
 * Une option de type `Role` afficherait un joli sélecteur… qui propose AUSSI
 * les rôles hors de portée. L'échec arriverait alors après coup, sous la forme
 * d'une erreur d'API. Discord n'autorise l'autocomplétion que sur du texte :
 * c'est le seul moyen de ne proposer QUE ce qui est réellement attribuable. La
 * valeur transportée reste un flocon (`extraireIdentifiantRole`), jamais un nom
 * — deux rôles peuvent porter le même, et « celui trouvé en premier » n'est pas
 * une cible acceptable pour une suppression.
 *
 * ── LA GOUVERNANCE, DANS CET ORDRE, SANS EXCEPTION ─────────────────────────
 *   a. droits Rose Griffon (`exigerDroits`, strict pour `supprimer` et `masse`) ;
 *   b. permissions réelles du bot (`permissionsManquantes`), nommées en clair ;
 *   c. hiérarchie et nature du rôle (`empechementRole`) ;
 *   d. bornes de saisie (nom, couleur de la charte, plafond de masse).
 *
 * ── LE RANG RG SUIT LE POUVOIR DISTRIBUÉ, PAS LA RÉVERSIBILITÉ ─────────────
 * `donner` est réversible, donc la garde ordinaire (`admin` OU `staff`) suffit…
 * tant que le rôle est décoratif. Un rôle qui porte « Bannir des membres » se
 * retire aussi, mais entre-temps son porteur a banni : un `staff` aurait donc pu
 * se procurer par le bas ce que `/administration moderation bannir` réserve au
 * rôle `admin`. `exigeRoleAdminRg` ferme ce passage — dès qu'un rôle accorde un
 * pouvoir sensible, le distribuer demande le rang `admin` ET une confirmation
 * qui nomme ce qui est accordé.
 *
 * Puis confirmation par bouton pour ce qui est irréversible, motif d'audit
 * Discord sur chaque appel qui l'accepte, trace en base (`admin_audit_log`), et
 * réponse toujours éphémère : le salon n'a pas à apprendre qui a demandé quoi.
 *
 * Aucune commande de ce fichier n'a été exécutée sur le serveur réel : ce qui
 * se vérifie est vérifié par les tests purs de `lib/discord-admin.test.ts` et
 * par les signatures lues dans les typages de discord.js 14.26.
 */
import { Discord, Slash, SlashChoice, SlashGroup, SlashOption } from "discordx";
import {
  ActionRowBuilder,
  ApplicationCommandOptionType,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
  PermissionFlagsBits,
  type AutocompleteInteraction,
  type ChatInputCommandInteraction,
  type EmbedBuilder,
  type Guild,
  type GuildMember,
  type Role,
} from "discord.js";

import { logAdminAction } from "../../lib/audit";
import {
  CHOIX_COULEUR_ROLE,
  codeErreurDiscord,
  dureeLisible,
  empechementRole,
  estMembreAbsent,
  exigeRoleAdminRg,
  expliquerCodeDiscord,
  expliquerEmpechementRole,
  extraireIdentifiantRole,
  LIMITE_NOM,
  MAX_MEMBRES_MASSE,
  MAX_PROPOSITIONS,
  motifAudit,
  normaliserNomRole,
  PAUSE_LOT_MASSE_MS,
  permissionsManquantes,
  permissionsSensibles,
  planifierMasse,
  resoudreCouleurRole,
  resumerMasse,
  TAILLE_LOT_MASSE,
  trierMembresPourRole,
} from "../../lib/discord-admin";
import { rgEmbed } from "../../lib/embeds";
import { borner, echapperMarkdown } from "../staff/format";
import { differerEnPrive, exigerDroits, messagePanne } from "../staff/garde";
import { analyserIdConfirmation, construireIdConfirmation } from "./valeurs";
import "./racine-moderation";
import { echec, pied, piedTexte, refus as accesRefuse, repondre } from "../../lib/ui";

/**
 * Délai laissé pour cliquer « Confirmer ».
 *
 * Une minute : assez pour relire l'écran de confirmation, trop court pour qu'un
 * bouton oublié serve de télécommande une demi-heure plus tard. Le jeton d'une
 * interaction vit 15 minutes ; on reste très loin de sa fin, donc l'annulation
 * par délai est toujours affichable.
 */
const DELAI_CONFIRMATION_MS = 60_000;

/** Un compte rendu de progression tous les dix lots, pas à chaque lot. */
const LOTS_PAR_COMPTE_RENDU = 10;

// ─── Contexte serveur ───────────────────────────────────────────────────────

interface ContexteServeur {
  readonly guilde: Guild;
  readonly bot: GuildMember;
  /** Position du rôle le plus haut du bot — la seule qui compte pour agir. */
  readonly positionBot: number;
}

/**
 * Résout le serveur, le membre « bot » et ses permissions réelles.
 *
 * Les permissions sont lues sur le MEMBRE, pas sur l'interaction :
 * `interaction.appPermissions` donne les permissions du bot DANS LE SALON, or
 * « Gérer les rôles » est une permission de serveur. Les confondre ferait
 * refuser une commande parfaitement légitime lancée depuis un salon restreint.
 *
 * @returns `null` quand le refus a déjà été envoyé.
 */
async function contexteServeur(interaction: ChatInputCommandInteraction): Promise<ContexteServeur | null> {
  const guilde = interaction.guild;
  if (!guilde) {
    await interaction.editReply({
      content: "🚫 Cette commande n'a de sens que sur le serveur : les rôles n'existent pas en message privé.",
    });
    return null;
  }
  const bot = guilde.members.me ?? (await guilde.members.fetchMe());
  const manquantes = permissionsManquantes(bot.permissions, "role");
  if (manquantes.length > 0) {
    await interaction.editReply({
      content:
        `🚫 Le bot ne peut pas toucher aux rôles de ce serveur. Permission(s) manquante(s) : ` +
        `**${manquantes.join(", ")}**. Ajoute-les au rôle du bot dans les paramètres du serveur — ` +
        "sans ça Discord répondrait un `50013` muet.",
    });
    return null;
  }
  return { guilde, bot, positionBot: bot.roles.highest.position };
}

type ResolutionRole = { readonly ok: true; readonly role: Role } | { readonly ok: false; readonly raison: string };

/** Retrouve le rôle désigné par l'option textuelle. */
async function lireRole(guilde: Guild, saisie: string): Promise<ResolutionRole> {
  const identifiant = extraireIdentifiantRole(saisie);
  if (!identifiant) {
    return {
      ok: false,
      raison:
        `« ${borner(echapperMarkdown(saisie), 60)} » n'est pas un rôle exploitable. Choisis une ` +
        "proposition dans la liste, ou colle l'identifiant du rôle (clic droit sur le rôle › " +
        "Copier l'identifiant).",
    };
  }
  // `RoleManager.fetch(id)` rend `Role | null` : un identifiant valide mais
  // inconnu (rôle supprimé entre l'autocomplétion et la validation) n'est pas
  // une erreur d'API, c'est un `null` qu'il faut traiter.
  const role = await guilde.roles.fetch(identifiant);
  if (!role) {
    return {
      ok: false,
      raison: `Aucun rôle \`${identifiant}\` sur ce serveur. Il a peut-être été supprimé entre-temps.`,
    };
  }
  return { ok: true, role };
}

/**
 * Vérifie que le bot a le droit de toucher à ce rôle.
 *
 * @returns la phrase de refus, ou `null` quand la voie est libre.
 */
function refusSurRole(contexte: ContexteServeur, role: Role): string | null {
  const empechement = empechementRole({
    estEveryone: role.id === contexte.guilde.roles.everyone.id,
    gereParIntegration: role.managed,
    estRoleDuBot: contexte.guilde.roles.botRoleFor(contexte.guilde.client.user)?.id === role.id,
    porteAdministration: role.permissions.has(PermissionFlagsBits.Administrator),
    positionRole: role.position,
    positionBot: contexte.positionBot,
  });
  return empechement === null ? null : expliquerEmpechementRole(empechement);
}

/**
 * Traduit une erreur de l'API en phrase utile.
 *
 * `expliquerCodeDiscord` couvre les codes que la modération croise vraiment ;
 * au-delà, on retombe sur le message brut plutôt que d'inventer une cause.
 */
function messageRefus(err: unknown): string {
  return expliquerCodeDiscord(codeErreurDiscord(err)) ?? messagePanne(err);
}

/** Récupère un membre, en distinguant « absent du serveur » d'une vraie panne. */
async function recupererMembre(guilde: Guild, identifiant: string): Promise<GuildMember | null> {
  try {
    return await guilde.members.fetch(identifiant);
  } catch (err) {
    if (estMembreAbsent(err)) {
      return null;
    }
    throw err;
  }
}

/** Comment un rôle s'écrit dans un accusé de réception. */
function decrireRole(role: Role): string {
  return `**${echapperMarkdown(borner(role.name, 80))}** (\`${role.id}\`, rang ${role.position})`;
}

/** L'auteur, tel qu'il apparaîtra dans le journal d'audit du serveur. */
function auteurAudit(interaction: ChatInputCommandInteraction): string {
  return `${interaction.user.username} (${interaction.user.id})`;
}

/**
 * Ce que ce rôle donnerait comme pouvoirs sur le serveur, en clair.
 *
 * `empechementRole` a déjà écarté « Administrateur ». Restent quatorze pouvoirs
 * qui n'en ont pas besoin pour faire des dégâts — bannir, expulser, gérer les
 * rôles, gérer le serveur, poser un webhook. Les nommer AVANT de distribuer est
 * la seule façon de ne pas transformer un « rôle de couleur » en promotion
 * silencieuse.
 */
function pouvoirsDuRole(role: Role): string[] {
  return permissionsSensibles(role.permissions);
}

/**
 * Ferme le contournement par le bas de la garde stricte.
 *
 * `/administration moderation bannir` exige le rôle Rose Griffon `admin`.
 * `/administration role donner` n'exigeait que `requireRgAdmin`, qui laisse
 * aussi passer `staff` — puisque donner un rôle se défait. Sauf qu'un `staff`
 * pouvait se donner un rôle portant « Bannir des membres », puis bannir depuis
 * l'interface de Discord : la garde stricte n'aurait jamais été affrontée, et la
 * trace en base dirait « role.donner ».
 *
 * @returns la phrase de refus, ou `null` quand le rang suffit.
 */
function refusRangInsuffisant(admin: { role: string }, pouvoirs: readonly string[]): string | null {
  if (pouvoirs.length === 0 || admin.role === "admin") {
    return null;
  }
  return (
    `Ce rôle accorde des pouvoirs sur le serveur : **${pouvoirs.join(", ")}**. Le distribuer ` +
    "revient à accorder ce que `/administration moderation` réserve au rôle Rose Griffon " +
    `\`admin\` — ton rôle est \`${admin.role}\`. Demande à un admin, ou distribue un rôle sans pouvoir.`
  );
}

// ─── Autocomplétion ─────────────────────────────────────────────────────────

/**
 * Propose les rôles du serveur.
 *
 * `gerablesSeulement` écarte tout ce sur quoi le bot ne peut RIEN : `@everyone`,
 * les rôles d'intégration, le sien, les rôles administrateurs et tout ce qui est
 * au-dessus de lui. C'est là que se joue la promesse de ce fichier — un refus
 * évité vaut mieux qu'un refus bien expliqué.
 *
 * L'autocomplétion n'a que 3 secondes et n'affiche aucune erreur : en cas de
 * pépin on rend une liste vide plutôt que de laisser l'appel se perdre.
 */
async function suggererRoles(interaction: AutocompleteInteraction, gerablesSeulement: boolean): Promise<void> {
  try {
    const guilde = interaction.guild;
    if (!guilde) {
      await interaction.respond([]);
      return;
    }
    const saisie = String(interaction.options.getFocused() ?? "")
      .trim()
      .toLowerCase();
    const bot = guilde.members.me;
    const positionBot = bot?.roles.highest.position ?? 0;
    const roleDuBot = guilde.roles.botRoleFor(guilde.client.user)?.id;

    const propositions = [...guilde.roles.cache.values()]
      .filter(role => {
        if (role.id === guilde.roles.everyone.id) {
          return false;
        }
        if (
          gerablesSeulement &&
          empechementRole({
            estEveryone: false,
            gereParIntegration: role.managed,
            estRoleDuBot: role.id === roleDuBot,
            porteAdministration: role.permissions.has(PermissionFlagsBits.Administrator),
            positionRole: role.position,
            positionBot,
          }) !== null
        ) {
          return false;
        }
        return saisie.length === 0 || role.name.toLowerCase().includes(saisie);
      })
      // Du plus haut au plus bas : c'est l'ordre de la liste des rôles du
      // serveur, celui que le staff a en tête.
      .toSorted((a, b) => b.position - a.position)
      .slice(0, MAX_PROPOSITIONS)
      .map(role => ({
        name: borner(`${role.name} — rang ${role.position}`, 100),
        value: role.id,
      }));
    await interaction.respond(propositions);
  } catch {
    // La réponse de repli peut échouer à son tour (l'appel a déjà été honoré,
    // ou les 3 secondes sont passées). Une exception ici deviendrait un rejet
    // non capturé qui ferait tomber le processus du bot pour une simple
    // autocomplétion : on l'absorbe.
    try {
      await interaction.respond([]);
    } catch {
      /* rien à faire : l'autocomplétion n'affiche aucune erreur au membre. */
    }
  }
}

// ─── Confirmation ───────────────────────────────────────────────────────────

/**
 * Demande une confirmation par bouton avant une action irréversible.
 *
 * L'identifiant du bouton est semé avec `interaction.id` : deux personnes qui
 * lancent la même suppression à la même seconde n'ont pas le même bouton, et le
 * filtre vérifie EN PLUS que celui qui clique est bien celui qui a demandé. La
 * réponse est éphémère, donc personne d'autre ne voit le bouton — mais s'en
 * remettre à ça serait faire de la confidentialité une mesure de sécurité.
 *
 * @returns `true` seulement si « oui » a été cliqué. Tout le reste — refus,
 *          délai dépassé — laisse le serveur intact et le dit.
 */
async function confirmer(
  interaction: ChatInputCommandInteraction,
  embed: EmbedBuilder,
  libelleAction: string,
): Promise<boolean> {
  const graine = interaction.id;
  const rangee = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(construireIdConfirmation("oui", graine))
      .setLabel(borner(libelleAction, 80))
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId(construireIdConfirmation("non", graine))
      .setLabel("Annuler")
      .setStyle(ButtonStyle.Secondary),
  );
  const message = await interaction.editReply({ embeds: [embed], components: [rangee] });
  try {
    const clic = await message.awaitMessageComponent({
      componentType: ComponentType.Button,
      time: DELAI_CONFIRMATION_MS,
      filter: bouton => {
        const lu = analyserIdConfirmation(bouton.customId);
        return lu !== null && lu.graine === graine && bouton.user.id === interaction.user.id;
      },
    });
    // `deferUpdate` accuse réception du clic sans rien changer à l'écran : sans
    // lui, Discord affiche « L'interaction a échoué » pendant que l'action
    // s'exécute pour de bon.
    await clic.deferUpdate();
    if (analyserIdConfirmation(clic.customId)?.reponse !== "oui") {
      await interaction.editReply({
        content: "Annulé. Rien n'a été modifié.",
        embeds: [],
        components: [],
      });
      return false;
    }
    await interaction.editReply({ components: [] });
    return true;
  } catch {
    // `awaitMessageComponent` rejette au bout du délai. On retire les boutons :
    // un bouton mort qui répond « L'interaction a échoué » laisse croire à une
    // panne alors que c'est une expiration normale.
    await interaction.editReply({
      content: `Délai dépassé (${DELAI_CONFIRMATION_MS / 1000} s sans réponse) : rien n'a été modifié.`,
      embeds: [],
      components: [],
    });
    return false;
  }
}

// ─── Commandes ──────────────────────────────────────────────────────────────

@Discord()
@SlashGroup({
  name: "role",
  description: "Distribution des rôles Discord : attribution, création, suppression",
  root: "moderation",
})
@SlashGroup("role", "moderation")
export class AdministrationRoleCommand {
  @Slash({ name: "donner", description: "Donne un rôle à un membre du serveur" })
  async donner(
    @SlashOption({
      name: "membre",
      description: "Membre qui reçoit le rôle",
      type: ApplicationCommandOptionType.User,
      required: true,
    })
    cible: { id: string },
    @SlashOption({
      name: "role",
      description: "Rôle à donner — seuls les rôles réellement attribuables sont proposés",
      type: ApplicationCommandOptionType.String,
      required: true,
      autocomplete: (interaction: AutocompleteInteraction) => suggererRoles(interaction, true),
    })
    roleSaisi: string,
    @SlashOption({
      name: "motif",
      description: "Motif inscrit au journal d'audit Discord et en base",
      type: ApplicationCommandOptionType.String,
      required: false,
    })
    motif: string | undefined,
    interaction: ChatInputCommandInteraction,
  ) {
    await differerEnPrive(interaction);
    const admin = await exigerDroits(interaction);
    if (!admin) {
      return;
    }
    try {
      const contexte = await contexteServeur(interaction);
      if (!contexte) {
        return;
      }
      const resolution = await lireRole(contexte.guilde, roleSaisi);
      if (!resolution.ok) {
        await repondre(interaction, accesRefuse(resolution.raison));
        return;
      }
      const role = resolution.role;
      const refus = refusSurRole(contexte, role);
      if (refus) {
        await repondre(interaction, accesRefuse(refus));
        return;
      }
      const membre = await recupererMembre(contexte.guilde, cible.id);
      if (!membre) {
        await interaction.editReply({
          content: "🚫 Ce compte n'est pas (ou plus) membre du serveur : il n'y a aucun rôle à lui donner.",
        });
        return;
      }
      if (membre.roles.cache.has(role.id)) {
        // L'API accepterait l'appel sans rien changer : une ligne d'audit pour
        // rien, et un accusé de réception qui laisse croire à un changement.
        await interaction.editReply({
          content: `<@${membre.id}> porte déjà le rôle ${decrireRole(role)}. Rien à faire.`,
        });
        return;
      }

      // Un rôle qui accorde des pouvoirs n'est pas une décoration : rang RG
      // `admin` exigé, et confirmation qui NOMME ce qui est accordé.
      const pouvoirs = pouvoirsDuRole(role);
      const refusRang = refusRangInsuffisant(admin, pouvoirs);
      if (refusRang) {
        await repondre(interaction, accesRefuse(refusRang));
        return;
      }
      if (exigeRoleAdminRg(role.permissions)) {
        const apercu = rgEmbed()
          .setTitle("Accorder ces pouvoirs ?")
          .setDescription(
            `${decrireRole(role)} → <@${membre.id}>\n\nCe rôle ne fait pas que colorer un pseudo : ` +
              "il accorde des pouvoirs sur le serveur, tout de suite, à ce membre.",
          )
          .addFields({ name: "Pouvoirs accordés", value: borner(pouvoirs.join("\n"), 1_000) });
        if (!(await confirmer(interaction, apercu, "Accorder ces pouvoirs"))) {
          return;
        }
      }

      const raison = motifAudit({ auteur: auteurAudit(interaction), motif });
      await membre.roles.add(role, raison);
      await logAdminAction({
        adminId: admin.profileId,
        discordId: admin.discordId,
        action: "role.donner",
        targetType: "discord_role",
        targetId: role.id,
        details: {
          role: role.name,
          membre: membre.id,
          motif: motif ?? null,
          pouvoirs: pouvoirs.length > 0 ? pouvoirs : null,
        },
      });

      const accuse = rgEmbed()
        .setTitle("Rôle attribué")
        .setDescription(`${decrireRole(role)} → <@${membre.id}>`)
        .addFields({ name: "Motif d'audit", value: borner(raison, 1_000) });
      if (pouvoirs.length > 0) {
        accuse.addFields({ name: "Pouvoirs accordés", value: borner(pouvoirs.join("\n"), 1_000) });
      }
      await interaction.editReply({ content: "", embeds: [accuse], components: [] });
    } catch (err) {
      // `components: []` : la confirmation des rôles à pouvoirs a pu poser des
      // boutons, et un bouton laissé sur un message d'erreur reste cliquable.
      await repondre(interaction, {
        components: [],
        ...echec("Action refusée", messageRefus(err)),
      });
    }
  }

  @Slash({ name: "retirer", description: "Retire un rôle à un membre du serveur" })
  async retirer(
    @SlashOption({
      name: "membre",
      description: "Membre qui perd le rôle",
      type: ApplicationCommandOptionType.User,
      required: true,
    })
    cible: { id: string },
    @SlashOption({
      name: "role",
      description: "Rôle à retirer — seuls les rôles réellement gérables sont proposés",
      type: ApplicationCommandOptionType.String,
      required: true,
      autocomplete: (interaction: AutocompleteInteraction) => suggererRoles(interaction, true),
    })
    roleSaisi: string,
    @SlashOption({
      name: "motif",
      description: "Motif inscrit au journal d'audit Discord et en base",
      type: ApplicationCommandOptionType.String,
      required: false,
    })
    motif: string | undefined,
    interaction: ChatInputCommandInteraction,
  ) {
    await differerEnPrive(interaction);
    const admin = await exigerDroits(interaction);
    if (!admin) {
      return;
    }
    try {
      const contexte = await contexteServeur(interaction);
      if (!contexte) {
        return;
      }
      const resolution = await lireRole(contexte.guilde, roleSaisi);
      if (!resolution.ok) {
        await repondre(interaction, accesRefuse(resolution.raison));
        return;
      }
      const role = resolution.role;
      const refus = refusSurRole(contexte, role);
      if (refus) {
        await repondre(interaction, accesRefuse(refus));
        return;
      }
      const membre = await recupererMembre(contexte.guilde, cible.id);
      if (!membre) {
        await interaction.editReply({
          content: "🚫 Ce compte n'est pas (ou plus) membre du serveur : il ne porte plus aucun rôle ici.",
        });
        return;
      }
      if (!membre.roles.cache.has(role.id)) {
        await interaction.editReply({
          content: `<@${membre.id}> ne porte pas le rôle ${decrireRole(role)}. Rien à faire.`,
        });
        return;
      }

      const raison = motifAudit({ auteur: auteurAudit(interaction), motif });
      await membre.roles.remove(role, raison);
      await logAdminAction({
        adminId: admin.profileId,
        discordId: admin.discordId,
        action: "role.retirer",
        targetType: "discord_role",
        targetId: role.id,
        details: { role: role.name, membre: membre.id, motif: motif ?? null },
      });

      await interaction.editReply({
        embeds: [
          rgEmbed()
            .setTitle("Rôle retiré")
            .setDescription(`${decrireRole(role)} ✕ <@${membre.id}>`)
            .addFields({ name: "Motif d'audit", value: borner(raison, 1_000) }),
        ],
      });
    } catch (err) {
      await repondre(interaction, echec("Action refusée", messageRefus(err)));
    }
  }

  @Slash({ name: "creer", description: "Crée un rôle aux couleurs de la charte Rose Griffon" })
  async creer(
    @SlashOption({
      name: "nom",
      description: "Nom du rôle (100 caractères au plus, accents et majuscules conservés)",
      type: ApplicationCommandOptionType.String,
      required: true,
    })
    nom: string,
    // La couleur ne s'écrit pas à la main : la liste vient de la charte
    // (`@rosegriffon/ui/tokens`), donc un rôle créé depuis Discord porte
    // exactement la teinte du site.
    @SlashChoice(...CHOIX_COULEUR_ROLE)
    @SlashOption({
      name: "couleur",
      description: "Couleur de la charte (par défaut : aucune, le rôle reste gris)",
      type: ApplicationCommandOptionType.String,
      required: false,
    })
    couleur: string | undefined,
    @SlashOption({
      name: "mentionnable",
      description: "Le rôle peut-il être mentionné par tout le monde ? (défaut : non)",
      type: ApplicationCommandOptionType.Boolean,
      required: false,
    })
    mentionnable: boolean | undefined,
    @SlashOption({
      name: "affiche-separement",
      description: "Afficher ses membres à part dans la liste du serveur ? (défaut : non)",
      type: ApplicationCommandOptionType.Boolean,
      required: false,
    })
    afficheSeparement: boolean | undefined,
    interaction: ChatInputCommandInteraction,
  ) {
    await differerEnPrive(interaction);
    const admin = await exigerDroits(interaction);
    if (!admin) {
      return;
    }
    try {
      const contexte = await contexteServeur(interaction);
      if (!contexte) {
        return;
      }
      const nomPropre = normaliserNomRole(nom);
      if (!nomPropre) {
        await interaction.editReply({
          content:
            `🚫 Nom de rôle refusé. Il doit tenir en ${LIMITE_NOM} caractères, ne pas être vide, ` +
            "et ne pas être `@everyone` ni `@here` (ce sont les mentions générales du serveur).",
        });
        return;
      }
      const teinte = resoudreCouleurRole(couleur);
      if (!teinte) {
        await interaction.editReply({
          content:
            "🚫 Couleur inconnue. Choisis une teinte de la charte dans la liste proposée : " +
            "un rôle d'une couleur inventée ne correspondrait à rien sur le site.",
        });
        return;
      }

      const raison = motifAudit({
        auteur: auteurAudit(interaction),
        motif: `Création du rôle ${nomPropre}`,
      });
      const role = await contexte.guilde.roles.create({
        name: nomPropre,
        // `colors.primaryColor`, pas `color` : `Role.setColor`/`RoleData.color`
        // sont dépréciés dans discord.js 14.26 au profit des trois teintes.
        colors: { primaryColor: teinte.entier },
        hoist: afficheSeparement ?? false,
        mentionable: mentionnable ?? false,
        // AUCUNE permission. Sans ce champ, Discord recopie celles de
        // `@everyone` : un rôle « décoratif » se retrouverait à porter tout ce
        // que le serveur accorde par défaut, sans que personne ne l'ait voulu.
        permissions: [],
        reason: raison,
      });

      await logAdminAction({
        adminId: admin.profileId,
        discordId: admin.discordId,
        action: "role.creer",
        targetType: "discord_role",
        targetId: role.id,
        details: {
          role: nomPropre,
          couleur: teinte.valeur,
          hoist: afficheSeparement ?? false,
          mentionnable: mentionnable ?? false,
        },
      });

      await interaction.editReply({
        embeds: [
          rgEmbed()
            .setTitle("Rôle créé")
            .setDescription(decrireRole(role))
            .addFields(
              { name: "Couleur", value: `${teinte.nom}`, inline: true },
              { name: "Mentionnable", value: role.mentionable ? "oui" : "non", inline: true },
              { name: "Affiché à part", value: role.hoist ? "oui" : "non", inline: true },
              {
                name: "Permissions",
                value:
                  "aucune — c'est un rôle d'affichage. Ajoute-lui des droits depuis les paramètres " +
                  "du serveur si besoin.",
              },
            )
            .setFooter(
              piedTexte({
                note: "Créé tout en bas de la liste des rôles : remonte-le à la main pour qu'il prenne le pas sur d'autres.",
              }),
            ),
        ],
      });
    } catch (err) {
      await repondre(interaction, echec("Action refusée", messageRefus(err)));
    }
  }

  @Slash({ name: "supprimer", description: "Supprime définitivement un rôle du serveur" })
  async supprimer(
    @SlashOption({
      name: "role",
      description: "Rôle à supprimer — irréversible, une confirmation sera demandée",
      type: ApplicationCommandOptionType.String,
      required: true,
      autocomplete: (interaction: AutocompleteInteraction) => suggererRoles(interaction, true),
    })
    roleSaisi: string,
    @SlashOption({
      name: "motif",
      description: "Motif inscrit au journal d'audit Discord et en base",
      type: ApplicationCommandOptionType.String,
      required: false,
    })
    motif: string | undefined,
    interaction: ChatInputCommandInteraction,
  ) {
    await differerEnPrive(interaction);
    // Irréversible : un rôle supprimé ne se restaure pas, et tous ceux qui le
    // portaient le perdent d'un coup. Garde stricte, pas la garde ordinaire.
    const admin = await exigerDroits(interaction, { strict: true });
    if (!admin) {
      return;
    }
    try {
      const contexte = await contexteServeur(interaction);
      if (!contexte) {
        return;
      }
      const resolution = await lireRole(contexte.guilde, roleSaisi);
      if (!resolution.ok) {
        await repondre(interaction, accesRefuse(resolution.raison));
        return;
      }
      const role = resolution.role;
      const refus = refusSurRole(contexte, role);
      if (refus) {
        await repondre(interaction, accesRefuse(refus));
        return;
      }

      // `role.members` se lit dans le cache des membres : sans ce chargement, un
      // rôle porté par 300 personnes s'annoncerait « 0 membre » et la
      // confirmation perdrait tout son sens.
      await contexte.guilde.members.fetch();
      const porteurs = role.members.size;

      const apercu = rgEmbed()
        .setTitle("Supprimer ce rôle ?")
        .setDescription(
          `${decrireRole(role)}\n\n**C'est irréversible.** Le rôle disparaît, et les ` +
            `**${porteurs}** membre(s) qui le portent le perdent immédiatement. Ni le nom, ni la ` +
            "couleur, ni les permissions ne peuvent être restaurés.",
        )
        .addFields(
          { name: "Porté par", value: `${porteurs} membre(s)`, inline: true },
          { name: "Rang", value: String(role.position), inline: true },
          { name: "Couleur", value: role.hexColor, inline: true },
        );
      if (!(await confirmer(interaction, apercu, "Supprimer définitivement"))) {
        return;
      }

      const raison = motifAudit({ auteur: auteurAudit(interaction), motif });
      const nomAvant = role.name;
      await role.delete(raison);
      await logAdminAction({
        adminId: admin.profileId,
        discordId: admin.discordId,
        action: "role.supprimer",
        targetType: "discord_role",
        targetId: role.id,
        details: { role: nomAvant, porteurs, motif: motif ?? null },
      });

      await interaction.editReply({
        content: "",
        embeds: [
          rgEmbed()
            .setTitle("Rôle supprimé")
            .setDescription(
              `**${echapperMarkdown(borner(nomAvant, 80))}** (\`${role.id}\`) n'existe plus. ` +
                `${porteurs} membre(s) l'ont perdu.`,
            )
            .addFields({ name: "Motif d'audit", value: borner(raison, 1_000) }),
        ],
        components: [],
      });
    } catch (err) {
      await repondre(interaction, {
        components: [],
        ...echec("Action refusée", messageRefus(err)),
      });
    }
  }

  @Slash({ name: "renommer", description: "Change le nom d'un rôle" })
  async renommer(
    @SlashOption({
      name: "role",
      description: "Rôle à renommer",
      type: ApplicationCommandOptionType.String,
      required: true,
      autocomplete: (interaction: AutocompleteInteraction) => suggererRoles(interaction, true),
    })
    roleSaisi: string,
    @SlashOption({
      name: "nom",
      description: "Nouveau nom (100 caractères au plus)",
      type: ApplicationCommandOptionType.String,
      required: true,
    })
    nom: string,
    interaction: ChatInputCommandInteraction,
  ) {
    await differerEnPrive(interaction);
    const admin = await exigerDroits(interaction);
    if (!admin) {
      return;
    }
    try {
      const contexte = await contexteServeur(interaction);
      if (!contexte) {
        return;
      }
      const resolution = await lireRole(contexte.guilde, roleSaisi);
      if (!resolution.ok) {
        await repondre(interaction, accesRefuse(resolution.raison));
        return;
      }
      const role = resolution.role;
      const refus = refusSurRole(contexte, role);
      if (refus) {
        await repondre(interaction, accesRefuse(refus));
        return;
      }
      const nomPropre = normaliserNomRole(nom);
      if (!nomPropre) {
        await interaction.editReply({
          content:
            `🚫 Nom de rôle refusé. Il doit tenir en ${LIMITE_NOM} caractères, ne pas être vide, ` +
            "et ne pas être `@everyone` ni `@here`.",
        });
        return;
      }
      const nomAvant = role.name;
      if (nomAvant === nomPropre) {
        await interaction.editReply({
          content: `Ce rôle s'appelle déjà **${echapperMarkdown(borner(nomPropre, 80))}**. Rien à faire.`,
        });
        return;
      }

      const raison = motifAudit({
        auteur: auteurAudit(interaction),
        motif: `Renommage « ${nomAvant} » → « ${nomPropre} »`,
      });
      await role.setName(nomPropre, raison);
      await logAdminAction({
        adminId: admin.profileId,
        discordId: admin.discordId,
        action: "role.renommer",
        targetType: "discord_role",
        targetId: role.id,
        details: { avant: nomAvant, apres: nomPropre },
      });

      await interaction.editReply({
        embeds: [
          rgEmbed()
            .setTitle("Rôle renommé")
            .setDescription(
              `\`${echapperMarkdown(borner(nomAvant, 80))}\` → ` +
                `**${echapperMarkdown(borner(nomPropre, 80))}** (\`${role.id}\`)`,
            ),
        ],
      });
    } catch (err) {
      await repondre(interaction, echec("Action refusée", messageRefus(err)));
    }
  }

  @Slash({
    name: "masse",
    description: "Donne un rôle à tous les porteurs d'un autre rôle (simulation par défaut)",
  })
  async masse(
    @SlashOption({
      name: "role-source",
      description: "Rôle qui désigne les membres concernés (jamais modifié)",
      type: ApplicationCommandOptionType.String,
      required: true,
      // La source n'est que LUE : un rôle d'intégration ou un rôle au-dessus du
      // bot désigne parfaitement un ensemble de membres, on ne le filtre pas.
      autocomplete: (interaction: AutocompleteInteraction) => suggererRoles(interaction, false),
    })
    sourceSaisie: string,
    @SlashOption({
      name: "role-a-donner",
      description: "Rôle attribué à chacun d'eux",
      type: ApplicationCommandOptionType.String,
      required: true,
      autocomplete: (interaction: AutocompleteInteraction) => suggererRoles(interaction, true),
    })
    cibleSaisie: string,
    @SlashOption({
      name: "simulation",
      description: "VRAI (défaut) : compte les membres sans rien écrire. FAUX : distribue vraiment.",
      type: ApplicationCommandOptionType.Boolean,
      required: false,
    })
    simulation: boolean | undefined,
    interaction: ChatInputCommandInteraction,
  ) {
    await differerEnPrive(interaction);
    // L'opération la plus lourde du bot : des centaines d'écritures d'un coup.
    // Garde stricte même en simulation — savoir combien de membres portent quel
    // rôle est déjà une information d'exploitation.
    const admin = await exigerDroits(interaction, { strict: true });
    if (!admin) {
      return;
    }
    // Une option booléenne non fournie vaut `undefined`, pas `false` : sans ce
    // défaut explicite, oublier l'option lancerait la distribution RÉELLE.
    const enSimulation = simulation ?? true;
    try {
      const contexte = await contexteServeur(interaction);
      if (!contexte) {
        return;
      }
      const source = await lireRole(contexte.guilde, sourceSaisie);
      if (!source.ok) {
        await interaction.editReply({ content: `🚫 Rôle source : ${source.raison}` });
        return;
      }
      const destination = await lireRole(contexte.guilde, cibleSaisie);
      if (!destination.ok) {
        await interaction.editReply({ content: `🚫 Rôle à donner : ${destination.raison}` });
        return;
      }
      if (source.role.id === destination.role.id) {
        await interaction.editReply({
          content: "🚫 Le rôle source et le rôle à donner sont le même : l'opération n'aurait aucun effet.",
        });
        return;
      }
      // Seul le rôle DONNÉ est modifié : c'est lui, et lui seul, qui doit être à
      // portée du bot.
      const refus = refusSurRole(contexte, destination.role);
      if (refus) {
        await interaction.editReply({ content: `🚫 Rôle à donner : ${refus}` });
        return;
      }

      // Une seule requête à la passerelle, puis tout se lit dans le cache.
      const tousLesMembres = await contexte.guilde.members.fetch();
      const porteurs = [...tousLesMembres.values()].filter(membre => membre.roles.cache.has(source.role.id));
      const tri = trierMembresPourRole(
        porteurs.map(membre => ({ id: membre.id, roles: [...membre.roles.cache.keys()] })),
        destination.role.id,
        "donner",
      );
      const plan = planifierMasse(tri.aTraiter.length);

      const entete =
        `Source : ${decrireRole(source.role)} — **${porteurs.length}** porteur(s)\n` +
        `À donner : ${decrireRole(destination.role)}`;

      if (plan.aTraiter === 0) {
        await interaction.editReply({
          embeds: [
            rgEmbed()
              .setTitle("Rien à distribuer")
              .setDescription(
                `${entete}\n\nLes **${tri.sansChangement.length}** porteur(s) du rôle source ont ` +
                  "déjà le rôle à donner. Aucun appel n'a été fait.",
              ),
          ],
        });
        return;
      }

      const apercu = rgEmbed()
        .setTitle(enSimulation ? "Simulation — rien n'a été écrit" : "Distribuer ce rôle en masse ?")
        .setDescription(entete)
        .addFields(
          { name: "Membres à traiter", value: `**${plan.aTraiter}**`, inline: true },
          { name: "Déjà pourvus", value: String(tri.sansChangement.length), inline: true },
          {
            name: "Cadence",
            value: `${TAILLE_LOT_MASSE} par lot, ${PAUSE_LOT_MASSE_MS / 1000} s de pause — ${plan.lots} lot(s)`,
            inline: true,
          },
          {
            name: "Durée minimale",
            value: `${dureeLisible(plan.dureeMinimaleMs)} (hors temps de réponse de l'API)`,
            inline: true,
          },
        );
      // Distribuer un rôle à pouvoirs à des centaines de personnes d'un coup est
      // la façon la plus rapide de perdre le contrôle d'un serveur. La garde
      // stricte est déjà passée ; reste à ne pas le faire sans l'avoir lu.
      const pouvoirs = pouvoirsDuRole(destination.role);
      if (pouvoirs.length > 0) {
        apercu.addFields({
          name: "⚠ Pouvoirs accordés à CHAQUE membre",
          value: borner(pouvoirs.join("\n"), 1_000),
        });
      }
      if (plan.plafonne) {
        apercu.addFields({
          name: "⚠ Plafond atteint",
          value:
            `Seuls les **${MAX_MEMBRES_MASSE}** premiers seront traités, **${plan.ignores}** ` +
            "resteront pour une relance. Au-delà, l'opération dépasserait la durée de vie d'une " +
            "interaction Discord.",
        });
      }

      if (enSimulation) {
        pied(apercu, {
          note: "Relance avec simulation:Faux pour distribuer réellement.",
        });
        await interaction.editReply({ embeds: [apercu] });
        return;
      }
      if (!(await confirmer(interaction, apercu, `Distribuer à ${plan.aTraiter} membre(s)`))) {
        return;
      }

      const raison = motifAudit({
        auteur: auteurAudit(interaction),
        motif: `Distribution en masse depuis « ${source.role.name} »`,
      });
      const debut = Date.now();
      const aFaire = tri.aTraiter.slice(0, plan.aTraiter);
      let reussis = 0;
      let echecs = 0;

      for (let debutLot = 0; debutLot < aFaire.length; debutLot += TAILLE_LOT_MASSE) {
        const lot = aFaire.slice(debutLot, debutLot + TAILLE_LOT_MASSE);
        // `allSettled`, pas `all` : un membre parti entre le chargement et
        // l'écriture ne doit pas interrompre les 495 suivants.
        const resultats = await Promise.allSettled(
          lot.map(async identifiant => {
            const membre = tousLesMembres.get(identifiant);
            if (!membre) {
              throw new Error("membre disparu du cache");
            }
            await membre.roles.add(destination.role, raison);
          }),
        );
        for (const resultat of resultats) {
          if (resultat.status === "fulfilled") {
            reussis += 1;
          } else {
            echecs += 1;
          }
        }

        const lotsFaits = Math.floor(debutLot / TAILLE_LOT_MASSE) + 1;
        const reste = debutLot + TAILLE_LOT_MASSE < aFaire.length;
        if (reste && lotsFaits % LOTS_PAR_COMPTE_RENDU === 0) {
          // Un compte rendu régulier vaut mieux qu'un silence de trois minutes,
          // mais un par lot brûlerait le quota d'édition de l'interaction.
          await interaction.editReply({
            content: `Distribution en cours — ${reussis + echecs}/${aFaire.length} membre(s) traités…`,
            embeds: [],
          });
        }
        if (reste) {
          // La pause EST la protection contre les 429 : une rafale de 500
          // requêtes ferait suspendre le JETON, donc le bot entier.
          await Bun.sleep(PAUSE_LOT_MASSE_MS);
        }
      }

      const dureeMs = Date.now() - debut;
      await logAdminAction({
        adminId: admin.profileId,
        discordId: admin.discordId,
        action: "role.masse",
        targetType: "discord_role",
        targetId: destination.role.id,
        details: {
          source: source.role.id,
          source_nom: source.role.name,
          role: destination.role.name,
          pouvoirs: pouvoirs.length > 0 ? pouvoirs : null,
          reussis,
          echecs,
          deja_pourvus: tri.sansChangement.length,
          ignores: plan.ignores,
          duree_ms: dureeMs,
        },
      });

      await interaction.editReply({
        content: "",
        embeds: [
          rgEmbed()
            .setTitle("Distribution terminée")
            .setDescription(entete)
            .addFields({
              name: "Bilan",
              value: borner(
                resumerMasse({
                  reussis,
                  echecs,
                  sansChangement: tri.sansChangement.length,
                  ignores: plan.ignores,
                  dureeMs,
                }),
                1_000,
              ),
            }),
        ],
        components: [],
      });
    } catch (err) {
      await repondre(interaction, {
        components: [],
        ...echec("Action refusée", messageRefus(err)),
      });
    }
  }
}
