import { env } from "@/env";
import { discordBotProfile } from "./discord-profile";

export const generalConfig: GeneralConfigType = {
	name: "AchilleaBot", // the name of your bot
	description: `Lien vers le site d'Achillea: ${env.WEBSITE_URL}`, // the description of your bot
	defaultLocale: "fr", // default language of the bot, must be a valid locale
	ownerId: env.BOT_OWNER_ID,
	timezone: "Europe/Paris", // default TimeZone to well format and localize dates (logs, stats, etc)

	simpleCommandsPrefix: "!", // default prefix for simple command messages (old way to do commands on discord)
	automaticDeferring: false, // enable or not the automatic deferring of the replies of the bot on the command interactions

	// useful links
	links: {
		invite: "", // https://discord.com/oauth2/authorize?client_id=1256600975464992818
		supportServer: "",
		gitRemoteRepo: "",
	},

	automaticUploadImagesToImgur: false, // enable or not the automatic assets upload

	devs: [
		"281114294152724491", // yoyo__goat (owner Achilléa)
		"238660901375442954",
		"1116660779320606812",
		"1256977518788083737",
		"1365017459484131348",
		"1365017877677346899",
	], // discord IDs of the devs that are working on the bot (you don't have to put the owner's id here)

	// define the bot activities (phrases under its name). Types can be: PLAYING, LISTENING, WATCHING, STREAMING
	activities: [
		{
			text: "Développement en cours",
			type: "PLAYING",
		},
	],
};

// global colors
export const colorsConfig = {
	primary: "#2F3136",
};

const coreManagerConfig_Test = {
	coreGuildId: "1210166824918978600", // The guild ID of the core guild
	coreGuildName: "Achillea",
	rankedCategoryId: "1261289734521749524", // The category ID of the category where the ranked channels will be created
	clanCategoryId: "1366082215460606003", // The category ID of the category where the clan channels will be created
	interclanCategoryId: "1433410236009545789",
	botId:
		discordBotProfile.clientId ??
		(discordBotProfile.name === "current" ? "1427690638576582697" : "1256600975464992818"),
	clanInvitesForumId: "1367046267590541363",
	clanAnnouncementsChannelId: "1388101315263201334", // The channel ID of the channel where the clan announcements will be sent
	botChannelId: "1388102060356145152", // The channel ID of the channel where the users will use bot commands
	captainRoleId: "1387483596880740509", // The role ID of the captain role
	rankedAnnouncementsChannelId: "1391150609104769206", // The channel ID of the channel where the ranked announcements will be sent
	// Salons de la catégorie Ranked (serveur de test) — laissés vides faute d'IDs dédiés (les intégrations skippent si vide).
	leaderboardChannelId: "",
	rankedQueueChannelId: "",
	generalRankedChannelId: "",
	helpRankedVoiceId: "",
	toChannelId: "", // salon des Tournament Organizers
};

const coreManagerConfig_Prod = {
	coreGuildId: "1055585286320554055", // The guild ID of the core guild
	coreGuildName: "Achillea 💮 - Inazuma Eleven FR",
	rankedCategoryId: "1398801439026974822", // The category ID of the category where the ranked channels will be created
	clanCategoryId: "1457486074874957917", // The category ID of the category where the clan channels will be created
	interclanCategoryId: "",
	botId:
		discordBotProfile.clientId ??
		(discordBotProfile.name === "current" ? "1427690638576582697" : "1256600975464992818"),
	clanInvitesForumId: "1398801519729709128",
	clanAnnouncementsChannelId: "1398801515694788719", // The channel ID of the channel where the clan announcements will be sent
	botChannelId: "1437025812833370313", // The channel ID of the channel where the users will use bot commands
	captainRoleId: "1398801292079403121", // The role ID of the captain role
	rankedAnnouncementsChannelId: "1398801521029943501", // The channel ID of the channel where the ranked announcements will be sent
	// Salons de la catégorie 🏅・Ranked (serveur central) — intégrations bot.
	leaderboardChannelId: "1398801522749477034", // 🏅・leaderboard — classement auto-actualisé
	rankedQueueChannelId: "1398801524179734528", // 🎮・ranked-queue — pont file web + feed résultats
	generalRankedChannelId: "1398801536313983027", // 💬・général-ranked
	helpRankedVoiceId: "1398801498598539356", // 🛑・Aide Ranked (vocal de support)
	toChannelId: "1436378680153608203", // ⚙🎮〡discussion-to — Tournament Organizers (preuves + alertes)
};

export const coreManagerConfig =
	env.NODE_ENV === "development" ? coreManagerConfig_Test : coreManagerConfig_Prod;

export const adminManagerConfig = {
	adminGuildId: "1387955162450100296", // The guild ID of the admin guild
	adminRoleId: "1387955371791876219", // The role ID of the admin role
	superadminsChannel: "1448033233337061487",
	adminCommandChannel: "1387959901191667974", // The channel ID of the channel where the admin commands will be allowed
	clansAdministrativeChannel: "1387959609414779004", // The channel ID of the channel where the clans administrative messages will be sent
	penaltiesAdministrativeChannel: "1387959649206014164", // The channel ID of the channel where the penalties will be sent
	rankedAdministrativeChannel: "1387959717556519132", // The channel ID of the channel where the ranked administrative messages will be sent
	tournamentAdministrativeChannel: "1387959803464253551", // The channel ID of the channel where the tournament administrative messages will be sent
};
