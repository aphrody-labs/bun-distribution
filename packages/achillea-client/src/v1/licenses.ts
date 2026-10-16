/**
 * `/licenses` — licences joueur : émission, révocation, PDF, vérification QR.
 */

import { z } from "zod";

import type { License, LicenseVerifyReason, LicenseVerifyResult } from "@rosegriffon/achillea-types/domain/license";
import { LicenseStatus } from "@rosegriffon/achillea-types/enums/license";

import { AchilleaResource, encodePathSegment, type AchilleaClientResult } from "./http";
import type { LicenseHolderResponse } from "./pending-contracts";

export const licenseStatusSchema = z.enum(LicenseStatus) satisfies z.ZodType<LicenseStatus>;

export const licenseVerifyReasonSchema = z.enum([
  "not_found",
  "revoked",
  "expired",
]) satisfies z.ZodType<LicenseVerifyReason>;

export const licenseSchema = z.object({
  id: z.string(),
  userId: z.string(),
  licenseNumber: z.string(),
  issuedAt: z.string(),
  validUntil: z.string(),
  status: licenseStatusSchema,
  pdfUrl: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
}) satisfies z.ZodType<License>;

export const licenseHolderResponseSchema = z.object({
  license: licenseSchema.nullable(),
  verificationToken: z.string().nullable(),
}) satisfies z.ZodType<LicenseHolderResponse>;

export const licenseVerifyResultSchema = z.object({
  valid: z.boolean(),
  reason: licenseVerifyReasonSchema.optional(),
  licenseNumber: z.string().optional(),
  validUntil: z.string().optional(),
  holder: z.object({ displayName: z.string(), avatar: z.string().nullable() }).optional(),
}) satisfies z.ZodType<LicenseVerifyResult>;

/** 5 routes. */
export class LicensesResource extends AchilleaResource {
  /** `GET /licenses/me` — licence la plus récente du compte connecté. */
  mine(): Promise<AchilleaClientResult<LicenseHolderResponse>> {
    return this.http.get("/licenses/me", licenseHolderResponseSchema);
  }

  /** `POST /licenses/issue/:userId` — émet une licence (administrateurs). */
  issue(userId: string): Promise<AchilleaClientResult<License>> {
    return this.http.post(`/licenses/issue/${encodePathSegment(userId)}`, licenseSchema);
  }

  /** `POST /licenses/:id/revoke` — révoque une licence (administrateurs). */
  revoke(id: string): Promise<AchilleaClientResult<License>> {
    return this.http.post(`/licenses/${encodePathSegment(id)}/revoke`, licenseSchema);
  }

  /** URL de `GET /licenses/:id.pdf` — PDF imprimable, route publique. */
  pdfUrl(id: string): string {
    return this.http.url(`/licenses/${encodePathSegment(id)}.pdf`);
  }

  /** `GET /licenses/:id.pdf` — PDF de la licence. */
  pdf(id: string): Promise<AchilleaClientResult<ArrayBuffer>> {
    return this.http.requestBytes(`/licenses/${encodePathSegment(id)}.pdf`, {
      accept: "application/pdf",
    });
  }

  /** `GET /licenses/verify/:qrSecret` — vérification publique, réponse assainie. */
  verify(qrSecret: string): Promise<AchilleaClientResult<LicenseVerifyResult>> {
    return this.http.get(`/licenses/verify/${encodePathSegment(qrSecret)}`, licenseVerifyResultSchema);
  }
}
