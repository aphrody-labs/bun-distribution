import type { GuardFunction } from "discordx";
import type { CommandInteraction, ButtonInteraction, ModalSubmitInteraction } from "discord.js";
import { MessageFlags } from "discord.js";
import { container } from "tsyringe";
import { SettingsService } from "~/services/SettingsService";

/**
 * Guard factory : bloque l'interaction si le toggle `features.<x>` est OFF dans
 * les settings runtime (`guild_settings`).
 *
 * **Fallback `true` impératif** : la table `guild_settings` est vide à
 * l'initialisation — sans clé, `getBool` renvoie le fallback. Un fallback
 * `false` désactiverait la feature partout par défaut (régression silencieuse).
 */
export function FeatureEnabled(
	key: string,
	label = "Cette fonctionnalité"
): GuardFunction<CommandInteraction | ButtonInteraction | ModalSubmitInteraction> {
	return async (interaction, _client, next) => {
		const settings = container.resolve(SettingsService);
		if (await settings.getBool(key, true)) {
			await next();
			return;
		}
		if (interaction.isRepliable()) {
			await interaction.reply({
				content: `${label} est actuellement désactivée.`,
				flags: MessageFlags.Ephemeral,
			});
		}
	};
}
