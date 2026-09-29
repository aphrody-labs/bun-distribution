/**
 * Embed helpers — inspirés de @aphrody/tscord (src/utils/functions/embeds.ts) mais
 * recopiés ici pour éviter de tirer toute la stack mikro-orm/tsed de tscord.
 *
 * Convention couleurs (alignée Discord brand) :
 *   • Success  → 0x57f287 (vert)
 *   • Error    → 0xed4245 (rouge)
 *   • Warning  → 0xfee75c (jaune)
 *   • Info     → 0x5865f2 (blurple)
 *   • Brand    → 0xfbbf24 (amber, identité shenron)
 */
import { EmbedBuilder, type ColorResolvable, type GuildMember, type User } from "discord.js";
import { formatZeni } from "~/lib/zeni";

export const COLORS = {
	success: 0x57f287,
	error: 0xed4245,
	warning: 0xfee75c,
	info: 0x5865f2,
	brand: 0xfbbf24,
	muted: 0x71717a,
} as const;

/**
 * Couleurs DBZ thématiques pour les events de gameplay (level-up, achievement,
 * sanctions, etc.). Chaque rang = une transformation iconique.
 */
export const DBZ_COLORS = {
	saiyan: 0xfacc15, // SS jaune
	blue: 0x3b82f6, // SS Blue
	rose: 0xec4899, // SS Rose / Black
	ultra: 0xa1a1aa, // Ultra Instinct argenté
	kaio: 0xdc2626, // Kaio-ken rouge
	namek: 0x16a34a, // Vert Namek
	power: 0xef4444, // Sanction
	zeni: 0xf59e0b, // Zenis / économie
	achievement: 0x8b5cf6, // Succès
	goku: 0xea580c, // Gi Goku
} as const;

export type EmbedKind = keyof typeof COLORS;

export function brandedEmbed(opts: {
	title?: string;
	description?: string;
	kind?: EmbedKind;
	footer?: string;
	timestamp?: boolean;
}): EmbedBuilder {
	const e = new EmbedBuilder().setColor(COLORS[opts.kind ?? "brand"]);
	if (opts.title) e.setTitle(opts.title);
	if (opts.description) e.setDescription(opts.description);
	if (opts.footer) e.setFooter({ text: opts.footer });
	if (opts.timestamp !== false) e.setTimestamp(new Date());
	return e;
}

export function successEmbed(message: string, description?: string): EmbedBuilder {
	return brandedEmbed({ title: `✅ ${message}`, description, kind: "success" });
}

export function errorEmbed(message: string, description?: string): EmbedBuilder {
	return brandedEmbed({ title: `❌ ${message}`, description, kind: "error" });
}

export function warningEmbed(message: string, description?: string): EmbedBuilder {
	return brandedEmbed({ title: `⚠️ ${message}`, description, kind: "warning" });
}

function infoEmbed(message: string, description?: string): EmbedBuilder {
	return brandedEmbed({ title: `ℹ️ ${message}`, description, kind: "info" });
}

// ─── Helpers safety (limites Discord) ────────────────────────────────────
// Limites strict de l'API Discord — au-delà l'embed est rejeté :
//   title 256 · description 4096 · field name 256 · field value 1024 ·
//   footer 2048 · author 256 · 25 fields max · 6000 chars total

/** Tronque proprement à `max` chars (avec ellipsis si coupure). */
function trim(str: string, max: number): string {
	return str.length > max ? `${str.slice(0, max - 3)}...` : str;
}

// ─── Embeds DBZ thématiques ──────────────────────────────────────────────

const FOOTER_DBZ = { text: "Shenron · réalise tes vœux DBZ" };

/** Couleur d'un level-up selon le palier atteint (1→namek, 4→saiyan, 6→kaio, 8→blue, 9→rose, 10→ultra). */
function colorForLevel(level: number): ColorResolvable {
	if (level >= 10) return DBZ_COLORS.ultra;
	if (level >= 9) return DBZ_COLORS.rose;
	if (level >= 8) return DBZ_COLORS.blue;
	if (level >= 6) return DBZ_COLORS.kaio;
	if (level >= 4) return DBZ_COLORS.saiyan;
	return DBZ_COLORS.namek;
}

/**
 * Level-up embed : avatar du membre, gradient couleur selon palier, fields
 * Niveau / XP / Récompense.
 */
export function levelUpEmbed(opts: {
	member: GuildMember;
	level: number;
	xp: number;
	zeniBonus?: number;
	message: string;
}): EmbedBuilder {
	const { member, level, xp, zeniBonus, message } = opts;
	const embed = new EmbedBuilder()
		.setColor(colorForLevel(level))
		.setAuthor({
			name: member.displayName,
			iconURL: member.displayAvatarURL({ size: 128 }),
		})
		.setTitle(trim(`Niveau ${level} atteint !`, 256))
		.setDescription(trim(message, 4096))
		.setThumbnail(member.displayAvatarURL({ size: 256 }))
		.addFields(
			{ name: "Niveau", value: `**${level}**`, inline: true },
			{ name: "XP total", value: xp.toLocaleString("fr-FR"), inline: true }
		)
		.setTimestamp()
		.setFooter(FOOTER_DBZ);
	if (zeniBonus && zeniBonus > 0) {
		embed.addFields({
			name: "Récompense",
			value: `**+${formatZeni(zeniBonus)}**`,
			inline: true,
		});
	}
	return embed;
}

/** Succès débloqué (achievement) : violet, mention user, description du succès. */
function achievementEmbed(opts: {
	user: User;
	code: string;
	description: string;
	zeniBonus?: number;
}): EmbedBuilder {
	const { user, code, description, zeniBonus } = opts;
	const embed = new EmbedBuilder()
		.setColor(DBZ_COLORS.achievement)
		.setAuthor({
			name: user.username,
			iconURL: user.displayAvatarURL({ size: 128 }),
		})
		.setTitle("🏆 Succès débloqué !")
		.setDescription(trim(`<@${user.id}> a débloqué **${code}**`, 4096))
		.addFields({ name: "Description", value: trim(description, 1024) })
		.setTimestamp()
		.setFooter(FOOTER_DBZ);
	if (zeniBonus && zeniBonus > 0) {
		embed.addFields({
			name: "Récompense",
			value: `**+${formatZeni(zeniBonus)}**`,
			inline: true,
		});
	}
	return embed;
}

/** Transaction économique (gain / perte zénis). */
function economyEmbed(opts: {
	user: User;
	delta: number;
	reason: string;
	newBalance?: number;
}): EmbedBuilder {
	const { user, delta, reason, newBalance } = opts;
	const positive = delta >= 0;
	const embed = new EmbedBuilder()
		.setColor(DBZ_COLORS.zeni)
		.setAuthor({
			name: user.username,
			iconURL: user.displayAvatarURL({ size: 128 }),
		})
		.setTitle(positive ? "💰 Gain de zénis" : "💸 Perte de zénis")
		.setDescription(reason)
		.addFields({
			name: positive ? "Gain" : "Perte",
			value: `**${positive ? "+" : ""}${formatZeni(delta)}**`,
			inline: true,
		})
		.setTimestamp()
		.setFooter(FOOTER_DBZ);
	if (typeof newBalance === "number") {
		embed.addFields({
			name: "Nouveau solde",
			value: formatZeni(newBalance),
			inline: true,
		});
	}
	return embed;
}

/** Bienvenue / Au revoir. */
function joinLeaveEmbed(opts: {
	user: User;
	kind: "join" | "leave";
	memberCount?: number;
	message?: string;
}): EmbedBuilder {
	const { user, kind, memberCount, message } = opts;
	const embed = new EmbedBuilder()
		.setColor(kind === "join" ? COLORS.success : COLORS.warning)
		.setAuthor({
			name: user.username,
			iconURL: user.displayAvatarURL({ size: 128 }),
		})
		.setTitle(kind === "join" ? "🌟 Nouveau combattant !" : "👋 Au revoir guerrier")
		.setDescription(message ?? `<@${user.id}>`)
		.setThumbnail(user.displayAvatarURL({ size: 256 }))
		.setTimestamp()
		.setFooter(FOOTER_DBZ);
	if (memberCount) {
		embed.addFields({
			name: "Membres",
			value: `**${memberCount}** combattants`,
			inline: true,
		});
	}
	return embed;
}

/** Sanction modération (warn / mute / kick / ban / jail) avec leur opposé `un*`. */
type SanctionAction =
	| "warn"
	| "mute"
	| "kick"
	| "ban"
	| "jail"
	| "unwarn"
	| "unmute"
	| "unjail"
	| "unban";

const SANCTION_EMOJI: Record<SanctionAction, string> = {
	warn: "⚠️",
	mute: "🔇",
	unmute: "🔊",
	kick: "👢",
	ban: "🔨",
	unban: "🔓",
	jail: "⛓️",
	unjail: "🕊️",
	unwarn: "✅",
};

/**
 * Embed compact "log style" pour les annonces publiques de sanctions
 * (ban / kick / jail). Format minimal volontairement :
 *   - 1 ligne flavor avec le persona ("Beerus disperse", "Enma juge", ...)
 *   - GIF en image principale
 *   - 0 field, pas de footer (réduit le bruit visuel dans le salon)
 *
 * Le détail complet (modérateur, motif, durée, DM) reste dans le log
 * sanctions via `sanctionEmbed()` standard.
 */
export function sanctionLogEmbed(opts: {
	target: User;
	action: "ban" | "kick" | "jail";
	gifUrl?: string;
}): EmbedBuilder {
	const { target, action, gifUrl } = opts;
	const phrase: Record<typeof action, { line: string; color: number }> = {
		jail: {
			line: `**${target.username}** a été envoyé en enfer !`,
			color: DBZ_COLORS.power,
		},
		ban: {
			line: `**${target.username}** a été désintégré par Beerus !`,
			color: DBZ_COLORS.power,
		},
		kick: {
			line: `**${target.username}** a été éjecté par Beerus !`,
			color: DBZ_COLORS.kaio,
		},
	};
	const { line, color } = phrase[action];
	const embed = new EmbedBuilder().setColor(color).setDescription(line);
	if (gifUrl && /^(https:\/\/|attachment:\/\/)/i.test(gifUrl)) embed.setImage(gifUrl);
	return embed;
}

export function sanctionEmbed(opts: {
	target: User;
	moderator: User;
	action: SanctionAction;
	reason?: string;
	duration?: string;
	/** URL d'un GIF/image à afficher en bas de l'embed (Discord setImage). */
	gifUrl?: string;
}): EmbedBuilder {
	const { target, moderator, action, reason, duration, gifUrl } = opts;
	const isUndo = action.startsWith("un");
	const embed = new EmbedBuilder()
		.setColor(isUndo ? COLORS.success : DBZ_COLORS.power)
		.setTitle(`${SANCTION_EMOJI[action]} ${action.charAt(0).toUpperCase() + action.slice(1)}`)
		.setDescription(`<@${target.id}>`)
		.addFields(
			{ name: "Modérateur", value: `<@${moderator.id}>`, inline: true },
			{
				name: "Cible",
				value: `${target.username} \`${target.id}\``,
				inline: true,
			}
		)
		.setTimestamp()
		.setFooter(FOOTER_DBZ);
	if (reason) embed.addFields({ name: "Motif", value: reason });
	if (duration) embed.addFields({ name: "Durée", value: duration, inline: true });
	if (gifUrl && /^(https:\/\/|attachment:\/\/)/i.test(gifUrl)) embed.setImage(gifUrl);
	return embed;
}

/**
 * Palette Harmonisée Dragon Ball & Shenron (Lead UI Design)
 */
export const SHENRON_THEME = {
	gold: 0xf59e0b, // Gold Shenron (#F59E0B)
	orange: 0xff6b00, // Orange Shenron (#FF6B00)
	saiyanBlue: 0x2563eb, // Bleu Saiyan (#2563EB)
	majinRed: 0xdc2626, // Rouge Majin (#DC2626)
	kiGreen: 0x22c55e, // Vert Namek / Ki (#22C55E)
	beerusPurple: 0x8b5cf6, // Violet Beerus (#8B5CF6)
	silverUltra: 0xe2e8f0, // Argent Ultra Instinct (#E2E8F0)
} as const;

export const SHENRON_SEPARATORS = {
	solid: "━━━━━━━━━━━━━━━━━━━━━━━━━━",
	dashed: "──────────────────────────",
	stars: "─── ⋆⋅☆⋅⋆ ───",
} as const;

/**
 * Génère une barre de progression Unicode esthétique (ex: ▰▰▰▰▱▱▱▱▱▱ 40%)
 */
export function renderProgressBar(current: number, max: number, size = 10): string {
	if (max <= 0) return `${"▱".repeat(size)} 0%`;
	const ratio = Math.max(0, Math.min(1, current / max));
	const filled = Math.round(ratio * size);
	const empty = size - filled;
	const pct = Math.round(ratio * 100);
	return `${"▰".repeat(filled)}${"▱".repeat(empty)} ${pct}%`;
}
