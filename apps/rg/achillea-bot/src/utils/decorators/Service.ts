import { singleton } from "tsyringe";
import type { constructor } from "tsyringe/dist/typings/types";

const globalInstances = (globalThis as any).__keptInstances || new Set();
(globalThis as any).__keptInstances = globalInstances;
export const keptInstances: Set<constructor<any>> = globalInstances;

type ServiceOptions = {
	keepInstanceAfterHmr?: boolean;
};

export function Service<T>(options: ServiceOptions = {}) {
	return function (target: constructor<T>) {
		if (options.keepInstanceAfterHmr) {
			const instances = (globalThis as any).__keptInstances || new Set();
			(globalThis as any).__keptInstances = instances;
			instances.add(target);
		}

		return singleton()(target);
	};
}
