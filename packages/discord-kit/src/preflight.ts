// SPDX-License-Identifier: Apache-2.0
import { GatewayIntentBits } from "discord.js";

/**
 * Standard intents requested in nominal bot operation.
 * The three privileged intents (GuildMembers, GuildPresences, MessageContent)
 * require switches activated in Discord Dev Portal -> Bot -> Privileged Gateway Intents.
 */
export const FULL_INTENTS: readonly GatewayIntentBits[] = [
  GatewayIntentBits.Guilds,
  GatewayIntentBits.GuildMembers,
  GatewayIntentBits.GuildMessages,
  GatewayIntentBits.GuildMessageReactions,
  GatewayIntentBits.GuildVoiceStates,
  GatewayIntentBits.GuildPresences,
  GatewayIntentBits.DirectMessages,
  GatewayIntentBits.MessageContent,
] as const;

/**
 * Safe fallback without any privileged intents.
 * Used when privileged intents have not yet been granted in the Developer Portal.
 */
export const FALLBACK_INTENTS: readonly GatewayIntentBits[] =
  FULL_INTENTS.filter(
    (intent) =>
      intent !== GatewayIntentBits.GuildMembers &&
      intent !== GatewayIntentBits.GuildPresences &&
      intent !== GatewayIntentBits.MessageContent,
  );

/**
 * Bit flags in `application.flags` confirming whether privileged intents are approved.
 */
export const PRIVILEGED_GRANT_BITS = {
  // Approved (verified bot) or enabled on bots in <100 guilds
  presence: [1 << 12, 1 << 13],
  members: [1 << 14, 1 << 15],
  messageContent: [1 << 18, 1 << 19],
} as const;

function withoutPrivilegedIntents(
  intents: readonly GatewayIntentBits[],
): GatewayIntentBits[] {
  return intents.filter(
    (intent) =>
      intent !== GatewayIntentBits.GuildMembers &&
      intent !== GatewayIntentBits.GuildPresences &&
      intent !== GatewayIntentBits.MessageContent,
  );
}

export interface ResolveGrantedIntentsOptions {
  desiredIntents?: readonly GatewayIntentBits[];
  timeoutMs?: number;
  logger?: {
    warn?: (msg: string) => void;
    error?: (msg: string) => void;
    info?: (msg: string) => void;
  };
  apiBase?: string;
  fetchImpl?: typeof fetch;
}

/**
 * Pre-flight check to query Discord API for approved privileged intents before Client construction.
 *
 * In Discord.js, `client.options.intents` is frozen at construction time. If privileged intents
 * are requested without being enabled in the Developer Portal, Discord abruptly closes the Gateway
 * websocket with error 4014 ("Used disallowed intents").
 *
 * This pre-flight inspects `application.flags` and gracefully filters out ungranted privileged intents,
 * logging a clear diagnostic warning instead of suffering a fatal disconnect.
 */
export async function resolveGrantedIntents(
  botToken: string,
  options: ResolveGrantedIntentsOptions = {},
): Promise<GatewayIntentBits[]> {
  const desired = options.desiredIntents ?? FULL_INTENTS;
  const timeoutMs = options.timeoutMs ?? 10_000;
  const apiBase = options.apiBase ?? "https://discord.com/api/v10";
  const fetchFn = options.fetchImpl ?? globalThis.fetch;
  const logger = options.logger ?? console;

  let flags = 0;
  try {
    const res = await fetchFn(`${apiBase}/applications/@me`, {
      headers: { Authorization: `Bot ${botToken}` },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) {
      logger.warn?.(
        `[discord-kit] Pre-flight GET /applications/@me returned HTTP ${res.status}. Falling back to non-privileged intents to avoid Gateway 4014.`,
      );
      return withoutPrivilegedIntents(desired);
    }
    const data = (await res.json()) as { flags?: number };
    flags = data.flags ?? 0;
  } catch (err) {
    logger.warn?.(
      `[discord-kit] Pre-flight intent check failed: ${err instanceof Error ? err.message : String(err)}. Falling back to non-privileged intents to avoid Gateway 4014.`,
    );
    return withoutPrivilegedIntents(desired);
  }

  const isGranted = (bits: readonly number[]) =>
    bits.some((b) => (flags & b) !== 0);
  const refused: string[] = [];

  const grantedIntents = desired.filter((intent) => {
    if (
      intent === GatewayIntentBits.GuildMembers &&
      !isGranted(PRIVILEGED_GRANT_BITS.members)
    ) {
      refused.push("GuildMembers");
      return false;
    }
    if (
      intent === GatewayIntentBits.GuildPresences &&
      !isGranted(PRIVILEGED_GRANT_BITS.presence)
    ) {
      refused.push("GuildPresences");
      return false;
    }
    if (
      intent === GatewayIntentBits.MessageContent &&
      !isGranted(PRIVILEGED_GRANT_BITS.messageContent)
    ) {
      refused.push("MessageContent");
      return false;
    }
    return true;
  });

  if (refused.length > 0) {
    const msg =
      `[discord-kit] Privileged intent(s) not granted in Discord Developer Portal: ${refused.join(", ")}. ` +
      "Connecting in degraded mode without them to prevent Gateway closure (4014 'Disallowed intents'). " +
      "Enable them in: Discord Dev Portal -> Applications -> Bot -> Privileged Gateway Intents.";
    if (logger.warn) logger.warn(msg);
    else console.warn(msg);
  }

  return [...grantedIntents];
}

export interface DiscordBotProfile {
  clientId?: string;
  name?: string;
}

/**
 * Asserts that the provided bot token matches the expected client ID profile before Gateway login,
 * preventing cross-environment token mix-ups.
 */
export async function assertDiscordTokenMatchesProfile(
  botToken: string,
  profile: DiscordBotProfile,
  options: {
    fetchImpl?: typeof fetch;
    apiBase?: string;
    timeoutMs?: number;
  } = {},
): Promise<void> {
  if (!profile.clientId) {
    throw new Error(
      `[discord-kit] Discord clientId is missing for profile "${profile.name ?? "unnamed"}"`,
    );
  }
  const fetchFn = options.fetchImpl ?? globalThis.fetch;
  const apiBase = options.apiBase ?? "https://discord.com/api/v10";
  const timeoutMs = options.timeoutMs ?? 10_000;

  const response = await fetchFn(`${apiBase}/applications/@me`, {
    headers: { Authorization: `Bot ${botToken}` },
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!response.ok) {
    throw new Error(
      `[discord-kit] Discord /applications/@me refused token for profile "${profile.name ?? "unnamed"}" (HTTP ${response.status})`,
    );
  }

  const app = (await response.json()) as { id?: string; name?: string };
  if (app.id !== profile.clientId) {
    throw new Error(
      `[discord-kit] Bot token belongs to application ${app.id} ("${app.name}"), ` +
        `which does NOT match configured clientId ${profile.clientId} for profile "${profile.name ?? "unnamed"}"`,
    );
  }
}
