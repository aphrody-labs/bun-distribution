/**
 * `/stats` — télémétrie d'usage du bot Discord.
 *
 * Toutes ces routes sont derrière `DevAuthenticated` : elles attendent un
 * jeton porteur de développement, à fournir via `getAuthToken` / `tokenStore`.
 */

import { z } from "zod";

import { AchilleaResource, type AchilleaClientResult } from "./http";
import type { BotTotalsResponse, CommandUsageRow, DailyCountRow, UsersAndGuildsResponse } from "./pending-contracts";

export const botTotalsResponseSchema = z.object({
  stats: z.object({
    totalUsers: z.number(),
    totalGuilds: z.number(),
    totalActiveUsers: z.number(),
    totalCommands: z.number(),
  }),
}) satisfies z.ZodType<BotTotalsResponse>;

export const dailyCountRowSchema = z.object({
  date: z.string(),
  count: z.number(),
}) satisfies z.ZodType<DailyCountRow>;

export const commandUsageRowSchema = z.object({
  date: z.string(),
  slashCommands: z.number(),
  simpleCommands: z.number(),
  contextMenus: z.number(),
}) satisfies z.ZodType<CommandUsageRow>;

export const usersAndGuildsResponseSchema = z.object({
  activeUsers: z.array(dailyCountRowSchema),
  users: z.array(dailyCountRowSchema),
  guilds: z.array(dailyCountRowSchema),
}) satisfies z.ZodType<UsersAndGuildsResponse>;

/** Une commande et son nombre d'usages (agrégat SQL, colonnes brutes). */
export const topCommandRowSchema = z.object({
  type: z.string(),
  name: z.string().nullable(),
  count: z.coerce.number(),
});

export type TopCommandRow = z.infer<typeof topCommandRowSchema>;

/** Répartition des membres par tranche de commandes lancées. */
export const usersActivitySchema = z.object({
  "1-10": z.number(),
  "11-50": z.number(),
  "51-100": z.number(),
  "101-1000": z.number(),
  ">1000": z.number(),
});

export type UsersActivity = z.infer<typeof usersActivitySchema>;

export const topGuildRowSchema = z.object({
  id: z.string(),
  name: z.string(),
  totalCommands: z.number(),
});

export type TopGuildRow = z.infer<typeof topGuildRowSchema>;

/** 8 routes. */
export class StatsResource extends AchilleaResource {
  /** `GET /stats/totals` — compteurs globaux (membres, serveurs, commandes). */
  totals(): Promise<AchilleaClientResult<BotTotalsResponse>> {
    return this.http.get("/stats/totals", botTotalsResponseSchema);
  }

  /** `GET /stats/interaction/last` — dernière interaction enregistrée. */
  lastInteraction(): Promise<AchilleaClientResult<unknown>> {
    return this.http.get("/stats/interaction/last", z.unknown());
  }

  /** `GET /stats/guilds/last` — dernier serveur ajouté. */
  lastGuildAdded(): Promise<AchilleaClientResult<unknown>> {
    return this.http.get("/stats/guilds/last", z.unknown());
  }

  /** `GET /stats/commands/usage` — usage cumulé par jour, par famille de commande. */
  commandsUsage(numberOfDays?: number): Promise<AchilleaClientResult<CommandUsageRow[]>> {
    return this.http.get("/stats/commands/usage", z.array(commandUsageRowSchema), {
      query: { numberOfDays },
    });
  }

  /** `GET /stats/commands/top` — commandes triées par nombre d'usages. */
  topCommands(): Promise<AchilleaClientResult<TopCommandRow[]>> {
    return this.http.get("/stats/commands/top", z.array(topCommandRowSchema));
  }

  /** `GET /stats/users/activity` — répartition des membres par tranche d'activité. */
  usersActivity(): Promise<AchilleaClientResult<UsersActivity>> {
    return this.http.get("/stats/users/activity", usersActivitySchema);
  }

  /** `GET /stats/guilds/top` — serveurs les plus actifs. */
  topGuilds(): Promise<AchilleaClientResult<TopGuildRow[]>> {
    return this.http.get("/stats/guilds/top", z.array(topGuildRowSchema));
  }

  /** `GET /stats/usersAndGuilds` — séries quotidiennes membres / serveurs. */
  usersAndGuilds(numberOfDays?: number): Promise<AchilleaClientResult<UsersAndGuildsResponse>> {
    return this.http.get("/stats/usersAndGuilds", usersAndGuildsResponseSchema, {
      query: { numberOfDays },
    });
  }
}
