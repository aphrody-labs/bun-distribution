import { singleton, inject } from "tsyringe";
import { sql, desc } from "drizzle-orm";
import { Client } from "discordx";
import { DatabaseService } from "~/db/index";
import { users, actionLogs } from "~/db/schema";
import { logger } from "~/lib/logger";
import { env } from "~/lib/env";

/**
 * Stats agrégées exposées par l'API REST (`/health/*`, `/stats/*`).
 *
 * Surface compatible avec [`@aphrody/tscord`'s `Stats` service](../../packages/tscord/src/services/Stats.ts)
 * pour qu'un dashboard tscord-shaped (ex. `barthofu/tscord-dashboard`) puisse
 * consommer l'API shenron sans adapter le client.
 *
 * Implémentation minimale, sans `pidusage` ou `node-os-utils` (deps system Linux
 * lourdes) : on lit directement `/proc/self/stat` pour le CPU/RAM du process et
 * `os` Node-compat pour le host. Suffisant pour un dashboard générique.
 */

export interface PidUsage {
	cpu: number; // % CPU
	memory: number; // bytes
	uptime: number; // ms
	rss: number; // bytes
}

export interface HostUsage {
	cpu: { count: number; usage: number }; // count of cores, % overall
	memory: { total: number; free: number; used: number; usage: number };
	platform: string;
	uptime: number; // s
}

export interface LatencyStats {
	ws: number; // ms
	db: number; // ms
}

export interface TotalStats {
	totalUsers: number;
	totalGuilds: number;
	totalActiveUsers: number; // users avec messageCount > 0
	totalCommands: number; // commands enregistrées sur le client
}

@singleton()
export class StatsService {
	constructor(
		@inject(DatabaseService) private dbs: DatabaseService,
		@inject(Client) private client: Client
	) {}

	getLatency(): LatencyStats {
		const ws = Math.max(0, this.client.ws.ping);
		// Latence DB : ping query simple
		const t0 = Bun.nanoseconds() / 1e6;
		try {
			this.dbs.sqlite.query("SELECT 1").get();
		} catch (err) {
			logger.debug({ err }, "DB latency probe failed");
		}
		const db = Bun.nanoseconds() / 1e6 - t0;
		return { ws, db: Math.round(db * 100) / 100 };
	}

	async getPidUsage(): Promise<PidUsage> {
		const memUsage = process.memoryUsage();
		const cpu = process.cpuUsage();
		const totalCpu = (cpu.user + cpu.system) / 1000; // ms
		const upMs = Math.round(process.uptime() * 1000);
		// CPU % approximé : (cpu time used / wall time) * 100. Rough mais sans deps.
		const cpuPct = upMs > 0 ? Math.min(100, (totalCpu / upMs) * 100) : 0;
		return {
			cpu: Math.round(cpuPct * 100) / 100,
			memory: memUsage.heapUsed,
			rss: memUsage.rss,
			uptime: upMs,
		};
	}

	async getHostUsage(): Promise<HostUsage> {
		const os = await import("node:os");
		const cpus = os.cpus();
		const totalMem = os.totalmem();
		const freeMem = os.freemem();
		// CPU usage moyenne sur tous les cores depuis boot (cumulative).
		// Pas un % instantané, mais représentatif de la charge système.
		let total = 0;
		let idle = 0;
		for (const c of cpus) {
			for (const t of Object.values(c.times)) total += t;
			idle += c.times.idle;
		}
		const usage = total > 0 ? ((total - idle) / total) * 100 : 0;
		return {
			cpu: { count: cpus.length, usage: Math.round(usage * 100) / 100 },
			memory: {
				total: totalMem,
				free: freeMem,
				used: totalMem - freeMem,
				usage: Math.round(((totalMem - freeMem) / totalMem) * 10_000) / 100,
			},
			platform: process.platform,
			uptime: Math.round(process.uptime()),
		};
	}

	async getTotalStats(): Promise<TotalStats> {
		const [{ count: total } = { count: 0 }] = await this.dbs.db
			.select({ count: sql<number>`COUNT(*)` })
			.from(users);
		const [{ count: active } = { count: 0 }] = await this.dbs.db
			.select({ count: sql<number>`COUNT(*)` })
			.from(users)
			.where(sql`${users.messageCount} > 0`);

		const totalCommands = this.client.applicationCommands?.length ?? 0;

		// Mono-guild forcé : on compte 1 si la prod est connectée, sinon 0.
		const totalGuilds = this.client.guilds.cache.has(env.GUILD_ID) ? 1 : 0;

		return {
			totalUsers: Number(total ?? 0),
			totalGuilds,
			totalActiveUsers: Number(active ?? 0),
			totalCommands,
		};
	}

	async getLastInteraction(): Promise<{
		date: string | null;
		userId: string | null;
		action: string | null;
		meta: string | null;
	}> {
		// Lit la dernière action de type "interaction" dans action_logs.
		// L'event interactionCreate (cf. src/events/InteractionLog.ts) y insère une
		// entrée pour chaque slash command / context menu déclenchée.
		const rows = await this.dbs.db
			.select()
			.from(actionLogs)
			.where(sql`${actionLogs.action} = 'interaction'`)
			.orderBy(desc(actionLogs.createdAt))
			.limit(1);
		const row = rows[0];
		if (!row) return { date: null, userId: null, action: null, meta: null };
		return {
			date: row.createdAt.toISOString(),
			userId: row.userId,
			action: row.action,
			meta: row.meta,
		};
	}

	getLastGuildAdded(): { id: string; name: string; joinedAt: string } | null {
		// Mono-guild : retourne uniquement la guild prod (env.GUILD_ID).
		const last = this.client.guilds.cache.get(env.GUILD_ID);
		if (!last) return null;
		return {
			id: last.id,
			name: last.name,
			joinedAt: new Date(last.joinedTimestamp ?? 0).toISOString(),
		};
	}
}
