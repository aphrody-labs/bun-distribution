import { injectable, inject } from "tsyringe";
import {
	Bot,
	ButtonComponent,
	Discord,
	Guard,
	Slash,
	SlashChoice,
	SlashOption,
} from "discordx";
import { userTransformer } from "~/lib/slash-user";
import {
	ApplicationCommandOptionType,
	AttachmentBuilder,
	EmbedBuilder,
	MessageFlags,
	type ButtonInteraction,
	type CommandInteraction,
	type Message,
	type SendableChannels,
	type User,
} from "discord.js";
import { GuildOnly } from "~/guards/GuildOnly";
import { CommandsChannelOnly } from "~/guards/CommandsChannelOnly";
import { EconomyService } from "~/services/EconomyService";
import { ZENI_GAME_WIN, ZENI_GAME_LOSS_PENALTY } from "~/lib/constants";
import { formatZeni, formatZeniDelta } from "~/lib/zeni";
import { SettingsService } from "~/services/SettingsService";
import { MessageTemplateService } from "~/services/MessageTemplateService";
import { GameRewardService } from "~/services/GameRewardService";
import { buildChallengeMessage, challengeIdPattern, parseChallengeId } from "~/lib/challenge";
import { COLORS, DBZ_COLORS } from "~/lib/embeds";
import { logger } from "~/lib/logger";
import { renderBingoCard } from "~/lib/game-cards";
import { REWARD_BLOCK_LABELS } from "~/services/games/anti-farm";
import {
	DIFFICULTY_LABELS,
	parseGameDifficulty,
	type GameDifficulty,
} from "~/services/games/difficulty";
import {
	BINGO_DEFAULT_TIMEOUT_MS,
	BINGO_LEVELS,
	bingoLossPenalty,
	bingoReward,
	bingoTimeLimitMs,
	compareBingoGuess,
	narrowBingoRange,
	randomBingoTarget,
	type BingoRange,
} from "~/services/games/bingo";

interface PendingChallenge {
	level: GameDifficulty;
	challengerId: string;
	opponentId: string;
	stake: number;
	expiresAt: number;
}

interface BingoSession {
	level: GameDifficulty;
	min: number;
	max: number;
	target: number;
	range: BingoRange;
	guesses: Array<{ value: number; hint: "higher" | "lower" | "match" }>;
	attempts: Map<string, number>;
	maxAttempts: number;
	players: string[];
	endsAt: number;
	stake: number;
	winReward: number;
	lossPenalty: number;
	lastMove: string | null;
}

type EndReason = "won" | "lost" | "timeout";

const challenges = new Map<string, PendingChallenge>();
/** Une seule partie de bingo à la fois par joueur. */
const activePlayers = new Set<string>();
const CHALLENGE_TTL_MS = 60_000;

@Discord()
@Bot("shenron")
@Guard(GuildOnly, CommandsChannelOnly)
@injectable()
export class BingoCommand {
	constructor(
		@inject(EconomyService) private eco: EconomyService,
		@inject(SettingsService) private settings: SettingsService,
		@inject(MessageTemplateService) private msg: MessageTemplateService,
		@inject(GameRewardService) private rewards: GameRewardService
	) {}

	@Slash({ name: "bingo", description: "Devine le nombre mystère en un nombre d'essais limité" })
	async bingo(
		@SlashChoice({ name: "bot", value: "bot" })
		@SlashChoice({ name: "joueur", value: "joueur" })
		@SlashOption({
			name: "mode",
			description: "bot/joueur",
			type: ApplicationCommandOptionType.String,
			required: true,
		})
		mode: "bot" | "joueur",
		@SlashOption(
			{
				name: "adversaire",
				description: "Adversaire (mode joueur)",
				type: ApplicationCommandOptionType.User,
				required: false,
			},
			userTransformer
		)
		opponent: User | undefined,
		@SlashChoice({ name: "facile", value: "facile" })
		@SlashChoice({ name: "normal", value: "normal" })
		@SlashChoice({ name: "difficile", value: "difficile" })
		@SlashOption({
			name: "difficulte",
			description: "Facile, normal (défaut) ou difficile : plage plus large, moins d'essais, plus de zénis",
			type: ApplicationCommandOptionType.String,
			required: false,
		})
		difficulte: string | undefined,
		@SlashOption({
			name: "mise",
			description: "Mise en zénis du duel (séquestrée, le gagnant remporte le pot et le bonus)",
			type: ApplicationCommandOptionType.Integer,
			required: false,
			minValue: 1,
			maxValue: 1_000_000,
		})
		mise: number | undefined,
		interaction: CommandInteraction
	) {
		const channel = interaction.channel;
		if (!channel?.isSendable()) {
			await interaction.reply({ content: "Non supporté ici.", flags: MessageFlags.Ephemeral });
			return;
		}
		const userId = interaction.user.id;
		if (activePlayers.has(userId)) {
			await interaction.reply({
				content: "Tu as déjà une partie de bingo en cours.",
				flags: MessageFlags.Ephemeral,
			});
			return;
		}
		const level = parseGameDifficulty(difficulte);
		const cfg = BINGO_LEVELS[level];
		const [baseWin, baseLoss, baseMs] = await Promise.all([
			this.settings.getInt("zeni.game.win", ZENI_GAME_WIN),
			this.settings.getInt("zeni.game.loss_penalty", ZENI_GAME_LOSS_PENALTY),
			this.settings.getInt("game.bingo.limit_ms", BINGO_DEFAULT_TIMEOUT_MS),
		]);

		if (mode === "bot") {
			if (mise !== undefined) {
				await interaction.reply({
					content: "Les mises sont réservées aux duels. En solo, le gain dépend de la difficulté.",
					flags: MessageFlags.Ephemeral,
				});
				return;
			}
			const session = this.createSession(level, [userId], {
				stake: 0,
				winReward: bingoReward(baseWin, level),
				lossPenalty: bingoLossPenalty(baseLoss, level),
				durationMs: bingoTimeLimitMs(level, baseMs),
			});
			activePlayers.add(userId);
			try {
				const response = await interaction.reply({
					...(await this.boardPayload(session, "playing")),
					withResponse: true,
				});
				this.runGame(channel, session, response.resource?.message ?? null, (reason, winnerId) =>
					this.settle(session, reason, winnerId, interaction.client)
				);
			} catch (err) {
				activePlayers.delete(userId);
				throw err;
			}
			return;
		}

		// ── Duel ───────────────────────────────────────────────────────
		if (!opponent || opponent.bot || opponent.id === userId) {
			await interaction.reply({ content: "Adversaire invalide.", flags: MessageFlags.Ephemeral });
			return;
		}
		if (activePlayers.has(opponent.id)) {
			await interaction.reply({
				content: `${opponent} a déjà une partie de bingo en cours.`,
				flags: MessageFlags.Ephemeral,
			});
			return;
		}
		const stake = mise ?? Math.max(0, baseLoss);
		if (stake > 0) {
			const [bal1, bal2] = await Promise.all([
				this.eco.getBalance(userId),
				this.eco.getBalance(opponent.id),
			]);
			if (bal1 < stake || bal2 < stake) {
				const who = bal1 < stake ? "Tu n'as" : `${opponent} n'a`;
				await interaction.reply({
					content: `${who} pas assez de zénis pour une mise de **${formatZeni(stake)}**.`,
					flags: MessageFlags.Ephemeral,
				});
				return;
			}
		}
		const key = interaction.id;
		challenges.set(key, {
			level,
			challengerId: userId,
			opponentId: opponent.id,
			stake,
			expiresAt: Date.now() + CHALLENGE_TTL_MS,
		});
		const bonus = bingoReward(baseWin, level);
		await interaction.reply(
			buildChallengeMessage({
				scope: "bingo",
				key,
				challenger: interaction.user,
				opponent,
				gameTitle: `Bingo · Duel ${DIFFICULTY_LABELS[level].toLowerCase()}`,
				color: DBZ_COLORS.goku,
				stake:
					stake > 0
						? `Mise **${formatZeni(stake)}** par joueur, séquestrée · le gagnant remporte **${formatZeni(stake * 2)}** + bonus **${formatZeni(bonus)}**`
						: `Gagnant **${formatZeniDelta(bonus)}**`,
				extraFields: [
					{ name: "Plage", value: `${cfg.min} → ${cfg.max}`, inline: true },
					{ name: "Essais", value: `${cfg.maxAttempts} par joueur`, inline: true },
				],
			})
		);
		setTimeout(() => {
			const c = challenges.get(key);
			if (c && c.expiresAt <= Date.now()) challenges.delete(key);
		}, CHALLENGE_TTL_MS + 5_000).unref();
	}

	@ButtonComponent({ id: challengeIdPattern("bingo") })
	async onChallengeButton(interaction: ButtonInteraction) {
		const parsed = parseChallengeId(interaction.customId);
		if (!parsed) return;
		const challenge = challenges.get(parsed.key);
		if (!challenge || challenge.expiresAt <= Date.now()) {
			challenges.delete(parsed.key);
			await interaction
				.reply({ content: "Défi expiré ou déjà traité.", flags: MessageFlags.Ephemeral })
				.catch(() => {});
			return;
		}
		if (interaction.user.id !== challenge.opponentId) {
			await interaction.reply({
				content: "Ce défi ne t'est pas adressé.",
				flags: MessageFlags.Ephemeral,
			});
			return;
		}
		challenges.delete(parsed.key);

		if (parsed.action === "decline") {
			await interaction.update({
				content: "",
				embeds: [
					new EmbedBuilder()
						.setTitle("Bingo · Défi refusé")
						.setDescription(
							`<@${challenge.opponentId}> a refusé le défi de <@${challenge.challengerId}>.`
						)
						.setColor(COLORS.muted),
				],
				components: [],
			});
			return;
		}
		const channel = interaction.channel;
		const players = [challenge.challengerId, challenge.opponentId];
		if (!channel?.isSendable() || players.some((p) => activePlayers.has(p))) {
			await interaction.update({
				content: "",
				embeds: [
					new EmbedBuilder()
						.setTitle("Bingo · Duel annulé")
						.setDescription("Un des joueurs a déjà une partie de bingo en cours.")
						.setColor(COLORS.muted),
				],
				components: [],
			});
			return;
		}
		for (const p of players) activePlayers.add(p);
		await interaction.update({
			content: "",
			embeds: [
				new EmbedBuilder()
					.setTitle("Bingo · Duel accepté")
					.setDescription(`<@${challenge.opponentId}> relève le défi. Le premier qui trouve le nombre gagne.`)
					.setColor(DBZ_COLORS.goku),
			],
			components: [],
		});
		const escrowed = await this.rewards.escrowStakes(
			challenge.challengerId,
			challenge.opponentId,
			challenge.stake
		);
		if (!escrowed) {
			for (const p of players) activePlayers.delete(p);
			await channel.send({
				content: "Duel annulé : un des joueurs n'a plus assez de zénis pour couvrir la mise.",
			});
			return;
		}
		const [baseWin, timeoutMs] = await Promise.all([
			this.settings.getInt("zeni.game.win", ZENI_GAME_WIN),
			this.settings.getInt("game.challenge_timeout_ms", 5 * 60_000),
		]);
		const session = this.createSession(challenge.level, players, {
			stake: challenge.stake,
			winReward: bingoReward(baseWin, challenge.level),
			lossPenalty: 0,
			durationMs: timeoutMs,
		});
		try {
			const board = await channel.send(await this.boardPayload(session, "playing"));
			this.runGame(channel, session, board, (reason, winnerId) =>
				this.settle(session, reason, winnerId, interaction.client)
			);
		} catch (err) {
			for (const p of players) activePlayers.delete(p);
			await this.rewards.payStakes("draw", players[0]!, players[1]!, challenge.stake);
			throw err;
		}
	}

	private createSession(
		level: GameDifficulty,
		players: string[],
		opts: { stake: number; winReward: number; lossPenalty: number; durationMs: number }
	): BingoSession {
		const cfg = BINGO_LEVELS[level];
		return {
			level,
			min: cfg.min,
			max: cfg.max,
			target: randomBingoTarget(cfg.min, cfg.max),
			range: { lo: cfg.min, hi: cfg.max },
			guesses: [],
			attempts: new Map(),
			maxAttempts: cfg.maxAttempts,
			players,
			endsAt: Date.now() + opts.durationMs,
			stake: opts.stake,
			winReward: opts.winReward,
			lossPenalty: opts.lossPenalty,
			lastMove: null,
		};
	}

	/** Boucle commune solo/duel : coups traités en file, un seul plateau affiché. */
	private runGame(
		channel: SendableChannels,
		session: BingoSession,
		firstBoard: Message | null,
		settle: (reason: EndReason, winnerId?: string) => Promise<string[]>
	): void {
		let board = firstBoard;
		let finished = false;
		let queue: Promise<void> = Promise.resolve();

		const refresh = async (status: "playing" | "won" | "lost", result?: string[]) => {
			const next = await channel.send(await this.boardPayload(session, status, result)).catch(() => null);
			if (next) {
				await board?.delete().catch(() => {});
				board = next;
			}
		};

		const finish = async (reason: EndReason, winnerId?: string) => {
			finished = true;
			let result: string[] = [];
			try {
				result = await settle(reason, winnerId);
			} catch (err) {
				logger.error({ err }, "bingo: règlement de fin de partie en échec");
			} finally {
				for (const p of session.players) activePlayers.delete(p);
			}
			await refresh(reason === "won" ? "won" : "lost", result);
		};

		const collector = channel.createMessageCollector({
			filter: (m: Message) => session.players.includes(m.author.id) && /^\d{1,7}$/.test(m.content.trim()),
			time: Math.max(1_000, session.endsAt - Date.now()),
		});

		const handle = async (m: Message) => {
			if (finished) return;
			const uid = m.author.id;
			const used = session.attempts.get(uid) ?? 0;
			if (used >= session.maxAttempts) return;
			const guess = Number.parseInt(m.content.trim(), 10);
			const who = `<@${uid}>`;
			const hint = compareBingoGuess(guess, session.target, session.min, session.max);
			if (hint === "out-of-range") {
				session.lastMove = `${who} : **${guess}** est hors plage, essai non compté.`;
				await refresh("playing");
				return;
			}
			session.attempts.set(uid, used + 1);
			session.guesses.push({ value: guess, hint });
			session.range = narrowBingoRange(session.range, guess, hint);
			if (hint === "match") {
				collector.stop("won");
				await finish("won", uid);
				return;
			}
			session.lastMove = `${who} : **${guess}**, c'est plus ${hint === "higher" ? "haut" : "bas"}.`;
			if (session.players.every((p) => (session.attempts.get(p) ?? 0) >= session.maxAttempts)) {
				collector.stop("lost");
				await finish("lost");
				return;
			}
			await refresh("playing");
		};

		collector.on("collect", (m: Message) => {
			queue = queue.then(() => handle(m)).catch((err) => logger.error({ err }, "bingo: coup en échec"));
		});
		collector.on("end", (_c, reason) => {
			queue = queue
				.then(() => (finished ? undefined : finish("timeout")))
				.catch((err) => logger.error({ err, reason }, "bingo: fin de partie en échec"));
		});
	}

	private async settle(
		session: BingoSession,
		reason: EndReason,
		winnerId: string | undefined,
		client: Message["client"]
	): Promise<string[]> {
		const duel = session.players.length === 2;
		const [a, b] = session.players as [string, string?];
		if (reason !== "won" || !winnerId) {
			const head = reason === "timeout" ? "Temps écoulé." : "Plus aucun essai.";
			if (duel) {
				if (session.stake > 0) await this.rewards.payStakes("draw", a, b!, session.stake);
				return [head, session.stake > 0 ? "Mises rendues." : "Aucun gain."];
			}
			if (session.lossPenalty > 0 && (await this.eco.removeZeni(a, session.lossPenalty))) {
				return [head, `<@${a}> **${formatZeniDelta(-(session.lossPenalty))}**`];
			}
			return [head];
		}

		const lines: string[] = [];
		const loserId = duel ? (winnerId === a ? b! : a) : undefined;
		if (duel && session.stake > 0) {
			await this.rewards.payStakes("win", winnerId, loserId!, session.stake);
			lines.push(`<@${winnerId}> remporte le pot : **${formatZeniDelta(session.stake * 2)}**`);
		}
		const grant = await this.rewards.grantWin({
			userId: winnerId,
			amount: session.winReward,
			opponentId: loserId,
		});
		if (grant.paid > 0) {
			lines.push(`${duel ? "Bonus" : `<@${winnerId}>`} **${formatZeniDelta(grant.paid)}**`);
			await this.msg.publish(
				"zeni_game_win",
				{ user: `<@${winnerId}>`, zeni: grant.paid, game: duel ? "bingo (duel)" : "bingo" },
				client
			);
		} else if (grant.blocked) {
			lines.push(`Bonus non versé : ${REWARD_BLOCK_LABELS[grant.blocked]}.`);
		}
		return lines;
	}

	private async boardPayload(
		session: BingoSession,
		status: "playing" | "won" | "lost",
		result?: string[]
	): Promise<{ embeds: EmbedBuilder[]; files: AttachmentBuilder[] }> {
		const solo = session.players.length === 1;
		const { level } = session;
		const players = solo
			? `Joueur : <@${session.players[0]}>`
			: `<@${session.players[0]}> contre <@${session.players[1]}>`;
		const description = [players, ""];
		if (status === "playing") {
			description.push(`**Intervalle possible :** ${session.range.lo} → ${session.range.hi}`);
		} else {
			description.push(`**Nombre mystère :** ${session.target}`);
		}
		if (session.lastMove) description.push(session.lastMove);

		const attemptsValue = session.players
			.map((p) => `${solo ? "" : `<@${p}> : `}${session.attempts.get(p) ?? 0} / ${session.maxAttempts}`)
			.join("\n");

		const embed = new EmbedBuilder()
			.setTitle(
				status === "won" ? "Bingo · Victoire" : status === "lost" ? "Bingo · Défaite" : `Bingo · ${DIFFICULTY_LABELS[level]}`
			)
			.setDescription(description.join("\n"))
			.setColor(status === "won" ? COLORS.brand : status === "lost" ? DBZ_COLORS.power : DBZ_COLORS.goku)
			.addFields(
				{ name: "Difficulté", value: DIFFICULTY_LABELS[level], inline: true },
				{ name: "Plage", value: `${session.min} → ${session.max}`, inline: true },
				{ name: "Essais", value: attemptsValue, inline: true }
			);
		if (status === "playing") {
			const gain = solo
				? `**${formatZeniDelta(session.winReward)}**${session.lossPenalty > 0 ? ` · défaite **${formatZeniDelta(-(session.lossPenalty))}**` : ""}`
				: `Pot **${formatZeni(session.stake * 2)}** + bonus **${formatZeni(session.winReward)}**`;
			embed.addFields(
				{ name: "Fin de partie", value: `<t:${Math.floor(session.endsAt / 1000)}:R>`, inline: true },
				{ name: "Gain", value: gain, inline: true }
			);
			embed.setFooter({ text: "Envoie un nombre dans ce salon." });
		} else if (result?.length) {
			embed.addFields({ name: "Résultat", value: result.join("\n") });
		}

		const files: AttachmentBuilder[] = [];
		try {
			const soloUsed = solo ? (session.attempts.get(session.players[0]!) ?? 0) : null;
			const png = await renderBingoCard({
				min: session.min,
				max: session.max,
				range: session.range,
				guesses: session.guesses,
				attemptsUsed: soloUsed,
				maxAttempts: solo ? session.maxAttempts : null,
				status,
				level,
				target: status === "playing" ? undefined : session.target,
				lastHint: session.guesses.at(-1)?.hint ?? null,
			});
			if (png.length > 0) {
				files.push(new AttachmentBuilder(png, { name: "bingo.png" }));
				embed.setImage("attachment://bingo.png");
			}
		} catch (err) {
			logger.debug({ err }, "bingo: rendu de la carte indisponible");
		}
		return { embeds: [embed], files };
	}
}
