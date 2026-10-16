/**
 * `/administration moderation` — les pouvoirs Discord du bot, enfin exercés.
 *
 * ── CE QUE CETTE COMMANDE OUVRE ────────────────────────────────────────────
 * Le bot porte la permission « Administrateur » sur le serveur Rose Griffon
 * depuis toujours, et ce pouvoir n'était exploité NULLE PART : aucune commande
 * ne bannissait, n'expulsait, n'excluait. Toute la modération passait donc par
 * l'interface de Discord, sans trace dans `admin_audit_log`, sans motif imposé,
 * et sans que le rôle Rose Griffon de la personne qui sanctionne compte pour
 * quoi que ce soit.
 *
 * ── DEUX « BANNIR » QUI N'ONT RIEN À VOIR ──────────────────────────────────
 * ⚠ `/administration moderation bannir` bannit du **serveur Discord**.
 * `/administration utilisateur bannir` bannit le **compte sur rosegriffon.fr**
 * (`profiles.role = 'banned'`). Ce sont deux sanctions distinctes, sur deux
 * surfaces distinctes : quelqu'un peut être banni du Discord et garder son
 * compte du site, et l'inverse. La confusion entre les deux est exactement ce
 * que l'arbre de commandes précédent produisait ; les descriptions le disent
 * donc en toutes lettres, et l'option `aussi-le-compte` existe pour faire les
 * deux d'un coup QUAND c'est vraiment ce qu'on veut.
 *
 * ── L'ORDRE DES VÉRIFICATIONS N'EST PAS NÉGOCIABLE ─────────────────────────
 *   a. droits Rose Griffon (`requireRgAdmin` / `requireRgAdminStrict`) — être
 *      administrateur DISCORD ne donne aucun droit ici, et réciproquement ;
 *   b. permissions réelles du bot (`permissionsManquantes`) — on nomme ce qui
 *      manque au lieu de laisser Discord répondre un `50013` muet ;
 *   c. hiérarchie (`empechementHierarchie`) — le rôle du bot doit être
 *      STRICTEMENT au-dessus de la cible, le propriétaire est intouchable ;
 *   d. bornes de saisie (durée d'exclusion, jours de purge).
 * Chacune de ces quatre étapes est vérifiée AVANT l'appel à l'API : après, un
 * bannissement ne se rejoue pas.
 *
 * ── LA TRACE EST DOUBLE, TOUJOURS ──────────────────────────────────────────
 * `motifAudit()` part en `reason` vers le journal d'audit du serveur (sans quoi
 * Discord n'affiche que « Rose Griffon » pour toutes les sanctions, et personne
 * ne sait plus qui a demandé quoi) ET `logAdminAction()` écrit la ligne dans
 * `admin_audit_log`. Une sanction sans trace n'existe pas.
 *
 * ── LA NOTIFICATION PRIVÉE PART AVANT LA SANCTION ──────────────────────────
 * Un bannissement retire le serveur commun, et Discord refuse ensuite d'ouvrir
 * le salon privé (`50007`). Le message part donc TOUJOURS avant l'appel, jamais
 * après : sinon la personne est bannie sans jamais savoir pourquoi, et le
 * recours devient impossible. L'échec de la remise n'annule pas la sanction —
 * il est simplement dit dans l'accusé de réception.
 */
import { Discord, Slash, SlashGroup, SlashOption } from "discordx";
import {
  ActionRowBuilder,
  ApplicationCommandOptionType,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
  type AutocompleteInteraction,
  type ChatInputCommandInteraction,
  type EmbedBuilder,
  type Guild,
  type GuildMember,
  type User,
} from "discord.js";

import { logAdminAction } from "../../lib/audit";
import { cached, invalidate } from "../../lib/cache";
import { sql } from "../../lib/db";
import {
  analyserDuree,
  codeErreurDiscord,
  dureeLisible,
  empechementHierarchie,
  empechementMessagePrive,
  estBannissementInexistant,
  estMembreAbsent,
  expliquerCodeDiscord,
  expliquerEmpechement,
  filtrerBannis,
  MAX_EXCLUSION_MS,
  MAX_JOURS_PURGE_BANNISSEMENT,
  messageSanctionPrivee,
  motifAudit,
  permissionsManquantes,
  secondesPurgeBannissement,
  type ActionDiscord,
  type BanniAffichable,
  type SanctionNotifiee,
} from "../../lib/discord-admin";
import { rgEmbed, truncate } from "../../lib/embeds";
import type { ActionModeration } from "../../lib/sanctions";
import { publierAuJournal } from "../../services/journal-moderation";
import { borner, echapperMarkdown, horodatageRelatif } from "../staff/format";
import { differerEnPrive, exigerDroits, messagePanne, type RgAdmin } from "../staff/garde";
import {
  analyserIdConfirmation,
  construireIdConfirmation,
  estIdentifiantDiscord,
  nomAffichable,
  verifierActionSurProfil,
  type ProfilAffichable,
} from "./valeurs";
import "./racine-moderation";
import { echec, piedTexte, refus as accesRefuse, repondre } from "../../lib/ui";

/** Délai laissé pour confirmer une action irréversible. */
const DELAI_CONFIRMATION_MS = 60_000;

/**
 * Cache de la liste des bannis, pour l'autocomplétion de `debannir`.
 *
 * `guild.bans.fetch()` interroge l'API à chaque appel, et l'autocomplétion doit
 * répondre en moins de 3 secondes à CHAQUE frappe. Sans cache, taper huit
 * lettres déclenche huit appels et finit par se faire limiter en débit — le
 * champ reste alors bloqué sur « chargement… ».
 */
const TTL_BANNIS_MS = 60_000;

function clefBannis(guildId: string): string {
  return `administration:moderation:bannis:${guildId}`;
}

/** La cible d'une action de modération, membre du serveur ou non. */
interface Cible {
  /** Flocon Discord. C'est la seule chose dont l'API a besoin pour bannir. */
  readonly id: string;
  /** Nom lisible (`user.tag`), ou l'identifiant brut si le compte est inconnu. */
  readonly etiquette: string;
  /** Le membre, quand il est encore sur le serveur. `null` sinon. */
  readonly membre: GuildMember | null;
  /** Le compte, même parti du serveur. `null` si Discord ne le connaît plus. */
  readonly utilisateur: User | null;
}

/**
 * Résout un identifiant en cible.
 *
 * ── LE CAS FRÉQUENT QUE PERSONNE NE GÈRE ───────────────────────────────────
 * On bannit très souvent quelqu'un qui vient JUSTEMENT de quitter le serveur
 * pour échapper à la sanction : `guild.members.fetch()` échoue alors avec
 * `10007 Unknown Member`, alors que `guild.bans.create()` accepte parfaitement
 * un identifiant seul. Renoncer sur l'échec du premier appel reviendrait à
 * refuser une action que l'API autorise.
 *
 * `guild.members.fetch(options: UserResolvable | FetchMemberOptions | …):
 * Promise<GuildMember>` et `client.users.fetch(user: UserResolvable,
 * options?: BaseFetchOptions): Promise<User>` (discord.js 14.26.4).
 */
async function resoudreCible(guild: Guild, identifiant: string): Promise<Cible> {
  let membre: GuildMember | null = null;
  try {
    membre = await guild.members.fetch(identifiant);
  } catch (err) {
    if (!estMembreAbsent(err)) {
      throw err;
    }
  }
  if (membre) {
    return { id: membre.id, etiquette: membre.user.tag, membre, utilisateur: membre.user };
  }
  let utilisateur: User | null = null;
  try {
    utilisateur = await guild.client.users.fetch(identifiant);
  } catch (err) {
    if (!estMembreAbsent(err)) {
      throw err;
    }
  }
  return {
    id: utilisateur?.id ?? identifiant,
    etiquette: utilisateur?.tag ?? identifiant,
    membre: null,
    utilisateur,
  };
}

/**
 * Vérifie les permissions du bot PUIS la hiérarchie, et rend la phrase de refus.
 *
 * `null` signifie « rien ne bloque ». L'ordre compte : annoncer « le rôle du bot
 * est trop bas » à un bot qui n'a même pas la permission de bannir enverrait
 * corriger la mauvaise chose.
 *
 * Pour une cible absente du serveur, il n'existe aucun rôle à comparer : on lui
 * donne la position `-1`, strictement sous le `@everyone` du bot. Restent les
 * garde-fous qui ne dépendent pas des rôles — le propriétaire, soi-même, le bot.
 */
function refusPouvoirs(opts: {
  action: ActionDiscord;
  guild: Guild;
  moi: GuildMember;
  auteurId: string;
  cible: Cible;
}): string | null {
  const manquantes = permissionsManquantes(opts.moi.permissions.bitfield, opts.action);
  if (manquantes.length > 0) {
    return (
      `Le bot n'a pas les permissions nécessaires sur ce serveur : ` +
      `**${manquantes.join(", ")}**. Ajoute-les au rôle du bot dans les paramètres du serveur.`
    );
  }
  const empechement = empechementHierarchie({
    positionBot: opts.moi.roles.highest.position,
    positionCible: opts.cible.membre?.roles.highest.position ?? -1,
    cibleProprietaire: opts.guild.ownerId === opts.cible.id,
    cibleEstAuteur: opts.auteurId === opts.cible.id,
    cibleEstBot: opts.cible.id === opts.moi.id,
  });
  return empechement ? expliquerEmpechement(empechement) : null;
}

/** Résultat de la remise d'une notification privée, tel qu'il s'affiche. */
async function notifier(
  destinataire: User | null,
  sanction: SanctionNotifiee,
  serveur: string,
  motif: string,
  dureeMs?: number | null,
): Promise<string> {
  if (!destinataire) {
    return "impossible — Discord ne connaît plus ce compte";
  }
  try {
    // `User.send(options: string | MessagePayload | MessageCreateOptions):
    // Promise<Message>` (héritée de `PartialTextBasedChannelFields`).
    await destinataire.send(messageSanctionPrivee({ sanction, serveur, motif, dureeMs }));
    return "remise";
  } catch (err) {
    return expliquerCodeDiscord(codeErreurDiscord(err)) ?? "non remise (Discord a refusé l'envoi)";
  }
}

/**
 * Demande une confirmation par bouton et rend la décision.
 *
 * `true` = confirmé, `false` = annulé, `null` = personne n'a répondu à temps.
 *
 * ── POURQUOI LA GRAINE ─────────────────────────────────────────────────────
 * `construireIdConfirmation(reponse, graine)` porte l'identifiant de
 * l'interaction d'origine. La réponse est éphémère, donc seule la personne qui a
 * lancé la commande la voit — mais deux commandes lancées coup sur coup par la
 * même personne produiraient deux messages aux boutons identiques, et le clic
 * sur l'un pourrait résoudre l'autre. Le filtre exige donc à la fois la bonne
 * personne ET la bonne graine.
 */
async function confirmer(
  interaction: ChatInputCommandInteraction,
  embed: EmbedBuilder,
  libelleAction: string,
): Promise<boolean | null> {
  const graine = interaction.id;
  const message = await interaction.editReply({
    embeds: [embed],
    components: [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(construireIdConfirmation("oui", graine))
          .setLabel(libelleAction)
          .setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
          .setCustomId(construireIdConfirmation("non", graine))
          .setLabel("Annuler")
          .setStyle(ButtonStyle.Secondary),
      ),
    ],
  });

  try {
    // `Message.awaitMessageComponent<ComponentType>(options?:
    // AwaitMessageCollectorOptionsParams<ComponentType, InGuild>):
    // Promise<MappedInteractionTypes<InGuild>[ComponentType]>` (14.26.4).
    const bouton = await message.awaitMessageComponent<ComponentType.Button>({
      componentType: ComponentType.Button,
      time: DELAI_CONFIRMATION_MS,
      filter: candidat => {
        const decode = analyserIdConfirmation(candidat.customId);
        return candidat.user.id === interaction.user.id && decode !== null && decode.graine === graine;
      },
    });
    // `deferUpdate()` accuse réception du clic sans rien réécrire : la suite
    // passe par `editReply` sur l'interaction d'origine, donc le message reste
    // unique du début à la fin.
    await bouton.deferUpdate();
    return analyserIdConfirmation(bouton.customId)?.reponse === "oui";
  } catch {
    // `awaitMessageComponent` lève sur expiration du délai — ce n'est pas une
    // panne : c'est un refus par défaut, ce qu'on veut pour une action
    // irréversible.
    return null;
  }
}

/** Retire les boutons et affiche le verdict final sur le même message. */
async function conclure(interaction: ChatInputCommandInteraction, embed: EmbedBuilder): Promise<void> {
  await interaction.editReply({ embeds: [embed], components: [] });
}

/**
 * Bannit aussi le compte du site, quand `aussi-le-compte` est demandé.
 *
 * ── LA COLONNE RÉELLE ──────────────────────────────────────────────────────
 * `profiles` n'a AUCUNE colonne dédiée au bannissement (relevé du 13/8/2026 :
 * 20 colonnes, aucune `banned_at` ni `is_banned`). Le bannissement du site est
 * la valeur `banned` de `profiles.role` — c'est ce qu'écrivent l'administration
 * du site (`apps/website/src/app/api/admin/users/[id]/route.ts`) et le tableau
 * de bord d'Azalée dans Website. On écrit donc
 * la même chose, pas une colonne inventée.
 *
 * Rend la phrase à afficher : l'échec du bannissement de compte n'annule jamais
 * le bannissement Discord, qui a déjà eu lieu.
 */
async function bannirLeCompte(admin: RgAdmin, discordId: string): Promise<string> {
  try {
    return await bannirLeCompteOuLever(admin, discordId);
  } catch (err) {
    // Le bannissement Discord, lui, a déjà eu lieu : une base injoignable ne
    // doit pas transformer un succès partiel en « ❌ » global.
    return `compte **non** banni — la base n'a pas répondu : ${messagePanne(err)}`;
  }
}

async function bannirLeCompteOuLever(admin: RgAdmin, discordId: string): Promise<string> {
  const profils = await sql<ProfilAffichable[]>`
		SELECT id::text, username, full_name, role, discord_id
		FROM profiles
		WHERE discord_id = ${discordId}
		LIMIT 1
	`;
  const profil = profils[0];
  if (!profil) {
    return "aucun compte rosegriffon.fr n'est lié à ce Discord";
  }
  const verdict = verifierActionSurProfil({
    acteurProfileId: admin.profileId,
    cibleProfileId: profil.id,
    roleCible: profil.role,
    nouveauRole: "banned",
  });
  if (!verdict.autorise) {
    return `compte **non** banni — ${verdict.raison}`;
  }
  await sql`
		UPDATE profiles
		   SET role = 'banned', updated_at = NOW()
		 WHERE id::text = ${profil.id}
	`;
  const alerte = await tracer({
    adminId: admin.profileId,
    discordId: admin.discordId,
    action: "profil.banni",
    targetType: "profile",
    targetId: profil.id,
    details: {
      discord_id: discordId,
      role_avant: profil.role,
      role_apres: "banned",
      origine: "administration.moderation.bannir",
    },
  });
  const banni = `compte **${echapperMarkdown(nomAffichable(profil))}** banni du site (rôle \`${profil.role ?? "user"}\` → \`banned\`)`;
  return alerte ? `${banni}\n⚠ ${alerte}` : banni;
}

/** Charge la liste des bannis du serveur, mise en cache pour l'autocomplétion. */
async function chargerBannis(guild: Guild): Promise<BanniAffichable[]> {
  return await cached(clefBannis(guild.id), TTL_BANNIS_MS, async () => {
    // `GuildBanManager.fetch(options?: FetchBansOptions):
    // Promise<Collection<Snowflake, GuildBan>>` — `limit` plafonne à 1000,
    // ce qui couvre très largement un serveur de ~1 984 membres.
    const bannis = await guild.bans.fetch({ limit: 1_000 });
    return bannis.map(banni => ({
      id: banni.user.id,
      etiquette: banni.user.tag,
      motif: banni.reason ?? null,
    }));
  });
}

/** Autocomplétion de `debannir` : les comptes réellement bannis, et eux seuls. */
async function proposerBannis(interaction: AutocompleteInteraction): Promise<void> {
  try {
    const guild = interaction.guild;
    if (!guild) {
      await interaction.respond([]);
      return;
    }
    const bannis = await chargerBannis(guild);
    await interaction.respond(filtrerBannis(bannis, interaction.options.getFocused()));
  } catch {
    // Une autocomplétion qui lève laisse le champ figé sur « chargement… ».
    await interaction.respond([]);
  }
}

/** Le contexte commun à toutes les sous-commandes, ou le refus déjà envoyé. */
interface Contexte {
  readonly admin: RgAdmin;
  readonly guild: Guild;
  readonly moi: GuildMember;
}

/**
 * Diffère, vérifie les droits Rose Griffon, et résout le bot lui-même.
 *
 * `guild.members.fetchMe(options?: BaseFetchOptions): Promise<GuildMember>` —
 * `guild.members.me` peut être `null` tant que le membre n'est pas en cache,
 * et lire ses permissions sur un `null` ferait planter la commande sur une
 * question de cache, pas de droits.
 */
async function ouvrir(
  interaction: ChatInputCommandInteraction,
  options: { strict?: boolean } = {},
): Promise<Contexte | null> {
  await differerEnPrive(interaction);
  const admin = await exigerDroits(interaction, options);
  if (!admin) {
    return null;
  }
  const guild = interaction.guild;
  if (!guild) {
    await interaction.editReply({
      content: "Cette commande n'a de sens que sur un serveur, pas en message privé.",
    });
    return null;
  }
  const moi = await guild.members.fetchMe();
  return { admin, guild, moi };
}

/** Traduit une panne d'API en phrase utile, sans jamais poser de pile d'appels. */
function messageApi(err: unknown): string {
  return expliquerCodeDiscord(codeErreurDiscord(err)) ?? messagePanne(err);
}

/**
 * Écrit la ligne d'audit sans jamais faire échouer l'accusé de réception.
 *
 * ── POURQUOI CE N'EST PAS UN `await` NU ────────────────────────────────────
 * L'écriture d'audit arrive APRÈS l'appel qui sanctionne. Si elle levait, le
 * `catch` de la commande répondrait « ❌ … » alors que le bannissement, lui, a
 * bien eu lieu : la personne qui sanctionne croirait que rien ne s'est passé,
 * relancerait, lirait « déjà banni », et n'aurait plus aucune idée de l'état
 * réel. Une sanction appliquée s'annonce donc TOUJOURS comme appliquée, et le
 * défaut de trace est dit à part, en clair, parce qu'il faut alors le consigner
 * à la main.
 *
 * ⚠ `lib/audit.ts` avale aujourd'hui ses propres erreurs (un `console.error`
 * et rien de plus) : cette garde ne se déclenchera donc que le jour où il les
 * laissera remonter — ce qu'il devrait faire, sans quoi une sanction peut rester
 * hors du journal sans que personne ne l'apprenne. Le fichier est hors du
 * périmètre de cette unité, la garde est posée du bon côté en attendant.
 *
 * Rend `null` quand tout s'est bien passé, la phrase d'alerte sinon.
 */
async function tracer(entree: Parameters<typeof logAdminAction>[0]): Promise<string | null> {
  try {
    await logAdminAction(entree);
    return null;
  } catch (err) {
    return (
      `L'action a bien été menée à son terme, mais elle n'a PAS pu être écrite dans ` +
      `\`admin_audit_log\` : ${messagePanne(err)}. Consigne-la à la main.`
    );
  }
}

/**
 * Consigne une action de modération — la table ET le salon, jamais l'une sans
 * l'autre.
 *
 * ── POURQUOI CETTE FONCTION PLUTÔT QUE DEUX APPELS ─────────────────────────
 * `admin_audit_log` est la SOURCE (elle se requête, elle survit à la purge d'un
 * salon, le site la lit) ; le salon de journal en est la LECTURE, celle qui
 * arrive au staff sans qu'il la demande. Tant que les deux étaient deux appels
 * distincts, la sous-commande suivante n'en écrivait qu'un — c'est exactement
 * ce qui s'est produit : six actions consignaient en base, aucune ne publiait
 * nulle part, et le reste du staff apprenait les sanctions par la personne
 * sanctionnée.
 *
 * Les trois détails communs (`etiquette`, `motif`, `guilde`) sont posés ICI :
 * ils étaient recopiés à l'identique dans les six appels, donc oubliables un à
 * un. Chaque appelante ne fournit plus que ce qui lui est propre.
 *
 * Rend `null` quand tout s'est bien passé, sinon les phrases d'alerte à
 * afficher dans l'accusé de réception — une action déjà appliquée ne se rejoue
 * pas, la seule chose utile est de dire ce qui n'a PAS été écrit.
 */
async function consigner(contexte: Contexte, entree: ActionAConsigner): Promise<string | null> {
  const alerteAudit = await tracer({
    adminId: contexte.admin.profileId,
    discordId: contexte.admin.discordId,
    action: entree.action,
    targetType: "discord_user",
    targetId: entree.cibleId,
    details: {
      etiquette: entree.cibleEtiquette,
      motif: entree.motif,
      guilde: contexte.guild.id,
      ...entree.details,
    },
  });
  const alerteSalon = await publierAuJournal(contexte.guild.client, contexte.guild.id, {
    action: entree.action,
    cibleId: entree.cibleId,
    cibleEtiquette: entree.cibleEtiquette,
    parQui: contexte.admin.discordId,
    motif: entree.motif,
    precisions: entree.precisions,
  });
  const alertes = [alerteAudit, alerteSalon].filter((alerte): alerte is string => alerte !== null);
  return alertes.length === 0 ? null : alertes.join("\n");
}

/** Ce qu'une sous-commande a à dire d'une action, une fois qu'elle est faite. */
interface ActionAConsigner {
  action: ActionModeration;
  cibleId: string;
  cibleEtiquette: string;
  /** Motif saisi par le staff. `null` seulement si l'action n'en demande pas. */
  motif: string | null;
  /** Précisions affichées au salon : durée, purge, remise du message privé. */
  precisions?: ReadonlyArray<{ nom: string; valeur: string | null } | null>;
  /** Détails supplémentaires de la ligne d'audit (valeurs machine). */
  details: Record<string, unknown>;
}

/** Ajoute le champ d'alerte du journal, quand il y a quelque chose à dire. */
function ajouterAlerteJournal(embed: EmbedBuilder, alerte: string | null): EmbedBuilder {
  return alerte ? embed.addFields({ name: "⚠ Journal Rose Griffon", value: truncate(alerte, 1_000) }) : embed;
}

@Discord()
@SlashGroup({
  name: "moderation",
  description: "Modération du SERVEUR DISCORD : bannir, expulser, exclure, avertir",
  root: "moderation",
})
@SlashGroup("moderation", "moderation")
export class AdministrationModerationCommand {
  @Slash({
    name: "bannir",
    description: "Bannir du SERVEUR DISCORD (≠ bannir le compte du site : voir /administration utilisateur)",
  })
  async bannir(
    @SlashOption({
      name: "membre",
      description: "Membre à bannir — accepte aussi l'identifiant d'un compte déjà parti du serveur",
      type: ApplicationCommandOptionType.User,
      required: true,
    })
    qui: { id: string },
    @SlashOption({
      name: "motif",
      description: "Motif inscrit au journal d'audit Discord ET dans le journal Rose Griffon",
      type: ApplicationCommandOptionType.String,
      required: true,
    })
    motif: string,
    @SlashOption({
      name: "jours-messages",
      description: "Effacer ses messages des N derniers jours (0 à 7, 0 par défaut)",
      type: ApplicationCommandOptionType.Integer,
      required: false,
      minValue: 0,
      maxValue: MAX_JOURS_PURGE_BANNISSEMENT,
    })
    joursMessages: number | undefined,
    @SlashOption({
      name: "aussi-le-compte",
      description: "Bannir EN PLUS son compte rosegriffon.fr (profiles.role = banned)",
      type: ApplicationCommandOptionType.Boolean,
      required: false,
    })
    aussiLeCompte: boolean | undefined,
    interaction: ChatInputCommandInteraction,
  ) {
    // Bannir est irréversible du point de vue des messages purgés : garde
    // stricte, `staff` ne suffit pas.
    const contexte = await ouvrir(interaction, { strict: true });
    if (!contexte) {
      return;
    }
    try {
      const jours = joursMessages ?? 0;
      const secondes = secondesPurgeBannissement(jours);
      if (secondes === null) {
        await interaction.editReply({
          content: `La purge de messages va de 0 à ${MAX_JOURS_PURGE_BANNISSEMENT} jours. Discord n'accepte rien d'autre.`,
        });
        return;
      }

      const cible = await resoudreCible(contexte.guild, qui.id);
      const refus = refusPouvoirs({
        action: "bannir",
        guild: contexte.guild,
        moi: contexte.moi,
        auteurId: interaction.user.id,
        cible,
      });
      if (refus) {
        await repondre(interaction, accesRefuse(refus));
        return;
      }

      // Bannir quelqu'un de déjà banni ne fait rien mais écrit quand même une
      // ligne d'audit : on lit l'état avant.
      try {
        // `GuildBanManager.fetch(options: UserResolvable | FetchBanOptions):
        // Promise<GuildBan>` — lève `10026 Unknown Ban` s'il n'y en a pas.
        const dejaBanni = await contexte.guild.bans.fetch({ user: cible.id, force: true });
        const motifOrigine = dejaBanni.reason ? ` (motif : ${echapperMarkdown(borner(dejaBanni.reason, 200))})` : "";
        await interaction.editReply({
          content: `**${echapperMarkdown(cible.etiquette)}** est déjà banni de ce serveur${motifOrigine}. Rien n'a été fait.`,
        });
        return;
      } catch (err) {
        if (!estBannissementInexistant(err)) {
          throw err;
        }
      }

      const apercu = rgEmbed()
        .setTitle("Confirmer le bannissement Discord")
        .setDescription(
          `**${echapperMarkdown(cible.etiquette)}** — <@${cible.id}>\n\`${cible.id}\`${
            cible.membre ? "" : "\n*Ce compte n'est plus sur le serveur : le bannissement l'empêchera de revenir.*"
          }`,
        )
        .addFields(
          { name: "Motif", value: truncate(motif, 1_000) },
          {
            name: "Messages effacés",
            value: jours === 0 ? "aucun" : `les ${jours} derniers jours`,
            inline: true,
          },
          {
            name: "Compte rosegriffon.fr",
            value: aussiLeCompte ? "banni également" : "non touché",
            inline: true,
          },
        )
        .setFooter(piedTexte({ note: "Action irréversible · 60 secondes pour confirmer" }));

      const decision = await confirmer(interaction, apercu, "Bannir");
      if (decision === null) {
        await conclure(
          interaction,
          rgEmbed()
            .setTitle("Bannissement abandonné")
            .setDescription("Personne n'a confirmé dans les 60 secondes. Rien n'a été fait."),
        );
        return;
      }
      if (!decision) {
        await conclure(interaction, rgEmbed().setTitle("Bannissement annulé").setDescription("Rien n'a été fait."));
        return;
      }

      const raison = motifAudit({ auteur: interaction.user.tag, motif });
      // La notification part AVANT : après le bannissement, il n'y a plus de
      // serveur commun et Discord refuse d'ouvrir le salon privé.
      const remise = await notifier(cible.utilisateur, "bannissement", contexte.guild.name, motif);

      // `GuildBanManager.create(user: UserResolvable, options?: BanOptions):
      // Promise<GuildMember | User | Snowflake>` — `BanOptions` porte
      // `deleteMessageSeconds` (`deleteMessageDays` est déprécié) et `reason`.
      await contexte.guild.bans.create(cible.id, {
        deleteMessageSeconds: secondes,
        reason: raison,
      });
      invalidate(clefBannis(contexte.guild.id));

      const compte = aussiLeCompte ? await bannirLeCompte(contexte.admin, cible.id) : "non touché";

      const alerteJournal = await consigner(contexte, {
        action: "discord.bannir",
        cibleId: cible.id,
        cibleEtiquette: cible.etiquette,
        motif,
        precisions: [
          { nom: "Messages effacés", valeur: jours === 0 ? "aucun" : `les ${jours} derniers jours` },
          { nom: "Message privé", valeur: remise },
          { nom: "Compte rosegriffon.fr", valeur: aussiLeCompte ? "banni également" : null },
        ],
        details: {
          jours_messages: jours,
          etait_membre: cible.membre !== null,
          aussi_le_compte: aussiLeCompte === true,
        },
      });

      await conclure(
        interaction,
        ajouterAlerteJournal(
          rgEmbed()
            .setTitle("Bannissement Discord appliqué")
            .setDescription(`**${echapperMarkdown(cible.etiquette)}** — \`${cible.id}\``)
            .addFields(
              { name: "Motif", value: truncate(motif, 1_000) },
              {
                name: "Messages effacés",
                value: jours === 0 ? "aucun" : `les ${jours} derniers jours`,
                inline: true,
              },
              { name: "Notification privée", value: remise, inline: true },
              { name: "Compte rosegriffon.fr", value: truncate(compte, 1_000) },
            )
            .setFooter(
              piedTexte({
                note: "Journal d'audit Discord + admin_audit_log · lever avec /administration moderation debannir",
              }),
            ),
          alerteJournal,
        ),
      );
    } catch (err) {
      await repondre(interaction, {
        components: [],
        ...echec("Discord a refusé l'action", messageApi(err)),
      });
    }
  }

  @Slash({
    name: "debannir",
    description: "Lever un bannissement du SERVEUR DISCORD",
  })
  async debannir(
    @SlashOption({
      name: "identifiant",
      description: "Compte banni (autocomplété depuis la liste réelle des bannis) ou son identifiant",
      type: ApplicationCommandOptionType.String,
      required: true,
      autocomplete: proposerBannis,
    })
    identifiant: string,
    @SlashOption({
      name: "motif",
      description: "Pourquoi la sanction est levée — inscrit dans les deux journaux",
      type: ApplicationCommandOptionType.String,
      required: true,
    })
    motif: string,
    interaction: ChatInputCommandInteraction,
  ) {
    // Lever un bannissement est réversible (on peut re-bannir) : la garde
    // ordinaire suffit, contrairement à `bannir`.
    const contexte = await ouvrir(interaction);
    if (!contexte) {
      return;
    }
    try {
      const saisie = identifiant.trim();
      if (!estIdentifiantDiscord(saisie)) {
        await interaction.editReply({
          content:
            `« ${truncate(saisie, 80)} » n'est pas un identifiant Discord (17 à 20 chiffres). ` +
            "Utilise l'autocomplétion : elle ne propose que des comptes réellement bannis.",
        });
        return;
      }

      const manquantes = permissionsManquantes(contexte.moi.permissions.bitfield, "bannir");
      if (manquantes.length > 0) {
        await repondre(
          interaction,
          accesRefuse(`Le bot n'a pas la permission **${manquantes.join(", ")}** sur ce serveur.`),
        );
        return;
      }

      let etiquette = saisie;
      let motifOrigine: string | null = null;
      try {
        const banni = await contexte.guild.bans.fetch({ user: saisie, force: true });
        etiquette = banni.user.tag;
        motifOrigine = banni.reason ?? null;
      } catch (err) {
        if (estBannissementInexistant(err)) {
          await interaction.editReply({
            content: `Aucun bannissement en cours pour \`${saisie}\` sur ce serveur. Rien n'a été fait.`,
          });
          return;
        }
        throw err;
      }

      // `GuildBanManager.remove(user: UserResolvable, reason?: string):
      // Promise<User | null>` — rend `null` si Discord ne résout pas le compte.
      await contexte.guild.bans.remove(saisie, motifAudit({ auteur: interaction.user.tag, motif }));
      invalidate(clefBannis(contexte.guild.id));

      const alerteJournal = await consigner(contexte, {
        action: "discord.debannir",
        cibleId: saisie,
        cibleEtiquette: etiquette,
        motif,
        precisions: [{ nom: "Motif du bannissement levé", valeur: motifOrigine }],
        details: { motif_du_bannissement: motifOrigine },
      });

      await interaction.editReply({
        embeds: [
          ajouterAlerteJournal(
            rgEmbed()
              .setTitle("Bannissement levé")
              .setDescription(`**${echapperMarkdown(etiquette)}** — \`${saisie}\``)
              .addFields(
                { name: "Motif de la levée", value: truncate(motif, 1_000) },
                {
                  name: "Motif du bannissement d'origine",
                  value: motifOrigine ? truncate(motifOrigine, 1_000) : "*aucun motif enregistré*",
                },
              )
              .setFooter(
                piedTexte({
                  note: "Le compte peut revenir avec une invitation · il n'est pas réinvité automatiquement",
                }),
              ),
            alerteJournal,
          ),
        ],
      });
    } catch (err) {
      await repondre(interaction, echec("Discord a refusé l'action", messageApi(err)));
    }
  }

  @Slash({
    name: "expulser",
    description: "Expulser du SERVEUR DISCORD (le membre peut revenir avec une invitation)",
  })
  async expulser(
    @SlashOption({
      name: "membre",
      description: "Membre à expulser — il doit être présent sur le serveur",
      type: ApplicationCommandOptionType.User,
      required: true,
    })
    qui: { id: string },
    @SlashOption({
      name: "motif",
      description: "Motif inscrit au journal d'audit Discord ET dans le journal Rose Griffon",
      type: ApplicationCommandOptionType.String,
      required: true,
    })
    motif: string,
    interaction: ChatInputCommandInteraction,
  ) {
    const contexte = await ouvrir(interaction, { strict: true });
    if (!contexte) {
      return;
    }
    try {
      const cible = await resoudreCible(contexte.guild, qui.id);
      if (!cible.membre) {
        await interaction.editReply({
          content:
            `**${echapperMarkdown(cible.etiquette)}** n'est pas sur le serveur : il n'y a rien à expulser. ` +
            "Pour l'empêcher de revenir, utilise `/administration moderation bannir`.",
        });
        return;
      }
      const refus = refusPouvoirs({
        action: "expulser",
        guild: contexte.guild,
        moi: contexte.moi,
        auteurId: interaction.user.id,
        cible,
      });
      if (refus) {
        await repondre(interaction, accesRefuse(refus));
        return;
      }

      const apercu = rgEmbed()
        .setTitle("Confirmer l'expulsion")
        .setDescription(`**${echapperMarkdown(cible.etiquette)}** — <@${cible.id}>\n\`${cible.id}\``)
        .addFields(
          { name: "Motif", value: truncate(motif, 1_000) },
          {
            name: "Sur le serveur depuis",
            value: horodatageRelatif(cible.membre.joinedAt),
            inline: true,
          },
        )
        .setFooter(
          piedTexte({
            note: "L'expulsion retire le membre et ses rôles · 60 secondes pour confirmer",
          }),
        );

      const decision = await confirmer(interaction, apercu, "Expulser");
      if (decision === null) {
        await conclure(
          interaction,
          rgEmbed()
            .setTitle("Expulsion abandonnée")
            .setDescription("Personne n'a confirmé dans les 60 secondes. Rien n'a été fait."),
        );
        return;
      }
      if (!decision) {
        await conclure(interaction, rgEmbed().setTitle("Expulsion annulée").setDescription("Rien n'a été fait."));
        return;
      }

      const remise = await notifier(cible.utilisateur, "expulsion", contexte.guild.name, motif);
      // `GuildMember.kick(reason?: string): Promise<GuildMember>` (14.26.4).
      await cible.membre.kick(motifAudit({ auteur: interaction.user.tag, motif }));

      const alerteJournal = await consigner(contexte, {
        action: "discord.expulser",
        cibleId: cible.id,
        cibleEtiquette: cible.etiquette,
        motif,
        precisions: [{ nom: "Message privé", valeur: remise }],
        details: {},
      });

      await conclure(
        interaction,
        ajouterAlerteJournal(
          rgEmbed()
            .setTitle("Expulsion appliquée")
            .setDescription(`**${echapperMarkdown(cible.etiquette)}** — \`${cible.id}\``)
            .addFields(
              { name: "Motif", value: truncate(motif, 1_000) },
              { name: "Notification privée", value: remise, inline: true },
            )
            .setFooter(
              piedTexte({
                note: "Le membre peut revenir avec une invitation · pour l'en empêcher, bannis-le",
              }),
            ),
          alerteJournal,
        ),
      );
    } catch (err) {
      await repondre(interaction, {
        components: [],
        ...echec("Discord a refusé l'action", messageApi(err)),
      });
    }
  }

  @Slash({
    name: "exclure",
    description: "Exclure temporairement : le membre reste, mais ne peut plus écrire ni parler",
  })
  async exclure(
    @SlashOption({
      name: "membre",
      description: "Membre à exclure temporairement",
      type: ApplicationCommandOptionType.User,
      required: true,
    })
    qui: { id: string },
    @SlashOption({
      name: "duree",
      description: "Durée : 10m, 1h30m, 7j… — 28 jours au maximum (plafond de l'API Discord)",
      type: ApplicationCommandOptionType.String,
      required: true,
    })
    duree: string,
    @SlashOption({
      name: "motif",
      description: "Motif inscrit au journal d'audit Discord ET dans le journal Rose Griffon",
      type: ApplicationCommandOptionType.String,
      required: true,
    })
    motif: string,
    interaction: ChatInputCommandInteraction,
  ) {
    // Une exclusion se lève en une commande : garde ordinaire.
    const contexte = await ouvrir(interaction);
    if (!contexte) {
      return;
    }
    try {
      const millisecondes = analyserDuree(duree);
      if (millisecondes === null) {
        await interaction.editReply({
          content:
            `Durée « ${truncate(duree, 60)} » illisible ou hors bornes. ` +
            `Écris par exemple \`10m\`, \`1h30m\`, \`7j\` — jusqu'à ${dureeLisible(MAX_EXCLUSION_MS)}, ` +
            "plafond imposé par Discord.",
        });
        return;
      }

      const cible = await resoudreCible(contexte.guild, qui.id);
      if (!cible.membre) {
        await interaction.editReply({
          content: `**${echapperMarkdown(cible.etiquette)}** n'est pas sur le serveur : on ne peut exclure que quelqu'un de présent.`,
        });
        return;
      }
      const refus = refusPouvoirs({
        action: "exclure",
        guild: contexte.guild,
        moi: contexte.moi,
        auteurId: interaction.user.id,
        cible,
      });
      if (refus) {
        await repondre(interaction, accesRefuse(refus));
        return;
      }

      const exclusionEnCours = cible.membre.communicationDisabledUntil;
      const remise = await notifier(cible.utilisateur, "exclusion", contexte.guild.name, motif, millisecondes);
      // `GuildMember.timeout(timeout: number | null, reason?: string):
      // Promise<GuildMember>` — la durée est en millisecondes, `null` lève
      // l'exclusion (voir `lever-exclusion`).
      const apres = await cible.membre.timeout(millisecondes, motifAudit({ auteur: interaction.user.tag, motif }));

      const alerteJournal = await consigner(contexte, {
        action: "discord.exclure",
        cibleId: cible.id,
        cibleEtiquette: cible.etiquette,
        motif,
        precisions: [
          { nom: "Durée", valeur: dureeLisible(millisecondes) },
          { nom: "Fin", valeur: horodatageRelatif(apres.communicationDisabledUntil) },
          { nom: "Message privé", valeur: remise },
        ],
        details: {
          duree_saisie: duree,
          duree_ms: millisecondes,
          fin: apres.communicationDisabledUntil?.toISOString() ?? null,
          exclusion_precedente: exclusionEnCours?.toISOString() ?? null,
        },
      });

      const embed = rgEmbed()
        .setTitle("Exclusion temporaire appliquée")
        .setDescription(`**${echapperMarkdown(cible.etiquette)}** — <@${cible.id}>`)
        .addFields(
          { name: "Durée", value: dureeLisible(millisecondes), inline: true },
          { name: "Fin", value: horodatageRelatif(apres.communicationDisabledUntil), inline: true },
          { name: "Notification privée", value: remise, inline: true },
          { name: "Motif", value: truncate(motif, 1_000) },
        )
        .setFooter(piedTexte({ note: "Lever avant terme : /moderation moderation lever-exclusion" }));
      ajouterAlerteJournal(embed, alerteJournal);
      if (exclusionEnCours) {
        embed.addFields({
          name: "Exclusion remplacée",
          value: `Une exclusion courait déjà jusqu'à ${horodatageRelatif(exclusionEnCours)} : la nouvelle durée l'écrase.`,
        });
      }
      await interaction.editReply({ embeds: [embed] });
    } catch (err) {
      await repondre(interaction, echec("Discord a refusé l'action", messageApi(err)));
    }
  }

  @Slash({
    // Seul nom de sous-commande collé du dépôt : `leverexclusion` se lit mal et
    // se tape mal. Kebab-case, comme partout ailleurs.
    name: "lever-exclusion",
    description: "Lever une exclusion temporaire avant son terme",
  })
  async leverexclusion(
    @SlashOption({
      name: "membre",
      description: "Membre dont l'exclusion doit être levée",
      type: ApplicationCommandOptionType.User,
      required: true,
    })
    qui: { id: string },
    @SlashOption({
      name: "motif",
      description: "Pourquoi l'exclusion est levée — inscrit dans les deux journaux",
      type: ApplicationCommandOptionType.String,
      required: true,
    })
    motif: string,
    interaction: ChatInputCommandInteraction,
  ) {
    const contexte = await ouvrir(interaction);
    if (!contexte) {
      return;
    }
    try {
      const cible = await resoudreCible(contexte.guild, qui.id);
      if (!cible.membre) {
        await interaction.editReply({
          content: `**${echapperMarkdown(cible.etiquette)}** n'est pas sur le serveur : il n'y a aucune exclusion à lever.`,
        });
        return;
      }
      const refus = refusPouvoirs({
        action: "exclure",
        guild: contexte.guild,
        moi: contexte.moi,
        auteurId: interaction.user.id,
        cible,
      });
      if (refus) {
        await repondre(interaction, accesRefuse(refus));
        return;
      }

      // `GuildMember.isCommunicationDisabled(): this is GuildMember & {…}` —
      // lever une exclusion qui n'existe pas écrirait une ligne d'audit pour
      // rien, et laisserait croire qu'une sanction a été annulée.
      const fin = cible.membre.communicationDisabledUntil;
      if (!cible.membre.isCommunicationDisabled()) {
        await interaction.editReply({
          content: `**${echapperMarkdown(cible.etiquette)}** n'est pas exclu actuellement. Rien n'a été fait.`,
        });
        return;
      }

      // `timeout(null, reason)` lève l'exclusion : c'est la forme documentée,
      // il n'existe pas de méthode `removeTimeout`.
      await cible.membre.timeout(null, motifAudit({ auteur: interaction.user.tag, motif }));

      const alerteJournal = await consigner(contexte, {
        action: "discord.lever-exclusion",
        cibleId: cible.id,
        cibleEtiquette: cible.etiquette,
        motif,
        precisions: [{ nom: "Elle devait courir jusqu'à", valeur: horodatageRelatif(fin) }],
        details: { fin_prevue: fin?.toISOString() ?? null },
      });

      await interaction.editReply({
        embeds: [
          ajouterAlerteJournal(
            rgEmbed()
              .setTitle("Exclusion levée")
              .setDescription(`**${echapperMarkdown(cible.etiquette)}** — <@${cible.id}>`)
              .addFields(
                { name: "Motif de la levée", value: truncate(motif, 1_000) },
                {
                  name: "Elle devait courir jusqu'à",
                  value: horodatageRelatif(fin),
                  inline: true,
                },
              )
              .setFooter(piedTexte({ note: "Le membre peut de nouveau écrire, réagir et parler en vocal" })),
            alerteJournal,
          ),
        ],
      });
    } catch (err) {
      await repondre(interaction, echec("Discord a refusé l'action", messageApi(err)));
    }
  }

  @Slash({
    name: "avertir",
    description: "Avertir en privé : aucune sanction Discord, mais une trace dans le journal",
  })
  async avertir(
    @SlashOption({
      name: "membre",
      description: "Membre à avertir",
      type: ApplicationCommandOptionType.User,
      required: true,
    })
    qui: { id: string },
    @SlashOption({
      name: "motif",
      description: "Ce qui est reproché — le texte est envoyé tel quel au membre",
      type: ApplicationCommandOptionType.String,
      required: true,
    })
    motif: string,
    interaction: ChatInputCommandInteraction,
  ) {
    const contexte = await ouvrir(interaction);
    if (!contexte) {
      return;
    }
    try {
      const cible = await resoudreCible(contexte.guild, qui.id);
      // Un avertissement n'exerce AUCUN pouvoir Discord : ni permission du bot,
      // ni hiérarchie à vérifier. Restent les deux cas absurdes.
      const empechement = empechementMessagePrive({
        cibleEstAuteur: interaction.user.id === cible.id,
        cibleEstBot: cible.id === contexte.moi.id,
      });
      if (empechement) {
        await repondre(interaction, accesRefuse(expliquerEmpechement(empechement)));
        return;
      }
      if (!cible.utilisateur) {
        await interaction.editReply({
          content: "Discord ne connaît plus ce compte : aucun message ne peut lui être remis.",
        });
        return;
      }

      const remise = await notifier(cible.utilisateur, "avertissement", contexte.guild.name, motif);
      const transmis = remise === "remise";

      // L'avertissement est consigné MÊME si le message privé n'a pas pu être
      // remis : c'est la trace qui compte pour la suite (une récidive se juge
      // sur l'historique), et le staff doit savoir que la personne n'a pas été
      // prévenue.
      const alerteJournal = await consigner(contexte, {
        action: "discord.avertir",
        cibleId: cible.id,
        cibleEtiquette: cible.etiquette,
        motif,
        precisions: [
          { nom: "Message privé", valeur: remise },
          { nom: "Sur le serveur", valeur: cible.membre ? null : "non — compte parti" },
        ],
        details: {
          message_prive_remis: transmis,
          sur_le_serveur: cible.membre !== null,
        },
      });

      await interaction.editReply({
        embeds: [
          ajouterAlerteJournal(
            rgEmbed()
              .setTitle(transmis ? "Avertissement envoyé" : "Avertissement consigné, non remis")
              .setDescription(`**${echapperMarkdown(cible.etiquette)}** — <@${cible.id}>`)
              .addFields(
                { name: "Motif", value: truncate(motif, 1_000) },
                { name: "Message privé", value: remise, inline: true },
                {
                  name: "Sanction Discord",
                  value: "aucune — le membre garde tous ses droits",
                  inline: true,
                },
              )
              .setFooter(
                piedTexte({
                  note: transmis
                    ? "Consigné dans admin_audit_log · aucune trace côté Discord (ce n'est pas une sanction)"
                    : "Consigné dans admin_audit_log · le membre n'a PAS été prévenu, préviens-le autrement",
                }),
              ),
            alerteJournal,
          ),
        ],
      });
    } catch (err) {
      await repondre(interaction, echec("Discord a refusé l'action", messageApi(err)));
    }
  }
}
