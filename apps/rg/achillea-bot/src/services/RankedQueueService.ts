import { rel } from "@mikro-orm/core";
import type { BaseMessageOptions, Guild, TextChannel, User as DiscordUser } from "discord.js";
import {
	ActionRowBuilder,
	ButtonBuilder,
	ButtonStyle,
	ChannelType,
	PermissionFlagsBits,
	userMention,
} from "discord.js";
import { Client } from "@aphrody/discordx";
import { asyncScheduler } from "rxjs";

import { coreManagerConfig } from "@/configs";
import { Service } from "@/decorators";
import { EventAnnouncement, Lobby, LobbyUser, Ranked, RankedQueueEntry, User } from "@/entities";
import { Database, Logger, Store } from "@/services";
import {
	batchCreateChannels,
	batchSend,
	createRankedCanceledEmbed,
	createRankedOngoingEmbed,
	createRankedQueueEmbed,
	resolveDependency,
	runInRequestContext,
	syncUser,
} from "@/utils/functions";

import { LobbyState, LobbyUserState, MatchMode, RankedState, TeamSide } from "../utils/enums";
import { logOnAchilleaRankedChannel } from "../utils/functions/messager";
import type { LobbyStruct, MatchStruct } from "../utils/types/lobbyStruct";
import { AnnouncementService } from "./AnnouncementService";
import { TwitchService } from "./Twitch";
import { UserService } from "./UserService";

@Service()
export class RankedQueueService {
	private updateTimers = new Map<string, NodeJS.Timeout>();

	constructor(
		private store: Store,
		private db: Database,
		private announcer: AnnouncementService,
		private userService: UserService,
		private twitchService: TwitchService
	) {}

	/**
	 * Restore queue for a specific Ranked event
	 */
	async initFromDatabase(ranked: Ranked) {
		const entries = await this.db.em.find(RankedQueueEntry, { ranked }, { populate: ["user"] });
		const userIds = entries.map((entry) => entry.user.id);

		this.store.update("matchmakingQueues", (queues) => ({
			...queues,
			[ranked.id]: userIds,
		}));

		this.store.update("queueLocks", (locks) => ({
			...locks,
			[ranked.id]: ranked.status !== RankedState.OPEN,
		}));
	}

	/**
	 * Join the queue for a Ranked event
	 */
	async joinQueue(ranked: Ranked, discordUser: DiscordUser): Promise<"already-in" | "success"> {
		const existing = await this.db.em.findOne(RankedQueueEntry, {
			ranked,
			user: discordUser.id,
		});
		if (existing) return "already-in";

		let user = await this.db.em.findOne(User, { id: discordUser.id });
		if (!user) {
			await syncUser(discordUser);

			user = await this.db.em.findOne(User, { id: discordUser.id });
		}

		const entry = new RankedQueueEntry();
		entry.user = user!;
		entry.ranked = ranked;
		await this.db.em.persist(entry).flush();

		this.store.update("matchmakingQueues", (queues) => ({
			...queues,
			[ranked.id]: [...(queues[ranked.id] || []), discordUser.id],
		}));

		return "success";
	}

	/**
	 * Leave the queue for a Ranked event
	 */
	async leaveQueue(ranked: Ranked, userId: string): Promise<"not-in" | "success"> {
		const affected = await this.db.em.nativeDelete(RankedQueueEntry, {
			ranked,
			user: userId,
		});
		if (!affected) return "not-in";

		this.store.update("matchmakingQueues", (queues) => ({
			...queues,
			[ranked.id]: queues[ranked.id].filter((id) => id !== userId),
		}));

		return "success";
	}

	/**
	 * Clear queue for a Ranked event
	 */
	async clearQueue(ranked: Ranked) {
		await this.db.em.nativeDelete(RankedQueueEntry, { ranked });

		this.store.update("matchmakingQueues", (queues) => ({
			...queues,
			[ranked.id]: [],
		}));

		this.store.update("queueLocks", (locks) => ({
			...locks,
			[ranked.id]: false,
		}));
	}

	/**
	 * Get queue members
	 */
	getQueue(ranked: Ranked): string[] {
		return this.store.get("matchmakingQueues")[ranked.id] ?? [];
	}

	/**
	 * Lock and unlock the queue
	 */
	async lockQueue(ranked: Ranked) {
		this.store.update("queueLocks", (locks) => ({
			...locks,
			[ranked.id]: true,
		}));

		ranked.status = RankedState.LOCKED;
		await this.db.em.persist(ranked).flush();
	}

	async unlockQueue(ranked: Ranked) {
		this.store.update("queueLocks", (locks) => ({
			...locks,
			[ranked.id]: false,
		}));

		ranked.status = RankedState.OPEN;
		await this.db.em.persist(ranked).flush();
	}

	isQueueLocked(ranked: Ranked): boolean {
		return this.store.get("queueLocks")[ranked.id] ?? false;
	}

	/**
	 * Watchdog reset if queue is locked but empty
	 */
	async watchdog(ranked: Ranked) {
		const queue = this.getQueue(ranked);
		const locked = this.isQueueLocked(ranked);

		if (locked && queue.length === 0) {
			await this.clearQueue(ranked);
			ranked.status = RankedState.FINISHED;
			await this.db.em.persist(ranked).flush();
			console.info(`[Watchdog] Cleared stuck queue for ${ranked.id}`);
		}
	}

	async restoreQueuesOnStartup(client: Client) {
		const now = new Date();
		const openRankedEvents = await this.db.em.find(Ranked, {
			status: { $nin: [RankedState.FINISHED, RankedState.CANCELED] },
		});

		for (const ranked of openRankedEvents) {
			await this.initFromDatabase(ranked);
			const msLeft = ranked.queueEndsAt.getTime() - now.getTime();

			if (ranked.status === RankedState.OPEN) {
				if (msLeft <= 0) {
					// time’s up already → start immediately
					await this.startSession(ranked, client);
				} else {
					// schedule it for the future
					asyncScheduler.schedule(() => this.startSession(ranked, client), msLeft);
				}
			} else {
				await this.startSession(ranked, client);
			}

			console.info(`[Startup] Restored queue ${ranked.id}, status: ${ranked.status}`);
		}
	}

	async watchdogCheckAllRanked() {
		const rankedEvents = await this.db.em.find(Ranked, {
			status: {
				$in: [RankedState.OPEN, RankedState.LOCKED, RankedState.MATCHING],
			},
		});

		for (const ranked of rankedEvents) {
			await this.watchdog(ranked);
		}
	}

	/**
	 * Locks the queue and returns an array of match groups.
	 * For ONE_VS_ONE: groups of 2. For TWO_VS_TWO: groups of 4.
	 */
	private async lockAndSeed(ranked: Ranked, client: Client) {
		if (ranked.status === RankedState.OPEN) await this.lockQueue(ranked);

		const isValidating = ranked.status === RankedState.VALIDATING_PRESENCE;
		if (!isValidating) {
			const initialQueue = [...this.getQueue(ranked)];

			if (initialQueue.length < ranked.mode) return [];

			ranked.status = RankedState.VALIDATING_PRESENCE;
			await this.db.em.persist(ranked).flush();

			const validator = new ButtonBuilder()
				.setEmoji("✅")
				.setCustomId(`confirm_presence:${ranked.id}`)
				.setStyle(ButtonStyle.Primary);

			const msg: BaseMessageOptions = {
				embeds: [],
				components: [new ActionRowBuilder<ButtonBuilder>().addComponents(validator) as any],
			};

			await this.announcer.editEventAnnouncements(client, ranked, msg);
		}

		// setTimeout = nouveau tick hors RequestContext → wrap obligatoire (le travail DB
		// d'onPresenceValidationComplete tape sinon l'EM global, refusé par MikroORM v7).
		setTimeout(() => {
			runInRequestContext(this.db, () => this.onPresenceValidationComplete(ranked, client)).catch(
				(err) => {
					console.error("[ranked] onPresenceValidationComplete failed:", err);
				}
			);
		}, 90_000);
	}

	private async onPresenceValidationComplete(ranked: Ranked, client: Client) {
		if (ranked.status === RankedState.VALIDATING_PRESENCE) {
			// Edit embed to PROCESSING... (?)

			await this.syncAndfilterQueue(ranked);

			ranked.status = RankedState.PAIRING;
			await this.db.em.persist(ranked).flush();
		}

		const syncedQueue = [...this.getQueue(ranked)];

		const existingLobbies = await this.db.em.find(Lobby, { event: ranked.id });
		const matches: MatchStruct[] = [];

		if (existingLobbies.length === 0) {
			const { matchGroups, kicked } = this.pairUsers(syncedQueue, ranked.mode);

			// if leftover players, kick them (last in queue)
			for (const kickedUser of kicked) {
				await this.leaveQueue(ranked, kickedUser);
				const logger = await resolveDependency(Logger);
				await logOnAchilleaRankedChannel(logger, {
					content: `Kicked ${userMention(kickedUser)} from queue for ${ranked.name} due to insufficient players.`,
				});
			}

			if (matchGroups.length === 0) {
				console.info("No participants… Queue canceled.");
				ranked.status = RankedState.CANCELED;
				await this.db.em.persist(ranked).flush();

				const msg: BaseMessageOptions = {
					embeds: [
						createRankedCanceledEmbed(
							ranked,
							"La file n'a pas atteint le nombre minimum de joueurs requis pour démarrer"
						),
					],
					components: [],
				};

				await this.announcer.editEventAnnouncements(client, ranked, msg);
			}

			await this.createLobbies(ranked, matchGroups);
			matches.push(...matchGroups);
		} else {
			const lobbiesToRestore = existingLobbies.filter((lobby) => !lobby.channelId);
			const matchGroups: MatchStruct[] = lobbiesToRestore.map((lobby) => ({
				players: lobby.lobbyUsers.getItems().map((lu) => lu.user.id),
				lobby,
			}));

			matches.push(...matchGroups);
		}

		const guild = await client.guilds.fetch(coreManagerConfig.coreGuildId);

		await this.initChannels(matches, guild);

		ranked.status = RankedState.VALIDATING_MATCH_START;
		await this.db.em.persist(ranked).flush();

		// Modify batchPresenceCheckAndRepool to match_start_validation_check_and_repool
		// setTimeout = nouveau tick hors RequestContext → wrap obligatoire.
		setTimeout(() => {
			runInRequestContext(this.db, () => this.batchPresenceCheckAndRepool(ranked, client)).catch(
				(err) => {
					console.error("[ranked] batchPresenceCheckAndRepool failed:", err);
				}
			);
		}, 90_000);
	}

	private async createLobbies(ranked: Ranked, matches: MatchStruct[]) {
		// 2) for each match group, create a lobby
		//    here we use a single “home” guild for all lobbies:
		await this.db.em.transactional<void>(async (em) => {
			for (const group of matches) {
				// create the Lobby entity
				const lobby = new Lobby();
				lobby.event = ranked;
				lobby.eventType = ranked.type;
				lobby.mode = ranked.mode;
				// persist lobby so we can FK into LobbyUser
				em.persist(lobby);

				group.lobby = lobby;

				// seed the two teams (or one-v-one) into LobbyUser rows
				group.players.forEach((userId, i) => {
					const team =
						ranked.mode === MatchMode.ONE_VS_ONE
							? i === 0
								? TeamSide.TEAM_1
								: TeamSide.TEAM_2
							: i < 2
								? TeamSide.TEAM_1
								: TeamSide.TEAM_2;
					const lu = new LobbyUser();
					lu.user = rel(User, userId); // FK to User
					lu.lobby = lobby; // FK to Lobby
					lu.team = team; // TeamSide enum

					em.persist(lu);
				});
			}
		});
	}

	private async syncAndfilterQueue(ranked: Ranked) {
		const queue = await this.db.em.find(RankedQueueEntry, {
			ranked: ranked.id,
		});
		for (const entry of queue) {
			if (!entry.validatedPresence) this.db.em.remove(entry);
		}
		await this.db.em.flush();
		const validatedQueue = await this.db.em.find(RankedQueueEntry, {
			ranked: ranked.id,
		});
		const userIds = validatedQueue.map((entry) => entry.user.id);

		this.store.update("matchmakingQueues", (oldQueues) => ({
			...oldQueues,
			[ranked.id]: userIds,
		}));
	}

	private pairUsers(
		userIds: string[],
		mode: MatchMode
	): { matchGroups: MatchStruct[]; kicked: string[] } {
		const queue = [...userIds];
		const groupSize = mode === MatchMode.ONE_VS_ONE ? 2 : 4;
		const kickedCount = queue.length % groupSize;

		const kicked = kickedCount > 0 ? queue.splice(-kickedCount) : [];

		for (let i = queue.length - 1; i > 0; i--) {
			const j = Math.floor(Math.random() * (i + 1));
			[queue[i], queue[j]] = [queue[j], queue[i]];
		}

		const matchGroups: MatchStruct[] = [];
		while (queue.length >= groupSize) {
			matchGroups.push({ players: queue.splice(0, groupSize) });
		}

		return { matchGroups, kicked };
	}

	/**
	 * Called when it's time to close the queue and start matches.
	 */
	async startSession(ranked: Ranked, client: Client) {
		const now = new Date();
		console.info(`—> startSession called for ${ranked.id} at ${now.toISOString()}`);

		// LOG IF SESSION WAS RESTORED
		// MIGHT WANT TO LOG IN WATCHDOG DIRECTLY

		switch (ranked.status) {
			case RankedState.LOCKED || RankedState.OPEN || RankedState.VALIDATING_PRESENCE:
				await this.lockAndSeed(ranked, client);
				break;

			case RankedState.PAIRING:
				// branch
				break;

			case RankedState.VALIDATING_MATCH_START:
				// setTimeout = nouveau tick hors RequestContext → wrap obligatoire.
				setTimeout(() => {
					runInRequestContext(this.db, () =>
						this.batchPresenceCheckAndRepool(ranked, client)
					).catch((err) => {
						console.error("[ranked] batchPresenceCheckAndRepool failed:", err);
					});
				}, 90_000);
				break;

			case RankedState.REPOOLING:
				await this.batchPresenceCheckAndRepool(ranked, client);
				break;

			case RankedState.MATCHING:
				await this.announceOngoingMatches(ranked, client);
				break;

			default:
				// ignore
				break;
		}
	}

	private async announceOngoingMatches(ranked: Ranked, client: Client) {
		const lobbies = await this.db.em.find(Lobby, {
			event: ranked.id,
			state: LobbyState.ONGOING,
		});

		const streamerLobbies = await this.getLobbiesWithStreamersAboveMinElo(lobbies);

		const liveTwitchIds = await this.twitchService.areUsersStreaming([
			...streamerLobbies.twitchUserIds,
		]);

		const liveLobbies = streamerLobbies.streamingLobbies
			.filter(
				(l) =>
					(l.p1.twitchId && liveTwitchIds.has(l.p1.twitchId)) ||
					(l.p2.twitchId && liveTwitchIds.has(l.p2.twitchId))
			)
			.toSorted((a, b) => (b.p1.elo + b.p2.elo) / 2 - (a.p1.elo + a.p2.elo) / 2)
			.slice(0, 20);

		const displayedLobbies: LobbyStruct[] = [...liveLobbies];

		if (displayedLobbies.length < 5) {
			const liveIds = new Set(liveLobbies.map((l) => l.lobby.id));
			const nonLiveLobbies = lobbies.filter((l) => !liveIds.has(l.id));

			const toLobbyStructs: LobbyStruct[] = await Promise.all(
				nonLiveLobbies.map(async (lobby) => {
					const p1 = await this.userService.getLobbyPlayerInfo(
						lobby.lobbyUsers.getItems()[0].user.id,
						ranked.mode
					);
					const p2 = await this.userService.getLobbyPlayerInfo(
						lobby.lobbyUsers.getItems()[1].user.id,
						ranked.mode
					);

					return { lobby, p1, p2 };
				})
			);

			const sortedHotLobbies = toLobbyStructs
				.toSorted((a, b) => (b.p1.elo + b.p2.elo) / 2 - (a.p1.elo + a.p2.elo) / 2)
				.slice(0, 20 - displayedLobbies.length);

			displayedLobbies.push(...sortedHotLobbies);
		}

		// 4) announce the matches in the Ranked channel
		const embed = await createRankedOngoingEmbed(
			ranked,
			displayedLobbies,
			liveTwitchIds,
			this.db,
			client,
			this.userService
		);
		const finalMsg: BaseMessageOptions = {
			embeds: [embed],
			components: [],
		};

		await this.announcer.editEventAnnouncements(client, ranked, finalMsg);
	}

	async getLobbiesWithStreamersAboveMinElo(lobbies: Lobby[]) {
		const minElo = 500;
		const twitchUserIds = new Set<string>();
		const streamingLobbies = [];

		for (const lobby of lobbies) {
			const p1 = await this.userService.getLobbyPlayerInfo(
				lobby.lobbyUsers.getItems()[0].user.id,
				lobby.mode
			);
			const p2 = await this.userService.getLobbyPlayerInfo(
				lobby.lobbyUsers.getItems()[1].user.id,
				lobby.mode
			);

			if (p1.twitchId && p1.elo >= minElo) twitchUserIds.add(p1.twitchId);
			if (p2.twitchId && p2.elo >= minElo) twitchUserIds.add(p2.twitchId);

			streamingLobbies.push({ lobby, p1, p2 } as LobbyStruct);
		}

		return { streamingLobbies, twitchUserIds };
	}

	/**
	 * Schedule a queue-count refresh 500ms from now
	 */
	public scheduleQueueCountUpdate(client: Client, ranked: Ranked) {
		// clear any pending update
		const prev = this.updateTimers.get(ranked.id.toString());
		if (prev) clearTimeout(prev);

		// schedule a fresh one
		const timer = setTimeout(() => {
			this.updateTimers.delete(ranked.id.toString());
			// setTimeout = nouveau tick hors RequestContext → wrap obligatoire (updateQueueCount lit la DB).
			runInRequestContext(this.db, () => this.updateQueueCount(client, ranked)).catch(
				console.error
			);
		}, 500);

		this.updateTimers.set(ranked.id.toString(), timer);
	}

	/**
	 * Fetch all announcements for this Ranked event, and update their embed
	 * to reflect the latest queue size.
	 */
	private async updateQueueCount(client: Client, ranked: Ranked) {
		// 1) fetch all announcement records
		const anns = await this.db.em.find(EventAnnouncement, { event: ranked });
		if (anns.length === 0) return;

		// 2) get the current queue size (you could also count DB rows here)
		const count = this.getQueue(ranked).length; // or use your queueService.getQueue(ranked).length

		// 3) batch-edit them all
		await batchSend(anns, 10, async (ann) => {
			const ch = await client.channels
				.fetch(ann.channelId)
				.then((c) => c as TextChannel)
				.catch(() => null);
			if (!ch) return;

			const msg = await ch.messages.fetch(ann.messageId).catch(() => null);
			if (!msg || !msg.embeds.length) return;

			await msg.edit({ embeds: [createRankedQueueEmbed(ranked, count)] });
		});
	}

	async validatePresence(userId: string) {
		const lobbyUser = await this.db.em.findOne(LobbyUser, { user: userId });

		if (!lobbyUser) return false;

		lobbyUser.state = LobbyUserState.READY;
		await this.db.em.persist(lobbyUser).flush();

		return true;
	}

	async batchPresenceCheckAndRepool(ranked: Ranked, client: Client) {
		if (ranked.status === RankedState.VALIDATING_MATCH_START) {
			ranked.status = RankedState.REPOOLING;
			await this.db.em.persist(ranked).flush();
		}

		const guild = await client.guilds.fetch(coreManagerConfig.coreGuildId);

		// All lobbies and users states are either changed or not because of transaction, so proceed only if a lobby doesn't have ONGOING state
		const { matchGroups, kicked } = await this.db.em.transactional(async (em) => {
			const lobbies = await em.find(
				Lobby,
				{
					event: ranked,
					state: LobbyState.FRESH,
				},
				{
					populate: ["lobbyUsers", "lobbyUsers.user", "lobbyUsers.user.elos"],
				}
			);
			const repoolCandidates = [];

			for (const lobby of lobbies) {
				const users = lobby.lobbyUsers.getItems();
				const states = users.map((u) => u.state);

				if (states.every((s) => s === LobbyUserState.READY)) {
					// startMatch
				} else if (states.every((s) => s === LobbyUserState.PENDING)) {
					users.forEach((u) => (u.state = LobbyUserState.AFK));
					// finishLobby + penalty methods
				} else {
					const verified = users.find((u) => u.state === LobbyUserState.READY);
					const afk = users.find((u) => u.state === LobbyUserState.PENDING);
					afk!.state = LobbyUserState.AFK;
					// finishLobby + penalty methods
					if (verified) repoolCandidates.push(verified);
				}

				em.persist(users);
				em.persist(lobby);
			}

			await em.flush();

			const { matchGroups, kicked } = this.pairUsers(
				repoolCandidates.map((lu) => lu.user.id),
				ranked.mode
			);

			for (const group of matchGroups) {
				const newLobby = new Lobby();
				newLobby.event = ranked;
				newLobby.eventType = ranked.type;
				newLobby.mode = ranked.mode;
				em.persist(newLobby);

				group.lobby = newLobby;

				// 2. Add LobbyUser rows for each player, set state VERIFIED (they already checked in)
				group.players.forEach((userId, i) => {
					const team =
						ranked.mode === MatchMode.ONE_VS_ONE
							? i === 0
								? TeamSide.TEAM_1
								: TeamSide.TEAM_2
							: i < 2
								? TeamSide.TEAM_1
								: TeamSide.TEAM_2;
					const lu = new LobbyUser();
					lu.user = rel(User, userId);
					lu.lobby = newLobby;
					lu.team = team;
					lu.state = LobbyUserState.READY; // Already present!
					em.persist(lu);
				});
			}
			await em.flush();

			return { matchGroups, kicked };
		});

		await this.initChannels(matchGroups, guild, true);

		// HANDLE LEFTOVER USERS => +COMPENSATE THEM

		ranked.status = RankedState.MATCHING;
		await this.db.em.persist(ranked).flush();

		await this.announceOngoingMatches(ranked, client);
	}

	private async initChannels(
		matches: MatchStruct[],
		guild: Guild,
		isRepool: boolean = false,
		batchSize: number = 10
	) {
		await batchCreateChannels(matches, batchSize, async (group) => {
			if (!group.lobby) return;
			if (group.lobby.channelId) {
				const exists = await guild.channels.fetch(group.lobby.channelId).catch(() => null);
				if (exists) return;
			}
			const channel = await guild.channels.create({
				name: `lobby-${group.lobby.id}`,
				type: ChannelType.GuildText,
				parent: coreManagerConfig.rankedCategoryId,
				permissionOverwrites: [
					{
						id: guild.roles.everyone,
						deny: [PermissionFlagsBits.ViewChannel],
					},
					// grant each player access
					...group.players.map((uid) => ({
						id: uid,
						allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages],
					})),
					{
						id: coreManagerConfig.botId,
						allow: [
							PermissionFlagsBits.ViewChannel,
							PermissionFlagsBits.SendMessages,
							PermissionFlagsBits.ManageMessages,
						],
					},
				],
			});
			group.lobby.channelId = channel.id;
			group.lobby.hostUser = group.lobby.getRandomPlayer();

			await this.db.em.persist(group.lobby).flush();

			const mentions = group.players.map((uid) => `${userMention(uid)}`).join(" ");

			// Changer le validator à l'autre bouton
			// Gérer 2 messages différents si repool ou non
			const validator = new ButtonBuilder()
				.setEmoji("✅")
				.setCustomId(`confirm_presence:${group.lobby.id}`)
				.setStyle(ButtonStyle.Primary);

			const lobbyMsg: BaseMessageOptions = {
				content: `${mentions}, veuillez confirmer que vous êtes prêts`,
				components: [new ActionRowBuilder<ButtonBuilder>().addComponents(validator) as any],
			};

			channel.send(lobbyMsg);
		});
	}
}
