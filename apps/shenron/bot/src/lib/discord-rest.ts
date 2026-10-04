// SPDX-License-Identifier: Apache-2.0
import { discordFetch as sharedDiscordFetch, type AuthMode, type DiscordResponse } from "@aphrody/discord-kit/rest";
import { env } from "./env";
import { logger } from "./logger";
export { DiscordRESTError } from "@aphrody/discord-kit/rest";
export type { AuthMode, DiscordResponse } from "@aphrody/discord-kit/rest";
export function discordFetch<T = unknown>(path: string, opts: { mode: AuthMode; token?: string; method?: string; body?: unknown } = { mode: "Bot" }): Promise<DiscordResponse<T>> {
  return sharedDiscordFetch<T>(path, { ...opts, token: opts.mode === "Bot" ? env.DISCORD_TOKEN : opts.token ?? "", onRateLimit: (info) => logger.warn(info, "Discord 429 — retry après") });
}
