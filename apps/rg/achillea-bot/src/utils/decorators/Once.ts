import type { EventOptions, MethodDecoratorEx } from "@aphrody/discordx";
import * as discordx from "@aphrody/discordx";
const DOn = (discordx as any).DOn;
const MetadataStorage = (discordx as any).MetadataStorage;

/**
 * Handle both discord and custom events only **once** with a defined handler
 * @param event - event name
 * @param options - event parameters
 * ___
 *
 * [View Documentation](https://discord-ts.js.org/docs/decorators/general/on)
 *
 * @category Decorator
 */
export function Once(event: string, options?: EventOptions): MethodDecoratorEx {
	return function <T>(target: Record<string, T>, key: string, descriptor?: PropertyDescriptor) {
		const clazz = target as unknown as new () => unknown;
		const on = DOn.create({
			botIds: options?.botIds,
			event,
			once: true,
			rest: false,
		}).decorate(clazz.constructor, key, descriptor?.value);

		MetadataStorage.instance.addOn(on);
	};
}
