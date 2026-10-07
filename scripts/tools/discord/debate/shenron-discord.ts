// SPDX-License-Identifier: Apache-2.0
import { loadCredentials, makeApi } from "../../../../packages/discord/kit/src/lab/ai-lab.ts";
import { DiscordRESTError } from "../../../../packages/discord/kit/src/rest.ts";

if (import.meta.main) {
  try {
    const encoded = process.argv[2] ?? "";
    if (!encoded || encoded.length > 16000) throw new Error("Bounded request required");
    const request = JSON.parse(Buffer.from(encoded, "base64").toString("utf8")) as {
      action: string;
      channelId?: string;
      message?: { content: string; nonce: string; message_reference?: unknown };
    };
    if (!["status", "send"].includes(request.action)) throw new Error("Unknown action");
    const credentials = await loadCredentials("/etc/rose-griffon/shenron-bot.env");
    const token =
      credentials.DISCORD_TOKEN_SHENRON ??
      credentials.DISCORD_BOT_TOKEN ??
      credentials.DISCORD_TOKEN ??
      credentials.TOKEN;
    if (!token) throw new Error("Missing bot credential");
    const api = makeApi(token);
    const self = await api<{ id: string }>("/users/@me");
    if (self.id !== "1497194276025663680") throw new Error("Shenron identity mismatch");
    const guild = await api<{ id: string }>("/guilds/1554189180030947338");
    if (guild.id !== "1554189180030947338") throw new Error("Guild identity mismatch");
    if (request.action === "status") {
      console.log(JSON.stringify({ available: true, botId: self.id }));
      process.exit(0);
    }
    if (
      !/^\d+$/.test(request.channelId ?? "") ||
      !request.message ||
      typeof request.message.content !== "string" ||
      request.message.content.length > 1900 ||
      !/^[a-z0-9]{1,25}$/.test(request.message.nonce)
    )
      throw new Error("Invalid message");
    const channel = await api<{ guild_id: string; name: string; type: number }>(
      `/channels/${request.channelId}`,
    );
    if (channel.guild_id !== guild.id || channel.type !== 0 || channel.name !== "debat")
      throw new Error("Debate channel required");
    const message = await api<{ id: string }>(`/channels/${request.channelId}/messages`, "POST", {
      content: request.message.content,
      nonce: request.message.nonce,
      enforce_nonce: true,
      allowed_mentions: { parse: [], replied_user: false },
    });
    console.log(JSON.stringify({ messageId: message.id, botId: self.id }));
  } catch (error) {
    console.log(
      JSON.stringify({
        available: false,
        error:
          error instanceof DiscordRESTError
            ? `Discord HTTP ${error.status}`
            : "Shenron transport unavailable",
      }),
    );
    process.exitCode = 1;
  }
}
