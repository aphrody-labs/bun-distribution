import { mkdir } from "node:fs/promises";
import { join } from "node:path";

import { formatLicenseNumber, generateQrSecret, LICENSE_VALIDITY_MS } from "@rosegriffon/achillea-core";
import { PDFDocument, rgb, StandardFonts } from "pdf-lib";
import QRCode from "qrcode";
import type { Generated, Kysely } from "kysely";
import { singleton } from "tsyringe";

import { createAchilleaSql } from "@rosegriffon/db/achillea-sql";
import { urlsConfig } from "@/configs";
import { LicenseStatus } from "@/utils/enums";

interface LicenseDatabase {
	license: {
		id: Generated<string>;
		user_id: string;
		license_number: string;
		issued_at: Generated<Date>;
		valid_until: Date;
		status: string;
		pdf_url: string | null;
		qr_secret: string;
		created_at: Generated<Date>;
		updated_at: Generated<Date>;
	};
	user: {
		id: string;
		display_name: string | null;
		username: string | null;
		avatar: string | null;
		role: number;
	};
}

const sql = createAchilleaSql<LicenseDatabase>() as Kysely<LicenseDatabase>;

type LicenseRow = Omit<LicenseDatabase["license"], "id" | "issued_at" | "created_at" | "updated_at"> & {
	id: string;
	issued_at: Date;
	created_at: Date;
	updated_at: Date;
};

export interface LicenseRecord {
	id: string;
	user: { id: string; displayName: string | null; username: string | null; avatar: string | null };
	licenseNumber: string;
	issuedAt: Date;
	validUntil: Date;
	status: LicenseStatus;
	pdfUrl: string | null;
	qrSecret: string;
	createdAt: Date;
	updatedAt: Date;
}

/** Storage root for generated PDFs (relative to apps/achillea-bot/). */
const STORAGE_ROOT = join(process.cwd(), "storage", "licenses");

/** Public verification base URL (source unique : src/configs/urls.ts). */
const VERIFY_BASE_URL = urlsConfig.licenseVerify;

/** License validity duration (1 year). */
const VALIDITY_MS = LICENSE_VALIDITY_MS;

export interface VerifyResult {
	valid: boolean;
	reason?: "not_found" | "revoked" | "expired";
	licenseNumber?: string;
	validUntil?: Date;
	holder?: { displayName: string; avatar: string | null };
}

@singleton()
export class LicenseService {
	private readonly db = sql;

	async findLatestForUser(userId: string): Promise<LicenseRecord | null> {
		const row = await this.db.selectFrom("license").selectAll().where("user_id", "=", userId).orderBy("issued_at", "desc").executeTakeFirst();
		if (!row) return null;
		const user = await this.db.selectFrom("user").select(["id", "display_name", "username", "avatar"]).where("id", "=", userId).executeTakeFirstOrThrow();
		return this.toRecord(row, user);
	}

	async findById(id: string): Promise<LicenseRecord | null> {
		const row = await this.db.selectFrom("license").selectAll().where("id", "=", id).executeTakeFirst();
		if (!row) return null;
		const user = await this.db.selectFrom("user").select(["id", "display_name", "username", "avatar"]).where("id", "=", row.user_id).executeTakeFirstOrThrow();
		return this.toRecord(row, user);
	}

	async isAdministrator(userId: string): Promise<boolean> {
		const user = await this.db.selectFrom("user").select("role").where("id", "=", userId).executeTakeFirst();
		return Boolean(user && user.role >= 2);
	}

	// issue

	/**
	 * Issues a new license for a user. Generates a PDF written under
	 * `storage/licenses/<id>.pdf`, persists License and returns it.
	 *
	 * - licenseNumber : `ACH-{year}-{seq:5}` (seq = count(year) + 1)
	 * - qrSecret      : 64 random hex chars (2 × randomUUID stripped)
	 * - validUntil    : +1 an
	 * - pdfUrl        : `/api/licenses/<id>.pdf` (endpoint API qui stream le fichier)
	 */
	async issue(userId: string): Promise<LicenseRecord> {
		const user = await this.db.selectFrom("user").select(["id", "display_name", "username", "avatar"]).where("id", "=", userId).executeTakeFirstOrThrow();

		const year = new Date().getFullYear();
		const yearStart = new Date(`${year}-01-01T00:00:00Z`);
		const yearEnd = new Date(`${year + 1}-01-01T00:00:00Z`);
		const seqRow = await this.db
			.selectFrom("license")
			.select(({ fn }) => fn.count<string>("id").as("count"))
			.where("issued_at", ">=", yearStart)
			.where("issued_at", "<", yearEnd)
			.executeTakeFirstOrThrow();
		const seq = Number(seqRow.count) + 1;
		const licenseNumber = formatLicenseNumber(year, seq);

		// 64 hex chars via Web Crypto (logique pure @rosegriffon/achillea-core).
		const qrSecret = generateQrSecret();

		const validUntil = new Date(Date.now() + VALIDITY_MS);
		const row = await this.db.insertInto("license").values({
			user_id: user.id,
			license_number: licenseNumber,
			valid_until: validUntil,
			status: LicenseStatus.Active,
			pdf_url: null,
			qr_secret: qrSecret,
		}).returningAll().executeTakeFirstOrThrow();
		const license: LicenseRecord = this.toRecord(row, user);

		// Generate + write PDF to storage
		const pdfBytes = await this.generatePdf(license, {
			displayName: user.display_name || user.username || `User#${user.id}`,
			avatar: user.avatar || null,
		});
		await mkdir(STORAGE_ROOT, { recursive: true });
		const pdfPath = join(STORAGE_ROOT, `${license.id}.pdf`);
		await Bun.write(pdfPath, pdfBytes);

		license.pdfUrl = `/api/licenses/${license.id}.pdf`;
		const updated = await this.db.updateTable("license").set({ pdf_url: license.pdfUrl }).where("id", "=", license.id).returningAll().executeTakeFirstOrThrow();
		license.updatedAt = updated.updated_at;

		return license;
	}

	// revoke

	/** Revokes a license (sets status = Revoked). */
	async revoke(licenseId: string, _by: string): Promise<LicenseRecord> {
		const row = await this.db.updateTable("license").set({ status: LicenseStatus.Revoked }).where("id", "=", licenseId).returningAll().executeTakeFirstOrThrow();
		const user = await this.db.selectFrom("user").select(["id", "display_name", "username", "avatar"]).where("id", "=", row.user_id).executeTakeFirstOrThrow();
		return this.toRecord(row, user);
	}

	// verify

	/**
	 * Public verification : never leaks user_id nor License internals.
	 * Returns a sanitized result with valid/holder/licenseNumber/validUntil only.
	 */
	async verify(qrSecret: string): Promise<VerifyResult> {
		const license = await this.db
			.selectFrom("license")
			.innerJoin("user", "user.id", "license.user_id")
			.select([
				"license.id", "license.license_number", "license.valid_until", "license.status",
				"user.display_name", "user.username", "user.avatar",
			])
			.where("license.qr_secret", "=", qrSecret)
			.executeTakeFirst();

		if (!license) return { valid: false, reason: "not_found" };

		if (license.status === LicenseStatus.Revoked) {
			return {
				valid: false,
				reason: "revoked",
				licenseNumber: license.license_number,
			};
		}

		if (license.valid_until.getTime() <= Date.now() || license.status === LicenseStatus.Expired) {
			return {
				valid: false,
				reason: "expired",
				licenseNumber: license.license_number,
			};
		}

		return {
			valid: true,
			licenseNumber: license.license_number,
			validUntil: license.valid_until,
			holder: {
				displayName: license.display_name || license.username || "Inconnu",
				avatar: license.avatar || null,
			},
		};
	}

	private toRecord(row: LicenseRow, user: Pick<LicenseDatabase["user"], "id" | "display_name" | "username" | "avatar">): LicenseRecord {
		return {
			id: row.id,
			user: { id: user.id, displayName: user.display_name, username: user.username, avatar: user.avatar },
			licenseNumber: row.license_number,
			issuedAt: row.issued_at,
			validUntil: row.valid_until,
			status: row.status as LicenseStatus,
			pdfUrl: row.pdf_url,
			qrSecret: row.qr_secret,
			createdAt: row.created_at,
			updatedAt: row.updated_at,
		};
	}

	// generatePdf — pdf-lib (pure JS, Bun OK)

	/**
	 * Génère un PDF 2 pages (recto / verso) au format A6 paysage (148×105 mm).
	 * - Recto : titre, licenseNumber, displayName, validité, photo (avatar Discord
	 *   ou placeholder gris), QR code vers /achillea/licenses/verify/{qrSecret}.
	 * - Verso : conditions générales courtes.
	 */
	async generatePdf(
		license: LicenseRecord,
		holder: { displayName: string; avatar: string | null }
	): Promise<Uint8Array> {
		const pdf = await PDFDocument.create();
		pdf.setTitle(`Licence Achilléa — ${license.licenseNumber}`);
		pdf.setAuthor("Association Rose Griffon");
		pdf.setSubject("Licence joueur Achilléa");
		pdf.setProducer("achillea-bot LicenseService");

		const font = await pdf.embedFont(StandardFonts.Helvetica);
		const fontBold = await pdf.embedFont(StandardFonts.HelveticaBold);

		// A6 landscape, in points (1 mm = 2.835 pt)
		const W = 420;
		const H = 297;

		// ------------------------- Recto -------------------------
		const recto = pdf.addPage([W, H]);

		// Bordure
		recto.drawRectangle({
			x: 8,
			y: 8,
			width: W - 16,
			height: H - 16,
			borderColor: rgb(0.45, 0.18, 0.5),
			borderWidth: 2,
		});

		// Bandeau titre
		recto.drawRectangle({
			x: 8,
			y: H - 50,
			width: W - 16,
			height: 42,
			color: rgb(0.45, 0.18, 0.5),
		});
		recto.drawText("LICENCE ACHILLÉA", {
			x: 18,
			y: H - 32,
			size: 18,
			font: fontBold,
			color: rgb(1, 1, 1),
		});
		recto.drawText("Association loi 1901 — Rose Griffon", {
			x: 18,
			y: H - 46,
			size: 8,
			font,
			color: rgb(1, 1, 1),
		});

		// Photo / placeholder
		const photoX = 18;
		const photoY = 60;
		const photoW = 90;
		const photoH = 110;
		let embedded = false;
		if (holder.avatar) {
			try {
				const res = await fetch(holder.avatar, { signal: AbortSignal.timeout(5000) });
				if (res.ok) {
					const buf = new Uint8Array(await res.arrayBuffer());
					const ct = res.headers.get("content-type") ?? "";
					const img = ct.includes("png") ? await pdf.embedPng(buf) : await pdf.embedJpg(buf);
					recto.drawImage(img, { x: photoX, y: photoY, width: photoW, height: photoH });
					embedded = true;
				}
			} catch {
				// Fallback to placeholder
			}
		}
		if (!embedded) {
			recto.drawRectangle({
				x: photoX,
				y: photoY,
				width: photoW,
				height: photoH,
				color: rgb(0.85, 0.85, 0.88),
				borderColor: rgb(0.6, 0.6, 0.65),
				borderWidth: 1,
			});
			recto.drawText("PHOTO", {
				x: photoX + 28,
				y: photoY + 50,
				size: 10,
				font,
				color: rgb(0.4, 0.4, 0.45),
			});
		}

		// Champs texte
		const txtX = photoX + photoW + 16;
		const lineH = 14;
		let y = H - 70;
		recto.drawText("Détenteur", { x: txtX, y, size: 8, font, color: rgb(0.45, 0.18, 0.5) });
		y -= lineH;
		recto.drawText(holder.displayName, { x: txtX, y, size: 13, font: fontBold });
		y -= lineH + 4;
		recto.drawText("N° de licence", { x: txtX, y, size: 8, font, color: rgb(0.45, 0.18, 0.5) });
		y -= lineH;
		recto.drawText(license.licenseNumber, { x: txtX, y, size: 12, font: fontBold });
		y -= lineH + 4;
		recto.drawText("Valide jusqu'au", { x: txtX, y, size: 8, font, color: rgb(0.45, 0.18, 0.5) });
		y -= lineH;
		recto.drawText(license.validUntil.toISOString().slice(0, 10), {
			x: txtX,
			y,
			size: 11,
			font,
		});

		// QR code
		const qrUrl = `${VERIFY_BASE_URL}/${license.qrSecret}`;
		const qrPngDataUrl = await QRCode.toDataURL(qrUrl, {
			errorCorrectionLevel: "M",
			margin: 1,
			width: 256,
		});
		const qrPngBytes = Uint8Array.from(Buffer.from(qrPngDataUrl.split(",")[1] ?? "", "base64"));
		const qrImg = await pdf.embedPng(qrPngBytes);
		const qrSize = 80;
		recto.drawImage(qrImg, {
			x: W - qrSize - 18,
			y: 18,
			width: qrSize,
			height: qrSize,
		});
		recto.drawText("Scanner pour vérifier", {
			x: W - qrSize - 18,
			y: 12,
			size: 6,
			font,
			color: rgb(0.4, 0.4, 0.45),
		});

		// ------------------------- Verso -------------------------
		const verso = pdf.addPage([W, H]);
		verso.drawRectangle({
			x: 8,
			y: 8,
			width: W - 16,
			height: H - 16,
			borderColor: rgb(0.45, 0.18, 0.5),
			borderWidth: 2,
		});
		verso.drawText("Conditions générales", {
			x: 18,
			y: H - 28,
			size: 12,
			font: fontBold,
			color: rgb(0.45, 0.18, 0.5),
		});

		const conditions = [
			"Détenteur licencié de l'association loi 1901 Rose Griffon.",
			"Cette licence personnelle et non transférable atteste de",
			"la qualité de membre actif pour la saison en cours.",
			"",
			"Toute personne peut vérifier la validité de la licence en",
			"scannant le QR code au verso. Le résultat de vérification",
			"indique uniquement la validité, le numéro et le détenteur.",
			"",
			"En cas de perte ou de révocation, contacter l'association",
			`via le canal officiel Discord ou ${urlsConfig.websiteHost}.`,
		];
		let cy = H - 56;
		for (const line of conditions) {
			verso.drawText(line, { x: 18, y: cy, size: 9, font });
			cy -= 13;
		}

		verso.drawText(`N° licence : ${license.licenseNumber}`, {
			x: 18,
			y: 22,
			size: 8,
			font,
			color: rgb(0.4, 0.4, 0.45),
		});
		verso.drawText(`Émis le : ${license.issuedAt.toISOString().slice(0, 10)}`, {
			x: 18,
			y: 12,
			size: 8,
			font,
			color: rgb(0.4, 0.4, 0.45),
		});

		return pdf.save();
	}
}
