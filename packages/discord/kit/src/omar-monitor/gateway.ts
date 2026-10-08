// SPDX-License-Identifier: Apache-2.0
import { Client, GatewayIntentBits, Options } from "discord.js";
import { resolveGrantedIntents } from "../preflight.ts";

export interface MonitorChannel {
  id: string;
  guild_id: string;
  type: number;
  last_message_id: string | null;
}

export type GatewayMessage = {
  id: string;
  guildId: string | null;
  channelId: string;
  content: string;
  author: { id: string; bot: boolean };
  webhookId: string | null;
  mentions: { id: string }[];
  mentionRoles: string[];
  mentionEveryone: boolean;
};

const MESSAGE_CHANNEL_TYPES = new Set([0, 2, 5, 10, 11, 12, 13, 15, 16]);

/** Discord sends the guild's visible channels and active threads in its Gateway cache. */
export function cachedMonitorChannels(client: Client, guildId: string): MonitorChannel[] {
  const guild = client.guilds.cache.get(guildId);
  if (!guild?.available)
    throw new Error("Discord target guild is unavailable in the Gateway cache");
  const channels = [...client.channels.cache.values()]
    .filter(
      (channel) =>
        "guildId" in channel &&
        channel.guildId === guildId &&
        MESSAGE_CHANNEL_TYPES.has(channel.type),
    )
    .map((channel) => ({
      id: channel.id,
      guild_id: guildId,
      type: channel.type,
      last_message_id: "lastMessageId" in channel ? channel.lastMessageId : null,
    }));
  if (!channels.length) throw new Error("Discord target guild exposes no monitorable channels");
  return channels;
}

/** Keep Discord's heartbeat, resume and reconnect protocol under its existing owner. */
export async function connectGateway(
  token: string,
  onMessage: (message: GatewayMessage) => void,
  onReady: () => void,
  onDisconnect: () => void,
) {
  const intents = await resolveGrantedIntents(token, {
    desiredIntents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
    ],
  });
  if (!intents.includes(GatewayIntentBits.MessageContent))
    throw new Error("Discord MessageContent grant required");
  const client = new Client({
    intents,
    makeCache: Options.cacheWithLimits({ MessageManager: 0, GuildMemberManager: 0 }),
    allowedMentions: { parse: [] },
  });
  client.on("messageCreate", (message) =>
    onMessage({
      id: message.id,
      guildId: message.guildId,
      channelId: message.channelId,
      content: message.content,
      author: { id: message.author.id, bot: message.author.bot },
      webhookId: message.webhookId,
      mentions: [...message.mentions.users.keys()].map((id) => ({ id })),
      mentionRoles: [...message.mentions.roles.keys()],
      mentionEveryone: message.mentions.everyone,
    }),
  );
  let signalReady!: () => void;
  const ready = new Promise<void>((resolve) => {
    signalReady = resolve;
  });
  client.on("clientReady", () => {
    onReady();
    signalReady();
  });
  client.on("shardResume", onReady);
  client.on("shardDisconnect", onDisconnect);
  client.on("error", () => console.error(JSON.stringify({ event: "gateway-error" })));
  await client.login(token);
  let readyTimer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      ready,
      new Promise<never>((_resolve, reject) => {
        readyTimer = setTimeout(
          () => reject(new Error("Discord Gateway readiness timeout")),
          30_000,
        );
      }),
    ]);
  } catch (error) {
    client.destroy();
    throw error;
  } finally {
    clearTimeout(readyTimer);
  }
  return client;
}
