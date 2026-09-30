/**
 * Droit de contribution — la décision pure. Elle garde deux périmètres (wiki,
 * databooks) et trois modes ; une erreur ici ouvre le wiki à tout le monde ou
 * le ferme à tout le monde, sans que rien ne le signale à l'écran.
 */
import { describe, expect, test } from "bun:test";
import {
	DEFAULT_CONTRIBUTION_RIGHTS,
	decideContribution,
	scopeOf,
	type ScopeRule,
} from "@/lib/contribution-rights-shared";

const anonyme = { isAdmin: false, authenticated: false };
const membre = { isAdmin: false, authenticated: true, discordId: "111111111111111111" };
const staff = { isAdmin: true, authenticated: true };

const regle = (p: Partial<ScopeRule> = {}): ScopeRule => ({
	mode: "members",
	roleIds: [],
	discordIds: [],
	...p,
});

describe("scopeOf", () => {
	test("les databooks ont leur propre périmètre", () => {
		expect(scopeOf("db_databooks")).toBe("databooks");
	});
	test("tout le reste relève du wiki", () => {
		for (const t of ["db_characters", "db_planets", "db_wiki_sections", "inconnue"]) {
			expect(scopeOf(t)).toBe("wiki");
		}
	});
});

describe("decideContribution", () => {
	test("un anonyme ne contribue jamais, quel que soit le mode", () => {
		for (const mode of ["members", "restricted", "admin"] as const) {
			expect(decideContribution(regle({ mode }), anonyme)).toBe(false);
		}
	});

	test("le staff passe partout, même en mode fermé", () => {
		expect(decideContribution(regle({ mode: "admin" }), staff)).toBe(true);
		// Y compris sans être connecté au sens du site (session admin).
		expect(
			decideContribution(regle({ mode: "restricted" }), { ...staff, authenticated: false })
		).toBe(true);
	});

	test("`members` ouvre à tout compte connecté", () => {
		expect(decideContribution(regle(), membre)).toBe(true);
	});

	test("`admin` ferme au public", () => {
		expect(decideContribution(regle({ mode: "admin" }), membre)).toBe(false);
	});

	test("`restricted` sans liste ne laisse passer personne", () => {
		expect(decideContribution(regle({ mode: "restricted" }), membre)).toBe(false);
	});

	test("`restricted` est un OU : un rôle suffit", () => {
		const r = regle({ mode: "restricted", roleIds: ["222222222222222222"] });
		expect(decideContribution(r, { ...membre, roleIds: ["222222222222222222"] })).toBe(true);
		expect(decideContribution(r, { ...membre, roleIds: ["999999999999999999"] })).toBe(false);
	});

	test("`restricted` est un OU : un membre nommé suffit, sans aucun rôle", () => {
		const r = regle({ mode: "restricted", discordIds: [membre.discordId] });
		expect(decideContribution(r, { ...membre, roleIds: [] })).toBe(true);
	});

	test("un autre membre nommé ne donne pas le droit", () => {
		const r = regle({ mode: "restricted", discordIds: ["333333333333333333"] });
		expect(decideContribution(r, membre)).toBe(false);
	});

	test("le défaut livré ne change rien au comportement historique", () => {
		expect(DEFAULT_CONTRIBUTION_RIGHTS.wiki.mode).toBe("members");
		expect(DEFAULT_CONTRIBUTION_RIGHTS.databooks.mode).toBe("members");
		expect(decideContribution(DEFAULT_CONTRIBUTION_RIGHTS.wiki, membre)).toBe(true);
	});
});
