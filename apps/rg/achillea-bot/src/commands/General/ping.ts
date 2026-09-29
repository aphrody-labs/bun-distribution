import { Category } from "@aphrody/utilities";
import type { Client } from "@aphrody/discordx";
import type { CommandInteraction } from "discord.js";
import { ApplicationCommandOptionType, Colors, EmbedBuilder, MessageFlags } from "discord.js";

import { Discord, Injectable, Slash, SlashOption } from "@/decorators";
import { Database } from "@/services";
import { followUpWithErrorEmbed } from "@/utils/functions";

interface CheckResult {
	name: string;
	ok: boolean;
	value: string;
	latencyMs: number | null;
	detail?: string;
}

function statusIcon(latencyMs: number | null, ok: boolean): string {
	if (!ok) return "🔴";
	if (latencyMs === null) return "⚪";
	if (latencyMs < 50) return "🟢";
	if (latencyMs < 200) return "🟡";
	return "🟠";
}

function formatBytes(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	const kb = bytes / 1024;
	if (kb < 1024) return `${kb.toFixed(1)} KB`;
	const mb = kb / 1024;
	if (mb < 1024) return `${mb.toFixed(1)} MB`;
	return `${(mb / 1024).toFixed(2)} GB`;
}

function formatUptime(seconds: number): string {
	const d = Math.floor(seconds / 86400);
	const h = Math.floor((seconds % 86400) / 3600);
	const m = Math.floor((seconds % 3600) / 60);
	const s = Math.floor(seconds % 60);
	const parts: string[] = [];
	if (d) parts.push(`${d}j`);
	if (h) parts.push(`${h}h`);
	if (m) parts.push(`${m}m`);
	parts.push(`${s}s`);
	return parts.join(" ");
}

@Discord()
@Injectable()
@Category("General")
export default class PingCommand {
	constructor(private db: Database) {}

	@Slash({
		description: "Diagnostic complet du bot (Discord, DB, API, mémoire, uptime)",
		name: "ping",
	})
	async ping(
		@SlashOption({
			description: "Afficher publiquement (défaut : visible que par toi)",
			name: "public",
			required: false,
			type: ApplicationCommandOptionType.Boolean,
		})
		isPublic: boolean | null,
		interaction: CommandInteraction,
		client: Client
	) {
		const ephemeral = !isPublic;
		const flags = ephemeral ? MessageFlags.Ephemeral : undefined;

		const startedAt = Date.now();
		await interaction.deferReply(flags ? { flags } : undefined);

		const checks: CheckResult[] = [];

		// 1. Discord WS heartbeat
		const wsPing = client.ws.ping;
		checks.push({
			name: "Discord WS",
			ok: wsPing >= 0 && wsPing < 5000,
			value: `${wsPing} ms`,
			latencyMs: wsPing >= 0 ? wsPing : null,
			detail: client.ws.status === 0 ? "Ready" : `status=${client.ws.status}`,
		});

		// 2. Interaction roundtrip (createdTimestamp → defer)
		const interactionRoundtrip = startedAt - interaction.createdTimestamp;
		checks.push({
			name: "Interaction RTT",
			ok: interactionRoundtrip < 3000,
			value: `${interactionRoundtrip} ms`,
			latencyMs: interactionRoundtrip,
		});

		// 3. Postgres SELECT 1
		try {
			const t0 = Date.now();
			// MikroORM v7 : l'API Knex a été remplacée par Kysely ; on passe par em.execute() (SQL brut)
			await this.db.em.execute("SELECT 1");
			const dbLatency = Date.now() - t0;
			checks.push({
				name: "PostgreSQL",
				ok: true,
				value: `${dbLatency} ms`,
				latencyMs: dbLatency,
				detail: "SELECT 1",
			});
		} catch (err: unknown) {
			checks.push({
				name: "PostgreSQL",
				ok: false,
				value: "DOWN",
				latencyMs: null,
				detail: err instanceof Error ? err.message.slice(0, 80) : "unknown error",
			});
		}

		// 4. REST API self-fetch (port 4000 by default)
		const apiPort = process.env.API_PORT ?? "4000";
		try {
			const t0 = Date.now();
			const r = await fetch(`http://127.0.0.1:${apiPort}/metrics`, {
				signal: AbortSignal.timeout(2000),
			});
			const apiLatency = Date.now() - t0;
			checks.push({
				name: "REST API",
				ok: r.ok,
				value: r.ok ? `${apiLatency} ms` : `HTTP ${r.status}`,
				latencyMs: apiLatency,
				detail: `:${apiPort}/metrics`,
			});
		} catch (err: unknown) {
			checks.push({
				name: "REST API",
				ok: false,
				value: "TIMEOUT",
				latencyMs: null,
				detail: err instanceof Error ? err.name : "fetch failed",
			});
		}

		// 5. Process info
		const mem = process.memoryUsage();
		const uptime = process.uptime();
		const guildsCount = client.guilds.cache.size;
		const usersCount = client.users.cache.size;

		const summary = checks.every((c) => c.ok) ? "🟢 Tous systèmes opérationnels" : "🟠 Dégradé";
		const color = checks.every((c) => c.ok) ? Colors.Green : Colors.Yellow;

		const embed = new EmbedBuilder()
			.setColor(color)
			.setTitle("🏓 Pong — Achilléa Bot")
			.setDescription(summary)
			.addFields(
				{
					name: "Connectivité",
					value: checks
						.map((c) => {
							const icon = statusIcon(c.latencyMs, c.ok);
							const detail = c.detail ? ` — ${c.detail}` : "";
							return `${icon} **${c.name}** : \`${c.value}\`${detail}`;
						})
						.join("\n"),
				},
				{
					name: "Process",
					value: [
						`⏱️ Uptime : \`${formatUptime(uptime)}\``,
						`💾 RSS : \`${formatBytes(mem.rss)}\``,
						`🧠 Heap : \`${formatBytes(mem.heapUsed)} / ${formatBytes(mem.heapTotal)}\``,
						`📦 Bun : \`v${Bun.version}\``,
					].join("\n"),
					inline: true,
				},
				{
					name: "Discord",
					value: [
						`🏛️ Guilds : \`${guildsCount}\``,
						`👥 Users (cache) : \`${usersCount}\``,
						`🤖 Tag : \`${client.user?.tag ?? "—"}\``,
						`🆔 Shard : \`${interaction.guild?.shardId ?? 0}\``,
					].join("\n"),
					inline: true,
				}
			)
			.setFooter({
				text: `Latence totale : ${Date.now() - startedAt} ms`,
			})
			.setTimestamp();

		try {
			await interaction.followUp({ embeds: [embed], ...(flags ? { flags } : {}) });
		} catch (err: unknown) {
			followUpWithErrorEmbed(
				interaction,
				err instanceof Error ? err.message : "Erreur lors de l'envoi du diagnostic."
			);
		}
	}
}
