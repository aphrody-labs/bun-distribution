// SPDX-License-Identifier: Apache-2.0
import { MessageFlags, type Interaction } from "discord.js";
import type { Client } from "discordx";

export interface SafeExecuteInteractionOptions {
	failureMessage?: string;
	unhandledMessage?: string;
	logger?: {
		error?: (...args: any[]) => void;
		warn?: (...args: any[]) => void;
	};
}

/**
 * Resilient interaction dispatcher for DiscordX clients.
 *
 * Guarantees that:
 * 1. Unhandled errors during `client.executeInteraction` are caught and logged.
 * 2. Autocomplete interactions (which are not repliable) are not incorrectly replied to.
 * 3. Interactions that called `deferReply()` and then failed are recovered via `editReply()`,
 *    preventing the Discord UI from hanging indefinitely on "thinking...".
 * 4. Interactions that haven't been replied to receive a clear ephemeral notification.
 * 5. Expired interaction tokens (Discord 3-second acknowledgement window) fail silently
 *    without crashing the service.
 */
export async function safeExecuteInteraction(
	client: Client,
	interaction: Interaction,
	options: SafeExecuteInteractionOptions = {}
): Promise<void> {
	const logger = options.logger ?? console;
	const failureMessage =
		options.failureMessage ?? "❌ La commande a rencontré une erreur interne.";
	const unhandledMessage =
		options.unhandledMessage ??
		"Commande inconnue ou expirée. Rechargez Discord (Ctrl+R) pour actualiser la liste.";

	let executionError: unknown;
	try {
		await client.executeInteraction(interaction);
	} catch (err) {
		executionError = err;
		logger.error?.(
			"[discord-kit] Interaction execution failed:",
			err instanceof Error ? (err.stack ?? err.message) : err
		);
	}

	if (!interaction.isRepliable()) {
		return;
	}

	try {
		if (interaction.replied) {
			return;
		}

		if (interaction.deferred) {
			if (executionError) {
				await interaction.editReply({ content: failureMessage });
			}
			return;
		}

		await interaction.reply({
			content: executionError ? failureMessage : unhandledMessage,
			flags: MessageFlags.Ephemeral,
		});
	} catch (replyErr) {
		// Interaction expired (3 seconds for initial ack, 15 minutes for webhook followup).
		// Safe to ignore as user's client already timed out.
	}
}
