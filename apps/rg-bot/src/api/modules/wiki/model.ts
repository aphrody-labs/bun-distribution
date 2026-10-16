import { t } from "elysia";

export const WikiModel = {
  characterListQuery: t.Object({
    page: t.Optional(t.Numeric({ default: 1 })),
    limit: t.Optional(t.Numeric({ default: 24 })),
    q: t.Optional(t.String()),
    element: t.Optional(t.String()),
    position: t.Optional(t.String()),
    rarity: t.Optional(t.String()),
    category: t.Optional(t.String()),
    team: t.Optional(t.String()),
    series: t.Optional(t.String()),
    gender: t.Optional(t.String()),
    sort: t.Optional(t.String()),
  }),
  skillListQuery: t.Object({
    page: t.Optional(t.Numeric({ default: 1 })),
    limit: t.Optional(t.Numeric({ default: 24 })),
    q: t.Optional(t.String()),
    element: t.Optional(t.String()),
    category: t.Optional(t.String()),
    sort: t.Optional(t.String()),
  }),
  notFound: t.Object({
    error: t.String(),
    message: t.String(),
  }),
} as const;
