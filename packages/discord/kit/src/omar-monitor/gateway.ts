// SPDX-License-Identifier: Apache-2.0
import { Client, GatewayIntentBits, Options } from "discord.js";
import { resolveGrantedIntents } from "../preflight.ts";

/** Keep Discord's heartbeat, resume and reconnect protocol under its existing owner. */
export async function connectGateway(
  token: string,
  onMessage: (message: {
    id: string;
    guildId: string | null;
    channelId: string;
    content: string;
    author: { id: string; bot: boolean };
    webhookId: string | null;
  }) => void,
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
  client.on("messageCreate", onMessage);
  client.on("clientReady", onReady);
  client.on("shardResume", onReady);
  client.on("shardDisconnect", onDisconnect);
  client.on("error", () => console.error(JSON.stringify({ event: "gateway-error" })));
  await client.login(token);
  return client;
}
