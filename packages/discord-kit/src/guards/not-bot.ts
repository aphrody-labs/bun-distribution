// SPDX-License-Identifier: Apache-2.0
import type { User } from "discord.js";
import type { GuardFunction } from "discordx";

/**
 * Extracts a Discord User object from various interaction and event parameter shapes.
 */
export function extractUserFromPayload(payload: unknown): User | null {
  if (!payload || typeof payload !== "object") return null;

  const target = Array.isArray(payload) ? payload[0] : payload;
  if (!target || typeof target !== "object") return null;

  // Interactions: CommandInteraction, ButtonInteraction, etc.
  if ("user" in target && (target as { user: unknown }).user) {
    return (target as { user: User }).user;
  }

  // Messages: Message
  if ("author" in target && (target as { author: unknown }).author) {
    return (target as { author: User }).author;
  }

  // Guild members or voice state: GuildMember, VoiceState
  if (
    "member" in target &&
    (target as { member: { user?: User } }).member?.user
  ) {
    return (target as { member: { user: User } }).member.user;
  }

  // Reactions: MessageReaction
  if (
    "message" in target &&
    (target as { message: { author?: User } }).message?.author
  ) {
    return (target as { message: { author: User } }).message.author;
  }

  return null;
}

/**
 * DiscordX Guard that prevents other Discord bots from triggering commands,
 * interactions, messages, or voice events.
 */
export const NotBot: GuardFunction<unknown> = async (arg, _client, next) => {
  const user = extractUserFromPayload(arg);
  if (user?.bot) {
    return;
  }
  await next();
};
