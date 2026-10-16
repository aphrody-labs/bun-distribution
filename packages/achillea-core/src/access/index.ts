/**
 * Contrôle d'accès RBAC Achilléa via CASL (logique pure, portable).
 *
 * Extrait de `apps/bot/src/utils/functions/buildAbility.ts`. `@casl/ability`
 * est universel (navigateur / edge / Node). Le service DI du bot
 * (`AccessControlService`) consomme cette fonction.
 */

import type { MongoAbility } from "@casl/ability";
import { AbilityBuilder, createMongoAbility } from "@casl/ability";

import { AchilleaRole } from "../enums/access";

/**
 * Actions CASL Achilléa.
 *
 * - manage   : toutes les opérations (CRUD complet)
 * - moderate : sanctionner, révoquer, avertir
 * - cast     : gérer les slots cast et disponibilités
 * - view     : lire / consulter
 */
export type AchilleaAction = "manage" | "moderate" | "cast" | "view";

/** Sujets CASL Achilléa. */
export type AchilleaSubject = "Sanction" | "CastEvent" | "Tournament" | "User" | "all";

export type AppAbility = MongoAbility<[AchilleaAction, AchilleaSubject]>;

/**
 * Construit une instance Ability CASL pour un rôle Achilléa.
 * Fonction pure — aucune dépendance DI ou DB.
 *
 * Règles :
 *   member : view tout
 *   staff  : view tout + moderate Sanction + cast CastEvent
 *   admin  : manage tout (sauf User avec role:'owner')
 *   owner  : manage all
 */
export function buildAbilityFor(role: AchilleaRole): AppAbility {
	const builder = new AbilityBuilder<AppAbility>(createMongoAbility);
	const { can, cannot } = builder;

	switch (role) {
		case AchilleaRole.owner:
			can("manage", "all");
			break;

		case AchilleaRole.admin:
			can("manage", "all");
			// Un admin ne peut pas modifier un user dont le rôle est owner
			cannot("manage", "User", { role: "owner" } as never);
			break;

		case AchilleaRole.staff:
			can("view", "all");
			can("moderate", "Sanction");
			can("cast", "CastEvent");
			break;

		case AchilleaRole.member:
		default:
			can("view", "all");
			break;
	}

	return builder.build();
}
