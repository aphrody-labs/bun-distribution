import type { Generated, Kysely } from "kysely";
import { createAchilleaSql } from "@rosegriffon/db/achillea-sql";

import { Service } from "@/decorators";
import type { Clan, Notification } from "@/entities";

import { emitToUsers } from "../websockets/socket-server";

interface NotificationDatabase {
	user: { id: string };
	clan_member: { clan_id: number; user_id: string };
	user_notification: {
		id: Generated<number>;
		created_at: Generated<Date>;
		updated_at: Generated<Date>;
		notification_id: number;
		user_id: string;
		is_read: Generated<boolean>;
		read_at: Date | null;
	};
}

const sql = createAchilleaSql<NotificationDatabase>() as Kysely<NotificationDatabase>;

@Service()
export class NotificationService {
	private async assignToUsers(userIds: string[], notification: Notification) {
		if (!userIds.length) return;
		await sql
			.insertInto("user_notification")
			.values(userIds.map((user_id) => ({ user_id, notification_id: notification.id })))
			.execute();
	}

	private async saveAndEmit(userIds: string[], notification: Notification, eventName: string) {
		await this.assignToUsers(userIds, notification);

		// Emit to all connected sockets in the users’ rooms
		emitToUsers(
			userIds,
			eventName,
			{ notification }
		);
	}

	/**
	 * Notification destinée à un seul joueur (promotion depuis une liste d'attente,
	 * disqualification, annulation d'un tournoi auquel il est inscrit).
	 * Sans effet — plutôt qu'en erreur — si l'utilisateur n'existe plus.
	 */
	async sendUserNotification(userId: string, notification: Notification) {
		const user = await sql.selectFrom("user").select("id").where("id", "=", userId).executeTakeFirst();
		if (!user) return;

		await this.saveAndEmit([user.id], notification, "notification");
	}

	async sendClanNotification(clan: Clan, notification: Notification) {
		const members = await sql
			.selectFrom("clan_member")
			.select("user_id")
			.where("clan_id", "=", clan.id)
			.execute();
		await this.saveAndEmit(members.map(({ user_id }) => user_id), notification, "notification");
	}

}
