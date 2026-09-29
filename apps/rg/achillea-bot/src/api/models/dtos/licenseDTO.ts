import { Exclude, Expose } from "class-transformer";

import type { LicenseStatus } from "@/utils/enums";

/**
 * Full License DTO — used for admin endpoints (CookieAuthorize required).
 * Never expose `qrSecret` (would let anyone impersonate verification of this license).
 */
@Exclude()
export class LicenseDTO {
	@Expose() id!: string;
	@Expose() userId!: string;
	@Expose() licenseNumber!: string;
	@Expose() issuedAt!: Date;
	@Expose() validUntil!: Date;
	@Expose() status!: LicenseStatus;
	@Expose() pdfUrl!: string | null;
	@Expose() createdAt!: Date;
	@Expose() updatedAt!: Date;
}

/**
 * Public verification DTO — returned by the unauthenticated GET /verify/:qrSecret.
 * Never includes user_id, qrSecret or any internal License fields.
 */
@Exclude()
export class LicenseVerifyDTO {
	@Expose() valid!: boolean;
	@Expose() reason?: "not_found" | "revoked" | "expired";
	@Expose() licenseNumber?: string;
	@Expose() validUntil?: Date;
	@Expose() holder?: { displayName: string; avatar: string | null };
}
