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
	ActionRowBuilder,
	ButtonBuilder,
	ButtonStyle,
	EmbedBuilder,
	MessageFlags,
	type ButtonInteraction,
	type CommandInteraction,
	type Message,
	type User,
} from "discord.js";
import { GuildOnly } from "~/guards/GuildOnly";
import { CommandsChannelOnly } from "~/guards/CommandsChannelOnly";
import { EconomyService } from "~/services/EconomyService";
import { SettingsService } from "~/services/SettingsService";
import { MessageTemplateService } from "~/services/MessageTemplateService";
import { GameRewardService } from "~/services/GameRewardService";
import { ZENI_GAME_WIN, ZENI_GAME_LOSS_PENALTY } from "~/lib/constants";
import { formatZeni, formatZeniDelta } from "~/lib/zeni";
import { buildChallengeMessage, challengeIdPattern, parseChallengeId } from "~/lib/challenge";
import { COLORS, DBZ_COLORS } from "~/lib/embeds";
import { logger } from "~/lib/logger";
import {
	MORPION_BOT,
	MORPION_BOT_BLUNDER_CHANCE,
	createMorpionGame,
	hasActiveMorpionGame,
	morpionIdlePlayer,
	playMorpionTurn,
	type MorpionGame,
	type MorpionOutcome,
} from "~/services/games/morpion";
import { REWARD_BLOCK_LABELS, stakeAllowed } from "~/services/games/anti-farm";

interface Session {
	game: MorpionGame;
	message?: Message;
	lastMoveAt: number;
}

interface PendingChallenge {
	challengerId: string;
	opponentId: string;
	stake: number;
	expiresAt: number;
}

const sessions = new Map<string, Session>();
const challenges = new Map<string, PendingChallenge>();
const CHALLENGE_TTL_MS = 60_000;
const DEFAULT_IDLE_TTL_MS = 5 * 60_000;

const TURN_ERRORS = {
	finished: "Cette partie est terminée.",
	"not-your-turn": "Ce n'est pas ton tour, ou tu ne joues pas dans cette partie.",
	occupied: "Case déjà prise.",
	invalid: "Coup invalide.",
} as const;

function activeGames(): Iterable<MorpionGame> {
	return [...sessions.values()].map((s) => s.game);
}

function renderBoard(
	game: MorpionGame,
	gameId: string,
	winLine?: readonly number[]
): ActionRowBuilder<ButtonBuilder>[] {
	const rows: ActionRowBuilder<ButtonBuilder>[] = [];
	const winSet = new Set(winLine ?? []);
	const locked = game.status !== "playing";
	for (let r = 0; r < 3; r++) {
		const row = new ActionRowBuilder<ButtonBuilder>();
		for (let c = 0; c < 3; c++) {
			const i = r * 3 + c;
			const cell = game.board[i]!;
			row.addComponents(
				new ButtonBuilder()
					.setCustomId(`morpion:${gameId}:${i}`)
					.setLabel(cell === "." ? "·" : cell)
					.setStyle(
						winSet.has(i)
							? ButtonStyle.Success
							: cell === "X"
								? ButtonStyle.Primary
								: cell === "O"
									? ButtonStyle.Danger
									: ButtonStyle.Secondary
					)
					.setDisabled(cell !== "." || locked)
			);
		}
		rows.push(row);
	}
	return rows;
}

type BoardStatus = "playing" | "draw" | "won" | "expired";

function mention(id: string): string {
	return id === MORPION_BOT ? "le robot" : `<@${id}>`;
}

function buildEmbed(
	game: MorpionGame,
	status: BoardStatus,
	opts: { winnerId?: string; result?: string } = {}
): EmbedBuilder {
	const vsBot = game.playerO === MORPION_BOT;
	const lines = [`${mention(game.playerX)} **(X)** contre ${mention(game.playerO)} **(O)**`];
	if (status === "playing") {
		const current = game.turn === "X" ? game.playerX : game.playerO;
		lines.push("", `Au tour de ${mention(current)} **(${game.turn})**`);
	} else if (status === "draw") {
		lines.push("", "**Match nul.**");
	} else if (status === "won" && opts.winnerId) {
		lines.push("", `**${opts.winnerId === MORPION_BOT ? "Le robot gagne" : `<@${opts.winnerId}> gagne`}.**`);
	} else if (status === "expired") {
		lines.push("", "**Partie expirée.**");
	}

	const color =
		status === "won"
			? opts.winnerId === MORPION_BOT
				? DBZ_COLORS.power
				: COLORS.brand
			: status === "draw"
				? COLORS.muted
				: status === "expired"
					? DBZ_COLORS.power
					: DBZ_COLORS.goku;

	const embed = new EmbedBuilder()
		.setTitle(vsBot ? "Morpion · Contre le robot" : "Morpion · Duel")
		.setDescription(lines.join("\n"))
		.setColor(color)
		.setTimestamp(new Date());
	if (game.stake > 0) {
		embed.addFields({
			name: "Mise",
			value: `**${formatZeni(game.stake)}** par joueur, séquestrée · pot **${formatZeni(game.stake * 2)}**`,
			inline: true,
		});
	}
	if (opts.result) embed.addFields({ name: "Résultat", value: opts.result });
	if (status === "playing") {
		embed.setFooter({
			text: vsBot
				? "Victoires récompensées plafonnées sur 24 h."
				: "Laisser expirer la partie à son tour, c'est déclarer forfait.",
		});
	}
	return embed;
}

@Discord()
@Bot("shenron")
@Guard(GuildOnly, CommandsChannelOnly)
@injectable()
export class MorpionCommand {
	constructor(
		@inject(EconomyService) private eco: EconomyService,
		@inject(SettingsService) private settings: SettingsService,
		@inject(MessageTemplateService) private msg: MessageTemplateService,
		@inject(GameRewardService) private rewards: GameRewardService
	) {}

	@Slash({ name: "morpion", description: "Morpion (tic-tac-toe)" })
	async morpion(
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
		const userId = interaction.user.id;
		if (!stakeAllowed(mode, mise)) {
			await interaction.reply({
				content: "Les mises sont réservées aux duels. Contre le robot, seul le gain de base est versé.",
				flags: MessageFlags.Ephemeral,
			});
			return;
		}
		if (hasActiveMorpionGame(activeGames(), userId)) {
			await interaction.reply({
				content: "Tu as déjà une partie de morpion en cours. Termine-la d'abord.",
				flags: MessageFlags.Ephemeral,
			});
			return;
		}

		if (mode === "joueur") {
			if (!opponent || opponent.bot || opponent.id === userId) {
				await interaction.reply({ content: "Adversaire invalide.", flags: MessageFlags.Ephemeral });
				return;
			}
			if (hasActiveMorpionGame(activeGames(), opponent.id)) {
				await interaction.reply({
					content: `${opponent} a déjà une partie de morpion en cours.`,
					flags: MessageFlags.Ephemeral,
				});
				return;
			}
			const stake = mise ?? 0;
			if (stake > 0) {
				const maxStake = await this.settings.getInt("game.max_stake", 1_000_000);
				if (stake > maxStake) {
					await interaction.reply({
						content: `Mise maximale : **${formatZeni(maxStake)}**.`,
						flags: MessageFlags.Ephemeral,
					});
					return;
				}
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
			const [baseWin, baseLoss] = await Promise.all([
				this.settings.getInt("zeni.game.win", ZENI_GAME_WIN),
				this.settings.getInt("zeni.game.loss_penalty", ZENI_GAME_LOSS_PENALTY),
			]);
			const key = interaction.id;
			challenges.set(key, {
				challengerId: userId,
				opponentId: opponent.id,
				stake,
				expiresAt: Date.now() + CHALLENGE_TTL_MS,
			});
			await interaction.reply(
				buildChallengeMessage({
					scope: "morpion",
					key,
					challenger: interaction.user,
					opponent,
					gameTitle: "Morpion · Duel",
					color: DBZ_COLORS.goku,
					stake:
						stake > 0
							? `Mise **${formatZeni(stake)}** par joueur, séquestrée à l'acceptation · pot **${formatZeni(stake * 2)}**`
							: `Gagnant **${formatZeniDelta(baseWin)}** · Perdant **${formatZeniDelta(-(baseLoss))}**`,
				})
			);
			setTimeout(() => {
				const c = challenges.get(key);
				if (c && c.expiresAt <= Date.now()) challenges.delete(key);
			}, CHALLENGE_TTL_MS + 5_000).unref();
			return;
		}

		const gameId = interaction.id;
		const session: Session = { game: createMorpionGame(userId, MORPION_BOT), lastMoveAt: Date.now() };
		sessions.set(gameId, session);
		const response = await interaction.reply({
			embeds: [buildEmbed(session.game, "playing")],
			components: renderBoard(session.game, gameId),
			withResponse: true,
		});
		session.message = response.resource?.message ?? undefined;
		void this.scheduleExpiry(gameId);
	}

	@ButtonComponent({ id: challengeIdPattern("morpion") })
	async onChallengeButton(interaction: ButtonInteraction) {
		const parsed = parseChallengeId(interaction.customId);
		if (!parsed) return;
		const challenge = challenges.get(parsed.key);
		if (!challenge || challenge.expiresAt <= Date.now()) {
			challenges.delete(parsed.key);
			// Réponse éphémère : un double-clic ne doit pas écraser le plateau déjà affiché.
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
		// Retrait synchrone : un second clic concurrent ne retrouve plus le défi.
		challenges.delete(parsed.key);

		if (parsed.action === "decline") {
			await interaction.update({
				content: "",
				embeds: [
					new EmbedBuilder()
						.setTitle("Morpion · Défi refusé")
						.setDescription(`<@${challenge.opponentId}> a refusé le défi.`)
						.setColor(COLORS.muted),
				],
				components: [],
			});
			return;
		}

		const games = activeGames();
		if (
			hasActiveMorpionGame(games, challenge.challengerId) ||
			hasActiveMorpionGame([...activeGames()], challenge.opponentId)
		) {
			await interaction.update({
				content: "",
				embeds: [
					new EmbedBuilder()
						.setTitle("Morpion · Duel annulé")
						.setDescription("Un des joueurs a déjà une partie de morpion en cours.")
						.setColor(COLORS.muted),
				],
				components: [],
			});
			return;
		}

		const gameId = parsed.key;
		const game = createMorpionGame(challenge.challengerId, challenge.opponentId, challenge.stake);
		// Réservé avant tout `await` : les deux joueurs ne peuvent pas lancer une autre partie.
		sessions.set(gameId, { game, lastMoveAt: Date.now(), message: interaction.message });

		if (challenge.stake > 0) {
			await interaction.deferUpdate();
			const ok = await this.rewards.escrowStakes(
				challenge.challengerId,
				challenge.opponentId,
				challenge.stake
			);
			if (!ok) {
				sessions.delete(gameId);
				await interaction.editReply({
					content: "",
					embeds: [
						new EmbedBuilder()
							.setTitle("Morpion · Duel annulé")
							.setDescription("Un des joueurs n'a plus assez de zénis pour couvrir la mise.")
							.setColor(DBZ_COLORS.power),
					],
					components: [],
				});
				return;
			}
			await interaction.editReply({
				content: "",
				embeds: [buildEmbed(game, "playing")],
				components: renderBoard(game, gameId),
			});
		} else {
			await interaction.update({
				content: "",
				embeds: [buildEmbed(game, "playing")],
				components: renderBoard(game, gameId),
			});
		}
		void this.scheduleExpiry(gameId);
	}

	@ButtonComponent({ id: /^morpion:\d+:[0-8]$/ })
	async move(interaction: ButtonInteraction) {
		const [, gameId, cellStr] = interaction.customId.split(":");
		const session = sessions.get(gameId!);
		if (!session) {
			await interaction.reply({
				content: "Cette partie est terminée ou a expiré.",
				flags: MessageFlags.Ephemeral,
			});
			return;
		}
		// Coup atomique : aucune attente entre la vérification du tour et la fin de partie.
		const result = playMorpionTurn(session.game, interaction.user.id, Number(cellStr), {
			blunderChance: MORPION_BOT_BLUNDER_CHANCE,
		});
		if (!result.ok) {
			await interaction.reply({ content: TURN_ERRORS[result.reason], flags: MessageFlags.Ephemeral });
			return;
		}
		session.lastMoveAt = Date.now();
		session.message = interaction.message;
		const { game } = session;

		if (result.outcome.kind === "playing") {
			await interaction.update({
				embeds: [buildEmbed(game, "playing")],
				components: renderBoard(game, gameId!),
			});
			return;
		}

		sessions.delete(gameId!);
		await interaction.deferUpdate();
		try {
			const embed = await this.settle(game, result.outcome, interaction);
			await interaction.editReply({
				embeds: [embed],
				components: renderBoard(
					game,
					gameId!,
					result.outcome.kind === "won" ? result.outcome.line : undefined
				),
			});
		} catch (err) {
			logger.error({ err, gameId }, "morpion: règlement de fin de partie en échec");
		}
	}

	private async settle(
		game: MorpionGame,
		outcome: Exclude<MorpionOutcome, { kind: "playing" }>,
		interaction: ButtonInteraction
	): Promise<EmbedBuilder> {
		const vsBot = game.playerO === MORPION_BOT;
		if (outcome.kind === "draw") {
			if (game.stake > 0) await this.rewards.payStakes("draw", game.playerX, game.playerO, game.stake);
			return buildEmbed(game, "draw", {
				result: game.stake > 0 ? `Mises rendues (**${formatZeni(game.stake)}** chacun).` : "Aucun gain.",
			});
		}

		const winnerId = outcome.mark === "X" ? game.playerX : game.playerO;
		const loserId = outcome.mark === "X" ? game.playerO : game.playerX;

		if (game.stake > 0) {
			await this.rewards.payStakes("win", winnerId, loserId, game.stake);
			return buildEmbed(game, "won", {
				winnerId,
				result: `<@${winnerId}> remporte le pot : **${formatZeniDelta(game.stake * 2)}**.`,
			});
		}

		const [baseWin, baseLoss] = await Promise.all([
			this.settings.getInt("zeni.game.win", ZENI_GAME_WIN),
			this.settings.getInt("zeni.game.loss_penalty", ZENI_GAME_LOSS_PENALTY),
		]);

		if (winnerId === MORPION_BOT) {
			const charged = baseLoss > 0 && (await this.eco.removeZeni(loserId, baseLoss));
			return buildEmbed(game, "won", {
				winnerId,
				result: charged ? `<@${loserId}> **${formatZeniDelta(-(baseLoss))}**` : "Aucune pénalité.",
			});
		}

		const grant = await this.rewards.grantWin({
			userId: winnerId,
			amount: baseWin,
			opponentId: vsBot ? undefined : loserId,
		});
		if (grant.paid === 0) {
			return buildEmbed(game, "won", {
				winnerId,
				result: grant.blocked
					? `Victoire sans gain : ${REWARD_BLOCK_LABELS[grant.blocked]}.`
					: "Aucun gain.",
			});
		}
		let result = `<@${winnerId}> **${formatZeniDelta(grant.paid)}**`;
		if (!vsBot && baseLoss > 0 && (await this.eco.removeZeni(loserId, baseLoss))) {
			result += ` · <@${loserId}> **${formatZeniDelta(-(baseLoss))}**`;
		}
		await this.msg.publish(
			"zeni_game_win",
			{ user: `<@${winnerId}>`, zeni: grant.paid, game: vsBot ? "morpion" : "morpion (duel)" },
			interaction.client
		);
		return buildEmbed(game, "won", { winnerId, result });
	}

	/** Expiration à l'inactivité : le joueur dont c'est le tour déclare forfait. */
	private async scheduleExpiry(gameId: string): Promise<void> {
		const ttl = Math.max(
			30_000,
			await this.settings.getInt("game.morpion.ttl_ms", DEFAULT_IDLE_TTL_MS)
		);
		const check = () => {
			const session = sessions.get(gameId);
			if (!session || session.game.status !== "playing") return;
			const idleFor = Date.now() - session.lastMoveAt;
			if (idleFor < ttl) {
				setTimeout(check, ttl - idleFor + 50).unref();
				return;
			}
			sessions.delete(gameId);
			session.game.status = "finished";
			this.expire(gameId, session).catch((err) =>
				logger.error({ err, gameId }, "morpion: expiration en échec")
			);
		};
		setTimeout(check, ttl).unref();
	}

	private async expire(gameId: string, session: Session): Promise<void> {
		const { game } = session;
		const idle = morpionIdlePlayer(game);
		let result = idle ? `<@${idle}> n'a pas joué à temps. Aucun gain.` : "Aucun gain.";
		if (game.stake > 0 && idle) {
			const other = idle === game.playerX ? game.playerO : game.playerX;
			await this.rewards.payStakes("forfeit", other, idle, game.stake);
			result = `<@${idle}> n'a pas joué à temps : <@${other}> remporte le pot (**${formatZeni(game.stake * 2)}**).`;
		}
		await session.message
			?.edit({ embeds: [buildEmbed(game, "expired", { result })], components: renderBoard(game, gameId) })
			.catch(() => {});
	}
}
