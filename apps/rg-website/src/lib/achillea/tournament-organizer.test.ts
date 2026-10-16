/**
 * Garde le prédicat d'autorisation TO côté web unifié (UI Modifier / Scores / Participants).
 * Porté d'achillea-web vers apps/website.
 *
 * Run : bun test apps/website/src/lib/achillea/tournament-organizer.test.ts
 */
import { describe, expect, test } from "bun:test";
import { isTournamentOrganizer } from "./index";

const tournament = {
	organization: {
		owner: { id: "owner-1" },
		managers: [
			// Forme API réelle : pas d'id composite au top-level, seulement user
			{ user: { id: "org-mgr-1" } },
			{ user: { id: "org-mgr-2" } },
		],
	},
	managers: [{ id: "to-1" }, { id: "to-2" }],
};

describe("isTournamentOrganizer (website)", () => {
	test("refuse un visiteur anonyme (user null / undefined / sans id)", () => {
		expect(isTournamentOrganizer(null, tournament)).toBe(false);
		expect(isTournamentOrganizer(undefined, tournament)).toBe(false);
		expect(isTournamentOrganizer({}, tournament)).toBe(false);
		expect(isTournamentOrganizer({ id: null } as any, tournament)).toBe(false);
		expect(isTournamentOrganizer({ role: 3 } as any, tournament)).toBe(false);
	});

	test("ne confond pas undefined === undefined sur les managers d'org", () => {
		const t = {
			organization: {
				owner: { id: "owner-1" },
				managers: [{ user: { id: "org-mgr-1" }, id: undefined as string | undefined }],
			},
			managers: [],
		};
		expect(isTournamentOrganizer(undefined, t)).toBe(false);
		expect(isTournamentOrganizer({ id: "stranger" }, t)).toBe(false);
	});

	test("accepte owner, manager org, TO et SuperAdmin", () => {
		expect(isTournamentOrganizer({ id: "owner-1" }, tournament)).toBe(true);
		expect(isTournamentOrganizer({ id: "org-mgr-2" }, tournament)).toBe(true);
		expect(isTournamentOrganizer({ id: "to-1" }, tournament)).toBe(true);
		expect(isTournamentOrganizer({ id: "anyone", role: 3 }, tournament)).toBe(true);
	});

	test("refuse un simple participant / intrus", () => {
		expect(isTournamentOrganizer({ id: "intrus", role: 0 }, tournament)).toBe(false);
		expect(isTournamentOrganizer({ id: "intrus", role: 1 }, tournament)).toBe(false);
	});

	test("gère tournoi ou org absents sans throw", () => {
		expect(isTournamentOrganizer({ id: "x" }, null)).toBe(false);
		expect(isTournamentOrganizer({ id: "x" }, {})).toBe(false);
		expect(isTournamentOrganizer({ id: "x" }, { organization: null })).toBe(false);
	});
});
