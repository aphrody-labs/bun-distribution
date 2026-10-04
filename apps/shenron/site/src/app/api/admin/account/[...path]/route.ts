// SPDX-License-Identifier: Apache-2.0
import { auth } from "@/lib/auth";
import { getCurrentUser } from "@/lib/session";
import { botAdmin } from "@/lib/bot-admin";
import { discordFetch, DiscordRESTError } from "@aphrody/discord-kit/rest";
import { discordGuildIcon as guildIcon } from "@shenron/config/public-urls";

export const dynamic = "force-dynamic";

/** Read the signed-in administrator's Discord account; tokens never leave the server. */
export async function GET(request: Request, context: { params: Promise<{ path: string[] }> }) {
  const reply = (body: unknown, status = 200) =>
    Response.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
  const me = await getCurrentUser();
  if (!me?.user?.roleAdmin) return reply({ error: "Forbidden" }, 403);
  const path = (await context.params).path.join("/");
  if (path === "auth/me")
    return reply({
      authenticated: true,
      user: {
        id: me.discordId,
        username: me.user.username,
        avatar: me.user.avatar,
        source: "better-auth",
      },
    });
  if (!["discord/me", "discord/guilds", "discord/guild-member"].includes(path))
    return reply({ error: "Not found" }, 404);
  let token: string;
  try {
    const accounts = await auth.api.listUserAccounts({ headers: request.headers });
    const account = accounts.find((entry) => entry.providerId === "discord");
    if (!account) return reply({ error: "Connexion Discord requise" }, 401);
    token = (
      await auth.api.getAccessToken({ headers: request.headers, body: { accountId: account.id } })
    ).accessToken;
  } catch {
    return reply({ error: "Reconnectez votre compte Discord" }, 401);
  }
  try {
    if (path === "discord/me") {
      const { data } = await discordFetch("/users/@me", { mode: "Bearer", token });
      return reply({ user: data });
    }
    const current = (await botAdmin.discord.guild()) as { guild?: { id?: string } };
    const guildId = current.guild?.id;
    if (!guildId || !/^\d+$/.test(guildId))
      return reply({ error: "Serveur Discord indisponible" }, 503);
    if (path === "discord/guild-member") {
      const { data } = await discordFetch(`/users/@me/guilds/${guildId}/member`, {
        mode: "Bearer",
        token,
      });
      return reply({ member: data });
    }
    const { data } = await discordFetch<Array<{ id: string; icon: string | null }>>(
      "/users/@me/guilds?with_counts=true",
      { mode: "Bearer", token },
    );
    return reply({
      guilds: data.map((guild) => ({
        ...guild,
        iconUrl: guildIcon(guild.id, guild.icon, { size: 128 }),
        isCurrent: guild.id === guildId,
      })),
    });
  } catch (error) {
    return reply(
      { error: error instanceof DiscordRESTError ? error.message : "Discord est indisponible" },
      error instanceof DiscordRESTError ? error.status : 502,
    );
  }
}
