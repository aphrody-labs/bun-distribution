import type { EntityManager } from "@mikro-orm/core";
import { RequestContext } from "@mikro-orm/core";
import type { F } from "ts-toolbelt";
import type { InjectionToken } from "tsyringe";
import { container } from "tsyringe";


/**
 * Exécute `fn` dans un RequestContext MikroORM dédié (fork de l'EM global).
 *
 * Indispensable pour TOUT travail DB déclenché HORS du pipeline discordx :
 * typiquement les callbacks de `createMessageComponentCollector` (et les
 * `.then()` de modals / sous-collectors), qui se déclenchent sur un événement
 * gateway séparé et ne traversent donc PAS le guard `RequestContextIsolator`.
 * Sans ce wrap, `db.em` / `db.get()` retombent sur l'EM global et MikroORM lève
 * « Using global EntityManager instance methods for context specific actions is
 * disallowed ». Le fork réadopte au passage les entités détachées (chargées par
 * le fork — désormais mort — de la slash-command), donc pas de re-fetch requis.
 *
 * ⚠ `fn` doit *appeler* (synchroniquement) ses méthodes DB à l'intérieur : un
 * `.then(cb)` non-`await` dont le `cb` interroge la DB plus tard sortira du
 * contexte → enrobez ce `cb` dans son propre `runInRequestContext`.
 */
export function runInRequestContext<T>(
	db: { orm: { em: unknown } },
	fn: () => Promise<T>
): Promise<T> {
	return RequestContext.create(db.orm.em as EntityManager, fn);
}

export async function resolveDependency<T>(
	token: InjectionToken<T>,
	interval: number = 500
): Promise<T> {
	while (!container.isRegistered(token, true))
		await new Promise((resolve) => setTimeout(resolve, interval));

	return container.resolve(token);
}

type Forward<T> = {
	[Key in keyof T]: T[Key] extends abstract new (...args: any) => any
		? InstanceType<T[Key]>
		: T[Key];
};

export async function resolveDependencies<T extends readonly [...unknown[]]>(tokens: F.Narrow<T>) {
	return Promise.all(tokens.map((token: any) => resolveDependency(token))) as Promise<
		Forward<F.Narrow<T>>
	>;
}

/**
 * Synchronous version of resolveDependencies — assumes tokens are already registered
 * (true for @singleton/@injectable services after import side-effects).
 *
 * Use in TSed @Controller constructors to avoid race conditions where requests
 * arrive before async .then() callbacks resolve.
 */
export function resolveDependenciesSync<T extends readonly [...unknown[]]>(
	tokens: F.Narrow<T>
): Forward<F.Narrow<T>> {
	return tokens.map((token: any) => container.resolve(token)) as any;
}
