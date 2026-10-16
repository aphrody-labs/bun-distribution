import type { Kysely } from "kysely";
import type { Database } from "@rosegriffon/db/schema";

export abstract class LicenseService {
  static async findLatestForUser(db: Kysely<Database>, userId: string) {
    const row = await db
      .selectFrom("license")
      .selectAll()
      .where("user_id", "=", userId)
      .orderBy("issued_at", "desc")
      .executeTakeFirst();
    if (!row) return { license: null, verificationToken: null };
    return {
      license: {
        id: row.id,
        userId: row.user_id,
        licenseNumber: row.license_number,
        issuedAt: row.issued_at.toISOString(),
        validUntil: row.valid_until.toISOString(),
        status: row.status,
        pdfUrl: row.pdf_url,
        createdAt: row.created_at.toISOString(),
        updatedAt: row.updated_at.toISOString(),
      },
      // This token is a public-verification bearer secret. It is returned only
      // by the authenticated /me endpoint to the license owner.
      verificationToken: row.qr_secret,
    };
  }

  static async verify(db: Kysely<Database>, qrSecret: string) {
    const row = await db
      .selectFrom("license")
      .innerJoin("user", "user.id", "license.user_id")
      .select([
        "license.license_number",
        "license.valid_until",
        "license.status",
        "license.qr_secret",
        "user.display_name",
        "user.username",
        "user.avatar",
      ])
      .where("license.qr_secret", "=", qrSecret)
      .executeTakeFirst();
    if (!row) return { valid: false as const, reason: "not_found" as const };
    if (row.status === "Revoked")
      return {
        valid: false as const,
        reason: "revoked" as const,
        licenseNumber: row.license_number,
      };
    if (row.status === "Expired" || row.valid_until.getTime() <= Date.now()) {
      return {
        valid: false as const,
        reason: "expired" as const,
        licenseNumber: row.license_number,
      };
    }
    return {
      valid: true as const,
      licenseNumber: row.license_number,
      validUntil: row.valid_until.toISOString(),
      holder: { displayName: row.display_name || row.username || "Inconnu", avatar: row.avatar },
    };
  }
}
