import { CommandInteraction, MessageFlags } from "discord.js";
import { SimpleCommandMessage } from "@aphrody/discordx";

/**
 * Abstraction level to reply to either a slash command or a simple command message.
 * @param interaction
 * @param message
 */
export async function replyToInteraction(
	interaction: CommandInteraction | SimpleCommandMessage,
	message: string | { [key: string]: any }
) {
	if (interaction instanceof CommandInteraction) {
		// Hérite de l'éphémère : un followUp après un deferReply éphémère sortirait sinon
		// en PUBLIC (confirmations admin /owner, etc.). On respecte un flags déjà fourni.
		const payload: { [key: string]: any } =
			typeof message === "string" ? { content: message } : { ...message };
		if (interaction.ephemeral === true && payload.flags === undefined) {
			payload.flags = MessageFlags.Ephemeral;
		}
		await interaction.followUp(payload);
	} else if (interaction instanceof SimpleCommandMessage) {
		await interaction.message.reply(message);
	}
}
