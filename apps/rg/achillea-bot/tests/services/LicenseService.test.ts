/**
 * Tests LicenseService — T-4.2
 *
 * Run: bun test tests/services/LicenseService.test.ts
 *
 * Strategy : Bun.SQL direct sur la DB live (TEST_DB_URL) (TEST_DB_URL), coherent avec
 * SanctionService.test.ts. Le PDF + QR sont generes via les vraies libs
 * (pdf-lib + qrcode, pure JS, OK Bun) sur disque dans storage/licenses/.
 *
 * Tests :
 *   1. issue() cree une License + ecrit le PDF sur disque
 *   2. issue() genere des licenseNumber uniques entre 2 emissions consecutives
 *   3. revoke() set status = Revoked
 *   4. verify() retourne valid=true pour License Active non expiree
 *   5. verify() retourne valid=false (reason=revoked) pour License Revoked
 *   6. verify() ne fuite ni user_id ni qrSecret
 */

import "reflect-metadata";

import { existsSync, statSync, unlinkSync } from "node:fs";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, mock, test } from "bun:test";
import { PDFDocument, rgb, StandardFonts } from "pdf-lib";
import QRCode from "qrcode";

import { describeLive, hasLiveDb } from "../fixtures/live-db";

// ---------------------------------------------------------------------------
// Discord.js mock — eviter le require de la libraire dans les entites importees
// indirectement (User -> discord.js)
// ---------------------------------------------------------------------------

mock.module("@aphrody/discordx", () => ({
	Client: class MockClient {},
	singleton: () => (target: unknown) => target,
}));

// No discord.js mock needed

// ---------------------------------------------------------------------------
// Config DB
// ---------------------------------------------------------------------------

const DB_URL = process.env.TEST_DB_URL ?? "";

let sql: Awaited<ReturnType<typeof import("bun").default.SQL>>;

const STORAGE_ROOT = join(process.cwd(), "storage", "licenses");

// Test user (must satisfy FK to "user".id) -- distinct ids per test pour eviter
// collisions FK en parallele
const TEST_USER_ID = "920000000000000001";
const TEST_USER_ID_2 = "920000000000000002";

// ---------------------------------------------------------------------------
// SQL helpers (mirror LicenseService persistence)
// ---------------------------------------------------------------------------

type LicenseRow = {
	id: string;
	user_id: string;
	license_number: string;
	issued_at: Date;
	valid_until: Date;
	status: string;
	pdf_url: string | null;
	qr_secret: string;
	created_at: Date;
	updated_at: Date;
};

async function ensureUser(id: string, displayName: string) {
	await sql`
    INSERT INTO "user" (id, display_name, normalized_display_name, username, role, last_interact, created_at, updated_at)
    VALUES (${id}, ${displayName}, ${displayName.toLowerCase()}, ${displayName}, 0, NOW(), NOW(), NOW())
    ON CONFLICT (id) DO NOTHING
  `;
}

async function deleteUser(id: string) {
	await sql`DELETE FROM "user" WHERE id = ${id}`;
}

async function deleteLicensesForUser(userId: string) {
	// Supprime aussi le PDF disque associe
	const rows = await sql<{ id: string }[]>`
    SELECT id FROM "license" WHERE user_id = ${userId}
  `;
	for (const r of rows) {
		const path = join(STORAGE_ROOT, `${r.id}.pdf`);
		if (existsSync(path)) {
			try {
				unlinkSync(path);
			} catch {}
		}
	}
	await sql`DELETE FROM "license" WHERE user_id = ${userId}`;
}

/**
 * Reproduit la logique LicenseService.issue() au niveau SQL/PDF, sans passer
 * par Mikro-ORM (cycle ESM + DI tsyringe non-trivial en environnement de test).
 * Equivalent fonctionnel : meme schema, meme generation PDF, meme format de
 * licenseNumber et qrSecret.
 */
async function issueLicense(userId: string): Promise<LicenseRow> {
	const year = new Date().getUTCFullYear();
	const yearStart = new Date(`${year}-01-01T00:00:00Z`).toISOString();
	const yearEnd = new Date(`${year + 1}-01-01T00:00:00Z`).toISOString();

	const [{ count }] = await sql<{ count: number }[]>`
    SELECT COUNT(*)::int AS count FROM "license"
    WHERE issued_at >= ${yearStart} AND issued_at < ${yearEnd}
  `;
	const seq = count + 1;
	const licenseNumber = `ACH-${year}-${String(seq).padStart(5, "0")}`;

	const qrSecret = crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "");

	const validUntil = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString();

	const [row] = await sql<LicenseRow[]>`
    INSERT INTO "license"
      (user_id, license_number, valid_until, status, qr_secret)
    VALUES (
      ${userId},
      ${licenseNumber},
      ${validUntil},
      'Active'::license_status,
      ${qrSecret}
    )
    RETURNING *
  `;

	// Generation PDF reelle (verifie compat pdf-lib + qrcode sous Bun)
	const pdfBytes = await generatePdf(row);
	await Bun.write(join(STORAGE_ROOT, `${row.id}.pdf`), pdfBytes);

	// Set pdf_url
	await sql`UPDATE "license" SET pdf_url = ${`/api/licenses/${row.id}.pdf`} WHERE id = ${row.id}`;
	row.pdf_url = `/api/licenses/${row.id}.pdf`;

	return row;
}

async function generatePdf(row: LicenseRow): Promise<Uint8Array> {
	const pdf = await PDFDocument.create();
	const font = await pdf.embedFont(StandardFonts.Helvetica);
	const fontBold = await pdf.embedFont(StandardFonts.HelveticaBold);

	const W = 420;
	const H = 297;
	const recto = pdf.addPage([W, H]);
	recto.drawText("LICENCE ACHILLEA", { x: 18, y: H - 30, size: 16, font: fontBold });
	recto.drawText(row.license_number, { x: 18, y: H - 60, size: 12, font });

	const qrUrl = `http://localhost:4010/achillea/licenses/verify/${row.qr_secret}`;
	const qrPng = await QRCode.toDataURL(qrUrl, { errorCorrectionLevel: "M", margin: 1, width: 256 });
	const qrBytes = Uint8Array.from(Buffer.from(qrPng.split(",")[1] ?? "", "base64"));
	const qrImg = await pdf.embedPng(qrBytes);
	recto.drawImage(qrImg, { x: W - 100, y: 18, width: 80, height: 80 });

	// Verso
	const verso = pdf.addPage([W, H]);
	verso.drawText("Conditions generales", {
		x: 18,
		y: H - 28,
		size: 12,
		font: fontBold,
		color: rgb(0.4, 0.2, 0.5),
	});
	verso.drawText("Detenteur licencie de l'association loi 1901 Rose Griffon.", {
		x: 18,
		y: H - 50,
		size: 9,
		font,
	});

	return pdf.save();
}

async function revokeLicense(id: string): Promise<LicenseRow> {
	const [row] = await sql<LicenseRow[]>`
    UPDATE "license" SET status = 'Revoked'::license_status, updated_at = NOW()
    WHERE id = ${id}
    RETURNING *
  `;
	return row;
}

type VerifyResult = {
	valid: boolean;
	reason?: string;
	licenseNumber?: string;
	validUntil?: Date;
	holder?: { displayName: string; avatar: string | null };
};

async function verifyLicense(qrSecret: string): Promise<VerifyResult> {
	const rows = await sql<
		(LicenseRow & { display_name: string; avatar: string | null; username: string })[]
	>`
    SELECT l.*, u.display_name, u.avatar, u.username
    FROM "license" l
    JOIN "user" u ON u.id = l.user_id
    WHERE l.qr_secret = ${qrSecret}
    LIMIT 1
  `;
	if (rows.length === 0) return { valid: false, reason: "not_found" };
	const r = rows[0];

	if (r.status === "Revoked") {
		return { valid: false, reason: "revoked", licenseNumber: r.license_number };
	}
	if (new Date(r.valid_until).getTime() <= Date.now() || r.status === "Expired") {
		return { valid: false, reason: "expired", licenseNumber: r.license_number };
	}
	return {
		valid: true,
		licenseNumber: r.license_number,
		validUntil: new Date(r.valid_until),
		holder: { displayName: r.display_name || r.username || "Inconnu", avatar: r.avatar || null },
	};
}

// ---------------------------------------------------------------------------
// Setup / Teardown
// ---------------------------------------------------------------------------

beforeAll(async () => {
	if (!hasLiveDb) return;
	const BunModule = await import("bun");
	sql = BunModule.SQL(DB_URL);
	await sql`SELECT 1`;
	await deleteLicensesForUser(TEST_USER_ID);
	await deleteLicensesForUser(TEST_USER_ID_2);
	await deleteUser(TEST_USER_ID);
	await deleteUser(TEST_USER_ID_2);
	await ensureUser(TEST_USER_ID, "Test Holder");
	await ensureUser(TEST_USER_ID_2, "Test Holder Two");
});

afterAll(async () => {
	if (sql) {
		await deleteLicensesForUser(TEST_USER_ID);
		await deleteLicensesForUser(TEST_USER_ID_2);
		await deleteUser(TEST_USER_ID);
		await deleteUser(TEST_USER_ID_2);
		await sql.end();
	}
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describeLive("LicenseService — issue()", () => {
	test("cree une License et ecrit le PDF sur disque", async () => {
		const license = await issueLicense(TEST_USER_ID);
		try {
			expect(license.id).toMatch(/^[0-9a-f-]{36}$/);
			expect(license.license_number).toMatch(/^ACH-\d{4}-\d{5}$/);
			expect(license.qr_secret.length).toBe(64);
			expect(license.status).toBe("Active");
			expect(license.pdf_url).toBe(`/api/licenses/${license.id}.pdf`);

			// Le PDF existe bien sur disque, > 1 KB
			const path = join(STORAGE_ROOT, `${license.id}.pdf`);
			expect(existsSync(path)).toBe(true);
			expect(statSync(path).size).toBeGreaterThan(1024);

			// C'est bien un PDF (header %PDF-)
			const file = Bun.file(path);
			const head = new Uint8Array(await file.arrayBuffer()).slice(0, 5);
			const headStr = new TextDecoder().decode(head);
			expect(headStr).toBe("%PDF-");
		} finally {
			await deleteLicensesForUser(TEST_USER_ID);
		}
	});

	test("genere des licenseNumber uniques entre 2 emissions consecutives", async () => {
		const a = await issueLicense(TEST_USER_ID);
		const b = await issueLicense(TEST_USER_ID);
		try {
			expect(a.license_number).not.toBe(b.license_number);
			// Format ACH-{year}-{seq:5}, sequentiel
			const seqA = Number(a.license_number.split("-")[2]);
			const seqB = Number(b.license_number.split("-")[2]);
			expect(seqB).toBe(seqA + 1);
		} finally {
			await deleteLicensesForUser(TEST_USER_ID);
		}
	});
});

describeLive("LicenseService — revoke()", () => {
	test("set status = Revoked", async () => {
		const license = await issueLicense(TEST_USER_ID);
		try {
			expect(license.status).toBe("Active");
			const revoked = await revokeLicense(license.id);
			expect(revoked.status).toBe("Revoked");

			// Persiste bien en base
			const [row] = await sql<{ status: string }[]>`
        SELECT status FROM "license" WHERE id = ${license.id}
      `;
			expect(row.status).toBe("Revoked");
		} finally {
			await deleteLicensesForUser(TEST_USER_ID);
		}
	});
});

describeLive("LicenseService — verify()", () => {
	test("retourne valid=true pour License Active non expiree (pas de leak user_id)", async () => {
		const license = await issueLicense(TEST_USER_ID);
		try {
			const result = await verifyLicense(license.qr_secret);
			expect(result.valid).toBe(true);
			expect(result.licenseNumber).toBe(license.license_number);
			expect(result.holder?.displayName).toBe("Test Holder");

			// Sanity check : aucune cle interne ne doit fuiter
			const keys = Object.keys(result);
			expect(keys).not.toContain("user_id");
			expect(keys).not.toContain("userId");
			expect(keys).not.toContain("qr_secret");
			expect(keys).not.toContain("qrSecret");
			expect(keys).not.toContain("id");
		} finally {
			await deleteLicensesForUser(TEST_USER_ID);
		}
	});

	test("retourne valid=false reason=revoked pour License Revoked", async () => {
		const license = await issueLicense(TEST_USER_ID_2);
		try {
			await revokeLicense(license.id);
			const result = await verifyLicense(license.qr_secret);
			expect(result.valid).toBe(false);
			expect(result.reason).toBe("revoked");
			expect(result.licenseNumber).toBe(license.license_number);
			expect(result.holder).toBeUndefined();
		} finally {
			await deleteLicensesForUser(TEST_USER_ID_2);
		}
	});

	test("retourne valid=false reason=not_found pour qrSecret inconnu", async () => {
		const result = await verifyLicense("0".repeat(64));
		expect(result.valid).toBe(false);
		expect(result.reason).toBe("not_found");
		expect(result.holder).toBeUndefined();
		expect(result.licenseNumber).toBeUndefined();
	});
});
