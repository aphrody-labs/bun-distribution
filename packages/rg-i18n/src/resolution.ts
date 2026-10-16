import { negotiateAcceptLanguage } from "./accept-language";
import {
	DEFAULT_LOCALE_REGISTRY,
	buildFallbackChain,
	getDefaultLocaleDefinition,
	matchLocale,
	type LocaleRegistry,
	type TextDirection,
} from "./registry";

export type LocaleSource = "route" | "profile" | "cookie" | "accept-language" | "default";

export interface LocaleResolutionInput {
	routeLocale?: string | null;
	profileLocale?: string | null;
	cookieLocale?: string | null;
	acceptLanguage?: string | null;
}

export interface ResolvedLocale {
	readonly locale: string;
	readonly direction: TextDirection;
	readonly source: LocaleSource;
	readonly fallbackChain: readonly string[];
}

/**
 * Résout la locale selon l'unique précédence canonique de l'application :
 * route, profil, cookie, `Accept-Language`, puis défaut du registre.
 */
export function resolveLocale(
	input: LocaleResolutionInput,
	registry: LocaleRegistry = DEFAULT_LOCALE_REGISTRY
): ResolvedLocale {
	const directSources = [
		["route", input.routeLocale],
		["profile", input.profileLocale],
		["cookie", input.cookieLocale],
	] as const;

	for (const [source, candidate] of directSources) {
		const definition = matchLocale(candidate, registry);
		if (definition) {
			return Object.freeze({
				direction: definition.direction,
				fallbackChain: buildFallbackChain(definition.tag, registry),
				locale: definition.tag,
				source,
			});
		}
	}

	const negotiated = negotiateAcceptLanguage(input.acceptLanguage, registry);
	const acceptedDefinition = matchLocale(negotiated, registry);
	if (acceptedDefinition) {
		return Object.freeze({
			direction: acceptedDefinition.direction,
			fallbackChain: buildFallbackChain(acceptedDefinition.tag, registry),
			locale: acceptedDefinition.tag,
			source: "accept-language",
		});
	}

	const fallback = getDefaultLocaleDefinition(registry);
	return Object.freeze({
		direction: fallback.direction,
		fallbackChain: buildFallbackChain(fallback.tag, registry),
		locale: fallback.tag,
		source: "default",
	});
}
