import { delay, inject } from "tsyringe";

import { Service } from "@/decorators";
import { User } from "@/entities";
import { userRoleToAchilleaRole } from "@/utils/enums";
import { buildAbilityFor } from "../utils/functions/buildAbility";

import { Database } from "./Database";
import { Logger } from "./Logger";

export type { AchilleaAction, AchilleaSubject, AppAbility } from "../utils/functions/buildAbility";

export { buildAbilityFor } from "../utils/functions/buildAbility";

// ---------------------------------------------------------------------------
// Service DI
// ---------------------------------------------------------------------------

@Service()
export class AccessControlService {
	constructor(
		@inject(delay(() => Database)) private db: any,
		@inject(delay(() => Logger)) private logger: any
	) {}

	/**
	 * Construit une instance Ability CASL pour l'utilisateur donné,
	 * en dérivant l'AchilleaRole depuis son UserRole legacy.
	 */
	defineAbilityFor(user: User) {
		const role = userRoleToAchilleaRole(user.role);
		return buildAbilityFor(role);
	}

	/**
	 * Vérifie si un utilisateur peut effectuer une action sur un sujet.
	 * Raccourci pour les guards.
	 */
	can(
		user: User,
		action: import("../utils/functions/buildAbility").AchilleaAction,
		subject: import("../utils/functions/buildAbility").AchilleaSubject
	): boolean {
		const ability = this.defineAbilityFor(user);
		return ability.can(action, subject);
	}
}
