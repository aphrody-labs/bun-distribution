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
import { renderPenduCard } from "~/lib/game-cards";
import { REWARD_BLOCK_LABELS, stakeAllowed } from "~/services/games/anti-farm";
import {
	DIFFICULTY_LABELS,
	parseGameDifficulty,
	type GameDifficulty,
} from "~/services/games/difficulty";
import {
	PENDU_LEVELS,
	PENDU_MAX_ERRORS_DEFAULT,
	createPenduState,
	evaluatePendu,
	guessPenduLetter,
	guessPenduWord,
	maskPenduWord,
	normalizePenduWord,
	penduErrors,
	penduLivesLeft,
	penduMaxErrorsFor,
	penduReward,
	randomPenduEntry,
	type PenduEntry,
	type PenduState,
} from "~/services/games/pendu";

interface PendingChallenge {
	entry: PenduEntry;
	level: GameDifficulty;
	challengerId: string;
	opponentId: string;
	expiresAt: number;
	stake: number;
}

interface PenduSession {
	entry: PenduEntry;
	level: GameDifficulty;
	state: PenduState;
	players: string[];
	endsAt: number;
	stake: number;
	winReward: number;
	lossPenalty: number;
	lastMove: string | null;
}

type EndReason = "won" | "lost" | "timeout";
type BoardPayload = { embeds: EmbedBuilder[]; files: AttachmentBuilder[] };

const challenges = new Map<string, PendingChallenge>();
/** Une seule partie de pendu à la fois par joueur (anti parties parallèles). */
const activePlayers = new Set<string>();
const CHALLENGE_TTL_MS = 60_000;
const GUESS_RE = /^[\p{L}' -]{1,40}$/u;

@Discord()
@Bot("shenron")
@Guard(GuildOnly, CommandsChannelOnly)
@injectable()
export class PenduCommand {
	constructor(
		@inject(EconomyService) private eco: EconomyService,
		@inject(SettingsService) private settings: SettingsService,
		@inject(MessageTemplateService) private msg: MessageTemplateService,
		@inject(GameRewardService) private rewards: GameRewardService
	) {}

	@Slash({ name: "pendu", description: "Pendu Dragon Ball : trouve le mot avant d'épuiser tes Dragon Balls" })
	async pendu(
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
			description: "Facile, normal (défaut) ou difficile : plus dur, plus de zénis",
			type: ApplicationCommandOptionType.String,
			required: false,
		})
		difficulte: string | undefined,
		@SlashOption({
			name: "mise",
			description: "Mise en zénis, duel uniquement (séquestrée, le gagnant remporte le pot)",
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
		if (!stakeAllowed(mode, mise)) {
			await interaction.reply({
				content: "Les mises sont réservées aux duels. En solo, le gain dépend de la difficulté.",
				flags: MessageFlags.Ephemeral,
			});
			return;
		}
		const userId = interaction.user.id;
		if (activePlayers.has(userId)) {
			await interaction.reply({
				content: "Tu as déjà une partie de pendu en cours.",
				flags: MessageFlags.Ephemeral,
			});
			return;
		}
		const level = parseGameDifficulty(difficulte);
		const entry = randomPenduEntry(level);
		const config = await this.loadConfig(level);

		if (mode === "joueur") {
			if (!opponent || opponent.bot || opponent.id === userId) {
				await interaction.reply({ content: "Adversaire invalide.", flags: MessageFlags.Ephemeral });
				return;
			}
			if (activePlayers.has(opponent.id)) {
				await interaction.reply({
					content: `${opponent} a déjà une partie de pendu en cours.`,
					flags: MessageFlags.Ephemeral,
				});
				return;
			}
			const stake = mise ?? 0;
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
				entry,
				level,
				challengerId: userId,
				opponentId: opponent.id,
				expiresAt: Date.now() + CHALLENGE_TTL_MS,
				stake,
			});
			await interaction.reply(
				buildChallengeMessage({
					scope: "pendu",
					key,
					challenger: interaction.user,
					opponent,
					gameTitle: `Pendu · Duel ${DIFFICULTY_LABELS[level].toLowerCase()}`,
					color: DBZ_COLORS.goku,
					stake:
						stake > 0
							? `Mise **${formatZeni(stake)}** par joueur, séquestrée · pot **${formatZeni(stake * 2)}**`
							: `Gagnant **${formatZeniDelta(config.winReward)}** · Perdant **${formatZeniDelta(-(config.lossPenalty))}**`,
					extraFields: [
						{ name: "Mot mystère", value: `**${entry.word.replace(/ /g, "").length} lettres**`, inline: true },
						{ name: "Vies", value: `${config.maxErrors}`, inline: true },
					],
				})
			);
			setTimeout(() => {
				const c = challenges.get(key);
				if (c && c.expiresAt <= Date.now()) challenges.delete(key);
			}, CHALLENGE_TTL_MS + 5_000).unref();
			return;
		}

		const session = this.createSession(entry, level, [userId], config, 0);
		activePlayers.add(userId);
		try {
			const first = await this.boardPayload(session, "playing");
			const response = await interaction.reply({ ...first, withResponse: true });
			this.runGame(channel, session, response.resource?.message ?? null, (reason) =>
				this.settleSolo(session, reason, interaction)
			);
		} catch (err) {
			activePlayers.delete(userId);
			throw err;
		}
	}

	@ButtonComponent({ id: challengeIdPattern("pendu") })
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
		const channel = interaction.channel;

		if (parsed.action === "decline") {
			await interaction.update({
				content: "",
				embeds: [
					new EmbedBuilder()
						.setTitle("Pendu · Défi refusé")
						.setDescription(
							`<@${challenge.opponentId}> a refusé le défi de <@${challenge.challengerId}>.`
						)
						.setColor(COLORS.muted),
				],
				components: [],
			});
			return;
		}
		const players = [challenge.challengerId, challenge.opponentId];
		if (!channel?.isSendable() || players.some((p) => activePlayers.has(p))) {
			await interaction.update({
				content: "",
				embeds: [
					new EmbedBuilder()
						.setTitle("Pendu · Duel annulé")
						.setDescription("Un des joueurs a déjà une partie de pendu en cours.")
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
					.setTitle("Pendu · Duel accepté")
					.setDescription(`<@${challenge.opponentId}> relève le défi. Le premier qui trouve le mot gagne.`)
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
		const config = await this.loadConfig(challenge.level);
		const timeoutMs = await this.settings.getInt("game.challenge_timeout_ms", 5 * 60_000);
		const session = this.createSession(challenge.entry, challenge.level, players, config, challenge.stake, timeoutMs);
		try {
			const board = await channel.send(await this.boardPayload(session, "playing"));
			this.runGame(channel, session, board, (reason, winnerId) =>
				this.settleDuel(session, reason, winnerId, interaction)
			);
		} catch (err) {
			for (const p of players) activePlayers.delete(p);
			await this.rewards.payStakes("draw", players[0]!, players[1]!, challenge.stake);
			throw err;
		}
	}

	private async loadConfig(level: GameDifficulty) {
		const [baseErrors, baseWin, baseLoss] = await Promise.all([
			this.settings.getInt("game.pendu.max_errors", PENDU_MAX_ERRORS_DEFAULT),
			this.settings.getInt("zeni.game.win", ZENI_GAME_WIN),
			this.settings.getInt("zeni.game.loss_penalty", ZENI_GAME_LOSS_PENALTY),
		]);
		return {
			maxErrors: penduMaxErrorsFor(level, baseErrors),
			winReward: penduReward(baseWin, level),
			lossPenalty: Math.max(0, baseLoss),
		};
	}

	private createSession(
		entry: PenduEntry,
		level: GameDifficulty,
		players: string[],
		config: { maxErrors: number; winReward: number; lossPenalty: number },
		stake: number,
		durationMs = PENDU_LEVELS[level].timeLimitMs
	): PenduSession {
		return {
			entry,
			level,
			state: createPenduState(entry.word, config.maxErrors),
			players,
			endsAt: Date.now() + durationMs,
			stake,
			winReward: config.winReward,
			lossPenalty: config.lossPenalty,
			lastMove: null,
		};
	}

	/**
	 * Boucle de jeu commune solo/duel. Les messages sont traités en file (pas de
	 * course entre deux propositions rapides) et un seul plateau reste affiché :
	 * le précédent est supprimé à chaque coup.
	 */
	private runGame(
		channel: SendableChannels,
		session: PenduSession,
		firstBoard: Message | null,
		settle: (reason: EndReason, winnerId?: string) => Promise<string[]>
	): void {
		let board = firstBoard;
		let finished = false;
		let queue: Promise<void> = Promise.resolve();
		const { state } = session;
		const cost = PENDU_LEVELS[session.level].wordMissCost;

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
				logger.error({ err }, "pendu: règlement de fin de partie en échec");
			} finally {
				for (const p of session.players) activePlayers.delete(p);
			}
			await refresh(reason === "won" ? "won" : "lost", result);
		};

		const collector = channel.createMessageCollector({
			filter: (m: Message) => session.players.includes(m.author.id) && GUESS_RE.test(m.content.trim()),
			time: Math.max(1_000, session.endsAt - Date.now()),
		});

		const handle = async (m: Message) => {
			if (finished) return;
			const guess = normalizePenduWord(m.content);
			const letters = guess.replace(/[^a-z]/g, "");
			if (!letters) return;
			const who = `<@${m.author.id}>`;
			if (guess.length === 1) {
				const r = guessPenduLetter(state, guess);
				if (r.alreadyPlayed) return;
				session.lastMove = r.hit
					? `${who} : **${guess.toUpperCase()}** est dans le mot.`
					: `${who} : **${guess.toUpperCase()}** n'y est pas, une Dragon Ball de moins.`;
			} else {
				const r = guessPenduWord(state, guess, cost);
				if (r.ignored) return;
				session.lastMove = r.correct
					? `${who} trouve le mot entier.`
					: `${who} propose **${guess.toUpperCase()}** : raté, ${r.cost} vie${r.cost > 1 ? "s" : ""} perdue${r.cost > 1 ? "s" : ""}.`;
			}
			const outcome = evaluatePendu(state);
			if (outcome === "playing") {
				await refresh("playing");
				return;
			}
			collector.stop(outcome);
			await finish(outcome, outcome === "won" ? m.author.id : undefined);
		};

		collector.on("collect", (m: Message) => {
			queue = queue.then(() => handle(m)).catch((err) => logger.error({ err }, "pendu: coup en échec"));
		});
		collector.on("end", (_c, reason) => {
			queue = queue
				.then(() => (finished ? undefined : finish("timeout")))
				.catch((err) => logger.error({ err, reason }, "pendu: fin de partie en échec"));
		});
	}

	private async settleSolo(
		session: PenduSession,
		reason: EndReason,
		interaction: CommandInteraction
	): Promise<string[]> {
		const userId = session.players[0]!;
		if (reason === "won") {
			const grant = await this.rewards.grantWin({ userId, amount: session.winReward });
			if (grant.paid === 0) {
				return [grant.blocked ? `Victoire sans gain : ${REWARD_BLOCK_LABELS[grant.blocked]}.` : "Aucun gain."];
			}
			await this.msg.publish(
				"zeni_game_win",
				{ user: `<@${userId}>`, zeni: grant.paid, game: "pendu" },
				interaction.client
			);
			return [`<@${userId}> **${formatZeniDelta(grant.paid)}**`];
		}
		const lines = [reason === "timeout" ? "Temps écoulé." : "Plus aucune Dragon Ball."];
		if (session.lossPenalty > 0 && (await this.eco.removeZeni(userId, session.lossPenalty))) {
			lines.push(`<@${userId}> **${formatZeniDelta(-(session.lossPenalty))}**`);
		}
		return lines;
	}

	private async settleDuel(
		session: PenduSession,
		reason: EndReason,
		winnerId: string | undefined,
		interaction: ButtonInteraction
	): Promise<string[]> {
		const [a, b] = session.players as [string, string];
		if (reason !== "won" || !winnerId) {
			if (session.stake > 0) await this.rewards.payStakes("draw", a, b, session.stake);
			return [
				reason === "timeout" ? "Temps écoulé, personne n'a trouvé." : "Plus aucune Dragon Ball, personne n'a trouvé.",
				session.stake > 0 ? "Mises rendues." : "Aucun gain.",
			];
		}
		const loserId = winnerId === a ? b : a;
		if (session.stake > 0) {
			await this.rewards.payStakes("win", winnerId, loserId, session.stake);
			return [`<@${winnerId}> remporte le pot : **${formatZeniDelta(session.stake * 2)}**.`];
		}
		const grant = await this.rewards.grantWin({
			userId: winnerId,
			amount: session.winReward,
			opponentId: loserId,
		});
		if (grant.paid === 0) {
			return [grant.blocked ? `Victoire sans gain : ${REWARD_BLOCK_LABELS[grant.blocked]}.` : "Aucun gain."];
		}
		const lines = [`<@${winnerId}> **${formatZeniDelta(grant.paid)}**`];
		if (session.lossPenalty > 0 && (await this.eco.removeZeni(loserId, session.lossPenalty))) {
			lines.push(`<@${loserId}> **${formatZeniDelta(-(session.lossPenalty))}**`);
		}
		await this.msg.publish(
			"zeni_game_win",
			{ user: `<@${winnerId}>`, zeni: grant.paid, game: "pendu (duel)" },
			interaction.client
		);
		return lines;
	}

	private async boardPayload(
		session: PenduSession,
		status: "playing" | "won" | "lost",
		result?: string[]
	): Promise<BoardPayload> {
		const { state, level, entry } = session;
		const config = PENDU_LEVELS[level];
		const category = config.showCategory ? entry.category : null;
		const shown = status === "playing" ? maskPenduWord(state, "_") : [...state.word].join(" ");
		const players =
			session.players.length === 1
				? `Joueur : <@${session.players[0]}>`
				: `<@${session.players[0]}> contre <@${session.players[1]}>`;

		const description = [players, "", `**Mot :** \`${shown.toUpperCase()}\``];
		if (session.lastMove) description.push(session.lastMove);

		const embed = new EmbedBuilder()
			.setTitle(
				status === "won"
					? "Pendu · Victoire"
					: status === "lost"
						? "Pendu · Défaite"
						: `Pendu · ${DIFFICULTY_LABELS[level]}`
			)
			.setDescription(description.join("\n"))
			.setColor(status === "won" ? COLORS.brand : status === "lost" ? DBZ_COLORS.power : DBZ_COLORS.goku)
			.addFields(
				{ name: "Difficulté", value: DIFFICULTY_LABELS[level], inline: true },
				{ name: "Vies", value: `${penduLivesLeft(state)} / ${state.maxErrors}`, inline: true },
				{ name: "Indice", value: category ?? "Aucun", inline: true }
			);

		if (status === "playing") {
			embed.addFields(
				{ name: "Fin de partie", value: `<t:${Math.floor(session.endsAt / 1000)}:R>`, inline: true },
				{
					name: "Gain",
					value: session.stake > 0 ? `Pot de **${formatZeni(session.stake * 2)}**` : `**${formatZeniDelta(session.winReward)}**`,
					inline: true,
				},
				{ name: "Mot faux", value: `-${config.wordMissCost} vie${config.wordMissCost > 1 ? "s" : ""}`, inline: true }
			);
			embed.setFooter({ text: "Envoie une lettre, ou tente le mot entier." });
		} else if (result?.length) {
			embed.addFields({ name: "Résultat", value: result.join("\n") });
		}

		const files: AttachmentBuilder[] = [];
		try {
			const png = await renderPenduCard({
				word: state.word,
				found: state.found,
				missed: state.missed,
				errors: penduErrors(state),
				maxErrors: state.maxErrors,
				status,
				level,
				category,
			});
			if (png.length > 0) {
				files.push(new AttachmentBuilder(png, { name: "pendu.png" }));
				embed.setImage("attachment://pendu.png");
			}
		} catch (err) {
			logger.debug({ err }, "pendu: rendu de la carte indisponible");
		}
		return { embeds: [embed], files };
	}
}
