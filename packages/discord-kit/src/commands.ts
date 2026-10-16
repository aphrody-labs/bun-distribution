// SPDX-License-Identifier: Apache-2.0
import type { Client } from "discordx";

export interface CommandInitOptions {
  logger?: {
    info?: (...args: any[]) => void;
    warn?: (...args: any[]) => void;
    error?: (...args: any[]) => void;
  };
}

/**
 * Safely initializes Discord slash application commands.
 *
 * Captures `rawError` from Discord API responses when command registration fails with
 * "Invalid Form Body", outputting the exact field path (e.g. `3.options.1.description`)
 * to speed up diagnosis.
 */
export async function initApplicationCommandsSafe(
  client: Client,
  options: CommandInitOptions = {},
): Promise<boolean> {
  const logger = options.logger ?? console;
  try {
    await client.initApplicationCommands();
    logger.info?.(
      "[discord-kit] Application commands initialized successfully",
    );
    return true;
  } catch (err) {
    const raw = (err as { rawError?: unknown }).rawError;
    logger.error?.(
      "[discord-kit] initApplicationCommands failed:",
      err instanceof Error ? err.message : String(err),
      raw ? `\n  Discord rawError details: ${JSON.stringify(raw)}` : "",
    );
    return false;
  }
}

/**
 * Clears guild-scoped commands on specific guilds safely.
 * Only targets guilds that the bot has actually joined to prevent API rejections on unknown guilds.
 */
export async function clearGuildCommandsSafe(
  client: Client,
  guildIds: readonly string[],
  options: CommandInitOptions = {},
): Promise<number> {
  const logger = options.logger ?? console;
  const joinedGuilds = guildIds.filter((id) => client.guilds.cache.has(id));

  if (joinedGuilds.length === 0) {
    return 0;
  }

  try {
    await client.clearApplicationCommands(...joinedGuilds);
    logger.info?.(
      `[discord-kit] Cleared guild commands from ${joinedGuilds.length} guild(s) (${joinedGuilds.join(", ")})`,
    );
    return joinedGuilds.length;
  } catch (err) {
    logger.warn?.(
      "[discord-kit] Failed to clear guild commands (duplicate commands may appear in client cache):",
      err instanceof Error ? err.message : String(err),
    );
    return 0;
  }
}
