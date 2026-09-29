import type { EntityName, Options } from "@mikro-orm/postgresql";
import { MikroORM } from "@mikro-orm/postgresql";

import { mikroORMConfig } from "@/configs";
import { Service } from "@/decorators";
import * as entities from "@/entities";
import { env } from "@/env";
import { PluginsManager } from "./PluginsManager";
import { resolveDependency } from "../utils/functions/dependency";
import { AuditLogSubscriber } from "./AuditLogSubscriber";

@Service()
export class Database {
	// InstanceType<typeof MikroORM> = PostgreSqlMikroORM avec ses paramètres par défaut
	private _orm!: InstanceType<typeof MikroORM>;

	async initialize() {
		const pluginsManager = await resolveDependency(PluginsManager);

		// get config
		const config = mikroORMConfig[env.NODE_ENV || "development"] as Options;

		// defines entities into the config
		config.entities = [...Object.values(entities), ...pluginsManager.getEntities()];

		// Register audit log subscriber for automatic event tracking
		const existingSubs = config.subscribers ? Array.from(config.subscribers) : [];
		config.subscribers = [...existingSubs, new AuditLogSubscriber()];

		// initialize the ORM using the configuration exported in `mikro-orm.config.ts`
		// Double instance de @mikro-orm/sql dans la résolution bun : cast de config nécessaire
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		this._orm = (await MikroORM.init(config as any)) as unknown as InstanceType<typeof MikroORM>;

		// Le schéma n'est jamais modifié au démarrage. Les migrations sont exécutées
		// explicitement via `migration:up:prod` pendant la procédure de déploiement.
	}

	get orm(): typeof this._orm {
		return this._orm;
	}

	get em(): DatabaseEntityManager {
		// cast : deux instances de @mikro-orm/sql dans la résolution bun (artefact structurel)
		return this._orm.em as unknown as DatabaseEntityManager;
	}

	async close(): Promise<void> {
		if (this._orm) await this._orm.close();
	}

	/**
	 * Shorthand to get custom and natives repositories
	 * @param entity Entity of the custom repository to get
	 */
	get<T extends object>(entity: EntityName<T>) {
		return this._orm.em.getRepository(entity);
	}

}
