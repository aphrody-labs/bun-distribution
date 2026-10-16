import {
	DEFAULT_LOCALE_REGISTRY,
	getDefaultLocaleDefinition,
	matchLocale,
	type LocaleDefinition,
	type LocaleRegistry,
	type TextDirection,
} from "./registry";

export type DateValue = Date | number;

export interface IntlFormatters {
	readonly locale: string;
	readonly direction: TextDirection;
	date(value: DateValue, options?: Intl.DateTimeFormatOptions): string;
	number(value: number | bigint, options?: Intl.NumberFormatOptions): string;
	list(values: Iterable<string>, options?: Intl.ListFormatOptions): string;
}

function formattingDefinition(locale: string, registry: LocaleRegistry): LocaleDefinition {
	return matchLocale(locale, registry) ?? getDefaultLocaleDefinition(registry);
}

export function formatDate(
	value: DateValue,
	locale: string,
	options?: Intl.DateTimeFormatOptions,
	registry: LocaleRegistry = DEFAULT_LOCALE_REGISTRY
): string {
	const definition = formattingDefinition(locale, registry);
	return new Intl.DateTimeFormat(definition.tag, options).format(value);
}

export function formatNumber(
	value: number | bigint,
	locale: string,
	options?: Intl.NumberFormatOptions,
	registry: LocaleRegistry = DEFAULT_LOCALE_REGISTRY
): string {
	const definition = formattingDefinition(locale, registry);
	return new Intl.NumberFormat(definition.tag, options).format(value);
}

export function formatList(
	values: Iterable<string>,
	locale: string,
	options?: Intl.ListFormatOptions,
	registry: LocaleRegistry = DEFAULT_LOCALE_REGISTRY
): string {
	const definition = formattingDefinition(locale, registry);
	return new Intl.ListFormat(definition.tag, options).format(values);
}

/** Lie une locale résolue à des formatteurs sans capturer d'état de plateforme. */
export function createIntlFormatters(
	locale: string,
	registry: LocaleRegistry = DEFAULT_LOCALE_REGISTRY
): IntlFormatters {
	const definition = formattingDefinition(locale, registry);
	return Object.freeze({
		date: (value: DateValue, options?: Intl.DateTimeFormatOptions) =>
			new Intl.DateTimeFormat(definition.tag, options).format(value),
		direction: definition.direction,
		list: (values: Iterable<string>, options?: Intl.ListFormatOptions) =>
			new Intl.ListFormat(definition.tag, options).format(values),
		locale: definition.tag,
		number: (value: number | bigint, options?: Intl.NumberFormatOptions) =>
			new Intl.NumberFormat(definition.tag, options).format(value),
	});
}
