import { isValidCron } from "cron-validator";
import type { InjectionToken } from "tsyringe";
import { container } from "tsyringe";

import { generalConfig } from "@/configs";
import { resolveDependency, runInRequestContext } from "../functions/dependency";

/**
 * Database résolu paresseusement au 1er tick (import dynamique → évite le cycle
 * `decorators` ↔ `Database` au chargement du module). Réutilisé ensuite.
 */
let schedulerDbPromise: Promise<{ orm: { em: unknown } }> | undefined;
function getSchedulerDb(): Promise<{ orm: { em: unknown } }> {
	if (!schedulerDbPromise) {
		schedulerDbPromise = import("../../services/Database").then(({ Database }) =>
			resolveDependency(Database)
		) as Promise<{ orm: { em: unknown } }>;
	}

	return schedulerDbPromise;
}

/**
 * Schedule a job to be executed at a specific time (cron)
 * @param cronExpression - cron expression to use (e.g: "0 0 * * *" will run each day at 00:00)
 * @param jobName - name of the job (the name of the function will be used if it is not provided)
 */
export function Schedule(cronExpression: string, jobName?: string) {
	if (!isValidCron(cronExpression, { alias: true, seconds: true }))
		throw new Error(`Invalid cron expression: ${cronExpression}`);

	return (target: any, propertyKey: string, descriptor: PropertyDescriptor) => {
		// eslint-disable-next-line node/prefer-global/process
		if (process.env.SKIP_SCHEDULE === "1") {
			return;
		}

		// associate the context to the function, with the injected dependencies defined
		const oldDescriptor = descriptor.value;
		descriptor.value = function (...args: any[]) {
			const instance = container.resolve(this.constructor as InjectionToken<any>);

			// Les ticks cron se déclenchent sur un timer (lib `cron`) HORS du pipeline
			// discordx → aucun RequestContext actif → `db.em` / `db.get()` retomberaient
			// sur l'EM global (MikroORM v7 refuse). On enrobe CHAQUE tick dans son propre
			// fork de contexte : couvre tous les @Schedule touchant encore la DB
			// (matchmaking Discord et statistiques). Les traitements métier Achilléa
			// (saisons/paiements) vivent exclusivement dans @rosegriffon/cron.
			return getSchedulerDb().then((db) =>
				runInRequestContext(db, () => oldDescriptor.apply(instance, args))
			);
		};

		const cronModule = "cron";
		const { CronJob: LazyCronJob } = require(cronModule) as typeof import("cron");
		const job = new LazyCronJob(
			cronExpression,
			descriptor.value,
			null,
			false,
			generalConfig.timezone,
			target
		);

		import("../../services/Scheduler")
			.then(async ({ Scheduler }) => {
				const scheduler = await resolveDependency(Scheduler);
				scheduler.addJob(jobName ?? propertyKey, job);
			})
			.catch((err) => {
				console.error(err);
				throw err;
			});
	};
}
