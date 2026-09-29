import "reflect-metadata";
import { Client, GatewayIntentBits, ChannelType, type GuildChannel } from "discord.js";
import { env } from "~/lib/env";

const OUT = `${import.meta.dir}/../data/guild-scan.json`;

const client = new Client({
	intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers],
});

await client.login(env.DISCORD_TOKEN);
await new Promise<void>((r) => client.once("clientReady", () => r()));

const guild = await client.guilds.fetch(env.GUILD_ID);
await guild.channels.fetch();
await guild.roles.fetch();

console.log(`Fetching members for guild ${guild.id}…`);
// Nécessite l'intent privilégié "Server Members" dans le portail dev.
const members = await guild.members.fetch();
console.log(`✓ ${members.size} members`);

const channelTypeLabel = (t: ChannelType) => {
	switch (t) {
		case ChannelType.GuildText:
			return "text";
		case ChannelType.GuildVoice:
			return "voice";
		case ChannelType.GuildCategory:
			return "category";
		case ChannelType.GuildAnnouncement:
			return "announcement";
		case ChannelType.GuildStageVoice:
			return "stage";
		case ChannelType.GuildForum:
			return "forum";
		case ChannelType.GuildMedia:
			return "media";
		case ChannelType.PublicThread:
			return "thread-public";
		case ChannelType.PrivateThread:
			return "thread-private";
		case ChannelType.AnnouncementThread:
			return "thread-announcement";
		default:
			return `type-${t}`;
	}
};

const channels = [...guild.channels.cache.values()]
	.toSorted(
		(a, b) =>
			a.type - b.type || ((a as GuildChannel).position ?? 0) - ((b as GuildChannel).position ?? 0)
	)
	.map((c) => {
		const gc = c as GuildChannel;
		return {
			id: c.id,
			name: c.name,
			type: channelTypeLabel(c.type),
			parentId: gc.parentId ?? null,
			parentName: gc.parentId ? (guild.channels.cache.get(gc.parentId)?.name ?? null) : null,
			position: gc.position ?? null,
		};
	});

const roles = [...guild.roles.cache.values()]
	.filter((r) => r.name !== "@everyone")
	.toSorted((a, b) => b.position - a.position)
	.map((r) => ({
		id: r.id,
		name: r.name,
		color: r.hexColor,
		position: r.position,
		hoist: r.hoist,
		managed: r.managed,
		mentionable: r.mentionable,
		permissions: r.permissions.toArray(),
		memberCount: r.members.size,
	}));

const users = [...members.values()].map((m) => ({
	id: m.id,
	username: m.user.username,
	globalName: m.user.globalName ?? null,
	nickname: m.nickname,
	bot: m.user.bot,
	joinedAt: m.joinedAt?.toISOString() ?? null,
	premiumSince: m.premiumSince?.toISOString() ?? null,
	roles: [...m.roles.cache.keys()].filter((id) => id !== guild.id),
}));

const payload = {
	scannedAt: new Date().toISOString(),
	guild: {
		id: guild.id,
		name: guild.name,
		memberCount: guild.memberCount,
		ownerId: guild.ownerId,
	},
	counts: {
		channels: channels.length,
		roles: roles.length,
		users: users.length,
	},
	channels,
	roles,
	users,
};

await Bun.write(OUT, JSON.stringify(payload, null, 2));
console.log(`✓ ${OUT}`);
console.log(`   channels=${channels.length}  roles=${roles.length}  users=${users.length}`);

await client.destroy();
process.exit(0);
