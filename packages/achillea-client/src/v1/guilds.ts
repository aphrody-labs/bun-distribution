/**
 * `/guilds` — métadonnées des serveurs Discord scannés (rôles, salons, agrégats).
 *
 * Ces formes n'existent pas dans `@rosegriffon/achillea-types` : elles décrivent
 * des lignes SQL propres au scanner du bot, pas un DTO métier Achilléa. Elles
 * restent donc définies ici, comme au premier jour du paquet.
 */

import { z } from "zod";

import { AchilleaResource, type AchilleaClientResult } from "./http";

/** Identifiant de contrat runtime, conservé pour les appelants historiques. */
export const ACHILLEA_GUILDS_CONTRACT_VERSION = "v1" as const;

/** Snowflake Discord transporté en texte JSON, pour éviter la perte de précision. */
export const discordIdSchema = z.string().regex(/^\d{15,25}$/u, "identifiant Discord invalide");

/** `member_count` arrive en `bigint` Postgres, donc parfois en texte. */
const flexibleNullableNumberSchema = z
  .union([z.number(), z.string()])
  .nullable()
  .transform(value => {
    if (value === null) return null;
    const number = typeof value === "number" ? value : Number(value);
    return Number.isFinite(number) ? number : null;
  });

export const achilleaRoleSchema = z.object({
  id: discordIdSchema,
  name: z.string(),
  color: z.number().default(0),
  position: z.number().default(0),
  permissions: z.string().nullable().default(null),
  hoist: z.boolean().nullable().default(false),
  managed: z.boolean().nullable().default(false),
  mentionable: z.boolean().nullable().default(false),
});

export const achilleaChannelSchema = z.object({
  id: discordIdSchema,
  name: z.string(),
  type: z.number(),
  parent_id: z.string().nullable().default(null),
  position: z.number().nullable().default(0),
  topic: z.string().nullable().default(null),
  nsfw: z.boolean().nullable().default(false),
});

export const achilleaGuildSchema = z.object({
  id: discordIdSchema,
  name: z.string().nullable(),
  icon: z.string().nullable(),
  banner: z.string().nullable(),
  owner_id: z.string().nullable(),
  member_count: flexibleNullableNumberSchema,
  presence_count: flexibleNullableNumberSchema,
  features: z.array(z.string()).nullable().default(null),
  premium_tier: z.number().nullable().default(0),
  verification_level: z.number().nullable().default(0),
  description: z.string().nullable(),
  scanned_at: z.string().nullable(),
});

export const achilleaGuildDetailSchema = achilleaGuildSchema.extend({
  roles: z.array(achilleaRoleSchema).default([]),
  channels: z.array(achilleaChannelSchema).default([]),
});

export const achilleaGuildPageSchema = z.object({
  data: z.array(achilleaGuildSchema),
  meta: z.object({
    page: z.number(),
    limit: z.number(),
    total: z.number(),
    pageCount: z.number(),
  }),
});

export const achilleaGuildStatsSchema = z.object({
  total_guilds: z.number(),
  total_members: z.union([z.number(), z.string()]).transform(Number),
  last_scan: z.string().nullable(),
  by_premium_tier: z.array(z.object({ premium_tier: z.number().nullable(), count: z.number() })).default([]),
  by_channel_type: z.array(z.object({ type: z.number(), count: z.number() })).default([]),
});

export type AchilleaRole = z.infer<typeof achilleaRoleSchema>;
export type AchilleaChannel = z.infer<typeof achilleaChannelSchema>;
export type AchilleaGuild = z.infer<typeof achilleaGuildSchema>;
export type AchilleaGuildDetail = z.infer<typeof achilleaGuildDetailSchema>;
export type AchilleaGuildPage = z.infer<typeof achilleaGuildPageSchema>;
export type AchilleaGuildStats = z.infer<typeof achilleaGuildStatsSchema>;

/** 3 routes. */
export class GuildsResource extends AchilleaResource {
  /** `GET /guilds` — serveurs scannés, triés par nombre de membres. */
  list(page = 1, limit = 25): Promise<AchilleaClientResult<AchilleaGuildPage>> {
    return this.http.get("/guilds", achilleaGuildPageSchema, { query: { page, limit } });
  }

  /** `GET /guilds/stats` — agrégats sur l'ensemble des serveurs scannés. */
  stats(): Promise<AchilleaClientResult<AchilleaGuildStats>> {
    return this.http.get("/guilds/stats", achilleaGuildStatsSchema);
  }

  /** `GET /guilds/:id` — détail d'un serveur, rôles et salons compris. */
  get(id: string): Promise<AchilleaClientResult<AchilleaGuildDetail>> {
    return this.http.get(`/guilds/${encodeURIComponent(id)}`, achilleaGuildDetailSchema);
  }
}
