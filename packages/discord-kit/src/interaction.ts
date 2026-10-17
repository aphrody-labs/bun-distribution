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
  options: SafeExecuteInteractionOptions = {},
): Promise<void> {
  const logger = options.logger ?? console;
  const failureMessage = options.failureMessage ?? "❌ La commande a rencontré une erreur interne.";
  const unhandledMessage =
    options.unhandledMessage ?? "Commande inconnue ou expirée. Rechargez Discord (Ctrl+R) pour actualiser la liste.";

  let executionFailed = false;
  try {
    await client.executeInteraction(interaction);
  } catch (err) {
    executionFailed = true;
    logger.error?.(
      "[discord-kit] Interaction execution failed:",
      err instanceof Error ? (err.stack ?? err.message) : err,
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
      if (executionFailed) {
        await interaction.editReply({ content: failureMessage });
      }
      return;
    }

    await interaction.reply({
      content: executionFailed ? failureMessage : unhandledMessage,
      flags: MessageFlags.Ephemeral,
    });
  } catch (replyErr) {
    // Discord code 10062 means the interaction token is no longer addressable.
    if ((replyErr as { code?: unknown })?.code === 10062) return;
    logger.warn?.(
      "[discord-kit] Failed to send interaction fallback reply:",
      replyErr instanceof Error ? (replyErr.stack ?? replyErr.message) : replyErr,
    );
  }
}
