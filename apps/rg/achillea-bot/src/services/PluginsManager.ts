import fs from "node:fs";
import { sep } from "node:path";

import { resolve } from "@aphrody/importer";
import type { AnyEntity, EntityClass } from "@mikro-orm/core";
import type { BaseTranslation } from "typesafe-i18n";
import type { ImportLocaleMapping } from "typesafe-i18n/importer";
import { storeTranslationsToDisk } from "typesafe-i18n/importer";
import { delay, inject } from "tsyringe";

import { Service } from "@/decorators";
import { locales } from "@/i18n";
import { Store } from "./Store";
import type { BaseController } from "@/utils/classes";
import { Plugin } from "@/utils/classes";
import { getSourceCodeLocation } from "@/utils/functions";

@Service()
export class PluginsManager {
	private _plugins: Plugin[] = [];

	constructor(@inject(delay(() => Store)) private store: any) {}

	public async loadPlugins(): Promise<void> {
		const pluginsDir = `${getSourceCodeLocation()}/plugins`;
		if (!fs.existsSync(pluginsDir)) {
			return;
		}

		const pluginPaths = await resolve(`${pluginsDir}/*`);

		for (const path of pluginPaths) {
			const plugin = new Plugin(path);
			await plugin.load();

			if (plugin.isValid()) this.plugins.push(plugin);
		}
	}

	public getEntities(): EntityClass<AnyEntity>[] {
		return this._plugins.flatMap((plugin) => Object.values(plugin.entities));
	}

	public getControllers(): (typeof BaseController)[] {
		return this._plugins.flatMap((plugin) => Object.values(plugin.controllers));
	}

	public async importCommands(): Promise<void> {
		for (const plugin of this._plugins) await plugin.importCommands();
	}

	public async importEvents(): Promise<void> {
		for (const plugin of this._plugins) await plugin.importEvents();
	}

	public async initServices(): Promise<{ [key: string]: any }> {
		const services: { [key: string]: any } = {};

		for (const plugin of this._plugins) {
			for (const service in plugin.services) services[service] = new plugin.services[service]();
		}

		return services;
	}

	public async execMains(): Promise<void> {
		for (const plugin of this._plugins) await plugin.execMain();
	}

	public async syncTranslations(): Promise<void> {
		const localeMapping: ImportLocaleMapping[] = [];
		const namespaces: { [key: string]: string[] } = {};
		const translations: { [key: string]: BaseTranslation } = {};

		for (const locale of locales) {
			const path = `${getSourceCodeLocation()}/i18n/${locale}`;
			if (fs.existsSync(path)) translations[locale] = (await import(path))?.default;
		}

		for (const plugin of this._plugins) {
			for (const locale in plugin.translations) {
				if (!translations[locale]) translations[locale] = {};
				if (!namespaces[locale]) namespaces[locale] = [];

				translations[locale] = {
					...translations[locale],
					[plugin.name]: plugin.translations[locale],
				};
				namespaces[locale].push(plugin.name);
			}
		}

		for (const locale in translations) {
			if (!locales.includes(locale as any)) continue;

			localeMapping.push({
				locale,
				translations: translations[locale],
				namespaces: namespaces[locale],
			});
		}

		const pluginsName = new Set(this._plugins.map((plugin) => plugin.name));

		for (const path of await resolve(`${getSourceCodeLocation()}/i18n/*/*/index.ts`)) {
			const name = path.split(sep).at(-2) || "";

			if (!pluginsName.has(name))
				await fs.rmSync(path.slice(0, -8), { recursive: true, force: true });
		}

		await storeTranslationsToDisk(localeMapping, true);
	}

	public isPluginLoad(pluginName: string): boolean {
		return this._plugins.findIndex((plugin) => plugin.name === pluginName) !== -1;
	}

	get plugins() {
		return this._plugins;
	}
}
