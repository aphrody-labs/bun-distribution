import { describe, expect, test } from "bun:test";
import { estCiblePlanche, numeroDePlanche } from "@/lib/databook-pages-shared";

/**
 * Ce que `snapshot()` de `lib/wiki-revisions.ts` doit préserver.
 *
 * On ne peut pas importer `wiki-revisions` ici (server-only + accès DB) : on
 * teste la RÈGLE qu'il applique, sur la même fonction de décision. Le défaut
 * corrigé était que `pages#42` n'étant pas une colonne mutable, la clé était
 * éliminée du journal — et les 2 359 révisions de transcription de databook
 * avaient `before = after`.
 */
function snapshotPlanches(table: string, row: Record<string, unknown>) {
	const out: Record<string, unknown> = {};
	for (const [k, v] of Object.entries(row)) {
		if (!estCiblePlanche(table, k)) continue;
		if (v === null || typeof v === "string") out[k] = v;
	}
	return out;
}

describe("cibles de planche dans le journal de révisions", () => {
	test("une transcription déposée est conservée", () => {
		const r = snapshotPlanches("db_databooks", { "pages#42": "かめはめ波", title: "Daizenshuu 7" });
		expect(r).toEqual({ "pages#42": "かめはめ波" });
	});

	test("`null` est conservé — c'est « la planche n'avait pas de texte »", () => {
		// Sans ça, annuler un PREMIER dépôt laisserait le texte en place : le
		// revert n'aurait rien à réécrire.
		expect(snapshotPlanches("db_databooks", { "pages#9": null })).toEqual({ "pages#9": null });
	});

	test("le tableau `pages` entier n'est PAS conservé", () => {
		// 313 planches par révision noieraient l'historique et pèseraient des
		// centaines de Ko : seule la planche visée entre au journal.
		expect(snapshotPlanches("db_databooks", { pages: [{ number: 1 }, { number: 2 }] })).toEqual({});
	});

	test("une autre table n'ouvre pas la porte", () => {
		expect(snapshotPlanches("db_characters", { "pages#42": "x" })).toEqual({});
	});

	test("les cibles mal formées sont refusées", () => {
		for (const cle of ["pages#", "pages#0", "pages# 4 ", "pages#-1", "pages#4.5", "pagesx#4"]) {
			expect(numeroDePlanche(cle)).toBeNull();
			expect(snapshotPlanches("db_databooks", { [cle]: "x" })).toEqual({});
		}
	});

	test("un numéro valide se relit", () => {
		expect(numeroDePlanche("pages#313")).toBe(313);
	});
});
