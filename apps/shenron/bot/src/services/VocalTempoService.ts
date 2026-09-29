import { singleton, inject } from "tsyringe";
import { and, eq } from "drizzle-orm";
import {
	ChannelType,
	PermissionFlagsBits,
	type Guild,
	type VoiceChannel,
	type GuildMember,
} from "discord.js";
import { DatabaseService } from "~/db/index";
import { vocalTempo, vocalTempoBans } from "~/db/schema";

@singleton()
export class VocalTempoService {
	constructor(@inject(DatabaseService) private dbs: DatabaseService) {}

	private get db() {
		return this.dbs.db;
	}

	async createFor(
		guild: Guild,
		owner: GuildMember,
		hubParentId: string | undefined
	): Promise<VoiceChannel> {
		const parent = hubParentId ? await guild.channels.fetch(hubParentId).catch(() => null) : null;
		const channel = (await guild.channels.create({
			name: `🔊 ${owner.displayName}`,
			type: ChannelType.GuildVoice,
			parent: parent?.type === ChannelType.GuildCategory ? parent.id : null,
			permissionOverwrites: [
				{
					id: owner.id,
					allow: [
						PermissionFlagsBits.ManageChannels,
						PermissionFlagsBits.MoveMembers,
						PermissionFlagsBits.MuteMembers,
						PermissionFlagsBits.DeafenMembers,
						PermissionFlagsBits.Connect,
						PermissionFlagsBits.Speak,
					],
				},
			],
		})) as VoiceChannel;

		await this.db.insert(vocalTempo).values({ channelId: channel.id, ownerId: owner.id });
		return channel;
	}

	async isTempo(channelId: string): Promise<boolean> {
		const row = await this.db.query.vocalTempo.findFirst({
			where: eq(vocalTempo.channelId, channelId),
		});
		return !!row;
	}

	async ownerOf(channelId: string): Promise<string | null> {
		const row = await this.db.query.vocalTempo.findFirst({
			where: eq(vocalTempo.channelId, channelId),
		});
		return row?.ownerId ?? null;
	}

	async remove(channelId: string) {
		await this.db.delete(vocalTempo).where(eq(vocalTempo.channelId, channelId));
	}

	async banUser(ownerId: string, targetId: string) {
		await this.db
			.insert(vocalTempoBans)
			.values({ ownerId, bannedUserId: targetId })
			.onConflictDoNothing();
	}

	async unbanUser(ownerId: string, targetId: string) {
		await this.db
			.delete(vocalTempoBans)
			.where(and(eq(vocalTempoBans.ownerId, ownerId), eq(vocalTempoBans.bannedUserId, targetId)));
	}

	async isBanned(ownerId: string, targetId: string): Promise<boolean> {
		const row = await this.db.query.vocalTempoBans.findFirst({
			where: and(eq(vocalTempoBans.ownerId, ownerId), eq(vocalTempoBans.bannedUserId, targetId)),
		});
		return !!row;
	}
}
