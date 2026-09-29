import process from "node:process";

import { constant } from "case";
import type { SimpleCommandMessage } from "@aphrody/discordx";
import { Client } from "@aphrody/discordx";
import type { Generated, Kysely } from "kysely";
import { sql } from "kysely";
import { createAchilleaSql } from "@rosegriffon/db/achillea-sql";
// node-os-utils v2 : l'export default est la classe OSUtils (pas une instance).
// On instancie une fois pour accéder aux moniteurs cpu / memory / system.
import OSUtils from "node-os-utils";

const osUtils = new OSUtils();
import pidusage from "pidusage";
import { delay, inject } from "tsyringe";

import { statsConfig } from "@/configs";
import { Schedule, Service } from "@/decorators";
import {
	datejs,
	formatDate,
	getTypeOfInteraction,
	resolveAction,
	resolveChannel,
	resolveGuild,
	resolveUser,
} from "@/utils/functions";

interface StatsDatabase {
	stat: {
		id: Generated<number>;
		type: string;
		value: Generated<string>;
		additional_data: Record<string, unknown> | null;
		created_at: Generated<Date>;
	};
	user: { id: string };
	guild: {
		id: string;
		prefix: string | null;
		deleted: boolean;
		created_at: Date;
		updated_at: Date;
		last_interact: Date;
	};
}

const sqlDb = createAchilleaSql<StatsDatabase>() as Kysely<StatsDatabase>;
const interactionTypes = [
	"SIMPLE_COMMAND_MESSAGE",
	"CHAT_INPUT_COMMAND_INTERACTION",
	"USER_CONTEXT_MENU_COMMAND_INTERACTION",
	"MESSAGE_CONTEXT_MENU_COMMAND_INTERACTION",
] as const;

@Service()
export class Stats {
	constructor(
		@inject(delay(() => Client)) private client: Client
	) {}

	/**
	 * Add an entry to the stats table.
	 * @param type
	 * @param value
	 * @param additionalData in JSON format
	 */
	async register(type: string, value: string, additionalData?: Record<string, unknown>) {
		await sqlDb.insertInto("stat").values({
			type,
			value,
			additional_data: additionalData ?? null,
		}).execute();
	}

	/**
	 * Record an interaction and add it to the database.
	 * @param interaction
	 */
	async registerInteraction(interaction: AllInteractions) {
		// we extract data from the interaction
		const type = constant(getTypeOfInteraction(interaction)) as InteractionsConstants;
		if (statsConfig.interaction.exclude.includes(type)) return;

		const value = resolveAction(interaction);
		const additionalData = {
			user: resolveUser(interaction)?.id,
			guild: resolveGuild(interaction)?.id || "dm",
			channel: resolveChannel(interaction)?.id,
		};

		// add it to the db
		await this.register(type, value, additionalData);
	}

	/**
	 * Record a simple command message and add it to the database.
	 * @param command
	 */
	async registerSimpleCommand(command: SimpleCommandMessage) {
		// we extract data from the interaction
		const type = "SIMPLE_COMMAND_MESSAGE";
		const value = command.name;
		const additionalData = {
			user: command.message.author.id,
			guild: command.message.guild?.id || "dm",
			channel: command.message.channel?.id,
		};

		// add it to the db
		await this.register(type, value, additionalData);
	}

	/**
	 * Returns an object with the total stats for each type.
	 */
	async getTotalStats() {
		const totalStatsObj = {
			TOTAL_USERS: this.client.guilds.cache.reduce((acc, guild) => acc + guild.memberCount, 0),
			TOTAL_GUILDS: this.client.guilds.cache.size,
			TOTAL_ACTIVE_USERS: Number((await sqlDb.selectFrom("user").select(sql<number>`count(*)`.as("count")).executeTakeFirstOrThrow()).count),
			TOTAL_COMMANDS: Number((await sqlDb.selectFrom("stat").select(sql<number>`count(*)`.as("count")).where("type", "in", interactionTypes).executeTakeFirstOrThrow()).count),
		};

		return totalStatsObj;
	}

	/**
	 * Get the last saved interaction.
	 */
	async getLastInteraction() {
		const row = await sqlDb.selectFrom("stat").selectAll().where("type", "in", interactionTypes).orderBy("created_at", "desc").executeTakeFirst();
		return row ? {
			id: row.id,
			type: row.type,
			value: row.value,
			additionalData: row.additional_data,
			createdAt: row.created_at,
		} : null;
	}

	/**
	 * Get the last guild added to the database.
	 */
	async getLastGuildAdded() {
		const row = await sqlDb.selectFrom("guild").select(["id", "created_at", "updated_at", "last_interact", "deleted", "prefix"]).orderBy("created_at", "desc").executeTakeFirst();
		return row ? {
			id: row.id,
			createdAt: row.created_at,
			updatedAt: row.updated_at,
			lastInteract: row.last_interact,
			deleted: row.deleted,
			prefix: row.prefix,
		} : null;
	}

	/**
	 * Get commands sorted by total amount of uses in DESC order.
	 */
	async getTopCommands() {
		const rows = await sqlDb.selectFrom("stat").select([
			"type", "value", sql<number>`count(*)`.as("count"),
		]).where("type", "in", interactionTypes).groupBy(["type", "value"]).execute();
		return rows.map((row) => ({ type: row.type, name: row.value, count: Number(row.count) })).toSorted((a, b) => b.count - a.count);
	}

	/**
	 * Get the users activity per slice of interactions amount in percentage.
	 */
	async getUsersActivity() {
		const usersActivity = {
			"1-10": 0,
			"11-50": 0,
			"51-100": 0,
			"101-1000": 0,
			">1000": 0,
		};

		const rows = await sqlDb.selectFrom("stat")
			.select([
				sql<string>`additional_data->>'user'`.as("user_id"),
				sql<number>`count(*)`.as("count"),
			])
			.where("type", "in", interactionTypes)
			.where(sql<boolean>`additional_data ? 'user'`)
			.groupBy(sql<string>`additional_data->>'user'`)
			.execute();
		const counts = new Map(rows.map((row) => [row.user_id, Number(row.count)]));
		const users = await sqlDb.selectFrom("user").select("id").execute();

		for (const user of users) {
			const commandsCount = counts.get(user.id) ?? 0;

			if (commandsCount <= 10) usersActivity["1-10"]++;
			else if (commandsCount <= 50) usersActivity["11-50"]++;
			else if (commandsCount <= 100) usersActivity["51-100"]++;
			else if (commandsCount <= 1000) usersActivity["101-1000"]++;
			else usersActivity[">1000"]++;
		}

		return usersActivity;
	}

	/**
	 * Get guilds sorted by total amount of commands in DESC order.
	 */
	async getTopGuilds() {
		const topGuilds: {
			id: string;
			name: string;
			totalCommands: number;
		}[] = [];

		const guilds = await sqlDb.selectFrom("guild").select(["id"]).where("deleted", "=", false).execute();
		const counts = await sqlDb.selectFrom("stat")
			.select([
				sql<string>`additional_data->>'guild'`.as("guild_id"),
				sql<number>`count(*)`.as("count"),
			])
			.where("type", "in", interactionTypes)
			.where(sql<boolean>`additional_data ? 'guild'`)
			.groupBy(sql<string>`additional_data->>'guild'`)
			.execute();
		const countsByGuild = new Map(counts.map((row) => [row.guild_id, Number(row.count)]));

		for (const guild of guilds) {
			const discordGuild = await this.client.guilds.fetch(guild.id).catch(() => null);
			if (!discordGuild) continue;

			topGuilds.push({
				id: guild.id,
				name: discordGuild?.name || "",
				totalCommands: countsByGuild.get(guild.id) ?? 0,
			});
		}

		return topGuilds.toSorted((a, b) => b.totalCommands - a.totalCommands);
	}

	/**
	 * Returns the amount of row for a given type per day in a given interval of days from now.
	 * @param type the type of the stat to retrieve
	 * @param days interval of days from now
	 */
	async countStatsPerDays(type: string, days: number): Promise<StatPerInterval> {
		const now = Date.now();
		const stats: StatPerInterval = [];

		for (let i = 0; i < days; i++) {
			const date = new Date(now - i * 24 * 60 * 60 * 1000);
			const statCount = await this.getCountForGivenDay(type, date);

			stats.push({
				date: formatDate(date, "onlyDate"),
				count: statCount,
			});
		}

		return this.cumulateStatPerInterval(stats);
	}

	/**
	 * Transform individual day stats into cumulated stats.
	 * @param stats
	 */
	cumulateStatPerInterval(stats: StatPerInterval): StatPerInterval {
		const cumulatedStats = stats
			.toReversed()
			.reduce((acc, stat, i) => {
				if (acc.length === 0) {
					acc.push(stat);
				} else {
					acc.push({
						date: stat.date,
						count: acc[i - 1].count + stat.count,
					});
				}

				return acc;
			}, [] as StatPerInterval)
			.toReversed();

		return cumulatedStats;
	}

	/**
	 * Sum two array of stats.
	 * @param stats1
	 * @param stats2
	 */
	sumStats(stats1: StatPerInterval, stats2: StatPerInterval): StatPerInterval {
		const allDays = [...new Set(stats1.concat(stats2).map((stat) => stat.date))].toSorted(
			(a, b) => {
				const aa = a.split("/").toReversed().join();
				const bb = b.split("/").toReversed().join();

				return aa < bb ? -1 : aa > bb ? 1 : 0;
			}
		);

		const sumStats = allDays.map((day) => ({
			date: day,
			count:
				(stats1.find((stat) => stat.date === day)?.count || 0) +
				(stats2.find((stat) => stat.date === day)?.count || 0),
		}));

		return sumStats;
	}

	/**
	 * Returns the total count of row for a given type at a given day.
	 * @param type
	 * @param date - day to get the stats for (any time of the day will work as it extract the very beginning and the very ending of the day as the two limits)
	 */
	async getCountForGivenDay(type: string, date: Date): Promise<number> {
		const start = datejs(date).startOf("day").toDate();
		const end = datejs(date).endOf("day").toDate();

		const row = await sqlDb.selectFrom("stat").select(sql<number>`count(*)`.as("count"))
			.where("type", "=", type).where("created_at", ">=", start).where("created_at", "<=", end)
			.executeTakeFirstOrThrow();
		return Number(row.count);
	}

	/**
	 * Get the current process usage (CPU, RAM, etc).
	 */
	async getPidUsage() {
		const pidUsage = await pidusage(process.pid);

		return {
			...pidUsage,
			cpu: pidUsage.cpu.toFixed(1),
			memory: {
				usedInMb: (pidUsage.memory / (1024 * 1024)).toFixed(1),
				// totalMem() est une méthode de compatibilité sync (retourne number | string)
				percentage: ((pidUsage.memory / Number(osUtils.memory.totalMem())) * 100).toFixed(1),
			},
		};
	}

	/**
	 * Get the current host health (CPU, RAM, etc).
	 */
	async getHostUsage() {
		// node-os-utils v2 : les moniteurs retournent MonitorResult<T> — on extrait .data.
		// osu.os n'existe plus ; les infos système passent par osUtils.system.info().
		const [cpuResult, memResult, sysResult] = await Promise.all([
			osUtils.cpu.usage(),
			osUtils.memory.info(),
			osUtils.system.info(),
		]);

		// MonitorResult<T> est une union discriminée sur le champ `success`
		return {
			cpu: cpuResult.success ? cpuResult.data : null,
			memory: memResult.success ? memResult.data : null,
			os: sysResult.success ? (sysResult.data.distro ?? null) : null,
			uptime: sysResult.success
				? (sysResult.data.uptimeSeconds ?? sysResult.data.uptime ?? null)
				: null,
			hostname: sysResult.success ? sysResult.data.hostname : null,
			platform: sysResult.success ? sysResult.data.platform : null,

			// drive: osUtils.disk.info(),
		};
	}

	/**
	 * Get latency from the discord websocket gate.
	 */
	getLatency() {
		return {
			ping: this.client.ws.ping,
		};
	}

	/**
	 * Run each day at 23:59 to update daily stats.
	 */
	@Schedule("59 59 23 * * *")
	async registerDailyStats() {
		const totalStats = await this.getTotalStats();

		for (const type of Object.keys(totalStats)) {
			const value = JSON.stringify(totalStats[type as keyof typeof totalStats]);
			await this.register(type, value);
		}
	}
}
