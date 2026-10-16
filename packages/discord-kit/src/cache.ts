// SPDX-License-Identifier: Apache-2.0
import { Options, type ClientOptions, type SweeperOptions } from "discord.js";

export interface ProductionCacheConfig {
  messageLimit?: number;
  threadLimit?: number;
  reactionLimit?: number;
  stageInstanceLimit?: number;
  messageSweeperInterval?: number;
  messageSweeperLifetime?: number;
  threadSweeperInterval?: number;
  threadSweeperLifetime?: number;
  sweeperOverrides?: Partial<SweeperOptions>;
}

export interface ProductionCacheOptions {
  makeCache: NonNullable<ClientOptions["makeCache"]>;
  sweepers: SweeperOptions;
}

/**
 * Creates standardized production cache limits and sweeper configurations
 * for Discord.js clients running on Bun in 24/7 gateway mode.
 *
 * Without cache limits and sweepers, Discord.js retains all messages, threads,
 * and reactions indefinitely in RAM, leading to memory bloat over days or weeks of uptime.
 */
export function createProductionCacheOptions(
  config: ProductionCacheConfig = {},
): ProductionCacheOptions {
  const messageLimit = config.messageLimit ?? 200;
  const threadLimit = config.threadLimit ?? 50;
  const reactionLimit = config.reactionLimit ?? 0;
  const stageInstanceLimit = config.stageInstanceLimit ?? 0;

  const messageInterval = config.messageSweeperInterval ?? 3600;
  const messageLifetime = config.messageSweeperLifetime ?? 1800;
  const threadInterval = config.threadSweeperInterval ?? 3600;
  const threadLifetime = config.threadSweeperLifetime ?? 3600;

  return {
    makeCache: Options.cacheWithLimits({
      MessageManager: messageLimit,
      ThreadManager: threadLimit,
      ReactionManager: reactionLimit,
      StageInstanceManager: stageInstanceLimit,
    }),
    sweepers: {
      ...Options.DefaultSweeperSettings,
      messages: { interval: messageInterval, lifetime: messageLifetime },
      threads: { interval: threadInterval, lifetime: threadLifetime },
      ...config.sweeperOverrides,
    },
  };
}
