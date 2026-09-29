import { createAchilleaSql } from "@rosegriffon/db/achillea-sql";
import type { Generated, Kysely } from "kysely";

import { Service } from "@/decorators";
import type { TournamentEventType } from "@/utils/enums";

interface TournamentEventDatabase {
	tournament_event: {
		id: Generated<string>;
		tournament_id: number;
		type: string;
		actor_id: string | null;
		target_id: string | null;
		payload: Record<string, unknown> | null;
		reason: string | null;
		created_at: Generated<Date>;
	};
	user: {
		id: string;
		username: string | null;
		display_name: string | null;
		avatar: string | null;
	};
}

const sql = createAchilleaSql<TournamentEventDatabase>() as Kysely<TournamentEventDatabase>;

export interface TournamentEventInput {
	tournamentId: number;
	type: TournamentEventType;
	actorId?: string | null;
	targetId?: string | null;
	payload?: Record<string, unknown> | null;
	reason?: string | null;
}

/** Journal métier append-only d'un tournoi, indépendant de Discord et de MikroORM. */
@Service()
export class TournamentEventService {
	async log(input: TournamentEventInput): Promise<void> {
		try {
			await sql.insertInto("tournament_event").values({
				tournament_id: input.tournamentId,
				type: input.type,
				actor_id: input.actorId ?? null,
				target_id: input.targetId ?? null,
				payload: input.payload ?? null,
				reason: input.reason ?? null,
			}).execute();
		} catch (error) {
			console.warn(
				`[TournamentEventService] journalisation ignorée (${input.type}) :`,
				(error as Error)?.message,
			);
		}
	}

	async list(tournamentId: number, includeReasons: boolean, limit = 200) {
		const events = await sql
			.selectFrom("tournament_event as event")
			.leftJoin("user as actor", "actor.id", "event.actor_id")
			.leftJoin("user as target", "target.id", "event.target_id")
			.select([
				"event.id", "event.type", "event.created_at", "event.payload", "event.reason",
				"actor.id as actor_id", "actor.username as actor_username",
				"actor.display_name as actor_display_name", "actor.avatar as actor_avatar",
				"target.id as target_id", "target.username as target_username",
				"target.display_name as target_display_name", "target.avatar as target_avatar",
			])
			.where("event.tournament_id", "=", tournamentId)
			.orderBy("event.created_at", "desc")
			.limit(limit)
			.execute();

		return events.map((event) => ({
			id: event.id,
			type: event.type,
			createdAt: event.created_at,
			actor: event.actor_id ? {
				id: event.actor_id,
				username: event.actor_username,
				displayName: event.actor_display_name,
				avatar: event.actor_avatar,
			} : null,
			target: event.target_id ? {
				id: event.target_id,
				username: event.target_username,
				displayName: event.target_display_name,
				avatar: event.target_avatar,
			} : null,
			payload: event.payload ?? null,
			reason: includeReasons ? (event.reason ?? null) : null,
		}));
	}
}
