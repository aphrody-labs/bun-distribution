import { singleton } from "tsyringe";
import type { Collection, Guild, Invite } from "discord.js";

/**
 * Track inviter for each member join — compare guild invite uses between snapshots.
 */
@singleton()
export class InviteTracker {
	private snapshots = new Map<string, Collection<string, Invite>>();

	async sync(guild: Guild) {
		const invites = await guild.invites.fetch().catch(() => null);
		if (invites) this.snapshots.set(guild.id, invites);
	}

	async detectInviter(guild: Guild): Promise<{ inviterId: string | null; code: string | null }> {
		const before = this.snapshots.get(guild.id);
		const after = await guild.invites.fetch().catch(() => null);
		if (after) this.snapshots.set(guild.id, after);
		if (!before || !after) return { inviterId: null, code: null };

		for (const [code, inv] of after) {
			const prev = before.get(code);
			if (!prev) continue;
			if ((inv.uses ?? 0) > (prev.uses ?? 0)) {
				return { inviterId: inv.inviterId ?? null, code };
			}
		}
		return { inviterId: null, code: null };
	}
}
