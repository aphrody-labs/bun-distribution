/**
 * Résolution de la configuration de l'accueil (`resolveHomeConfig`).
 *
 * Remplace `home-fx.test.ts`, qui couvrait le sous-système VFX/SFX supprimé le
 * 2026-08-21 : l'accueil défile désormais normalement et n'a plus ni son ni
 * effet, donc plus de `fx` en configuration. Ce qui reste — et qui compte — est
 * la fusion défensive d'un document partiel venu de la base : un patch ne doit
 * jamais faire disparaître le héro ni les sections.
 *
 * Cas vécu à ne pas régresser : un document enregistré AVANT la suppression
 * porte encore une clé `fx`. Elle doit être ignorée sans rien casser.
 */
import { describe, expect, test } from "bun:test";
import { DEFAULT_HOME_CONFIG, resolveHomeConfig } from "../src/lib/home-scenes";

describe("resolveHomeConfig", () => {
	test("un document quasi vide retombe sur les défauts complets", () => {
		const cfg = resolveHomeConfig({ version: 1 });
		expect(cfg.hero.scenes.length).toBeGreaterThan(0);
		expect(cfg.sections.length).toBe(DEFAULT_HOME_CONFIG.sections.length);
		expect(cfg.catalogue.destinations).toHaveLength(DEFAULT_HOME_CONFIG.catalogue.destinations.length);
		expect(cfg.journey.destinations).toHaveLength(DEFAULT_HOME_CONFIG.journey.destinations.length);
	});

	test("les actualités suivent immédiatement la section Discord", () => {
		const ids = resolveHomeConfig({ version: 1 }).sections.map((section) => section.id);
		expect(ids.indexOf("news")).toBe(ids.indexOf("guardians") + 1);

		// Les documents déjà enregistrés ne conservent pas un ancien ordre :
		// `resolveHomeConfig` réapplique toujours SECTION_ORDER.
		const legacyIds = resolveHomeConfig({
			sections: [{ id: "news" }, { id: "guardians" }],
		}).sections.map((section) => section.id);
		expect(legacyIds.indexOf("news")).toBe(legacyIds.indexOf("guardians") + 1);
	});

	test("les destinations fixes sont éditables mais une route injectée est rejetée", () => {
		const cfg = resolveHomeConfig({
			catalogue: {
				title: "À regarder",
				destinations: [
					{ href: "/wiki/episodes", enabled: false },
					{ href: "https://example.com", enabled: true },
				],
			},
			journey: {
				destinations: [
					{ href: "/dashboard", label: "Mon repaire", accent: "#123456" },
					{ href: "javascript:alert(1)", label: "Piège" },
				],
			},
		});

		expect(cfg.catalogue.title).toBe("À regarder");
		expect(
			cfg.catalogue.destinations.find((entry) => entry.href === "/wiki/episodes")?.enabled
		).toBe(false);
		expect(
			cfg.catalogue.destinations.some((entry) => (entry.href as string) === "https://example.com")
		).toBe(false);
		expect(cfg.journey.destinations[0]?.href).toBe("/dashboard");
		expect(cfg.journey.destinations[0]?.label).toBe("Mon repaire");
		expect(cfg.journey.destinations[0]?.accent).toBe("#123456");
		expect(cfg.journey.destinations.some((entry) => entry.href.startsWith("javascript:"))).toBe(
			false
		);
	});

	test("un patch partiel ne perd pas le reste", () => {
		const cfg = resolveHomeConfig({ hero: { lede: "Test lede custom" } });
		expect(cfg.hero.lede).toBe("Test lede custom");
		expect(cfg.hero.scenes.length).toBeGreaterThan(0);
		expect(cfg.sections.length).toBe(DEFAULT_HOME_CONFIG.sections.length);
	});

	test("une clé `fx` héritée est ignorée sans rien casser", () => {
		const cfg = resolveHomeConfig({
			fx: { sfxVolume: 0.4, vfx: { kameCss: true } },
			hero: { lede: "Avec fx legacy" },
			// `HomeConfig` n'a pas d'index signature : le cast direct est refusé par
			// TS. On passe par `unknown` — c'est justement ce qu'on veut vérifier,
			// que la clé héritée ne survit PAS au type public.
		}) as unknown as Record<string, unknown>;
		expect(cfg.fx).toBeUndefined();
		expect((cfg.hero as { lede: string }).lede).toBe("Avec fx legacy");
		expect((cfg.sections as unknown[]).length).toBe(DEFAULT_HOME_CONFIG.sections.length);
	});

	test("n'importe quoi en entrée reste résolvable", () => {
		for (const entree of [null, undefined, 42, "x", [], { sections: "pas un tableau" }]) {
			const cfg = resolveHomeConfig(entree as never);
			expect(cfg.version).toBe(1);
			expect(Array.isArray(cfg.sections)).toBe(true);
			expect(cfg.sections.length).toBeGreaterThan(0);
		}
	});
});
