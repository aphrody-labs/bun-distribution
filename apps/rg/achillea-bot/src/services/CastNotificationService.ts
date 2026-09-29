import { EmbedBuilder } from "discord.js";
import { Client } from "@aphrody/discordx";
import { singleton } from "tsyringe";
import type { Generated, Kysely } from "kysely";
import { createAchilleaSql } from "@rosegriffon/db/achillea-sql";

interface CastNotificationDatabase {
	cast_event: {
		id: Generated<string>;
		name: string;
		kind: string;
		scheduled_at: Date;
		twitch_url: string | null;
		status: string;
	};
	cast_slot: { id: Generated<string>; event_id: string; role: string };
	cast_attribution: {
		id: Generated<string>;
		slot_id: string;
		user_id: string | null;
		confirmed_at: Date | null;
		notified_j2: boolean;
		notified_h2: boolean;
	};
}

interface CastEventLike {
	id: string;
	name: string;
	kind: string;
	scheduledAt: Date;
	twitchUrl: string | null;
}

interface CastAttributionRow {
	id: string;
	user_id: string;
	role: string;
}

const sql = createAchilleaSql<CastNotificationDatabase>() as Kysely<CastNotificationDatabase>;

export interface NotifyResult {
	sent: number;
	failed: number;
}

/** Fenêtre ±30 min autour de J-2 (48h) */
const J2_WINDOW_MS = 30 * 60 * 1000;
/** Fenêtre ±15 min autour de H-2 (2h) */
const H2_WINDOW_MS = 15 * 60 * 1000;
/** Target J-2 : 48h avant l'event */
const J2_OFFSET_MS = 48 * 60 * 60 * 1000;
/** Target H-2 : 2h avant l'event */
const H2_OFFSET_MS = 2 * 60 * 60 * 1000;

// CastNotificationService — T-2.4

/**
 * Envoie les rappels de cast par DM Discord (J-2 et H-2) + ping channel staff.
 *
 * Idempotence : les flags `notifiedJ2` / `notifiedH2` sur CastAttribution
 * empêchent le re-DM en cas de restart du bot.
 *
 * Tolère `DiscordAPIError 50007` (DM fermés) : log warn + continue.
 */
@singleton()
export class CastNotificationService {
	// notifyJ2

	/**
	 * Envoie les DM J-2 à tous les casters confirmés dont notifiedJ2 = false.
	 * Met à jour notifiedJ2 = true et envoie un récap sur le channel staff.
	 */
	async notifyJ2(event: CastEventLike, client: Client): Promise<NotifyResult> {
		const attributions = await sql
			.selectFrom("cast_attribution as ca")
			.innerJoin("cast_slot as cs", "cs.id", "ca.slot_id")
			.select(["ca.id as id", "ca.user_id", "cs.role"])
			.where("cs.event_id", "=", event.id)
			.where("ca.confirmed_at", "is not", null)
			.where("ca.notified_j2", "=", false)
			.where("ca.user_id", "is not", null)
			.execute() as CastAttributionRow[];

		let sent = 0;
		let failed = 0;
		const notifiedUsers: string[] = [];
		const notifiedIds: string[] = [];

		for (const attribution of attributions) {
			const userId = attribution.user_id;
			try {
				const user = await client.users.fetch(userId);
				const embed = this._buildJ2Embed(event, attribution);
				await user.send({ embeds: [embed] });
				notifiedIds.push(attribution.id);
				notifiedUsers.push(`<@${userId}>`);
				sent++;
			} catch (err: any) {
				// 50007 = Cannot send messages to this user (DM fermés)
				if (err?.code === 50007) {
					console.warn(
						`[CastNotificationService] J-2 DM bloqué pour userId=${userId} (50007) — event=${event.id}`
					);
					// On marque quand même notifiedJ2 pour éviter de respammer à chaque cron
					notifiedIds.push(attribution.id);
				} else {
					console.error(
						`[CastNotificationService] J-2 DM échoué pour userId=${userId} — event=${event.id}`,
						err
					);
					failed++;
					continue;
				}
			}
		}

		if (notifiedIds.length > 0) {
			await sql.updateTable("cast_attribution").set({ notified_j2: true }).where("id", "in", notifiedIds).execute();
			await this._pingStaffChannel(client, event, "J-2", notifiedUsers, sent, failed);
		}

		return { sent, failed };
	}

	// notifyH2

	/**
	 * Envoie les DM H-2 à tous les casters confirmés dont notifiedH2 = false.
	 * Template plus urgent que J-2.
	 */
	async notifyH2(event: CastEventLike, client: Client): Promise<NotifyResult> {
		const attributions = await sql
			.selectFrom("cast_attribution as ca")
			.innerJoin("cast_slot as cs", "cs.id", "ca.slot_id")
			.select(["ca.id as id", "ca.user_id", "cs.role"])
			.where("cs.event_id", "=", event.id)
			.where("ca.confirmed_at", "is not", null)
			.where("ca.notified_h2", "=", false)
			.where("ca.user_id", "is not", null)
			.execute() as CastAttributionRow[];

		let sent = 0;
		let failed = 0;
		const notifiedUsers: string[] = [];
		const notifiedIds: string[] = [];

		for (const attribution of attributions) {
			const userId = attribution.user_id;
			try {
				const user = await client.users.fetch(userId);
				const embed = this._buildH2Embed(event, attribution);
				await user.send({ embeds: [embed] });
				notifiedIds.push(attribution.id);
				notifiedUsers.push(`<@${userId}>`);
				sent++;
			} catch (err: any) {
				if (err?.code === 50007) {
					console.warn(
						`[CastNotificationService] H-2 DM bloqué pour userId=${userId} (50007) — event=${event.id}`
					);
					notifiedIds.push(attribution.id);
				} else {
					console.error(
						`[CastNotificationService] H-2 DM échoué pour userId=${userId} — event=${event.id}`,
						err
					);
					failed++;
					continue;
				}
			}
		}

		if (notifiedIds.length > 0) {
			await sql.updateTable("cast_attribution").set({ notified_h2: true }).where("id", "in", notifiedIds).execute();
			await this._pingStaffChannel(client, event, "H-2", notifiedUsers, sent, failed);
		}

		return { sent, failed };
	}

	// dispatchUpcoming

	/**
	 * Appelé par le cron toutes les 15 min.
	 *
	 * Charge les events dont scheduledAt est dans la fenêtre J-2 ±30 min
	 * ET qui ont au moins une attribution confirmedAt != null avec notifiedJ2 = false.
	 * Idem pour H-2 ±15 min.
	 */
	async dispatchUpcoming(client: Client): Promise<void> {
		const now = new Date();

		// Fenêtre J-2 : [now+48h-30min, now+48h+30min]
		const j2Target = new Date(now.getTime() + J2_OFFSET_MS);
		const j2Low = new Date(j2Target.getTime() - J2_WINDOW_MS);
		const j2High = new Date(j2Target.getTime() + J2_WINDOW_MS);

		// Fenêtre H-2 : [now+2h-15min, now+2h+15min]
		const h2Target = new Date(now.getTime() + H2_OFFSET_MS);
		const h2Low = new Date(h2Target.getTime() - H2_WINDOW_MS);
		const h2High = new Date(h2Target.getTime() + H2_WINDOW_MS);

		// Events J-2 : scheduledAt dans la fenêtre ET au moins 1 attribution notifiedJ2=false+confirmed
		const j2Events = await this.upcomingEvents(j2Low, j2High, "j2");

		for (const event of j2Events) {
			try {
				const { sent, failed } = await this.notifyJ2(event, client);
				console.info(`[CastNotificationService] J-2 event=${event.id} — sent=${sent}, failed=${failed}`);
			} catch (err) {
				console.error(`[CastNotificationService] dispatchUpcoming J-2 event=${event.id} error:`, err);
			}
		}

		// Events H-2 : scheduledAt dans la fenêtre ET au moins 1 attribution notifiedH2=false+confirmed
		const h2Events = await this.upcomingEvents(h2Low, h2High, "h2");

		for (const event of h2Events) {
			try {
				const { sent, failed } = await this.notifyH2(event, client);
				console.info(`[CastNotificationService] H-2 event=${event.id} — sent=${sent}, failed=${failed}`);
			} catch (err) {
				console.error(`[CastNotificationService] dispatchUpcoming H-2 event=${event.id} error:`, err);
			}
		}
	}

	// Private helpers

	private async upcomingEvents(low: Date, high: Date, flag: "j2" | "h2"): Promise<CastEventLike[]> {
		const query = sql
			.selectFrom("cast_event as ce")
			.innerJoin("cast_slot as cs", "cs.event_id", "ce.id")
			.innerJoin("cast_attribution as ca", "ca.slot_id", "cs.id")
			.select(["ce.id", "ce.name", "ce.kind", "ce.scheduled_at", "ce.twitch_url"])
			.distinct()
			.where("ce.scheduled_at", ">=", low)
			.where("ce.scheduled_at", "<=", high)
			.where("ce.status", "not in", ["done", "cancelled"])
			.where("ca.confirmed_at", "is not", null)
			.where("ca.user_id", "is not", null);
		const rows = await (flag === "j2"
			? query.where("ca.notified_j2", "=", false)
			: query.where("ca.notified_h2", "=", false)).execute();
		return rows.map((row) => ({ id: row.id, name: row.name, kind: row.kind, scheduledAt: row.scheduled_at, twitchUrl: row.twitch_url }));
	}

	private _buildJ2Embed(event: CastEventLike, slot: { role: string }): EmbedBuilder {
		const scheduledAtTs = Math.floor(event.scheduledAt.getTime() / 1000);
		return new EmbedBuilder()
			.setTitle("Rappel de cast — J-2")
			.setColor(0x5865f2)
			.setDescription(`Tu as un cast dans **2 jours** ! Voici les informations :`)
			.addFields(
				{ name: "Evenement", value: `${event.name} (${event.kind})`, inline: true },
				{ name: "Role", value: slot.role, inline: true },
				{ name: "Date", value: `<t:${scheduledAtTs}:F>`, inline: false },
				...(event.twitchUrl ? [{ name: "Twitch", value: event.twitchUrl, inline: false }] : [])
			)
			.setFooter({ text: "Achillea Cast — rappel J-2" })
			.setTimestamp();
	}

	private _buildH2Embed(event: CastEventLike, slot: { role: string }): EmbedBuilder {
		const scheduledAtTs = Math.floor(event.scheduledAt.getTime() / 1000);
		return new EmbedBuilder()
			.setTitle("Rappel de cast — H-2 (dans 2h !)")
			.setColor(0xed4245)
			.setDescription(`Tu cast dans **2 heures** ! Verifie que tout est pret.`)
			.addFields(
				{ name: "Evenement", value: `${event.name} (${event.kind})`, inline: true },
				{ name: "Role", value: slot.role, inline: true },
				{ name: "Heure", value: `<t:${scheduledAtTs}:t>`, inline: false },
				...(event.twitchUrl ? [{ name: "Twitch", value: event.twitchUrl, inline: false }] : [])
			)
			.setFooter({ text: "Achillea Cast — rappel H-2" })
			.setTimestamp();
	}

	private async _pingStaffChannel(
		client: Client,
		event: CastEventLike,
		label: "J-2" | "H-2",
		mentionedUsers: string[],
		sent: number,
		failed: number
	): Promise<void> {
		const channelId = process.env.ACHILLEA_STAFF_CHANNEL_ID;
		if (!channelId) {
			console.warn(
				`[CastNotificationService] ACHILLEA_STAFF_CHANNEL_ID non defini — ping staff skipped (event=${event.id}, label=${label})`
			);
			return;
		}

		try {
			const channel = await client.channels.fetch(channelId);
			if (!channel || !channel.isTextBased() || !("send" in channel)) {
				console.warn(
					`[CastNotificationService] Channel staff ${channelId} introuvable ou non textuel`
				);
				return;
			}

			const userList = mentionedUsers.length > 0 ? mentionedUsers.join(", ") : "_aucun_";

			await channel.send({
				content: [
					`**[Cast ${label}]** Rappels envoyés pour **${event.name}**`,
					`Casters notifiés : ${userList}`,
					`Bilan : ${sent} envoyé(s), ${failed} echec(s)`,
				].join("\n"),
			});
		} catch (err) {
			console.error(
				`[CastNotificationService] Echec ping staff channel (event=${event.id}, label=${label}):`,
				err
			);
		}
	}
}
