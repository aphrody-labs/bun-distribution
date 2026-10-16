import { type ArgsOf, Discord, On } from "discordx";
import type { Client } from "discord.js";

import { syncOneMember, syncOneUser } from "../services/syncMembers";
import { BOT_SYNC_MEMBRES, GUILD_ID } from "../lib/config";

/**
 * Écoute des événements de membres.
 *
 * `rg-cron.service` branche déjà `guildMemberAdd`, `guildMemberRemove`,
 * `guildMemberUpdate` et `userUpdate` sur les mêmes fonctions de
 * synchronisation (`packages/cron/src/lib/discord.ts`). Comme les deux démons
 * ouvrent une passerelle avec le même jeton, les deux reçoivent chaque
 * événement : laisser ces gestionnaires actifs écrirait deux fois la même
 * ligne dans `discord_members` à chaque arrivée ou changement de pseudo.
 *
 * Ils restent donc inertes tant que `BOT_SYNC_MEMBRES=1` n'est pas posé.
 */
@Discord()
export class MemberEvents {
  @On({ event: "guildMemberAdd" })
  async onAdd([member]: ArgsOf<"guildMemberAdd">) {
    if (!BOT_SYNC_MEMBRES) return;
    if (member.guild.id !== GUILD_ID) return;
    await syncOneMember(member).catch(err => console.error("[guildMemberAdd] échec :", err));
  }

  @On({ event: "guildMemberUpdate" })
  async onUpdate([_, after]: ArgsOf<"guildMemberUpdate">) {
    if (!BOT_SYNC_MEMBRES) return;
    if (after.guild.id !== GUILD_ID) return;
    await syncOneMember(after).catch(err => console.error("[guildMemberUpdate] échec :", err));
  }

  @On({ event: "userUpdate" })
  async onUserUpdate([_, after]: ArgsOf<"userUpdate">, client: Client) {
    if (!BOT_SYNC_MEMBRES) return;
    if (!GUILD_ID) return;
    const guild = client.guilds.cache.get(GUILD_ID);
    if (!guild) return;
    await syncOneUser(after, guild).catch(err => console.error("[userUpdate] échec :", err));
  }
}
