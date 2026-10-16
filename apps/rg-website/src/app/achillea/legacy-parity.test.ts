import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "bun:test";

/**
 * Contrat de migration Angular → Next.
 *
 * L'ancienne application reste dans `apps/achillea-web` pour l'exploitation,
 * mais ces écrans doivent tous être atteignables depuis la surface Next. Une
 * route oubliée ne se voit souvent qu'au clic d'un lien Discord historique.
 */
const ROUTES_ANGULAR_MIGREES = [
	"",
	"clans",
	"clans/create",
	"clans/dashboard",
	"clans/[id]",
	"users/[id]",
	"events/create/tournament",
	"events/list/tournament",
	"events/tournaments/circuit/ranking",
	"events/tournaments/[id]",
	"leagues/astral",
	"leagues/astral-s1",
	"leagues/asytral",
	"leagues/asytral-s1",
	"organizations/create",
	"admins/dashboard",
	"admins/sanctions",
	"admins/dashboard/organizations/validate/[id]",
	"admins/ranked-disputes",
	"ranked",
	"ranked/tiers",
	"ranked/leaderboard",
	"ranked/history",
	"ranked/match",
	"ranked/defi/[code]",
	"licence",
	"licence/verify/[qr]",
	"wallet",
	"casts",
	"casts/[id]/availability",
	"casts/[id]/planning",
	"guide",
	"guide/brand",
	"forbidden",
] as const;

const ACHILLEA_APP_DIR = import.meta.dir;

describe("parité fonctionnelle Achilléa — Angular vers Next", () => {
	test("chaque écran Angular migré possède sa page Next", () => {
		for (const route of ROUTES_ANGULAR_MIGREES) {
			const page = resolve(ACHILLEA_APP_DIR, route, "page.tsx");
			expect(existsSync(page), `Route /achillea/${route || ""} absente : ${page}`).toBe(true);
		}
	});

	test("l'aperçu d'accueil garde toutes les données de compétition", async () => {
		const apiRoute = await Bun.file(
			resolve(ACHILLEA_APP_DIR, "../api/public/achillea/preview/route.ts")
		).text();
		const hub = await Bun.file(
			resolve(ACHILLEA_APP_DIR, "../../components/home/AchilleaLiveHub.tsx")
		).text();

		for (const field of ["clans", "leaderboard", "tournaments", "stats"]) {
			expect(apiRoute).toContain(`${field}:`);
		}

		for (const view of ["clans", "leaderboard", "tournaments", "modes"]) {
			expect(hub).toContain(`activePreview === "${view}"`);
		}
		expect(hub).toContain('useState<PreviewTab>("clans")');
	});
});
