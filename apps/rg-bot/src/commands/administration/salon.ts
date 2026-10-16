/**
 * `/administration salon` — la tenue des salons du serveur.
 *
 * ── CE QUE CETTE COMMANDE OUVRE ────────────────────────────────────────────
 * Le bot porte la permission « Administrateur » sur le serveur Rose Griffon
 * depuis toujours, et AUCUNE commande ne s'en servait pour tenir les salons :
 * créer, renommer, verrouiller le temps d'une crise, poser un mode lent, purger
 * un flood, publier une annonce signée, supprimer un salon mort — tout cela se
 * faisait à la main, sans trace, et donc sans possibilité de dire six mois plus
 * tard qui avait fait quoi.
 *
 * ── LES CINQ PIÈGES QUE CE FICHIER TRAITE AVANT L'APPEL ────────────────────
 *
 *  1. **`bulkDelete` ment par omission.** Il refuse tout message de plus de
 *     quatorze jours et travaille par lots de 2 à 100. Demander « 100 » dans un
 *     salon calme en supprime souvent une poignée, sans que l'API ne dise rien.
 *     `purger` calcule donc le chiffre RÉEL avant d'agir (`resumerPurge`), le
 *     montre, et ne l'annonce jamais comme une purge complète. Le filtre par
 *     auteur s'applique AVANT le plafond de 100 : sinon « les 50 derniers
 *     messages de X » ne regarderait que les 50 derniers messages du salon,
 *     dont deux seraient peut-être de X.
 *
 *  2. **Verrouiller n'est pas supprimer.** `verrouiller` pose une surcharge de
 *     permission sur `@everyone`, il n'efface rien. Mais la permission
 *     « Envoyer des messages » a TROIS états, pas deux : autorisée, refusée, ou
 *     absente (héritée de la catégorie). Remettre « autorisée » au
 *     déverrouillage OUVRIRAIT un salon que la catégorie tenait fermé. L'état
 *     d'avant est donc archivé dans `admin_audit_log`, et `deverrouiller` le
 *     relit pour rendre exactement celui-là.
 *
 *  3. **Discord réécrit le nom qu'on lui donne — mais pas toujours.** « Salon
 *     des Annonces » revient en `salon-des-annonces` pour un salon textuel, et
 *     reste tel quel pour un salon vocal. `nomSalonEffectif` applique la règle
 *     du TYPE choisi, et la réponse affiche le nom obtenu, pas le nom demandé.
 *
 *  4. **Un salon d'annonces exige un serveur Communauté.** Sans la
 *     fonctionnalité, l'API répond `50024` et le refus ne dit pas pourquoi. On
 *     lit `guild.features` avant d'appeler.
 *
 *  5. **Supprimer un salon casse ce qui pointe dessus.** Trois configurations
 *     citent des salons par identifiant — les variables `DISCORD_*_CHANNEL_ID`,
 *     la table `DISCORD_CHANNELS` de `@rosegriffon/types/discord`, et
 *     `settings['tweets.notification'].salon` en base. ⚠ `lib/config.ts` n'en
 *     porte AUCUN (vérifié le 13/8/2026 : guilde, Redis, URL du site, et rien
 *     d'autre) : chercher là aurait donné un garde-fou vide. La panne
 *     n'apparaîtrait qu'au prochain drain de la veille, sous la forme d'un
 *     `10003 Unknown Channel` que plus personne ne relierait à la suppression.
 *
 * ── AUCUNE ACTION N'A ÉTÉ ESSAYÉE SUR LE SERVEUR ───────────────────────────
 * Le serveur Rose Griffon compte ~1 984 membres et `apps/bot` n'est plus
 * déployé : rien de ce qui suit n'a été exécuté contre lui. Les signatures
 * appelées sont lues dans `node_modules/discord.js/typings/index.d.ts`
 * (v14.26.4) et citées à l'appel ; la logique qui décide est pure, dans
 * `lib/discord-admin.ts`, et couverte par `bun:test`.
 */
import { Discord, Slash, SlashChoice, SlashGroup, SlashOption } from "discordx";
import {
	ActionRowBuilder,
	ApplicationCommandOptionType,
	ButtonBuilder,
	ButtonStyle,
	ChannelType,
	ComponentType,
	GuildFeature,
	PermissionFlagsBits,
	type CategoryChannel,
	type ChatInputCommandInteraction,
	type EmbedBuilder,
	type Guild,
	type GuildBasedChannel,
	type GuildMember,
	type Message,
	type NewsChannel,
	type TextChannel,
	type User,
	type VoiceChannel,
} from "discord.js";

import { DISCORD_CHANNELS } from "@rosegriffon/types/discord";

import { logAdminAction } from "../../lib/audit";
import { RG_BASE_URL } from "../../lib/config";
import { sql } from "../../lib/db";
import {
	codeErreurDiscord,
	dureeLisible,
	expliquerCodeDiscord,
	libelleEtatEnvoi,
	libelleTypeSalon,
	lireEtatEnvoi,
	lireEtatEnvoiArchive,
	lireTypeSalon,
	LIMITE_NOM,
	LIMITE_SUJET_SALON,
	manquantesParmi,
	MAX_LENTEUR_SECONDES,
	MAX_SUPPRESSION_MASSE,
	motifAudit,
	nomSalonEffectif,
	normaliserLenteur,
	PAGES_MAX_PURGE,
	partitionnerSuppression,
	PERMISSIONS_LECTURE_MESSAGES,
	PERMISSIONS_PAR_ACTION,
	PERMISSIONS_PUBLICATION,
	pictoTypeSalon,
	referencesSalon,
	resumerPurge,
	surchargeEnvoi,
	TAILLE_PAGE_MESSAGES,
	TYPES_SALON_CREABLES,
	type BilanPurge,
	type EtatEnvoi,
} from "../../lib/discord-admin";
import { rgEmbed, truncate } from "../../lib/embeds";
import { lireFiltreNotification } from "../../services/tweets";
import { borner, echapperMarkdown, horodatageRelatif } from "../staff/format";
import { differerEnPrive, exigerDroits, messagePanne, type RgAdmin } from "../staff/garde";
import {
	analyserIdConfirmation,
	construireIdConfirmation,
	decrireChangement,
	urlIllustrationAbsolue,
} from "./valeurs";
import "./racine-moderation";
import { echec, repondre } from "../../lib/ui";

// ─── Constantes locales ─────────────────────────────────────────────────────

/** `entity_type` sous lequel toutes les traces de ce fichier sont rangées. */
const ENTITE_AUDIT = "discord_channel";

const ACTION_CREER = "salon.creer";
const ACTION_RENOMMER = "salon.renommer";
const ACTION_VERROUILLER = "salon.verrouiller";
const ACTION_DEVERROUILLER = "salon.deverrouiller";
const ACTION_LENT = "salon.lent";
const ACTION_PURGER = "salon.purger";
const ACTION_ANNONCER = "salon.annoncer";
const ACTION_SUPPRIMER = "salon.supprimer";

/** Délai laissé pour confirmer une action irréversible. */
const DELAI_CONFIRMATION_MS = 60_000;

/** Tenir un salon (créer, renommer, mode lent, supprimer) : « Gérer les salons ». */
const PERMISSIONS_TENUE: readonly bigint[] = PERMISSIONS_PAR_ACTION.salon;

/**
 * Verrouiller : « Gérer les salons » ET « Gérer les rôles ».
 *
 * Éditer une surcharge de permission relève de `ManageRoles`, pas de
 * `ManageChannels` : un bot qui n'aurait que le second créerait un salon sans
 * jamais pouvoir le verrouiller, et Discord répondrait `50013` sans distinguer
 * les deux causes.
 */
const PERMISSIONS_VERROU: readonly bigint[] = [
	...PERMISSIONS_PAR_ACTION.salon,
	...PERMISSIONS_PAR_ACTION.role,
];

/** Purger : « Gérer les messages », plus de quoi LIRE l'historique à purger. */
const PERMISSIONS_PURGE: readonly bigint[] = [
	...PERMISSIONS_PAR_ACTION.purger,
	...PERMISSIONS_LECTURE_MESSAGES,
];

/** Les trois types de salon proposés à la création, tels que Discord les nomme. */
const CHOIX_TYPE_SALON = TYPES_SALON_CREABLES.map((type) => ({
	name: type.libelle,
	value: type.valeur,
}));

/** Salons que ce fichier sait tenir : ni fil, ni forum, ni conférence. */
type SalonGere = TextChannel | NewsChannel | VoiceChannel | CategoryChannel;

/** Salons qui portent des messages : mode lent, purge, publication. */
type SalonEcrit = TextChannel | NewsChannel | VoiceChannel;

/** Salons qui peuvent recevoir une annonce publique. */
type SalonPublication = TextChannel | NewsChannel;

// ─── Résolution et gardes communes ──────────────────────────────────────────

/** Le serveur et le membre « bot », les deux choses dont chaque garde a besoin. */
interface Contexte {
	readonly guild: Guild;
	readonly moi: GuildMember;
}

/**
 * Résout le serveur et le membre du bot.
 *
 * `guild.members.me` est un GETTER de cache : il rend `null` tant que le membre
 * du bot n'a pas été mis en cache, ce qui arrive après un redémarrage. Sans le
 * `fetchMe()` de repli, la commande refuserait « hors serveur » sur un serveur
 * parfaitement valable.
 *
 * `GuildMemberManager.fetchMe(options?: BaseFetchOptions): Promise<GuildMember>`
 */
async function contexteGuilde(interaction: ChatInputCommandInteraction): Promise<Contexte | null> {
	const guild = interaction.guild;
	if (!guild) {
		await interaction.editReply({
			content: "Cette commande ne s'utilise que depuis un serveur, pas en message privé.",
		});
		return null;
	}
	let moi = guild.members.me;
	if (!moi) {
		try {
			moi = await guild.members.fetchMe();
		} catch (err) {
			await repondre(interaction, echec("Le bot ne se voit pas sur ce serveur", messagePanne(err)));
			return null;
		}
	}
	return { guild, moi };
}

function estSalonGere(salon: GuildBasedChannel): salon is SalonGere {
	return (
		salon.type === ChannelType.GuildText ||
		salon.type === ChannelType.GuildAnnouncement ||
		salon.type === ChannelType.GuildVoice ||
		salon.type === ChannelType.GuildCategory
	);
}

function estSalonEcrit(salon: GuildBasedChannel): salon is SalonEcrit {
	return (
		salon.type === ChannelType.GuildText ||
		salon.type === ChannelType.GuildAnnouncement ||
		salon.type === ChannelType.GuildVoice
	);
}

function estSalonPublication(salon: GuildBasedChannel): salon is SalonPublication {
	return salon.type === ChannelType.GuildText || salon.type === ChannelType.GuildAnnouncement;
}

/** `📣 #annonces` — le pictogramme dit le type sans faire une phrase de plus. */
function nommerSalon(salon: GuildBasedChannel): string {
	return `${pictoTypeSalon(salon.type)} **${echapperMarkdown(borner(salon.name, 80))}**`;
}

/**
 * Ce qui manque au bot SUR CE SALON, dit en clair.
 *
 * ── POURQUOI `permissionsIn` ET PAS `moi.permissions` ──────────────────────
 * Les permissions d'un bot ne sont pas globales : une surcharge posée sur un
 * salon peut lui retirer ce que son rôle lui donne partout ailleurs. Contrôler
 * la permission globale laisserait donc passer l'appel, et Discord répondrait un
 * `50013` que le staff lirait comme « le bot est cassé ».
 *
 * `GuildMember.permissionsIn(channel: GuildChannelResolvable): Readonly<PermissionsBitField>`
 */
function refusPermissions(
	moi: GuildMember,
	salon: SalonGere,
	requises: readonly bigint[]
): string | null {
	const manquantes = manquantesParmi(moi.permissionsIn(salon).bitfield, requises);
	if (manquantes.length === 0) {
		return null;
	}
	return (
		`🚫 Le bot n'a pas ce qu'il faut sur ${salon} : il lui manque ` +
		`${manquantes.map((nom) => `**${nom}**`).join(", ")}. ` +
		"Ce n'est pas une permission du serveur qui manque forcément — une surcharge posée " +
		"sur ce salon peut retirer au bot ce que son rôle lui accorde ailleurs."
	);
}

/**
 * Le pendant de la hiérarchie, côté salon.
 *
 * Un salon n'a pas de rang : ce qui joue le rôle de la hiérarchie est
 * `manageable`, qui vérifie que le bot voit le salon ET y détient « Gérer les
 * salons » une fois toutes les surcharges appliquées. `deletable` y ajoute la
 * suppression. Les deux sont des getters de discord.js
 * (`GuildChannel.get manageable(): boolean`, `get deletable(): boolean`) : ils
 * rejouent localement ce que l'API refuserait, et permettent de le DIRE.
 */
function refusPortee(salon: SalonGere, suppression: boolean): string | null {
	if (!salon.viewable && salon.type !== ChannelType.GuildCategory) {
		return `🚫 Le bot ne voit même pas ${salon} : il lui manque « Voir le salon » dessus.`;
	}
	if (!salon.manageable) {
		return (
			`🚫 Discord ne laisse pas le bot gérer ${salon}. Vérifie que le rôle du bot est ` +
			"au-dessus des rôles qui portent une surcharge sur ce salon, et qu'il y détient " +
			"bien « Gérer les salons »."
		);
	}
	if (suppression && !salon.deletable) {
		return `🚫 Discord refuse la suppression de ${salon} (salon protégé ou hors de portée du bot).`;
	}
	return null;
}

/** Motif d'audit Discord : toujours l'auteur humain, jamais « Rose Griffon » seul. */
function raisonAudit(interaction: ChatInputCommandInteraction, motif?: string | null): string {
	return motifAudit({ auteur: `${interaction.user.tag} (${interaction.user.id})`, motif });
}

/**
 * Traduit un refus de l'API en phrase actionnable, sinon rend le message brut.
 *
 * `expliquerCodeDiscord` couvre les codes que la modération croise ; ceux qui
 * suivent sont propres aux salons et ne remontent nulle part ailleurs.
 */
function expliquerRefusSalon(err: unknown): string {
	const code = codeErreurDiscord(err);
	if (code === 10_003) {
		return "Ce salon n'existe plus : il a été supprimé entre la commande et l'appel.";
	}
	if (code === 30_013) {
		return "Le serveur a atteint le nombre maximal de salons (500). Supprime-en un avant d'en créer un autre.";
	}
	if (code === 50_034) {
		return (
			"Un des messages du lot vient de dépasser quatorze jours entre l'aperçu et la " +
			"confirmation : Discord refuse alors le lot ENTIER. Relance la commande, le compte " +
			"sera recalculé."
		);
	}
	if (code === 50_024) {
		return (
			"Discord refuse cette opération sur ce type de salon. Un salon d'annonces exige un " +
			"serveur Communauté ; un salon vocal n'a pas de sujet."
		);
	}
	return expliquerCodeDiscord(code) ?? messagePanne(err);
}

/**
 * Demande une confirmation par bouton pour une action irréversible.
 *
 * `true` = confirmé ; `false` = refusé ou délai dépassé, et le message a déjà
 * été mis à jour — l'appelant n'a plus qu'à revenir.
 *
 * ── POURQUOI LA GRAINE, PUISQUE C'EST ÉPHÉMÈRE ─────────────────────────────
 * La réponse n'est visible que de la personne qui a lancé la commande : nul
 * autre ne peut cliquer. Mais deux commandes lancées coup sur coup par la MÊME
 * personne produiraient deux messages aux boutons identiques, et le clic sur
 * l'un résoudrait l'attente de l'autre — donc supprimerait le mauvais salon. La
 * graine est l'identifiant de l'interaction : elle rend chaque paire de boutons
 * unique, et le filtre exige la bonne graine ET la bonne personne.
 *
 * `Message.awaitMessageComponent<ComponentType>(options?:
 *   AwaitMessageCollectorOptionsParams<ComponentType, InGuild>):
 *   Promise<MappedInteractionTypes<InGuild>[ComponentType]>`
 */
async function confirmer(
	interaction: ChatInputCommandInteraction,
	embed: EmbedBuilder,
	libelleAction: string
): Promise<boolean> {
	const graine = interaction.id;
	const message: Message = await interaction.editReply({
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
					.setStyle(ButtonStyle.Secondary)
			),
		],
	});

	try {
		const clic = await message.awaitMessageComponent({
			componentType: ComponentType.Button,
			time: DELAI_CONFIRMATION_MS,
			filter: (bouton) => {
				const lu = analyserIdConfirmation(bouton.customId);
				return lu !== null && lu.graine === graine && bouton.user.id === interaction.user.id;
			},
		});
		// `deferUpdate` accuse réception du clic sans rien afficher : sans lui,
		// Discord marque le bouton « interaction échouée » au bout de 3 secondes,
		// même quand l'action se déroule parfaitement derrière.
		await clic.deferUpdate();
		if (analyserIdConfirmation(clic.customId)?.reponse !== "oui") {
			await interaction.editReply({
				content: "Annulé. Rien n'a été touché.",
				embeds: [],
				components: [],
			});
			return false;
		}
		return true;
	} catch {
		// Le collecteur lève sur expiration du délai — pas sur un refus.
		await interaction.editReply({
			content: `Délai de confirmation dépassé (${DELAI_CONFIRMATION_MS / 1_000} s). Rien n'a été touché.`,
			embeds: [],
			components: [],
		});
		return false;
	}
}

// ─── Verrouillage : l'état d'avant, archivé et relu ─────────────────────────

/**
 * État actuel de « Envoyer des messages » pour `@everyone` sur ce salon.
 *
 * `has(bit, checkAdmin = false)` : sans le second argument, un masque contenant
 * `Administrator` répondrait « oui » à TOUTES les permissions, et un salon
 * ouvert passerait pour verrouillé. Sur une surcharge, ce raccourci n'a aucun
 * sens — on interroge le bit et lui seul.
 *
 * La lecture se fait dans le cache et non par un `fetch` forcé : le bot ouvre sa
 * passerelle avec l'intention `Guilds` (`src/index.ts`), donc il reçoit chaque
 * `CHANNEL_UPDATE` et discord.js tient les surcharges à jour. Forcer un appel de
 * plus n'apporterait rien, et l'état lu ici décide de ce que `deverrouiller`
 * rendra.
 *
 * `PermissionOverwrites.allow: Readonly<PermissionsBitField>` (idem `deny`),
 * `PermissionsBitField.has(permission: PermissionResolvable, checkAdmin?: boolean): boolean`
 */
function etatEnvoiActuel(salon: SalonGere, guild: Guild): EtatEnvoi {
	const surcharge = salon.permissionOverwrites.cache.get(guild.roles.everyone.id);
	if (!surcharge) {
		return lireEtatEnvoi(null);
	}
	return lireEtatEnvoi({
		autorise: surcharge.allow.has(PermissionFlagsBits.SendMessages, false),
		refuse: surcharge.deny.has(PermissionFlagsBits.SendMessages, false),
	});
}

interface TraceVerrou {
	readonly action: string;
	readonly details: unknown;
	readonly created_at: Date | string;
}

/**
 * Dernière action de verrouillage connue pour ce salon.
 *
 * ── POURQUOI LA BASE ET PAS LA MÉMOIRE ─────────────────────────────────────
 * Le bot ne garde rien entre deux commandes, et un redémarrage effacerait un
 * cache. Le seul endroit où l'état d'avant survit est la trace d'audit écrite en
 * même temps que le verrouillage. On relit la DERNIÈRE des deux actions : si
 * c'est un déverrouillage, l'archive de verrouillage qui la précède est périmée
 * et ne doit surtout pas être rejouée.
 */
async function lireDernierVerrou(salonId: string): Promise<TraceVerrou | null> {
	const lignes = await sql<TraceVerrou[]>`
		SELECT action, details, created_at
		FROM admin_audit_log
		WHERE entity_type = ${ENTITE_AUDIT}
		  AND entity_id = ${salonId}
		  AND action IN (${ACTION_VERROUILLER}, ${ACTION_DEVERROUILLER})
		ORDER BY created_at DESC
		LIMIT 1
	`;
	return lignes[0] ?? null;
}

// ─── Purge : ce qui est réellement supprimable ──────────────────────────────

interface RecoltePurge {
	/**
	 * Les messages qui correspondent à la demande, du plus récent au plus ancien
	 * — filtre par auteur appliqué, épingles écartées, ÂGE NON ENCORE JUGÉ.
	 */
	readonly candidats: Message[];
	/** Messages parcourus dans l'historique, filtre compris. */
	readonly examines: number;
	/** Messages épinglés écartés (déjà passés par le filtre par auteur). */
	readonly epingles: number;
	/** Vrai si les pages autorisées ont été épuisées avant d'avoir le compte. */
	readonly tronque: boolean;
}

/**
 * Parcourt l'historique et retient les candidats à la purge.
 *
 * ── L'ORDRE DES OPÉRATIONS EST LE SUJET ────────────────────────────────────
 * Filtrer par auteur APRÈS avoir plafonné à 100 donnerait « les messages de X
 * parmi les 100 derniers du salon » — c'est-à-dire presque rien dans un salon
 * actif, alors que la commande promet « les N derniers messages de X ». On
 * pagine donc jusqu'à `PAGES_MAX_PURGE` pages de 100, on filtre, et on s'arrête
 * dès qu'on a le compte demandé.
 *
 * ── POURQUOI L'ÂGE N'EST PAS JUGÉ ICI ──────────────────────────────────────
 * Il serait tentant de s'arrêter au premier message de plus de quatorze jours :
 * `messages.fetch` rend du plus récent au plus ancien, donc tout ce qui suit est
 * hors de portée de `bulkDelete`. Mais on ne saurait alors PAS COMBIEN de
 * messages sont hors de portée, et la commande ne pourrait qu'inférer ce nombre
 * par soustraction — ce qui compterait « trop vieux » un salon qui n'a
 * simplement pas assez de messages. Les candidats sont donc collectés jusqu'au
 * nombre demandé, âge compris, et `partitionnerSuppression` (déjà testé) tranche
 * ensuite. Les deux chiffres annoncés sont alors MESURÉS, pas devinés.
 *
 * Les messages épinglés sont écartés : ils ont été épinglés exprès, et
 * `bulkDelete` les supprimerait sans broncher.
 *
 * `MessageManager.fetch(options?: FetchMessagesOptions): Promise<Collection<Snowflake, Message>>`
 * avec `FetchMessagesOptions { limit?: number; before?: Snowflake; … }`
 */
async function recolterPourPurge(
	salon: SalonEcrit,
	voulus: number,
	auteur: User | null
): Promise<RecoltePurge> {
	const candidats: Message[] = [];
	let examines = 0;
	let epingles = 0;
	let avant: string | undefined;

	for (let page = 0; page < PAGES_MAX_PURGE; page += 1) {
		const lot = await salon.messages.fetch({ limit: TAILLE_PAGE_MESSAGES, before: avant });
		if (lot.size === 0) {
			return { candidats, examines, epingles, tronque: false };
		}
		for (const message of lot.values()) {
			examines += 1;
			avant = message.id;
			if (auteur && message.author.id !== auteur.id) {
				continue;
			}
			if (message.pinned) {
				epingles += 1;
				continue;
			}
			candidats.push(message);
			if (candidats.length >= voulus) {
				return { candidats, examines, epingles, tronque: false };
			}
		}
		// Une page incomplète signifie qu'on a atteint le début du salon : il n'y
		// a rien de plus à parcourir, et la récolte n'est donc pas tronquée.
		if (lot.size < TAILLE_PAGE_MESSAGES) {
			return { candidats, examines, epingles, tronque: false };
		}
	}
	return { candidats, examines, epingles, tronque: candidats.length < voulus };
}

// ─── La commande ────────────────────────────────────────────────────────────

@Discord()
@SlashGroup({
	name: "salon",
	description: "Tenue des salons : créer, renommer, verrouiller, purger, annoncer, supprimer",
	root: "moderation",
})
@SlashGroup("salon", "moderation")
export class AdministrationSalonCommand {
	@Slash({
		name: "creer",
		description: "Crée un salon textuel, vocal ou d'annonces dans une catégorie",
	})
	async creer(
		@SlashOption({
			name: "nom",
			description: "Nom du salon (Discord réécrit celui d'un salon textuel en minuscules-tirets)",
			type: ApplicationCommandOptionType.String,
			required: true,
			minLength: 1,
			maxLength: LIMITE_NOM,
		})
		nom: string,
		@SlashChoice(...CHOIX_TYPE_SALON)
		@SlashOption({
			name: "type",
			description: "Type de salon à créer",
			type: ApplicationCommandOptionType.String,
			required: true,
		})
		type: string,
		@SlashOption({
			name: "categorie",
			description: "Catégorie parente (facultative : sinon le salon se pose à la racine)",
			type: ApplicationCommandOptionType.Channel,
			channelTypes: [ChannelType.GuildCategory],
			required: false,
		})
		categorie: GuildBasedChannel | undefined,
		@SlashOption({
			name: "sujet",
			description: `Sujet du salon (${LIMITE_SUJET_SALON} caractères ; ignoré pour un salon vocal)`,
			type: ApplicationCommandOptionType.String,
			required: false,
			maxLength: LIMITE_SUJET_SALON,
		})
		sujet: string | undefined,
		interaction: ChatInputCommandInteraction
	) {
		await differerEnPrive(interaction);
		const admin = await exigerDroits(interaction);
		if (!admin) {
			return;
		}
		const contexte = await contexteGuilde(interaction);
		if (!contexte) {
			return;
		}
		const { guild, moi } = contexte;

		const choix = lireTypeSalon(type);
		if (!choix) {
			await repondre(
				interaction,
				echec(
					"Valeur inconnue",
					`Type inconnu. Les trois valeurs possibles : ${TYPES_SALON_CREABLES.map(
						(t) => `\`${t.valeur}\``
					).join(", ")}.`
				)
			);
			return;
		}

		// Créer se juge sur les permissions du SERVEUR quand il n'y a pas de
		// catégorie, et sur celles de la catégorie sinon : une catégorie peut
		// parfaitement refuser au bot ce que le serveur lui accorde.
		const manquantes = manquantesParmi(moi.permissions.bitfield, PERMISSIONS_TENUE);
		if (manquantes.length > 0) {
			await interaction.editReply({
				content: `🚫 Le bot n'a pas **${manquantes.join(", ")}** sur ce serveur : il ne peut pas créer de salon.`,
			});
			return;
		}
		if (categorie) {
			if (categorie.type !== ChannelType.GuildCategory) {
				await repondre(
					interaction,
					echec("Salon incompatible", `${nommerSalon(categorie)} n'est pas une catégorie.`)
				);
				return;
			}
			const refus = refusPermissions(moi, categorie, PERMISSIONS_TENUE);
			if (refus) {
				await interaction.editReply({ content: refus });
				return;
			}
		}

		if (choix.exigeCommunaute && !guild.features.includes(GuildFeature.Community)) {
			await interaction.editReply({
				content:
					"❌ Un salon d'annonces n'existe que sur un serveur **Communauté**, et ce serveur ne " +
					"l'est pas. Active la Communauté dans les paramètres du serveur, ou crée un salon " +
					"textuel — l'API répondrait sinon un `50024` qui ne dit pas pourquoi.",
			});
			return;
		}

		const nomFinal = nomSalonEffectif(nom, choix);
		if (!nomFinal) {
			await interaction.editReply({
				content:
					"❌ Ce nom ne laisse rien d'exploitable une fois normalisé par Discord " +
					"(seuls les lettres, chiffres, tirets et soulignés survivent sur un salon textuel).",
			});
			return;
		}

		const sujetSaisi = sujet?.trim() ?? "";
		const sujetPose = choix.accepteSujet && sujetSaisi.length > 0 ? sujetSaisi : null;

		try {
			// `GuildChannelManager.create<Type extends GuildChannelTypes>(
			//    options: GuildChannelCreateOptions & { type: Type }
			//  ): Promise<MappedGuildChannelTypes[Type]>`
			const cree = await guild.channels.create({
				name: nomFinal,
				type: choix.type,
				parent: categorie?.id ?? null,
				topic: sujetPose ?? undefined,
				reason: raisonAudit(interaction, `Création de ${choix.libelle.toLowerCase()}`),
			});

			await logAdminAction({
				adminId: admin.profileId,
				discordId: admin.discordId,
				action: ACTION_CREER,
				targetType: ENTITE_AUDIT,
				targetId: cree.id,
				details: {
					nom_demande: nom,
					nom_obtenu: cree.name,
					type: choix.valeur,
					categorie: categorie?.id ?? null,
					sujet: sujetPose,
					serveur: guild.id,
				},
			});

			const embed = rgEmbed()
				.setTitle(`${choix.libelle} créé`)
				.addFields(
					{ name: "Salon", value: `${cree} — \`${cree.id}\``, inline: false },
					{ name: "Type", value: libelleTypeSalon(cree.type), inline: true },
					{
						name: "Catégorie",
						value: categorie ? `${categorie}` : "*aucune (racine du serveur)*",
						inline: true,
					}
				);
			// Le nom OBTENU, jamais le nom demandé : Discord réécrit celui d'un
			// salon textuel, et afficher la saisie ferait croire à un bug de nommage.
			if (cree.name !== nom.trim()) {
				embed.addFields({
					name: "Nom réécrit par Discord",
					value: decrireChangement(nom.trim(), cree.name),
				});
			}
			if (sujetPose) {
				embed.addFields({ name: "Sujet", value: truncate(sujetPose, 1_000) });
			} else if (sujetSaisi.length > 0) {
				embed.addFields({
					name: "Sujet non posé",
					value: `Un ${choix.libelle.toLowerCase()} n'a pas de sujet : la saisie a été ignorée.`,
				});
			}
			await interaction.editReply({ embeds: [embed] });
		} catch (err) {
			await repondre(interaction, echec("Salon inaccessible", expliquerRefusSalon(err)));
		}
	}

	@Slash({ name: "renommer", description: "Change le nom d'un salon ou d'une catégorie" })
	async renommer(
		@SlashOption({
			name: "salon",
			description: "Salon à renommer",
			type: ApplicationCommandOptionType.Channel,
			channelTypes: [
				ChannelType.GuildText,
				ChannelType.GuildAnnouncement,
				ChannelType.GuildVoice,
				ChannelType.GuildCategory,
			],
			required: true,
		})
		salon: GuildBasedChannel,
		@SlashOption({
			name: "nom",
			description: "Nouveau nom",
			type: ApplicationCommandOptionType.String,
			required: true,
			minLength: 1,
			maxLength: LIMITE_NOM,
		})
		nom: string,
		interaction: ChatInputCommandInteraction
	) {
		await differerEnPrive(interaction);
		const admin = await exigerDroits(interaction);
		if (!admin) {
			return;
		}
		const contexte = await contexteGuilde(interaction);
		if (!contexte) {
			return;
		}
		const cible = await verifierSalon(interaction, contexte, salon, PERMISSIONS_TENUE, false);
		if (!cible) {
			return;
		}

		// Un salon vocal et une catégorie gardent majuscules et espaces ; un salon
		// textuel ou d'annonces est réécrit par Discord. On applique la règle du
		// type RÉEL de la cible, pas celle du type le plus fréquent.
		const normalise =
			cible.type === ChannelType.GuildText || cible.type === ChannelType.GuildAnnouncement;
		const nomFinal = nomSalonEffectif(nom, {
			valeur: "textuel",
			libelle: libelleTypeSalon(cible.type),
			type: ChannelType.GuildText,
			nomNormalise: normalise,
			accepteSujet: false,
			exigeCommunaute: false,
		});
		if (!nomFinal) {
			await interaction.editReply({
				content: "❌ Ce nom ne laisse rien d'exploitable une fois normalisé par Discord.",
			});
			return;
		}
		if (nomFinal === cible.name) {
			await interaction.editReply({
				content: `${nommerSalon(cible)} porte déjà ce nom : rien n'a été touché.`,
			});
			return;
		}

		const ancien = cible.name;
		try {
			// `GuildChannel.setName(name: string, reason?: string): Promise<this>`
			const apres = await cible.setName(
				nomFinal,
				raisonAudit(interaction, `Renommage depuis « ${ancien} »`)
			);

			await logAdminAction({
				adminId: admin.profileId,
				discordId: admin.discordId,
				action: ACTION_RENOMMER,
				targetType: ENTITE_AUDIT,
				targetId: apres.id,
				details: {
					nom_avant: ancien,
					nom_demande: nom,
					nom_apres: apres.name,
					type: apres.type,
					serveur: contexte.guild.id,
				},
			});

			await interaction.editReply({
				content:
					`✏️ ${pictoTypeSalon(apres.type)} ${decrireChangement(ancien, apres.name)}` +
					(apres.name === nom.trim() ? "" : "\nDiscord a réécrit le nom saisi."),
			});
		} catch (err) {
			await repondre(interaction, echec("Salon inaccessible", expliquerRefusSalon(err)));
		}
	}

	@Slash({
		name: "verrouiller",
		description: "Retire « Envoyer des messages » à @everyone, et archive l'état d'avant",
	})
	async verrouiller(
		@SlashOption({
			name: "salon",
			description: "Salon à verrouiller",
			type: ApplicationCommandOptionType.Channel,
			channelTypes: [ChannelType.GuildText, ChannelType.GuildAnnouncement, ChannelType.GuildVoice],
			required: true,
		})
		salon: GuildBasedChannel,
		@SlashOption({
			name: "motif",
			description: "Motif inscrit au journal d'audit Discord et en base",
			type: ApplicationCommandOptionType.String,
			required: true,
			minLength: 3,
			maxLength: 400,
		})
		motif: string,
		interaction: ChatInputCommandInteraction
	) {
		await differerEnPrive(interaction);
		const admin = await exigerDroits(interaction);
		if (!admin) {
			return;
		}
		const contexte = await contexteGuilde(interaction);
		if (!contexte) {
			return;
		}
		const cible = await verifierSalon(interaction, contexte, salon, PERMISSIONS_VERROU, false);
		if (!cible) {
			return;
		}

		const avant = etatEnvoiActuel(cible, contexte.guild);
		if (avant === "refuse") {
			await interaction.editReply({
				content:
					`${nommerSalon(cible)} est **déjà verrouillé** pour @everyone. Rien n'a été touché, ` +
					"et surtout aucune trace n'a été écrite : elle écraserait l'état d'avant le premier " +
					"verrouillage, que `deverrouiller` doit rendre.",
			});
			return;
		}

		try {
			// `PermissionOverwriteManager.edit(userOrRole: RoleResolvable | UserResolvable,
			//    options: PermissionOverwriteOptions,
			//    overwriteOptions?: GuildChannelOverwriteOptions): Promise<NonThreadGuildBasedChannel>`
			// `PermissionOverwriteOptions = Partial<Record<keyof typeof PermissionFlagsBits, boolean | null>>`
			await cible.permissionOverwrites.edit(
				contexte.guild.roles.everyone,
				{ SendMessages: false },
				{ reason: raisonAudit(interaction, motif) }
			);

			await logAdminAction({
				adminId: admin.profileId,
				discordId: admin.discordId,
				action: ACTION_VERROUILLER,
				targetType: ENTITE_AUDIT,
				targetId: cible.id,
				details: {
					// C'est CE champ que `deverrouiller` relit : sans lui, le
					// déverrouillage ne saurait que remettre « autorisé », ce qui
					// ouvrirait un salon que la catégorie tenait fermé.
					envoyer_avant: avant,
					envoyer_apres: "refuse",
					salon: cible.name,
					motif,
					serveur: contexte.guild.id,
				},
			});

			const embed = rgEmbed()
				.setTitle("Salon verrouillé")
				.setDescription(
					`${cible} — @everyone ne peut plus y écrire. Le salon reste **visible** et son ` +
						"historique intact : rien n'a été supprimé."
				)
				.addFields(
					{ name: "Motif", value: truncate(motif, 1_000) },
					{ name: "État d'avant", value: libelleEtatEnvoi(avant), inline: true },
					{ name: "État actuel", value: libelleEtatEnvoi("refuse"), inline: true },
					{
						name: "Réversible",
						value:
							"`/administration salon deverrouiller` rendra exactement l'état ci-dessus, " +
							"relu dans le journal d'audit — pas « autorisé » par défaut.",
					}
				);
			await interaction.editReply({ embeds: [embed] });
		} catch (err) {
			await repondre(interaction, echec("Salon inaccessible", expliquerRefusSalon(err)));
		}
	}

	@Slash({
		name: "deverrouiller",
		description: "Rend à @everyone exactement l'état d'envoi qu'il avait avant le verrouillage",
	})
	async deverrouiller(
		@SlashOption({
			name: "salon",
			description: "Salon à déverrouiller",
			type: ApplicationCommandOptionType.Channel,
			channelTypes: [ChannelType.GuildText, ChannelType.GuildAnnouncement, ChannelType.GuildVoice],
			required: true,
		})
		salon: GuildBasedChannel,
		@SlashOption({
			name: "motif",
			description: "Motif inscrit au journal d'audit Discord et en base",
			type: ApplicationCommandOptionType.String,
			required: true,
			minLength: 3,
			maxLength: 400,
		})
		motif: string,
		interaction: ChatInputCommandInteraction
	) {
		await differerEnPrive(interaction);
		const admin = await exigerDroits(interaction);
		if (!admin) {
			return;
		}
		const contexte = await contexteGuilde(interaction);
		if (!contexte) {
			return;
		}
		const cible = await verifierSalon(interaction, contexte, salon, PERMISSIONS_VERROU, false);
		if (!cible) {
			return;
		}

		const actuel = etatEnvoiActuel(cible, contexte.guild);
		if (actuel !== "refuse") {
			await interaction.editReply({
				content:
					`${nommerSalon(cible)} n'est pas verrouillé : « Envoyer des messages » y est ` +
					`**${libelleEtatEnvoi(actuel)}** pour @everyone. Rien n'a été touché.`,
			});
			return;
		}

		try {
			const trace = await lireDernierVerrou(cible.id);
			const archive =
				trace?.action === ACTION_VERROUILLER ? lireEtatEnvoiArchive(trace.details) : null;
			// Sans archive, l'héritage est le seul repli honnête : c'est l'absence
			// de surcharge, donc la permission telle que la catégorie et les rôles
			// la définissent. Remettre « autorisé » ouvrirait potentiellement plus
			// grand qu'avant le verrouillage.
			const rendu: EtatEnvoi = archive ?? "herite";

			await cible.permissionOverwrites.edit(
				contexte.guild.roles.everyone,
				{ SendMessages: surchargeEnvoi(rendu) },
				{ reason: raisonAudit(interaction, motif) }
			);

			await logAdminAction({
				adminId: admin.profileId,
				discordId: admin.discordId,
				action: ACTION_DEVERROUILLER,
				targetType: ENTITE_AUDIT,
				targetId: cible.id,
				details: {
					envoyer_avant: "refuse",
					envoyer_apres: rendu,
					source: archive ? "journal" : "defaut",
					salon: cible.name,
					motif,
					serveur: contexte.guild.id,
				},
			});

			const embed = rgEmbed()
				.setTitle("Salon déverrouillé")
				.setDescription(`${cible} — @everyone peut de nouveau y écrire.`)
				.addFields(
					{ name: "Motif", value: truncate(motif, 1_000) },
					{ name: "État rendu", value: libelleEtatEnvoi(rendu), inline: true },
					{
						name: "Source",
						value: archive
							? `journal d'audit (verrouillage ${horodatageRelatif(trace?.created_at ?? null)})`
							: "aucune trace de verrouillage",
						inline: true,
					}
				);
			if (!archive) {
				embed.addFields({
					name: "Pourquoi l'héritage",
					value:
						"Aucun verrouillage de ce salon n'a été trouvé dans le journal : la surcharge a été " +
						"RETIRÉE plutôt que remise sur « autorisé ». La permission redevient celle que la " +
						"catégorie et les rôles définissent — remettre « autorisé » aurait pu ouvrir le " +
						"salon plus grand qu'il ne l'était.",
				});
			}
			await interaction.editReply({ embeds: [embed] });
		} catch (err) {
			await repondre(interaction, echec("Salon inaccessible", expliquerRefusSalon(err)));
		}
	}

	@Slash({ name: "lent", description: "Pose le mode lent d'un salon, de 0 à 6 heures" })
	async lent(
		@SlashOption({
			name: "salon",
			description: "Salon concerné",
			type: ApplicationCommandOptionType.Channel,
			channelTypes: [ChannelType.GuildText, ChannelType.GuildAnnouncement, ChannelType.GuildVoice],
			required: true,
		})
		salon: GuildBasedChannel,
		@SlashOption({
			name: "secondes",
			description: `Délai entre deux messages, de 0 (désactivé) à ${MAX_LENTEUR_SECONDES} (6 h)`,
			type: ApplicationCommandOptionType.Integer,
			required: true,
			minValue: 0,
			maxValue: MAX_LENTEUR_SECONDES,
		})
		secondes: number,
		@SlashOption({
			name: "motif",
			description: "Motif inscrit au journal d'audit Discord et en base",
			type: ApplicationCommandOptionType.String,
			required: false,
			maxLength: 400,
		})
		motif: string | undefined,
		interaction: ChatInputCommandInteraction
	) {
		await differerEnPrive(interaction);
		const admin = await exigerDroits(interaction);
		if (!admin) {
			return;
		}
		const contexte = await contexteGuilde(interaction);
		if (!contexte) {
			return;
		}
		const cible = await verifierSalon(interaction, contexte, salon, PERMISSIONS_TENUE, false);
		if (!cible) {
			return;
		}
		if (!estSalonEcrit(cible)) {
			await repondre(
				interaction,
				echec("Salon incompatible", `Une catégorie n'a pas de mode lent : ${nommerSalon(cible)}.`)
			);
			return;
		}

		// La borne est déjà posée par Discord (`minValue`/`maxValue`), mais elle ne
		// vaut que pour l'interface : une commande enregistrée avant un changement
		// de borne continue d'accepter l'ancienne valeur. On revérifie.
		const lenteur = normaliserLenteur(secondes);
		if (lenteur === null) {
			await repondre(
				interaction,
				echec(
					"Valeur hors bornes",
					`Le mode lent va de 0 à ${MAX_LENTEUR_SECONDES} secondes (6 heures).`
				)
			);
			return;
		}
		const avant = cible.rateLimitPerUser ?? 0;
		if (avant === lenteur) {
			await interaction.editReply({
				content: `${nommerSalon(cible)} est déjà réglé sur ${decrireLenteur(lenteur)} : rien n'a été touché.`,
			});
			return;
		}

		try {
			// `setRateLimitPerUser(rateLimitPerUser: number, reason?: string): Promise<this>`
			await cible.setRateLimitPerUser(lenteur, raisonAudit(interaction, motif));

			await logAdminAction({
				adminId: admin.profileId,
				discordId: admin.discordId,
				action: ACTION_LENT,
				targetType: ENTITE_AUDIT,
				targetId: cible.id,
				details: {
					lenteur_avant: avant,
					lenteur_apres: lenteur,
					salon: cible.name,
					motif: motif ?? null,
					serveur: contexte.guild.id,
				},
			});

			await interaction.editReply({
				content:
					`🐌 ${cible} — mode lent : ${decrireChangement(decrireLenteur(avant), decrireLenteur(lenteur))}.` +
					(lenteur > 0
						? "\nLes membres qui portent « Gérer les messages » ou « Ignorer le mode lent » n'y sont pas soumis."
						: ""),
			});
		} catch (err) {
			await repondre(interaction, echec("Salon inaccessible", expliquerRefusSalon(err)));
		}
	}

	@Slash({
		name: "purger",
		description: "Supprime en masse les derniers messages d'un salon (jamais au-delà de 14 jours)",
	})
	async purger(
		@SlashOption({
			name: "salon",
			description: "Salon à purger",
			type: ApplicationCommandOptionType.Channel,
			channelTypes: [ChannelType.GuildText, ChannelType.GuildAnnouncement, ChannelType.GuildVoice],
			required: true,
		})
		salon: GuildBasedChannel,
		@SlashOption({
			name: "nombre",
			description: `Messages à supprimer, de 2 à ${MAX_SUPPRESSION_MASSE} (plafond de l'API)`,
			type: ApplicationCommandOptionType.Integer,
			required: true,
			minValue: 2,
			maxValue: MAX_SUPPRESSION_MASSE,
		})
		nombre: number,
		@SlashOption({
			name: "auteur",
			description: "Ne supprimer que les messages de ce membre (filtré AVANT le plafond de 100)",
			type: ApplicationCommandOptionType.User,
			required: false,
		})
		auteur: User | undefined,
		@SlashOption({
			name: "motif",
			description: "Motif inscrit en base (Discord n'accepte pas de motif sur une purge)",
			type: ApplicationCommandOptionType.String,
			required: false,
			maxLength: 400,
		})
		motif: string | undefined,
		interaction: ChatInputCommandInteraction
	) {
		await differerEnPrive(interaction);
		// Strict : une purge ne se rejoue pas, et rien ne restaure un message.
		const admin = await exigerDroits(interaction, { strict: true });
		if (!admin) {
			return;
		}
		const contexte = await contexteGuilde(interaction);
		if (!contexte) {
			return;
		}
		const cible = await verifierSalon(interaction, contexte, salon, PERMISSIONS_PURGE, false);
		if (!cible) {
			return;
		}
		if (!estSalonEcrit(cible)) {
			await repondre(
				interaction,
				echec(
					"Salon incompatible",
					`Une catégorie ne porte pas de messages : ${nommerSalon(cible)}.`
				)
			);
			return;
		}

		const voulus = Math.min(Math.max(Math.trunc(nombre), 0), MAX_SUPPRESSION_MASSE);

		try {
			const recolte = await recolterPourPurge(cible, voulus, auteur ?? null);
			// `partitionnerSuppression(horodatages, maintenant, demande)` est le
			// module pur déjà testé : il coupe au plafond de 100 puis sépare ce que
			// `bulkDelete` accepte de ce qu'il refuse. Les candidats arrivent du plus
			// récent au plus ancien, donc les `supprimables` sont exactement les
			// premiers de la liste.
			const maintenant = Date.now();
			const partition = partitionnerSuppression(
				recolte.candidats.map((message) => message.createdTimestamp),
				maintenant,
				nombre
			);
			const retenus = recolte.candidats.slice(0, partition.supprimables);
			const bilan: BilanPurge = {
				demande: voulus,
				examines: recolte.examines,
				epingles: recolte.epingles,
				supprimables: partition.supprimables,
				tropAnciens: partition.tropAnciens,
				plafonne: partition.plafonne,
				tronque: recolte.tronque,
			};

			if (retenus.length === 0) {
				await interaction.editReply({
					content:
						`Rien à supprimer dans ${cible}. ${resumerPurge(bilan)}\n` +
						(auteur ? `Filtre : messages de ${auteur}.\n` : "") +
						"Une suppression de masse ne touche jamais un message de plus de quatorze jours : " +
						"c'est une règle de l'API Discord, pas un réglage du bot.",
				});
				return;
			}

			const embed = rgEmbed()
				.setTitle("Purge — à confirmer")
				.setDescription(
					`Salon : ${cible}\n` +
						(auteur ? `Filtre : messages de ${auteur} uniquement.\n` : "") +
						`\n${resumerPurge(bilan)}`
				)
				.addFields(
					{
						name: "Ce qui va être supprimé",
						value: `**${retenus.length}** message${retenus.length > 1 ? "s" : ""}, du plus récent au plus ancien.`,
						inline: true,
					},
					{
						name: "Plus ancien du lot",
						value: horodatageRelatif(retenus[retenus.length - 1]?.createdAt ?? null),
						inline: true,
					},
					{
						name: "Irréversible",
						value:
							"Aucun de ces messages ne se récupère. Le journal d'audit Discord n'en gardera " +
							"que le nombre — l'API de suppression de masse n'accepte pas de motif, celui " +
							"saisi ici n'est écrit qu'en base.",
					}
				);
			if (!(await confirmer(interaction, embed, `Supprimer ${retenus.length} messages`))) {
				return;
			}

			// `bulkDelete(messages: Collection<Snowflake, Message> | readonly
			//   MessageResolvable[] | number, filterOld?: boolean):
			//   Promise<Collection<Snowflake, Message | PartialMessage | undefined>>`
			// On passe la LISTE exacte plutôt qu'un nombre : le nombre relancerait
			// une lecture de l'historique sans le filtre par auteur ni l'exclusion
			// des épingles, et supprimerait donc autre chose que ce qui a été annoncé.
			const supprimes = await cible.bulkDelete(retenus, false);

			await logAdminAction({
				adminId: admin.profileId,
				discordId: admin.discordId,
				action: ACTION_PURGER,
				targetType: ENTITE_AUDIT,
				targetId: cible.id,
				details: {
					demande: voulus,
					supprimes: supprimes.size,
					examines: recolte.examines,
					epingles_epargnes: recolte.epingles,
					auteur: auteur?.id ?? null,
					salon: cible.name,
					motif: motif ?? null,
					serveur: contexte.guild.id,
				},
			});

			await interaction.editReply({
				content:
					`🧹 **${supprimes.size}** message${supprimes.size > 1 ? "s" : ""} supprimé${supprimes.size > 1 ? "s" : ""} dans ${cible}` +
					(auteur ? ` (messages de ${auteur})` : "") +
					`.\n${resumerPurge({ ...bilan, supprimables: supprimes.size })}`,
				embeds: [],
				components: [],
			});
		} catch (err) {
			await repondre(interaction, {
				embeds: [],
				components: [],
				...echec("Salon inaccessible", expliquerRefusSalon(err)),
			});
		}
	}

	@Slash({
		name: "annoncer",
		description: "Publie un embed signé Rose Griffon dans un salon (visible de tout le serveur)",
	})
	async annoncer(
		@SlashOption({
			name: "salon",
			description: "Salon de destination",
			type: ApplicationCommandOptionType.Channel,
			channelTypes: [ChannelType.GuildText, ChannelType.GuildAnnouncement],
			required: true,
		})
		salon: GuildBasedChannel,
		@SlashOption({
			name: "titre",
			description: "Titre de l'annonce (256 caractères)",
			type: ApplicationCommandOptionType.String,
			required: true,
			minLength: 2,
			maxLength: 256,
		})
		titre: string,
		@SlashOption({
			name: "texte",
			description: "Corps de l'annonce — « \\n » produit un saut de ligne",
			type: ApplicationCommandOptionType.String,
			required: true,
			minLength: 2,
			maxLength: 4_000,
		})
		texte: string,
		@SlashOption({
			name: "image",
			description: "Illustration : URL https complète, ou chemin absolu du site (/rgtv/…)",
			type: ApplicationCommandOptionType.String,
			required: false,
		})
		image: string | undefined,
		interaction: ChatInputCommandInteraction
	) {
		await differerEnPrive(interaction);
		// Strict : une annonce part vers ~1 984 membres et ne se rattrape pas.
		const admin = await exigerDroits(interaction, { strict: true });
		if (!admin) {
			return;
		}
		const contexte = await contexteGuilde(interaction);
		if (!contexte) {
			return;
		}
		const cible = await verifierSalon(
			interaction,
			contexte,
			salon,
			PERMISSIONS_PUBLICATION,
			false,
			{ tenue: false }
		);
		if (!cible) {
			return;
		}
		if (!estSalonPublication(cible)) {
			await repondre(
				interaction,
				echec("Salon incompatible", `${nommerSalon(cible)} ne peut pas recevoir d'annonce.`)
			);
			return;
		}

		// Discord n'accepte pas de retour à la ligne dans un champ d'option : sans
		// cette conversion, toute annonce composée en plusieurs paragraphes
		// arriverait sur une seule ligne avec des « \n » visibles.
		const corps = texte.replaceAll("\\n", "\n").trim();
		let illustration: string | null = null;
		if (image !== undefined && image.trim().length > 0) {
			illustration = urlIllustrationAbsolue(image, RG_BASE_URL);
			if (!illustration) {
				await interaction.editReply({
					content:
						"❌ L'illustration doit être une URL `https://` complète, ou un chemin absolu du " +
						"site (`/rgtv/jude.webp`). Une URL en clair (`http://`) fait rejeter l'embed " +
						"ENTIER par l'API : l'annonce serait perdue, pas seulement l'image.",
				});
				return;
			}
		}

		const annonce = rgEmbed()
			.setTitle(truncate(titre.trim(), 256))
			.setDescription(truncate(corps, 4_096))
			.setTimestamp(new Date());
		if (illustration) {
			annonce.setImage(illustration);
		}
		// `EmbedBuilder.get length(): number` compte exactement comme Discord.
		// Les 6000 ne peuvent pas être atteints avec ces bornes, mais l'assertion
		// coûte moins qu'une annonce refusée en `50035`.
		if (annonce.length > 6_000) {
			await interaction.editReply({
				content: "❌ L'annonce dépasse les 6 000 caractères qu'un embed accepte au total.",
			});
			return;
		}

		try {
			// `PartialTextBasedChannelFields.send(options: string | MessagePayload
			//   | MessageCreateOptions): Promise<Message>`
			const publie = await cible.send({ embeds: [annonce] });

			await logAdminAction({
				adminId: admin.profileId,
				discordId: admin.discordId,
				action: ACTION_ANNONCER,
				targetType: ENTITE_AUDIT,
				targetId: cible.id,
				details: {
					// Le lien du message publié : c'est la seule chose qui permet de
					// retrouver — et donc de corriger ou retirer — une annonce six mois
					// plus tard.
					lien: publie.url,
					message: publie.id,
					titre: titre.trim(),
					image: illustration,
					salon: cible.name,
					serveur: contexte.guild.id,
				},
			});

			await interaction.editReply({
				content: `📣 Annonce publiée dans ${cible} — ${publie.url}`,
				embeds: [annonce],
			});
		} catch (err) {
			await repondre(interaction, echec("Salon inaccessible", expliquerRefusSalon(err)));
		}
	}

	@Slash({ name: "supprimer", description: "Supprime définitivement un salon ou une catégorie" })
	async supprimer(
		@SlashOption({
			name: "salon",
			description: "Salon à supprimer",
			type: ApplicationCommandOptionType.Channel,
			channelTypes: [
				ChannelType.GuildText,
				ChannelType.GuildAnnouncement,
				ChannelType.GuildVoice,
				ChannelType.GuildCategory,
			],
			required: true,
		})
		salon: GuildBasedChannel,
		@SlashOption({
			name: "motif",
			description: "Motif inscrit au journal d'audit Discord et en base",
			type: ApplicationCommandOptionType.String,
			required: true,
			minLength: 3,
			maxLength: 400,
		})
		motif: string,
		interaction: ChatInputCommandInteraction
	) {
		await differerEnPrive(interaction);
		// Strict : un salon supprimé emporte son historique, et rien ne le rend.
		const admin = await exigerDroits(interaction, { strict: true });
		if (!admin) {
			return;
		}
		const contexte = await contexteGuilde(interaction);
		if (!contexte) {
			return;
		}
		const cible = await verifierSalon(interaction, contexte, salon, PERMISSIONS_TENUE, true);
		if (!cible) {
			return;
		}

		// On ne supprime pas le sol sous ses pieds : ni le salon d'où vient la
		// commande, ni la catégorie qui le porte, ni le salon parent du fil dans
		// lequel on est — la réponse éphémère mourrait avec, et le refus de
		// Discord serait illisible.
		const sousLesPieds = new Set<string>([interaction.channelId]);
		const courant = interaction.channel;
		if (courant && "parentId" in courant && typeof courant.parentId === "string") {
			sousLesPieds.add(courant.parentId);
		}
		if (sousLesPieds.has(cible.id)) {
			await interaction.editReply({
				content:
					`❌ ${nommerSalon(cible)} est le salon d'où part cette commande (ou sa catégorie). ` +
					"Relance-la depuis un autre salon : la réponse serait supprimée avec lui.",
			});
			return;
		}

		try {
			const references = await referencesConfiguration(cible.id);
			if (references.length > 0) {
				await interaction.editReply({
					content:
						`❌ ${nommerSalon(cible)} est **référencé par la configuration du bot** :\n` +
						references.map((source) => `• \`${source}\``).join("\n") +
						"\n\nLe supprimer ne casse rien tout de suite : la panne apparaîtrait au prochain " +
						"drain de la veille ou à la prochaine annonce, sous la forme d'un " +
						"`10003 Unknown Channel` que plus personne ne relierait à cette commande. " +
						"Repointe d'abord la configuration ailleurs.",
				});
				return;
			}

			const enfants = cible.type === ChannelType.GuildCategory ? cible.children.cache.size : 0;
			const embed = rgEmbed()
				.setTitle("Suppression de salon — à confirmer")
				.setDescription(
					`${cible} — \`${cible.id}\`\n` +
						"Le salon et **tout son historique** disparaissent. Rien ne les rend."
				)
				.addFields(
					{ name: "Type", value: libelleTypeSalon(cible.type), inline: true },
					{
						name: "Créé",
						value: horodatageRelatif(cible.createdAt),
						inline: true,
					},
					{ name: "Motif", value: truncate(motif, 1_000) }
				);
			if (cible.type === ChannelType.GuildCategory) {
				embed.addFields({
					name: `Salons de la catégorie : ${enfants}`,
					value:
						enfants > 0
							? "Ils ne seront **pas** supprimés : Discord les remonte à la racine du serveur, " +
								"sans catégorie, et ils perdent les permissions qu'ils héritaient d'elle."
							: "La catégorie est vide.",
				});
			}
			if (!(await confirmer(interaction, embed, "Supprimer définitivement"))) {
				return;
			}

			const nomSupprime = cible.name;
			// `GuildChannel.delete(reason?: string): Promise<this>`
			await cible.delete(raisonAudit(interaction, motif));

			await logAdminAction({
				adminId: admin.profileId,
				discordId: admin.discordId,
				action: ACTION_SUPPRIMER,
				targetType: ENTITE_AUDIT,
				targetId: cible.id,
				details: {
					salon: nomSupprime,
					type: cible.type,
					categorie: cible.parentId,
					enfants_orphelins: enfants,
					motif,
					serveur: contexte.guild.id,
				},
			});

			await interaction.editReply({
				content:
					`🗑 **${echapperMarkdown(borner(nomSupprime, 80))}** supprimé du serveur.` +
					(enfants > 0
						? `\n${enfants} salon${enfants > 1 ? "s" : ""} de cette catégorie ${enfants > 1 ? "sont remontés" : "est remonté"} à la racine.`
						: ""),
				embeds: [],
				components: [],
			});
		} catch (err) {
			await interaction.editReply({
				content: `❌ ${expliquerRefusSalon(err)}`,
				embeds: [],
				components: [],
			});
		}
	}
}

// ─── Gardes partagées entre sous-commandes ──────────────────────────────────

/**
 * L'ordre de vérification, toujours le même, avant de toucher à l'API.
 *
 *   a. les droits Rose Griffon ont déjà été exigés par l'appelant ;
 *   b. le salon appartient bien à CE serveur et est d'un type que l'on sait tenir ;
 *   c. les permissions RÉELLES du bot sur ce salon, nommées une par une ;
 *   d. la portée : `manageable` / `deletable`, le pendant de la hiérarchie côté salon.
 *
 * Rend `null` quand un refus a déjà été envoyé.
 */
async function verifierSalon(
	interaction: ChatInputCommandInteraction,
	contexte: Contexte,
	salon: GuildBasedChannel,
	requises: readonly bigint[],
	suppression: boolean,
	options: { readonly tenue?: boolean } = {}
): Promise<SalonGere | null> {
	if (!estSalonGere(salon)) {
		await interaction.editReply({
			content:
				`❌ ${nommerSalon(salon)} est un ${libelleTypeSalon(salon.type).toLowerCase()} : ` +
				"cette commande ne tient que les salons textuels, vocaux, d'annonces et les catégories.",
		});
		return null;
	}
	if (salon.guildId !== contexte.guild.id) {
		await interaction.editReply({
			content: "❌ Ce salon n'appartient pas à ce serveur.",
		});
		return null;
	}
	const refusDroits = refusPermissions(contexte.moi, salon, requises);
	if (refusDroits) {
		await interaction.editReply({ content: refusDroits });
		return null;
	}
	// `annoncer` publie sans rien modifier du salon : lui imposer `manageable`
	// interdirait d'annoncer dans un salon que le bot peut parfaitement lire et
	// où il peut parfaitement écrire.
	if (options.tenue !== false) {
		const refusPorteeSalon = refusPortee(salon, suppression);
		if (refusPorteeSalon) {
			await interaction.editReply({ content: refusPorteeSalon });
			return null;
		}
	}
	return salon;
}

/**
 * Les endroits où un identifiant de salon est câblé dans la configuration.
 *
 * ⚠ `lib/config.ts` n'en porte AUCUN (vérifié le 13/8/2026 : `GUILD_ID`,
 * `GUILD_IDS`, `REDIS_URL`, `RG_BASE_URL` et les couleurs de la charte, rien de
 * plus). Les salons sont câblés à trois autres endroits, et les trois sont
 * consultés ici :
 *   • les variables `DISCORD_*_CHANNEL_ID` lues par la veille et les annonces ;
 *   • `DISCORD_CHANNELS` de `@rosegriffon/types/discord` ;
 *   • `settings['tweets.notification'].salon`, en base, qui l'emporte sur l'env.
 *
 * La lecture en base peut lever : dans ce cas la suppression échoue plutôt que
 * de passer outre. Un garde-fou qu'une panne désactive n'est pas un garde-fou.
 */
async function referencesConfiguration(salonId: string): Promise<string[]> {
	const filtre = await lireFiltreNotification();
	const sources: Record<string, string | null | undefined> = {
		DISCORD_NEWS_CHANNEL_ID: Bun.env.DISCORD_NEWS_CHANNEL_ID,
		DISCORD_WIKI_ANNOUNCEMENTS_CHANNEL_ID: Bun.env.DISCORD_WIKI_ANNOUNCEMENTS_CHANNEL_ID,
		DISCORD_WEBSITE_ANNOUNCEMENTS_CHANNEL_ID: Bun.env.DISCORD_WEBSITE_ANNOUNCEMENTS_CHANNEL_ID,
		"settings['tweets.notification'].salon": filtre.salon,
	};
	for (const [nom, valeur] of Object.entries(DISCORD_CHANNELS)) {
		sources[`DISCORD_CHANNELS.${nom}`] = valeur;
	}
	return referencesSalon(salonId, sources);
}

/** « désactivé » plutôt que « 0 s » : c'est ce que le réglage veut dire. */
function decrireLenteur(secondes: number): string {
	if (secondes <= 0) {
		return "désactivé";
	}
	return dureeLisible(secondes * 1_000);
}
