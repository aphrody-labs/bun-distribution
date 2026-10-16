import { t } from "elysia";

export const CommunityModel = {
  infoResponse: t.Object({
    name: t.String(),
    slogan: t.String(),
    contact: t.String(),
    website: t.String(),
    colors: t.Object({
      primary: t.String(),
      secondary: t.String(),
    }),
    structure: t.Record(t.String(), t.String()),
  }),
  emotesResponse: t.Object({
    success: t.Boolean(),
    count: t.Number(),
    data: t.Array(
      t.Object({
        name: t.String(),
        path: t.String(),
        character: t.String(),
        category: t.String(),
        alt: t.String(),
        fullPath: t.String(),
      }),
    ),
  }),
  tagsResponse: t.Array(
    t.Object({
      tag: t.String(),
      count: t.Number(),
    }),
  ),
} as const;
