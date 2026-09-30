/**
 * Tests de l'ingest d'assets — exerce le catalogue réel + download réel
 * dans un répertoire temporaire (pas de hardcode de tailles inventées).
 */
import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { mkdir, rm, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { existsSync } from "node:fs";
import {
	SFX_CATALOG,
	CANONICAL_SFX_SLOTS,
	catalogHasRole,
	catalogRoles,
} from "../scripts/asset-catalog";
import {
	ingestSfx,
	applyCanonicalSlots,
	writeInventory,
	type InventoryRecord,
} from "../scripts/ingest-official-assets";

const TMP = join(import.meta.dir, "..", ".tmp-asset-ingest-test");

beforeAll(async () => {
	if (existsSync(TMP)) await rm(TMP, { recursive: true, force: true });
	await mkdir(TMP, { recursive: true });
});

afterAll(async () => {
	if (existsSync(TMP)) await rm(TMP, { recursive: true, force: true });
});

describe("asset-catalog", () => {
	test("catalogue SFX non vide avec rôles canoniques", () => {
		expect(SFX_CATALOG.length).toBeGreaterThan(10);
		expect(catalogHasRole("teleport")).toBe(true);
		expect(catalogHasRole("kamehameha")).toBe(true);
		expect(catalogHasRole("kiCharge")).toBe(true);
		expect(catalogRoles().length).toBeGreaterThan(5);
		expect(CANONICAL_SFX_SLOTS.teleport).toBe("teleport.mp3");
		expect(CANONICAL_SFX_SLOTS.kamehameha).toBe("kamehameha.mp3");
	});

	test("chaque entrée a URL myinstants + filename .mp3", () => {
		for (const e of SFX_CATALOG) {
			expect(e.filename.endsWith(".mp3")).toBe(true);
			expect(e.url.startsWith("https://")).toBe(true);
			expect(e.role.length).toBeGreaterThan(0);
		}
	});
});

describe("ingestSfx (réseau réel)", () => {
	test("télécharge ≥1 MP3 valide dans un tmp dir", async () => {
		const sfxDir = join(TMP, "sfx");
		await mkdir(sfxDir, { recursive: true });
		// Sous-ensemble fiable (prouvés 200 en probe)
		const mini = SFX_CATALOG.filter((e) =>
			["teleport.mp3", "kamehameha.mp3", "click.mp3", "hit.mp3"].includes(e.filename)
		);
		expect(mini.length).toBeGreaterThanOrEqual(3);

		const records = await ingestSfx(mini, { force: true, sfxDir });
		const ok = records.filter((r: InventoryRecord) => r.ok);
		expect(ok.length).toBeGreaterThanOrEqual(1);

		// Fichiers réels non vides
		const files = await readdir(sfxDir);
		const mp3 = files.filter((f) => f.endsWith(".mp3"));
		expect(mp3.length).toBeGreaterThanOrEqual(1);
		for (const f of mp3) {
			const st = await stat(join(sfxDir, f));
			expect(st.size).toBeGreaterThan(800);
		}

		await applyCanonicalSlots(sfxDir);
		// teleport slot doit exister après apply
		const tele = join(sfxDir, "teleport.mp3");
		expect(existsSync(tele)).toBe(true);
		expect((await stat(tele)).size).toBeGreaterThan(800);

		const invPath = join(TMP, "inv.json");
		const summary = await writeInventory(records, invPath);
		expect(summary.ok).toBe(ok.length);
		expect(existsSync(invPath)).toBe(true);
		const inv = JSON.parse(await Bun.file(invPath).text()) as {
			summary: { ok: number };
			records: InventoryRecord[];
		};
		expect(inv.summary.ok).toBe(ok.length);
		expect(inv.records.length).toBe(records.length);
	}, 120_000);
});
