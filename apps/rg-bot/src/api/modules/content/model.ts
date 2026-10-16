import { t } from "elysia";

export const ContentModel = {
	feedQuery: t.Object({
		page: t.Optional(t.Numeric({ default: 1 })),
		category: t.Optional(t.String()),
		q: t.Optional(t.String())
	}),
	feedResponse: t.Object({
		items: t.Array(t.Object({
			id: t.String(),
			title: t.String(),
			slug: t.String(),
			excerpt: t.Nullable(t.String()),
			category: t.Nullable(t.String()),
			featuredImageUrl: t.Nullable(t.String()),
			authorId: t.Nullable(t.String()),
			createdAt: t.Nullable(t.String()),
			publishedAt: t.Nullable(t.String())
		})),
		page: t.Number(),
		hasMore: t.Boolean()
	}),
	calendarResponse: t.Object({
		events: t.Array(t.Object({
			id: t.String(),
			title: t.String(),
			description: t.Nullable(t.String()),
			location: t.Nullable(t.String()),
			startTime: t.String(),
			endTime: t.String()
		}))
	})
} as const;
