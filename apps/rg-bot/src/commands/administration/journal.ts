/**
 * `/administration journal` — dire OÙ les sanctions se lisent.
 *
 * ── POURQUOI CE RÉGLAGE EXISTE ─────────────────────────────────────────────
 * Chaque action de `/moderation moderation` écrit sa ligne dans
 * `admin_audit_log`. C'est une table Postgres : elle se requête, elle survit à
 * la purge d'un salon, le site la lit — et personne, depuis Discord, ne la
 * voyait. Le reste du staff apprenait donc les avertissements par la personne
 * avertie. Ce salon est la lecture immédiate de cette table.
 *
 * ── POURQUOI SOUS `/administration` ET PAS `/moderation` ───────────────────
 * Mesuré, pas supposé : `/moderation` pèse 7 086 des 8 000 caractères que
 * Discord accorde à une racine, et porte DÉJÀ un groupe nommé `moderation` —
 * un second groupe du même nom y serait refusé pour doublon, indépendamment du
 * budget. `/gestion` est à 7 798, soit 202 caractères de marge : y poser ce
 * groupe ferait sauter l'enregistrement de TOUTES les commandes du bot au
 * premier mot ajouté ailleurs. `/administration` est à 4 647, et c'est déjà la
 * racine qui porte les autres réglages écrits (`reglages`, `cron`, `veille`).
 * Cf. `docs/bot-commandes.md` §1.4 pour remesurer avant d'ajouter quoi que ce
 * soit.
 *
 * ── LE SALON N'EST PAS VÉRIFIÉ « À LA MAIN » ───────────────────────────────
 * `channelTypes` limite déjà la saisie aux salons textuels, et la commande
 * envoie une carte d'essai : c'est la seule vérification qui vaille, puisque
 * c'est exactement l'appel que fera la prochaine sanction. Un contrôle de
 * permissions calculé dirait « ça devrait marcher » là où l'essai dit « ça
 * marche ».
 */
import { Discord, Slash, SlashGroup, SlashOption } from "discordx";
import {
	ApplicationCommandOptionType,
	ChannelType,
	type ChatInputCommandInteraction,
	type GuildTextBasedChannel,
} from "discord.js";

import { logAdminAction } from "../../lib/audit";
import { fusionnerReglages } from "../../lib/reglages-communaute";
import { echec, repondre, succes } from "../../lib/ui";
import { enregistrerReglages, reglagesDe } from "../../services/communaute";
import { publierAuJournal } from "../../services/journal-moderation";
import { differerEnPrive, exigerDroits, messagePanne } from "../staff/garde";
import "./racine";

@Discord()
@SlashGroup({
	description: "Salon où le bot publie les sanctions prises avec /moderation",
	name: "journal",
	root: "administration",
})
@SlashGroup("journal", "administration")
export class AdministrationJournalCommand {
	@Slash({
		description: "Choisir le salon du journal de modération (vide = ne rien publier)",
		name: "salon",
	})
	async salon(
		@SlashOption({
			channelTypes: [ChannelType.GuildText, ChannelType.GuildAnnouncement],
			description: "Le salon (laisse vide pour COUPER la publication)",
			name: "salon",
			required: false,
			type: ApplicationCommandOptionType.Channel,
		})
		salon: GuildTextBasedChannel | undefined,
		interaction: ChatInputCommandInteraction
	) {
		await differerEnPrive(interaction);
		const admin = await exigerDroits(interaction);
		if (!admin) {
			return;
		}
		const guildId = interaction.guildId;
		if (!guildId) {
			await repondre(
				interaction,
				echec("Hors serveur", "Un journal se règle sur un serveur, pas en message privé.")
			);
			return;
		}
		try {
			const actuels = await reglagesDe(guildId);
			const modifies = fusionnerReglages(actuels, {
				moderation: { actif: salon !== undefined, salonJournal: salon?.id ?? null },
			});
			await enregistrerReglages(guildId, modifies);
			await logAdminAction({
				action: "moderation.journal",
				adminId: admin.profileId,
				details: { salon: salon?.id ?? null },
				discordId: interaction.user.id,
				targetId: guildId,
				targetType: "bot_reglages_guilde",
			});

			if (!salon) {
				await repondre(
					interaction,
					succes(
						"Journal de modération coupé",
						"Les sanctions continuent d'être consignées dans `admin_audit_log` — elles ne seront simplement plus publiées nulle part.",
						{ prive: true }
					)
				);
				return;
			}

			// L'essai passe par le MÊME chemin qu'une vraie sanction : réglages
			// relus, salon résolu, embed envoyé. Il vaut donc preuve, là où une
			// vérification de permissions calculée ne vaudrait que promesse.
			const echecEssai = await publierAuJournal(interaction.client, guildId, {
				action: "discord.avertir",
				cibleId: interaction.user.id,
				cibleEtiquette: interaction.user.tag,
				parQui: interaction.user.id,
				motif: "Carte d'essai — le journal de modération vient d'être branché sur ce salon.",
				precisions: [{ nom: "Essai", valeur: "aucune sanction n'a été prise" }],
			});
			await repondre(
				interaction,
				echecEssai
					? echec("Salon enregistré, mais rien n'a pu y être publié", echecEssai)
					: succes(
							"Journal de modération branché",
							`Avertissements, exclusions et bannissements paraîtront dans ${salon.toString()}. Une carte d'essai vient d'y être posée.`,
							{ prive: true }
						)
			);
		} catch (err) {
			await repondre(interaction, echec("Réglage refusé", messagePanne(err)));
		}
	}
}
