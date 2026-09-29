import type { ButtonInteraction, CommandInteraction } from "discord.js";
import type { GuardFunction } from "@aphrody/discordx";

import { User } from "@/entities";
import { AccessControlService } from "@/services/AccessControlService";
import type { AchilleaAction, AchilleaSubject } from "@/services/AccessControlService";
import { Database } from "@/services";
import { replyWithSimpleErrorEmbed, resolveDependency } from "@/utils/functions";

/**
 * Guard CASL réutilisable pour les slash commands discordx.
 *
 * Usage :
 *   @Guard(CASLGuard('moderate', 'Sanction'))
 *   async sanctionCommand(...) { ... }
 *
 * Si l'utilisateur n'a pas la permission, une erreur éphémère est renvoyée
 * et la commande est interrompue.
 */
export function CASLGuard(action: AchilleaAction, subject: AchilleaSubject) {
	const guard: GuardFunction<CommandInteraction | ButtonInteraction> = async (
		interaction,
		_client,
		next
	) => {
		const db = await resolveDependency(Database);
		const acs = await resolveDependency(AccessControlService);

		const user = await db.get(User).findOne({ id: interaction.user.id });

		if (!user || !acs.can(user, action, subject)) {
			replyWithSimpleErrorEmbed(
				interaction,
				`Vous n'avez pas la permission d'effectuer l'action \`${action}\` sur \`${subject}\`.`
			);
			return;
		}

		await next();
	};

	return guard;
}
