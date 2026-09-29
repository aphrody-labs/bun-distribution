/**
 * Challenge helper — message de proposition d'un duel (Accepter / Refuser).
 *
 * Réutilisable par n'importe quel jeu en mode joueur (Pendu, Morpion, PFC,
 * Bingo…). Le `customId` du bouton sérialise un identifiant arbitraire `key`
 * que l'appelant déchiffre dans son handler `@ButtonComponent`.
 *
 * Flux :
 *   1. /jeu mode:joueur adversaire:@X
 *   2. → bot envoie embed "X a défié Y. Accepter / Refuser ?" + 2 boutons
 *   3. Y clique Accepter (ou Refuser, ou timeout 60s) → callback `onAccept` /
 *      `onDecline` exécuté côté handler.
 *
 * Le matching customId est laissé au handler (ButtonComponent regex) parce que
 * discordx résout chaque @ButtonComponent statiquement à l'enregistrement —
 * impossible d'attacher un listener dynamique inline. On expose juste un
 * `buildChallengeMessage()` qui pose des customIds normalisés
 * `challenge:<scope>:<accept|decline>:<key>`.
 */
import {
	ActionRowBuilder,
	ButtonBuilder,
	ButtonStyle,
	EmbedBuilder,
	type APIEmbedField,
	type User,
} from "discord.js";

export interface ChallengeMessageInput {
	/** Identifiant logique du jeu, ex. "pendu", "morpion". */
	scope: string;
	/** Clé arbitraire (gameId / interaction.id) que tu décrypteras dans le handler. */
	key: string;
	challenger: User;
	opponent: User;
	gameTitle: string;
	gameEmoji?: string;
	stake?: string;
	extraFields?: APIEmbedField[];
	color?: number;
	timeoutSec?: number;
}

export interface ChallengeMessage {
	embeds: EmbedBuilder[];
	components: ActionRowBuilder<ButtonBuilder>[];
	content: string;
}

const DEFAULT_COLOR = 0xfbbf24; // amber-400

export function buildChallengeMessage(input: ChallengeMessageInput): ChallengeMessage {
	const timeout = input.timeoutSec ?? 60;
	const embed = new EmbedBuilder()
		.setTitle(input.gameEmoji ? `${input.gameEmoji} ${input.gameTitle}` : input.gameTitle)
		.setDescription(
			`${input.challenger} **défie** ${input.opponent} !\n` +
				`${input.opponent}, accepte ou refuse dans les **${timeout}s**.`
		)
		.setColor(input.color ?? DEFAULT_COLOR)
		.setTimestamp(new Date());

	if (input.stake) {
		embed.addFields({ name: "Enjeu", value: input.stake, inline: true });
	}
	if (input.extraFields?.length) {
		embed.addFields(...input.extraFields);
	}

	const accept = new ButtonBuilder()
		.setCustomId(buildChallengeId(input.scope, "accept", input.key))
		.setLabel("Accepter")
		.setEmoji("✅")
		.setStyle(ButtonStyle.Success);
	const decline = new ButtonBuilder()
		.setCustomId(buildChallengeId(input.scope, "decline", input.key))
		.setLabel("Refuser")
		.setEmoji("❌")
		.setStyle(ButtonStyle.Danger);

	return {
		content: `${input.opponent}`,
		embeds: [embed],
		components: [new ActionRowBuilder<ButtonBuilder>().addComponents(accept, decline)],
	};
}

function buildChallengeId(scope: string, action: "accept" | "decline", key: string): string {
	return `challenge:${scope}:${action}:${key}`;
}

/** Regex à utiliser dans @ButtonComponent({ id: ... }). */
export function challengeIdPattern(scope: string): RegExp {
	return new RegExp(`^challenge:${scope}:(accept|decline):.+$`);
}

export function parseChallengeId(
	customId: string
): { scope: string; action: "accept" | "decline"; key: string } | null {
	const parts = customId.split(":");
	if (parts.length < 4 || parts[0] !== "challenge") return null;
	const action = parts[2];
	if (action !== "accept" && action !== "decline") return null;
	return {
		scope: parts[1] as string,
		action,
		key: parts.slice(3).join(":"),
	};
}
