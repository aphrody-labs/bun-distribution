import { describe, expect, test } from "bun:test";

import {
	DEFAULT_LOCALE_REGISTRY,
	buildFallbackChain,
	canonicalizeLocaleTag,
	createIntlFormatters,
	createLocaleRegistry,
	directionForLocale,
	formatDate,
	formatList,
	formatNumber,
	isLocaleSupported,
	matchLocale,
	negotiateAcceptLanguage,
	parseAcceptLanguage,
	resolveLocale,
} from "../src/index";

describe("registre BCP-47", () => {
	test("déclare fr, en et ja avec leur direction et leur repli", () => {
		expect(DEFAULT_LOCALE_REGISTRY.defaultLocale).toBe("fr");
		expect(
			DEFAULT_LOCALE_REGISTRY.locales.map(({ tag, direction }) => ({ tag, direction }))
		).toEqual([
			{ direction: "ltr", tag: "fr" },
			{ direction: "ltr", tag: "en" },
			{ direction: "ltr", tag: "ja" },
		]);
		expect(buildFallbackChain("en")).toEqual(["en", "fr"]);
		expect(buildFallbackChain("ja-JP")).toEqual(["ja", "fr"]);
		expect(buildFallbackChain("fr-CA")).toEqual(["fr"]);
	});

	test("canonicalise, reconnaît régions et alias, et expose le RTL", () => {
		const registry = createLocaleRegistry({
			defaultLocale: "en-US",
			locales: [
				{ aliases: ["en-GB"], direction: "ltr", tag: "en-us" },
				{ direction: "rtl", fallbacks: ["en-US"], tag: "ar" },
			],
		});

		expect(canonicalizeLocaleTag("  EN-us ")).toBe("en-US");
		expect(canonicalizeLocaleTag("fr_FR")).toBeNull();
		expect(matchLocale("en-GB", registry)?.tag).toBe("en-US");
		expect(matchLocale("ar-MA", registry)?.tag).toBe("ar");
		expect(matchLocale("en", registry)?.tag).toBe("en-US");
		expect(directionForLocale("ar-MA", registry)).toBe("rtl");
		expect(isLocaleSupported("de", registry)).toBe(false);
		expect(buildFallbackChain("ar", registry)).toEqual(["ar", "en-US"]);
	});

	test("ajoute le parent régional avant le défaut", () => {
		const registry = createLocaleRegistry({
			defaultLocale: "en",
			locales: [
				{ direction: "ltr", tag: "en" },
				{ direction: "ltr", fallbacks: ["en"], tag: "fr" },
				{ direction: "ltr", tag: "fr-CA" },
			],
		});
		expect(buildFallbackChain("fr-CA", registry)).toEqual(["fr-CA", "fr", "en"]);
	});

	test("refuse les configurations ambiguës ou invalides", () => {
		expect(() => createLocaleRegistry({ defaultLocale: "fr", locales: [] })).toThrow();
		expect(() =>
			createLocaleRegistry({
				defaultLocale: "fr",
				locales: [{ direction: "vertical" as "ltr", tag: "fr" }],
			})
		).toThrow("Direction de locale invalide");
		expect(() =>
			createLocaleRegistry({
				defaultLocale: "de",
				locales: [{ direction: "ltr", tag: "fr" }],
			})
		).toThrow("locale par défaut");
		expect(() =>
			createLocaleRegistry({
				defaultLocale: "fr",
				locales: [
					{ aliases: ["en"], direction: "ltr", tag: "fr" },
					{ direction: "ltr", tag: "en" },
				],
			})
		).toThrow("plusieurs fois");
		expect(() =>
			createLocaleRegistry({
				defaultLocale: "fr",
				locales: [{ direction: "ltr", fallbacks: ["en"], tag: "fr" }],
			})
		).toThrow("absent du registre");
		expect(() =>
			createLocaleRegistry({
				defaultLocale: "fr",
				locales: [
					{ direction: "ltr", fallbacks: ["en"], tag: "fr" },
					{ direction: "ltr", fallbacks: ["fr"], tag: "en" },
				],
			})
		).toThrow("Cycle");
	});
});

describe("Accept-Language", () => {
	test("trie les poids, canonicalise et fusionne les doublons", () => {
		expect(parseAcceptLanguage("en-us;q=0.7, fr-FR, en-US;q=0.9, ja;q=0")).toEqual([
			{ position: 1, quality: 1, range: "fr-FR" },
			{ position: 2, quality: 0.9, range: "en-US" },
			{ position: 3, quality: 0, range: "ja" },
		]);
	});

	test("ignore les fragments et poids invalides sans lever", () => {
		expect(parseAcceptLanguage("fr_FR, en;q=2, ja;q=abc, de;q=0.5")).toEqual([
			{ position: 3, quality: 0.5, range: "de" },
		]);
	});

	test("négocie régions, poids, wildcard et exclusions q=0", () => {
		expect(negotiateAcceptLanguage("de, en-GB;q=0.8, fr;q=0.9")).toBe("fr");
		expect(negotiateAcceptLanguage("en-GB, fr;q=0.5")).toBe("en");
		expect(negotiateAcceptLanguage("fr;q=0, *;q=1")).toBe("en");
		expect(negotiateAcceptLanguage("en;q=0")).toBeNull();
		expect(negotiateAcceptLanguage("de, *;q=0.2")).toBe("fr");
	});
});

describe("résolution server-first", () => {
	test("respecte route > profil > cookie > Accept-Language > défaut", () => {
		expect(
			resolveLocale({
				acceptLanguage: "fr",
				cookieLocale: "ja",
				profileLocale: "en-US",
				routeLocale: "ja-JP",
			})
		).toMatchObject({ locale: "ja", source: "route" });
		expect(
			resolveLocale({ acceptLanguage: "fr", cookieLocale: "ja", profileLocale: "en-US" })
		).toMatchObject({ locale: "en", source: "profile" });
		expect(resolveLocale({ acceptLanguage: "fr", cookieLocale: "ja" })).toMatchObject({
			locale: "ja",
			source: "cookie",
		});
		expect(resolveLocale({ acceptLanguage: "en-GB" })).toMatchObject({
			locale: "en",
			source: "accept-language",
		});
		expect(resolveLocale({ acceptLanguage: "de" })).toEqual({
			direction: "ltr",
			fallbackChain: ["fr"],
			locale: "fr",
			source: "default",
		});
	});

	test("ignore une source prioritaire invalide au lieu de bloquer la suivante", () => {
		expect(resolveLocale({ cookieLocale: "ja", profileLocale: "xx-invalid_tag" })).toMatchObject({
			locale: "ja",
			source: "cookie",
		});
	});
});

describe("formatteurs Intl", () => {
	const instant = Date.UTC(2024, 0, 2, 15, 4, 5);
	const dateOptions = { dateStyle: "long", timeZone: "UTC" } as const;
	const numberOptions = { maximumFractionDigits: 1 } as const;
	const listOptions = { style: "long", type: "conjunction" } as const;

	test("formate date, nombre et liste dans la locale résolue", () => {
		expect(formatDate(instant, "fr-CA", dateOptions)).toBe(
			new Intl.DateTimeFormat("fr", dateOptions).format(instant)
		);
		expect(formatNumber(12_345.6, "en-GB", numberOptions)).toBe(
			new Intl.NumberFormat("en", numberOptions).format(12_345.6)
		);
		expect(formatList(["A", "B", "C"], "ja-JP", listOptions)).toBe(
			new Intl.ListFormat("ja", listOptions).format(["A", "B", "C"])
		);
	});

	test("crée un groupe de formatteurs lié à une locale et à sa direction", () => {
		const registry = createLocaleRegistry({
			defaultLocale: "fr",
			locales: [
				{ direction: "ltr", tag: "fr" },
				{ direction: "rtl", fallbacks: ["fr"], tag: "ar" },
			],
		});
		const formatters = createIntlFormatters("ar-MA", registry);

		expect(formatters.locale).toBe("ar");
		expect(formatters.direction).toBe("rtl");
		expect(formatters.date(instant, dateOptions)).toBe(
			new Intl.DateTimeFormat("ar", dateOptions).format(instant)
		);
		expect(formatters.number(12_345.6, numberOptions)).toBe(
			new Intl.NumberFormat("ar", numberOptions).format(12_345.6)
		);
		expect(formatters.list(["A", "B"], listOptions)).toBe(
			new Intl.ListFormat("ar", listOptions).format(["A", "B"])
		);
	});
});
