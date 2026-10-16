export type TextDirection = "ltr" | "rtl";

/** Déclaration sérialisable d'une locale prise en charge par l'application. */
export interface LocaleDefinition {
	/** Tag de langue canonique BCP-47, par exemple `fr`, `en-GB` ou `ar`. */
	tag: string;
	/** Direction d'écriture à appliquer au document. */
	direction: TextDirection;
	/** Tags alternatifs acceptés en entrée, jamais émis comme locale résolue. */
	aliases?: readonly string[];
	/** Replis explicites, du plus proche au plus général. */
	fallbacks?: readonly string[];
}

export interface LocaleRegistryOptions {
	defaultLocale: string;
	locales: readonly LocaleDefinition[];
}

/** Registre immuable, indépendant de tout framework et de toute persistance. */
export interface LocaleRegistry {
	readonly defaultLocale: string;
	readonly locales: readonly LocaleDefinition[];
}

function invalidTagMessage(tag: string): string {
	return `Tag de locale BCP-47 invalide : ${JSON.stringify(tag)}`;
}

/** Canonicalise un tag BCP-47 ; rend `null` au lieu de lever pour une entrée externe invalide. */
export function canonicalizeLocaleTag(tag: string): string | null {
	const trimmed = tag.trim();
	if (!trimmed) return null;

	try {
		return Intl.getCanonicalLocales(trimmed)[0] ?? null;
	} catch {
		return null;
	}
}

function requireCanonicalTag(tag: string): string {
	const canonical = canonicalizeLocaleTag(tag);
	if (!canonical) throw new RangeError(invalidTagMessage(tag));
	return canonical;
}

function exactDefinition(
	registry: LocaleRegistry,
	canonicalTag: string
): LocaleDefinition | undefined {
	return registry.locales.find(
		(locale) => locale.tag === canonicalTag || locale.aliases?.includes(canonicalTag)
	);
}

function assertAcyclicFallbacks(locales: readonly LocaleDefinition[]): void {
	const byTag = new Map(locales.map((locale) => [locale.tag, locale]));
	const visited = new Set<string>();
	const active = new Set<string>();

	const visit = (tag: string): void => {
		if (visited.has(tag)) return;
		if (active.has(tag)) {
			throw new RangeError(`Cycle dans les replis de locales autour de ${JSON.stringify(tag)}`);
		}

		active.add(tag);
		for (const fallback of byTag.get(tag)?.fallbacks ?? []) visit(fallback);
		active.delete(tag);
		visited.add(tag);
	};

	for (const locale of locales) visit(locale.tag);
}

/**
 * Construit et valide un registre de locales.
 *
 * Les tags, alias et replis sont canonicalisés une seule fois. Toute ambiguïté
 * (doublon, alias partagé, repli absent ou cycle) est refusée au démarrage.
 */
export function createLocaleRegistry(options: LocaleRegistryOptions): LocaleRegistry {
	if (options.locales.length === 0) {
		throw new RangeError("Le registre doit déclarer au moins une locale");
	}

	const identifiers = new Set<string>();
	const locales = options.locales.map((input) => {
		if (input.direction !== "ltr" && input.direction !== "rtl") {
			throw new RangeError(
				`Direction de locale invalide pour ${JSON.stringify(input.tag)} : ${JSON.stringify(input.direction)}`
			);
		}

		const tag = requireCanonicalTag(input.tag);
		const aliases = [...new Set((input.aliases ?? []).map(requireCanonicalTag))];
		const fallbacks = [...new Set((input.fallbacks ?? []).map(requireCanonicalTag))];

		for (const identifier of [tag, ...aliases]) {
			if (identifiers.has(identifier)) {
				throw new RangeError(
					`Locale ou alias déclaré plusieurs fois : ${JSON.stringify(identifier)}`
				);
			}
			identifiers.add(identifier);
		}

		return Object.freeze({
			aliases: Object.freeze(aliases),
			direction: input.direction,
			fallbacks: Object.freeze(fallbacks),
			tag,
		}) satisfies LocaleDefinition;
	});

	const defaultLocale = requireCanonicalTag(options.defaultLocale);
	const canonicalTags = new Set(locales.map((locale) => locale.tag));
	if (!canonicalTags.has(defaultLocale)) {
		throw new RangeError(
			`La locale par défaut n'est pas déclarée : ${JSON.stringify(defaultLocale)}`
		);
	}

	for (const locale of locales) {
		for (const fallback of locale.fallbacks ?? []) {
			if (!canonicalTags.has(fallback)) {
				throw new RangeError(
					`Repli ${JSON.stringify(fallback)} absent du registre pour ${JSON.stringify(locale.tag)}`
				);
			}
		}
	}

	assertAcyclicFallbacks(locales);
	return Object.freeze({ defaultLocale, locales: Object.freeze(locales) });
}

function lookupCandidates(tag: string): string[] {
	const candidates: string[] = [tag];
	const baseName = new Intl.Locale(tag).baseName;
	if (baseName !== tag) candidates.push(baseName);

	let current = baseName;
	while (current.includes("-")) {
		current = current.slice(0, current.lastIndexOf("-"));
		candidates.push(current);
	}

	return candidates;
}

/**
 * Cherche une locale supportée avec l'algorithme de lookup BCP-47.
 *
 * Une variante régionale peut donc retomber sur sa langue (`fr-CA` → `fr`) ;
 * inversement, une langue générique peut sélectionner la première variante
 * déclarée (`pt` → `pt-BR`) lorsqu'aucun `pt` exact n'existe.
 */
export function matchLocale(
	locale: string | null | undefined,
	registry: LocaleRegistry = DEFAULT_LOCALE_REGISTRY
): LocaleDefinition | null {
	if (!locale) return null;
	const canonical = canonicalizeLocaleTag(locale);
	if (!canonical) return null;

	const candidates = lookupCandidates(canonical);
	for (const candidate of candidates) {
		const exact = exactDefinition(registry, candidate);
		if (exact) return exact;
	}

	for (const candidate of candidates.toReversed()) {
		const prefix = `${candidate}-`;
		const regional = registry.locales.find(
			(definition) =>
				definition.tag.startsWith(prefix) ||
				definition.aliases?.some((alias) => alias.startsWith(prefix))
		);
		if (regional) return regional;
	}

	return null;
}

export function isLocaleSupported(
	locale: string | null | undefined,
	registry: LocaleRegistry = DEFAULT_LOCALE_REGISTRY
): boolean {
	return matchLocale(locale, registry) !== null;
}

/** Rend la locale par défaut validée, et refuse un registre construit manuellement invalide. */
export function getDefaultLocaleDefinition(
	registry: LocaleRegistry = DEFAULT_LOCALE_REGISTRY
): LocaleDefinition {
	const definition = exactDefinition(registry, registry.defaultLocale);
	if (!definition) {
		throw new RangeError(
			`La locale par défaut n'est pas déclarée : ${JSON.stringify(registry.defaultLocale)}`
		);
	}
	return definition;
}

export function directionForLocale(
	locale: string | null | undefined,
	registry: LocaleRegistry = DEFAULT_LOCALE_REGISTRY
): TextDirection {
	return (matchLocale(locale, registry) ?? getDefaultLocaleDefinition(registry)).direction;
}

function exactParent(tag: string, registry: LocaleRegistry): LocaleDefinition | undefined {
	let current = new Intl.Locale(tag).baseName;
	while (current.includes("-")) {
		current = current.slice(0, current.lastIndexOf("-"));
		const parent = exactDefinition(registry, current);
		if (parent) return parent;
	}
	return undefined;
}

/** Construit une chaîne sans doublon : locale, replis explicites/parents, puis défaut. */
export function buildFallbackChain(
	locale: string | null | undefined,
	registry: LocaleRegistry = DEFAULT_LOCALE_REGISTRY
): readonly string[] {
	const start = matchLocale(locale, registry) ?? getDefaultLocaleDefinition(registry);
	const chain: string[] = [];
	const visited = new Set<string>();

	const append = (definition: LocaleDefinition): void => {
		if (visited.has(definition.tag)) return;
		visited.add(definition.tag);
		chain.push(definition.tag);

		for (const fallback of definition.fallbacks ?? []) {
			const next = exactDefinition(registry, fallback);
			if (next) append(next);
		}

		const parent = exactParent(definition.tag, registry);
		if (parent) append(parent);
	};

	append(start);
	append(getDefaultLocaleDefinition(registry));

	return Object.freeze(chain);
}

export const DEFAULT_LOCALE_REGISTRY = createLocaleRegistry({
	defaultLocale: "fr",
	locales: [
		{ direction: "ltr", tag: "fr" },
		{ direction: "ltr", fallbacks: ["fr"], tag: "en" },
		{ direction: "ltr", fallbacks: ["fr"], tag: "ja" },
	],
});
