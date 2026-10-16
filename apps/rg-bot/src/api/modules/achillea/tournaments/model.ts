import { t } from "elysia";

export const TournamentModel = {
	scorePolicy: t.Object({ success: t.Literal(true), scoreReportPolicy: t.String() }),
	participant: t.Object({
		id: t.Number(), tournamentId: t.Number(), userId: t.String(), status: t.String(), registeredAt: t.String(),
	}),
	event: t.Object({
		id: t.String(), type: t.String(), createdAt: t.String(),
		actor: t.Nullable(t.Object({ id: t.String(), username: t.Nullable(t.String()), displayName: t.Nullable(t.String()), avatar: t.Nullable(t.String()) })),
		target: t.Nullable(t.Object({ id: t.String(), username: t.Nullable(t.String()), displayName: t.Nullable(t.String()), avatar: t.Nullable(t.String()) })),
		payload: t.Nullable(t.Record(t.String(), t.Unknown())), reason: t.Nullable(t.String()),
	}),
	tournament: t.Object({
		id: t.Number(),
		name: t.String(),
		description: t.String(),
		type: t.Union([t.Literal("TOURNAMENT"), t.Literal("INTERCLAN"), t.Literal("RANKED")]),
		status: t.Nullable(t.String()),
		createdAt: t.String(),
		updatedAt: t.String()
	}),
	listResponse: t.Object({
		data: t.Array(
			t.Object({
				id: t.Number(),
				name: t.String(),
				description: t.String(),
				type: t.Union([t.Literal("TOURNAMENT"), t.Literal("INTERCLAN"), t.Literal("RANKED")]),
				status: t.Nullable(t.String()),
				createdAt: t.String(),
				updatedAt: t.String()
			})
		),
		meta: t.Object({ page: t.Number(), limit: t.Number(), total: t.Number(), pageCount: t.Number() })
	}),
	notFound: t.Object({
		message: t.Literal("Tournament not found")
	})
} as const;

export type TournamentDTO = typeof TournamentModel.tournament.static;
