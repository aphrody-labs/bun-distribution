import { describe, expect, test } from "bun:test";
import { prettyDocument, resolveToriyamaHref } from "../src/lib/toriyama-shared";

describe("nommage des documents du corpus Toriyama", () => {
	/**
	 * Le corpus contient des documents dont le nom est resté un nom de FICHIER,
	 * queue de chemin de sauvegarde comprise. Les afficher publierait
	 * l'arborescence interne sur une page de lecture — c'est une fuite, pas une
	 * imperfection d'affichage.
	 */
	test("aucun nom de fichier ni chemin interne ne ressort", () => {
		const bruts = [
			"toriyama_toriyama-interviews.md",
			"toriyama_akira-toriyama-tankobon-introductions.md",
			"shenron_daizenshuu-1-shenlong-times_shenron_data_backups_dbfr-20260906_apps_bot_data_rag_raw_guides.md",
			"shenron_seg-character-volume_shenron_data_backups_dbfr-20260906_apps_bot_data_rag_raw_guides.md",
		];
		for (const brut of bruts) {
			const rendu = prettyDocument(brut);
			expect(rendu).not.toContain(".md");
			expect(rendu).not.toContain("_");
			expect(rendu).not.toContain("/");
			expect(rendu).not.toContain("backups");
			expect(rendu).not.toContain("data_rag");
			expect(rendu.length).toBeGreaterThan(3);
		}
	});

	test("les documents connus portent leur vrai titre", () => {
		expect(prettyDocument("toriyama_toriyama-interviews.md")).toBe("Interviews d'Akira Toriyama");
		expect(prettyDocument("toriyama_akira-toriyama-tankobon-introductions.md")).toBe(
			"Introductions des tomes, par Akira Toriyama"
		);
	});

	test("un titre d'ouvrage déjà propre n'est pas réécrit", () => {
		// Le nettoyage ne doit pas abîmer les titres corrects : tirets cadratins,
		// accents et numéros de tome restent tels quels.
		for (const titre of [
			"Dragon Ball Daizenshuu 7 — Dragon Ball Daijiten",
			"Akira Toriyama Hetappi Manga Kenkyūjo",
			"Dragon Ball Super Exciting Guide — Story Volume",
		]) {
			expect(prettyDocument(titre)).toBe(titre);
		}
	});

	test("un document inconnu en forme de fichier est nettoyé sans être inventé", () => {
		// Aucune invention de titre : on enlève ce qui est technique, on garde les
		// mots de la source.
		const rendu = prettyDocument("toriyama_nouvelle-interview-2027.md");
		expect(rendu).toBe("Nouvelle interview 2027");
	});

	test("les citations historiques ouvrent leur databook plutôt que le canon générique", () => {
		expect(resolveToriyamaHref("/wiki/canon", 464)).toBe("/wiki/databooks/464");
		expect(resolveToriyamaHref(null, 7)).toBe("/wiki/databooks/7");
		expect(resolveToriyamaHref("/wiki/databooks/7#planche-1", 7)).toBe(
			"/wiki/databooks/7#planche-1"
		);
		expect(resolveToriyamaHref("/wiki/canon", null)).toBe("/wiki/canon");
	});
});
