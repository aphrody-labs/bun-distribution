import type { EntityManager } from "@mikro-orm/core";
import { RequestContext } from "@mikro-orm/core";
import type { GuardFunction } from "@aphrody/discordx";

import { Database } from "@/services";
import { resolveDependency } from "@/utils/functions";

/**
 * Isole chaque pipeline de traitement pour éviter les conflits de la
 * carte d'identité globale MikrORM entre requêtes concurrentes.
 */
export const RequestContextIsolator: GuardFunction = async (_, client, next) => {
	const db = await resolveDependency(Database);
	// CRITIQUE : await sinon la promise du handler est orpheline et discordx
	// considère le pipeline fini avant que le handler ait répondu (Discord
	// affiche "L'application ne répond plus" après 3s de timeout).
	// Le cast est nécessaire : PostgreSqlEntityManager n'est pas structurellement
	// assignable à EntityManager générique en v7, mais en est bien une sous-classe.
	await RequestContext.create(db.orm.em as unknown as EntityManager, next);
};
