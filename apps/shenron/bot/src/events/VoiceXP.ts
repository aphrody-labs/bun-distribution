import { injectable, inject } from "tsyringe";
import { Bot, Discord, On, Once, type ArgsOf } from "discordx";
import type { Client, Guild, GuildMember, VoiceBasedChannel } from "discord.js";
import { LevelService } from "~/services/LevelService";
import { VocalTempoService } from "~/services/VocalTempoService";
import { SettingsService } from "~/services/SettingsService";
import { MessageTemplateService } from "~/services/MessageTemplateService";
import { DatabaseService } from "~/db/index";
import { actionLogs } from "~/db/schema";
import { XP_PER_VOICE_TICK, XP_VOICE_TICK_MS, VOCAL_TEMPO_EMPTY_DELAY_MS } from "~/lib/constants";
import { env } from "~/lib/env";
import { resolveLevelChannel } from "~/lib/announce";
import { boosterXpMultiplier } from "~/lib/booster";
import { formatDuration } from "~/lib/native";
import {
	bestRoleMultiplier,
	formatMultiplier,
	isNight,
	loadXpBoostConfig,
	voiceBoost,
	voiceChannelContext,
	voicePresencesByChannel,
	voiceStatusOf,
	type VoiceChannelContext,
	type VoiceStatus,
	type XpBoostConfig,
} from "~/lib/xp-boosts";
import { logger } from "~/lib/logger";
import { ChannelType } from "discord.js";
import { CronRegistry } from "~/api/cron-registry";

interface VoiceSession {
	channelId: string;
	status: VoiceStatus;
	joinedAt: number;
	lastTickAt: number;
}

interface Sleepcall {
	channelId: string;
	startedAt: number;
	lastSeenAt: number;
	participants: Set<string>;
	xp: number;
}

@Discord()
@Bot("shenron")
@injectable()
export class VoiceXPEvent {
	private sessions = new Map<string, VoiceSession>(); // userId -> session
	/** Contexte de chaque salon qui rapporte, recalculé à chaque tick. */
	private channels = new Map<string, VoiceChannelContext>();
	private sleepcalls = new Map<string, Sleepcall>(); // channelId -> sleepcall
	/** Faux au premier passage : les sleepcalls en cours au démarrage sont repris sans annonce. */
	private adopted = false;
	private emptyTimers = new Map<string, ReturnType<typeof setTimeout>>();

	constructor(
		@inject(LevelService) private levels: LevelService,
		@inject(VocalTempoService) private vts: VocalTempoService,
		@inject(CronRegistry) private cron: CronRegistry,
		@inject(SettingsService) private settings: SettingsService,
		@inject(MessageTemplateService) private msg: MessageTemplateService,
		@inject(DatabaseService) private dbs: DatabaseService
	) {}

	@Once({ event: "clientReady" })
	async startTicker([client]: [Client]) {
		this.cron.register({
			name: "voice-xp-tick",
			description: `Distribution d'XP pour les membres en vocal (toutes les ${XP_VOICE_TICK_MS / 1000}s)`,
			intervalMs: XP_VOICE_TICK_MS,
			fn: () => this.tickXP(client),
		});
	}

	private async tickXP(client: Client) {
		// Toggle features.voice_xp — fallback true (DB vide = activé par défaut).
		if (!(await this.settings.getBool("features.voice_xp", true))) return;
		const guild = client.guilds.cache.get(env.GUILD_ID) ?? client.guilds.cache.first();
		if (!guild) return;
		const now = Date.now();
		// Snapshot des boosts une fois par tick (cache 30s côté SettingsService)
		const boosts = await this.settings.getXpBoostRoles();
		const cfg = await loadXpBoostConfig(this.settings);

		// Vérité = état vocal réel de Discord, pas la mémoire d'events passés.
		await this.syncSessions(guild, cfg, now);

		// Setting xp.voice.per_minute → conversion en per-tick (XP_VOICE_TICK_MS).
		// Fallback constant `XP_PER_VOICE_TICK` si pas de setting.
		const perMinute = await this.settings.getInt("xp.voice.per_minute", 0);
		const baseGain =
			perMinute > 0
				? Math.max(1, Math.round((perMinute * XP_VOICE_TICK_MS) / 60_000))
				: XP_PER_VOICE_TICK;

		for (const [userId, sess] of this.sessions) {
			// Marge de 5s : `setInterval` peut tirer quelques ms trop tôt et faire
			// sauter un tick entier (XP vocal divisé par 2 sans raison visible).
			if (now - sess.lastTickAt < XP_VOICE_TICK_MS - 5_000) continue;
			const channel = this.channels.get(sess.channelId);
			if (!channel) continue;
			sess.lastTickAt = now;

			const member =
				guild.members.cache.get(userId) ?? (await guild.members.fetch(userId).catch(() => null));
			const roleMultiplier = member
				? bestRoleMultiplier(
						(roleId) => member.roles.cache.has(roleId),
						boosts,
						await boosterXpMultiplier(member, this.settings)
					)
				: 1;
			const u = await this.levels.getUser(userId);
			const boost = voiceBoost(
				{
					roleMultiplier,
					race: u?.race,
					raceBoostUntil: u?.raceBoostUntil?.getTime() ?? 0,
					now,
					status: sess.status,
					channel,
				},
				cfg
			);
			const gain = Math.floor(baseGain * boost.total);

			// Temps de présence vocal (classement « vocal » + stats de profil).
			await this.levels.addVoiceTime(userId, XP_VOICE_TICK_MS, new Date(sess.joinedAt));
			if (gain <= 0) continue;

			const res = await this.levels.addXP(userId, gain, { propagateFusion: true, source: "voice" });
			if (channel.sleepcall) {
				const sleepcall = this.sleepcalls.get(sess.channelId);
				if (sleepcall) sleepcall.xp += gain;
			}
			if (res.levelUp && member) {
				const announce = await resolveLevelChannel(client, guild);
				await this.levels.handleLevelUp(member, res.newLevel, announce ?? undefined);
			}
		}

		await this.closeSleepcalls(client, cfg, now);
	}

	/**
	 * Réconcilie `sessions` avec l'état vocal réel de la guilde.
	 *
	 * `sessions` n'était alimentée que par `voiceStateUpdate` : après un restart
	 * du bot (ou un event manqué / une reconnexion gateway), tous les membres
	 * déjà connectés en vocal restaient invisibles → **zéro XP vocal** tant
	 * qu'ils ne changeaient pas de salon ou ne re-toggle pas leur micro. Comme
	 * le service redémarre à chaque déploiement, la map restait vide en pratique
	 * (tick à 0 ms, aucun gain, classement figé).
	 *
	 * Qui gagne dans un salon (seuil de membres, micro ou casque coupé, sleepcall)
	 * est tranché par `voiceChannelContext` selon les réglages `xp.*`.
	 */
	private async syncSessions(guild: Guild, cfg: XpBoostConfig, now: number) {
		const hubId = (await this.settings.getRaw("channel.vocal_tempo_hub")) ?? env.VOCAL_TEMPO_HUB_ID;

		this.channels.clear();
		const eligible = new Set<string>();
		for (const [channelId, presences] of voicePresencesByChannel(guild, hubId)) {
			const ctx = voiceChannelContext(presences, cfg, now);
			if (ctx.earners.length === 0) continue;
			this.channels.set(channelId, ctx);
			if (ctx.sleepcall) await this.trackSleepcall(guild.client, channelId, ctx, cfg, now);
			for (const { userId, status } of ctx.earners) {
				eligible.add(userId);
				const sess = this.sessions.get(userId);
				if (sess) {
					sess.channelId = channelId;
					sess.status = status;
				} else {
					// Déjà en vocal avant qu'on le sache → éligible dès ce tick.
					this.sessions.set(userId, {
						channelId,
						status,
						joinedAt: now,
						lastTickAt: now - XP_VOICE_TICK_MS,
					});
				}
			}
		}

		const stale: string[] = [];
		for (const userId of this.sessions.keys()) {
			if (!eligible.has(userId)) stale.push(userId);
		}
		for (const userId of stale) this.sessions.delete(userId);
		this.adopted = true;
	}

	private async trackSleepcall(
		client: Client,
		channelId: string,
		ctx: VoiceChannelContext,
		cfg: XpBoostConfig,
		now: number
	) {
		let sleepcall = this.sleepcalls.get(channelId);
		if (!sleepcall) {
			sleepcall = { channelId, startedAt: now, lastSeenAt: now, participants: new Set(), xp: 0 };
			this.sleepcalls.set(channelId, sleepcall);
			if (this.adopted && cfg.sleepcall.announce) {
				await this.msg.publish(
					"sleepcall_start",
					{
						channelId,
						members: ctx.earners.length,
						multiplier: formatMultiplier(cfg.sleepcall.multiplier),
						endHour: cfg.night.endHour,
					},
					client
				);
			}
		}
		sleepcall.lastSeenAt = now;
		for (const { userId } of ctx.earners) sleepcall.participants.add(userId);
	}

	/**
	 * Clôt les sleepcalls qui ne remplissent plus les conditions. Un creux de
	 * quelques minutes (quelqu'un se reconnecte) ne coupe rien ; la fin de la
	 * nuit clôt tout de suite. Les sleepcalls assez longs sont résumés et
	 * journalisés pour chaque participant.
	 */
	private async closeSleepcalls(client: Client, cfg: XpBoostConfig, now: number) {
		const night = isNight(now, cfg);
		for (const sleepcall of this.sleepcalls.values()) {
			if (sleepcall.lastSeenAt === now) continue;
			if (night && now - sleepcall.lastSeenAt < cfg.sleepcall.graceMinutes * 60_000) continue;
			this.sleepcalls.delete(sleepcall.channelId);

			const durationMs = sleepcall.lastSeenAt - sleepcall.startedAt;
			if (durationMs < cfg.sleepcall.summaryMinMinutes * 60_000) continue;
			const meta = JSON.stringify({
				channelId: sleepcall.channelId,
				startedAt: sleepcall.startedAt,
				durationMs,
				participants: sleepcall.participants.size,
				xp: sleepcall.xp,
			});
			try {
				await this.dbs.db
					.insert(actionLogs)
					.values(
						[...sleepcall.participants].map((userId) => ({ userId, action: "SLEEPCALL", meta }))
					);
			} catch (err) {
				logger.warn({ err, channelId: sleepcall.channelId }, "sleepcall log failed");
			}
			if (cfg.sleepcall.announce) {
				await this.msg.publish(
					"sleepcall_end",
					{
						channelId: sleepcall.channelId,
						duration: formatDuration(durationMs),
						participants: sleepcall.participants.size,
						xp: sleepcall.xp.toLocaleString("fr-FR"),
					},
					client
				);
			}
		}
	}

	@On({ event: "voiceStateUpdate" })
	async onVoice([oldState, newState]: ArgsOf<"voiceStateUpdate">) {
		const userId = newState.id;
		const oldCh = oldState.channel;
		const newCh = newState.channel;

		// LEAVE
		if (oldCh && (!newCh || oldCh.id !== newCh.id)) {
			this.sessions.delete(userId);
			await this.handleMaybeEmpty(oldCh);
		}

		// JOIN / MOVE
		if (newCh && (!oldCh || oldCh.id !== newCh.id)) {
			// Vocal tempo HUB — priorité au setting runtime (`channel.vocal_tempo_hub`)
			// qui peut être set à chaud sans redémarrer, fallback env legacy.
			const hubId =
				(await this.settings.getRaw("channel.vocal_tempo_hub")) ?? env.VOCAL_TEMPO_HUB_ID;
			if (hubId && newCh.id === hubId && newState.member) {
				await this.createTempo(newState.member, newCh);
				return;
			}
			// Premier gain après une minute pleine : entrer et ressortir ne rapporte
			// rien. Micro, casque et seuil de membres sont évalués au tick.
			this.sessions.set(userId, {
				channelId: newCh.id,
				status: voiceStatusOf(newState) ?? "open",
				joinedAt: Date.now(),
				lastTickAt: Date.now(),
			});
		}
	}

	private async createTempo(member: GuildMember, hub: VoiceBasedChannel) {
		try {
			const parentId = hub.parentId ?? undefined;
			const tempo = await this.vts.createFor(member.guild, member, parentId);
			await member.voice.setChannel(tempo).catch(() => {});
			await this.msg.publish(
				"vocal_tempo_created",
				{ user: `<@${member.id}>`, channelId: tempo.id },
				member.client
			);
		} catch (err) {
			logger.warn({ err }, "Failed to create vocal tempo");
		}
	}

	private async handleMaybeEmpty(channel: VoiceBasedChannel) {
		if (channel.type !== ChannelType.GuildVoice) return;
		const isTempo = await this.vts.isTempo(channel.id);
		if (!isTempo) return;
		if (channel.members.size > 0) return;

		const prev = this.emptyTimers.get(channel.id);
		if (prev) clearTimeout(prev);
		const delayMs = await this.settings.getInt(
			"vocal.tempo_empty_delay_ms",
			VOCAL_TEMPO_EMPTY_DELAY_MS
		);
		const timer = setTimeout(async () => {
			const refetched = await channel.fetch().catch(() => null);
			if (!refetched || refetched.members.size > 0) return;
			await refetched.delete("Vocal tempo empty").catch(() => {});
			await this.vts.remove(channel.id);
			this.emptyTimers.delete(channel.id);
			await this.msg.publish("vocal_tempo_destroyed", { channelId: channel.id }, channel.client);
		}, delayMs);
		this.emptyTimers.set(channel.id, timer);
	}
}
