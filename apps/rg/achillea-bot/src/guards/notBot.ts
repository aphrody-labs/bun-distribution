// SPDX-License-Identifier: Apache-2.0
import { NotBot as NotBotKit } from "@aphrody/discord-kit";
import type { ArgsOf, GuardFunction } from "discordx";

/**
 * Prevent other bots to interact with this bot.
 * Re-exported from @aphrody/discord-kit for monorepo alignment.
 */
export const NotBot: GuardFunction<
	EmittedInteractions | ArgsOf<"messageCreate" | "messageReactionAdd" | "voiceStateUpdate">
> = NotBotKit as GuardFunction<
	EmittedInteractions | ArgsOf<"messageCreate" | "messageReactionAdd" | "voiceStateUpdate">
>;
