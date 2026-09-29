import { singleton, inject } from "tsyringe";
import { EmbedBuilder, type Client, type SendableChannels } from "discord.js";
import { logger } from "~/lib/logger";
import { SettingsService } from "~/services/SettingsService";
import { fetchTikTokProfile, type TikTokProfile, type TikTokVideo } from "~/lib/tiktok";

const LIVE_COLOR = 0xfe2c55; // rose/rouge TikTok
const VIDEO_COLOR = 0x25f4ee; // cyan TikTok
const DESC_MAX = 280;

export interface TikTokTickResult {
	ok: boolean;
	reason?: string;
	live?: boolean;
	announcedLive?: boolean;
	announcedVideos?: number;
	username?: string;
	videosSeen?: number;
}

/**
 * Surveillance TikTok → notifications Discord (live + nouvelles vidéos).
 *
 * - Live : `roomId` du profil (cf. `lib/tiktok.ts`). Transition hors-ligne→live
 *   ⇒ un post unique avec ping du rôle opt-in. Fiable depuis le VPS.
 * - Vidéos : best-effort via l'`itemList` SSR (souvent vide ⇒ silencieux). La
 *   dédup se fait sur `createTime` (epoch) + id de la dernière annoncée. Premier
 *   passage = seed silencieux (on n'annonce pas le backlog existant).
 *
 * Tout l'état (live actif, dernière vidéo) est persisté via SettingsService pour
 * survivre aux redémarrages. Le client Discord est injecté par l'event ready.
 */
@singleton()
export class TikTokService {
	private client: Client | null = null;

	constructor(@inject(SettingsService) private settings: SettingsService) {}

	setClient(client: Client) {
		this.client = client;
	}

	/** Tick périodique (cron) — sûr : n'émet jamais d'exception. */
	async tick(): Promise<TikTokTickResult> {
		try {
			if (!(await this.settings.getBool("tiktok.enabled", false))) {
				return { ok: false, reason: "disabled" };
			}
			return await this.run();
		} catch (err) {
			logger.warn({ err }, "[tiktok] tick a échoué");
			return { ok: false, reason: "error" };
		}
	}

	/**
	 * Force une vérification même si `tiktok.enabled` est off (pour la commande
	 * `/tiktok test`). Retourne un résumé exploitable par l'admin.
	 */
	async runOnce(): Promise<TikTokTickResult> {
		try {
			return await this.run();
		} catch (err) {
			logger.warn({ err }, "[tiktok] runOnce a échoué");
			return { ok: false, reason: "error" };
		}
	}

	private async run(): Promise<TikTokTickResult> {
		const username = await this.settings.getString("tiktok.username", "goku_dbfr");
		const proxy = (await this.settings.getString("tiktok.proxy", "")).trim() || undefined;

		const profile = await fetchTikTokProfile(username, proxy);
		if (!profile) {
			return { ok: false, reason: "fetch_failed", username };
		}

		const announcedLive = await this.handleLive(profile);
		let announcedVideos = 0;
		if (await this.settings.getBool("tiktok.videos", true)) {
			announcedVideos = await this.handleVideos(profile);
		}

		return {
			ok: true,
			username: profile.uniqueId,
			live: profile.isLive,
			announcedLive,
			announcedVideos,
			videosSeen: profile.videos.length,
		};
	}

	private async handleLive(p: TikTokProfile): Promise<boolean> {
		const wasLive = await this.settings.getBool("tiktok.live_active", false);
		if (p.isLive && !wasLive) {
			const sent = await this.post(
				`Le live de **${p.nickname}** vient de commencer, viens vite !`,
				this.liveEmbed(p)
			);
			await this.settings.set("tiktok.live_active", "true");
			if (sent) logger.info({ user: p.uniqueId }, "[tiktok] notif live envoyée");
			return sent;
		}
		if (!p.isLive && wasLive) {
			await this.settings.set("tiktok.live_active", "false");
		}
		return false;
	}

	private async handleVideos(p: TikTokProfile): Promise<number> {
		if (p.videos.length === 0) return 0;

		const lastId = await this.settings.getString("tiktok.last_video_id", "");
		const lastTime = await this.settings.getInt("tiktok.last_video_time", 0);

		// Premier passage (jamais seedé) : on enregistre la plus récente sans rien
		// annoncer, pour ne pas spammer tout l'historique d'un coup.
		if (!lastId && lastTime === 0) {
			await this.rememberVideo(p.videos[0]);
			return 0;
		}

		const fresh = p.videos
			.filter((v) => v.createTime > lastTime && v.id !== lastId)
			.toSorted((a, b) => a.createTime - b.createTime); // plus ancienne → plus récente

		if (fresh.length === 0) return 0;

		let count = 0;
		for (const v of fresh) {
			const sent = await this.post(
				`Nouvelle vidéo TikTok de **${p.nickname}** !`,
				this.videoEmbed(p, v)
			);
			if (sent) count++;
		}
		// On mémorise la plus récente vue (même si un envoi a échoué, pour ne pas
		// boucler indéfiniment sur la même vidéo).
		await this.rememberVideo(p.videos[0]);
		if (count > 0) logger.info({ user: p.uniqueId, count }, "[tiktok] notif vidéo(s) envoyée(s)");
		return count;
	}

	private async rememberVideo(v: TikTokVideo) {
		await this.settings.set("tiktok.last_video_id", v.id);
		await this.settings.set("tiktok.last_video_time", String(v.createTime));
	}

	private liveEmbed(p: TikTokProfile): EmbedBuilder {
		const e = new EmbedBuilder()
			.setColor(LIVE_COLOR)
			.setTitle(`🔴 ${p.nickname} est EN LIVE sur TikTok`)
			.setURL(p.liveUrl)
			.setDescription(`Rejoins le live de [@${p.uniqueId}](${p.liveUrl}) maintenant sur TikTok !`)
			.addFields({ name: "Lien", value: p.liveUrl })
			.setFooter({ text: "TikTok • LIVE" })
			.setTimestamp(new Date());
		if (p.avatar) e.setThumbnail(p.avatar);
		return e;
	}

	private videoEmbed(p: TikTokProfile, v: TikTokVideo): EmbedBuilder {
		const desc = v.desc.length > DESC_MAX ? `${v.desc.slice(0, DESC_MAX)}…` : v.desc;
		const e = new EmbedBuilder()
			.setColor(VIDEO_COLOR)
			.setTitle(`Nouvelle vidéo de ${p.nickname}`)
			.setURL(v.url)
			.setDescription(desc || `[Voir la vidéo](${v.url})`)
			.setFooter({ text: "TikTok • Nouvelle vidéo" })
			.setTimestamp(new Date(v.createTime * 1000));
		if (v.cover) e.setImage(v.cover);
		else if (p.avatar) e.setThumbnail(p.avatar);
		return e;
	}

	/**
	 * Poste dans le salon configuré avec le ping du rôle opt-in. Retourne `false`
	 * (sans throw) si le salon/rôle n'est pas configuré ou si l'envoi échoue.
	 */
	private async post(content: string, embed: EmbedBuilder): Promise<boolean> {
		if (!this.client) return false;
		const channelId = await this.settings.getSnowflake("tiktok.channel");
		if (!channelId) {
			logger.warn("[tiktok] tiktok.channel non configuré — notif ignorée");
			return false;
		}
		const channel = await this.client.channels.fetch(channelId).catch(() => null);
		if (!channel || !channel.isTextBased() || !("send" in channel)) {
			logger.warn({ channelId }, "[tiktok] salon introuvable ou non textuel");
			return false;
		}
		const roleId = await this.settings.getSnowflake("tiktok.role");
		const prefix = roleId ? `<@&${roleId}> ` : "";
		try {
			await (channel as SendableChannels).send({
				content: prefix + content,
				embeds: [embed],
				allowedMentions: roleId ? { roles: [roleId] } : { parse: [] },
			});
			return true;
		} catch (err) {
			logger.warn({ err, channelId }, "[tiktok] échec envoi notif");
			return false;
		}
	}
}
