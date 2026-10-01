import { describe, expect, it } from "bun:test";
import type { Kysely } from "kysely";
import type { Database } from "@rosegriffon/db/schema";
import { LicenseService } from "../src/api/modules/achillea/licenses/service";

describe("license verification token ownership", () => {
	it("returns the QR bearer token only in the owner-scoped /me projection", async () => {
		const qrSecret = "a".repeat(64);
		const row = {
			id: "license-1",
			user_id: "discord-owner",
			license_number: "RG-2026-001",
			issued_at: new Date("2026-01-01T00:00:00.000Z"),
			valid_until: new Date("2027-01-01T00:00:00.000Z"),
			status: "Active",
			pdf_url: null,
			qr_secret: qrSecret,
			created_at: new Date("2026-01-01T00:00:00.000Z"),
			updated_at: new Date("2026-01-01T00:00:00.000Z"),
		};
		let requestedUserId: string | undefined;
		const query = {
			selectAll: () => query,
			where: (column: string, operator: string, value: string) => {
				expect([column, operator]).toEqual(["user_id", "="]);
				requestedUserId = value;
				return query;
			},
			orderBy: () => query,
			executeTakeFirst: async () => row,
		};
		const db = {
			selectFrom: (table: string) => {
				expect(table).toBe("license");
				return query;
			},
		} as unknown as Kysely<Database>;

		const result = await LicenseService.findLatestForUser(db, "discord-owner");
		expect(requestedUserId).toBe("discord-owner");
		expect(result).toMatchObject({
			license: { id: "license-1", pdfUrl: null },
			verificationToken: qrSecret,
		});
		expect(result.license).not.toHaveProperty("qr_secret");
	});

	it("returns no token when the authenticated user has no license", async () => {
		const query = {
			selectAll: () => query,
			where: () => query,
			orderBy: () => query,
			executeTakeFirst: async () => undefined,
		};
		const db = { selectFrom: () => query } as unknown as Kysely<Database>;

		expect(await LicenseService.findLatestForUser(db, "discord-owner")).toEqual({
			license: null,
			verificationToken: null,
		});
	});
});
