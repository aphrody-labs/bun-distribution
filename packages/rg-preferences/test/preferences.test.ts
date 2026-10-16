import { describe, expect, test } from "bun:test";

import {
	CONTRAST_IDS,
	DEFAULT_EXPERIENCE,
	DENSITY_IDS,
	FONT_IDS,
	FONT_SCALE_MAX,
	FONT_SCALE_MIN,
	LOCALE_IDS,
	THEME_IDS,
	isContrast,
	isDensity,
	isFontId,
	isFontScale,
	isLocaleId,
	isThemeId,
	resolveExperience,
} from "../src";
import type { ExperienceCandidate, ExperienceWhitelist } from "../src";

describe("identifier guards", () => {
	test("catalogues contain unique serializable IDs", () => {
		for (const catalogue of [THEME_IDS, LOCALE_IDS, FONT_IDS, DENSITY_IDS, CONTRAST_IDS]) {
			expect(new Set(catalogue).size).toBe(catalogue.length);
			expect(catalogue.every((value) => typeof value === "string" && value.length > 0)).toBe(true);
		}
	});

	test("accept only declared identifiers", () => {
		for (const value of THEME_IDS) expect(isThemeId(value)).toBe(true);
		for (const value of LOCALE_IDS) expect(isLocaleId(value)).toBe(true);
		for (const value of FONT_IDS) expect(isFontId(value)).toBe(true);
		for (const value of DENSITY_IDS) expect(isDensity(value)).toBe(true);
		for (const value of CONTRAST_IDS) expect(isContrast(value)).toBe(true);

		expect(isThemeId("dark")).toBe(false);
		expect(isLocaleId("fr-FR")).toBe(false);
		expect(isFontId("Comic Sans MS")).toBe(false);
		expect(isDensity("dense")).toBe(false);
		expect(isContrast("forced")).toBe(false);
		expect(isThemeId(null)).toBe(false);
	});

	test("font scale is finite and bounded", () => {
		expect(isFontScale(FONT_SCALE_MIN)).toBe(true);
		expect(isFontScale(FONT_SCALE_MAX)).toBe(true);
		expect(isFontScale(FONT_SCALE_MIN - 0.01)).toBe(false);
		expect(isFontScale(FONT_SCALE_MAX + 0.01)).toBe(false);
		expect(isFontScale(Number.NaN)).toBe(false);
		expect(isFontScale(Number.POSITIVE_INFINITY)).toBe(false);
		expect(isFontScale("1.25")).toBe(false);
	});
});

describe("runtime boundaries", () => {
	test("source has no framework, DOM, network, storage, or database dependency", async () => {
		const source = await Bun.file(new URL("../src/index.ts", import.meta.url)).text();
		const packageJson = await Bun.file(new URL("../package.json", import.meta.url)).json();
		const executableSource = source.replace(/\/\*[\s\S]*?\*\//g, "");

		expect(packageJson.dependencies).toBeUndefined();
		expect(executableSource).not.toMatch(/^\s*import\s/m);
		expect(executableSource).not.toMatch(
			/\b(?:document|window|localStorage|sessionStorage|fetch|process\.env|Bun)\b|(?:next\/|@supabase|node:|bun:)/
		);
	});
});

describe("resolveExperience", () => {
	test("returns safe complete defaults with provenance", () => {
		expect(resolveExperience()).toEqual({
			...DEFAULT_EXPERIENCE,
			sources: {
				contrast: "defaults",
				density: "defaults",
				font: "defaults",
				fontScale: "defaults",
				locale: "defaults",
				readingMode: "defaults",
				reducedMotion: "defaults",
				theme: "defaults",
			},
		});
	});

	test("resolves each field using user > domain > device > defaults", () => {
		const resolved = resolveExperience({
			defaults: {
				contrast: "standard",
				density: "spacious",
				font: "lato",
				fontScale: 0.9,
				locale: "fr",
				readingMode: false,
				reducedMotion: false,
				theme: "roy",
			},
			deviceHints: {
				contrast: "high",
				fontScale: 1.1,
				locale: "en",
				reducedMotion: true,
				theme: "azalee-dark",
			},
			domain: {
				density: "compact",
				font: "noto-sans",
				fontScale: 1.25,
				locale: "ja",
				theme: "achillea",
			},
			user: {
				fontScale: 1.5,
				readingMode: true,
				theme: "gaelle",
			},
		});

		expect(resolved).toEqual({
			contrast: "high",
			density: "compact",
			font: "noto-sans",
			fontScale: 1.5,
			locale: "ja",
			readingMode: true,
			reducedMotion: true,
			theme: "gaelle",
			sources: {
				contrast: "device",
				density: "domain",
				font: "domain",
				fontScale: "user",
				locale: "domain",
				readingMode: "user",
				reducedMotion: "device",
				theme: "user",
			},
		});
	});

	test("ignores invalid higher-priority values instead of coercing them", () => {
		const invalidUser: ExperienceCandidate = {
			contrast: "maximum",
			density: "tiny",
			font: "unknown-font",
			fontScale: "1.5",
			locale: "de",
			readingMode: 1,
			reducedMotion: "true",
			theme: "dark",
		};
		const resolved = resolveExperience({
			domain: {
				contrast: "high",
				density: "compact",
				font: "poppins",
				fontScale: 1.2,
				locale: "en",
				readingMode: true,
				reducedMotion: false,
				theme: "azalee-dark",
			},
			user: invalidUser,
		});

		expect(resolved.theme).toBe("azalee-dark");
		expect(resolved.locale).toBe("en");
		expect(resolved.font).toBe("poppins");
		expect(resolved.fontScale).toBe(1.2);
		expect(resolved.density).toBe("compact");
		expect(resolved.contrast).toBe("high");
		expect(resolved.reducedMotion).toBe(false);
		expect(resolved.readingMode).toBe(true);
		expect(Object.values(resolved.sources).every((source) => source === "domain")).toBe(true);
	});

	test("applies deployment allowlists and falls through to an allowed layer", () => {
		const resolved = resolveExperience({
			defaults: { font: "roboto", locale: "en", theme: "roy" },
			deviceHints: { font: "lato", locale: "fr", theme: "azalee-dark" },
			domain: { font: "poppins", locale: "ja", theme: "achillea" },
			user: { font: "super-cartoon", locale: "en", theme: "gaelle" },
			whitelist: {
				fonts: ["lato"],
				locales: ["fr", "ja"],
				themes: ["azalee-dark", "achillea"],
			},
		});

		expect(resolved.theme).toBe("achillea");
		expect(resolved.sources.theme).toBe("domain");
		expect(resolved.locale).toBe("ja");
		expect(resolved.sources.locale).toBe("domain");
		expect(resolved.font).toBe("lato");
		expect(resolved.sources.font).toBe("device");
	});

	test("uses the first allowed ID when the built-in default is not allowed", () => {
		const resolved = resolveExperience({
			whitelist: {
				fonts: ["noto-sans"],
				locales: ["ja"],
				themes: ["achillea"],
			},
		});

		expect(resolved.theme).toBe("achillea");
		expect(resolved.locale).toBe("ja");
		expect(resolved.font).toBe("noto-sans");
		expect(resolved.sources.theme).toBe("defaults");
	});

	test("invalid or empty runtime allowlists fail closed to built-in defaults", () => {
		const resolved = resolveExperience({
			whitelist: {
				fonts: ["invalid"],
				locales: [],
				themes: ["dark"],
			} as unknown as ExperienceWhitelist,
		});

		expect(resolved.theme).toBe(DEFAULT_EXPERIENCE.theme);
		expect(resolved.locale).toBe(DEFAULT_EXPERIENCE.locale);
		expect(resolved.font).toBe(DEFAULT_EXPERIENCE.font);
	});

	test("does not mutate its inputs and returns immutable output", () => {
		const user = { fontScale: 1.25, theme: "gaelle" } as const;
		const before = JSON.stringify(user);
		const resolved = resolveExperience({ user });

		expect(JSON.stringify(user)).toBe(before);
		expect(Object.isFrozen(resolved)).toBe(true);
		expect(Object.isFrozen(resolved.sources)).toBe(true);
	});

	test("is deterministic and emits JSON without undefined fields", () => {
		const input = {
			deviceHints: { contrast: "high", reducedMotion: true },
			domain: { locale: "ja", theme: "azalee-dark" },
			user: { font: "noto-sans", fontScale: 1.15 },
		} as const;
		const first = resolveExperience(input);
		const second = resolveExperience(input);

		expect(first).toEqual(second);
		expect(JSON.stringify(first)).toBe(JSON.stringify(second));
		expect(JSON.stringify(first)).not.toContain("undefined");
	});
});
