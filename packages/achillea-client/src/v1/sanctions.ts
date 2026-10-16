/**
 * `/sanctions` — journal de modération cross-serveurs.
 */

import { z } from "zod";

import type {
	CreateSanctionPayload,
	Sanction,
	SanctionFilters,
	SanctionListResponse,
} from "@rosegriffon/achillea-types/domain/sanction";
import {
	SanctionIssuerType,
	SanctionType,
} from "@rosegriffon/achillea-types/enums/sanction";

import { pagedListSchema } from "./common";
import {
	AchilleaResource,
	encodePathSegment,
	type AchilleaClientResult,
	type QueryParams,
} from "./http";

export const sanctionTypeSchema = z.enum(SanctionType) satisfies z.ZodType<SanctionType>;
export const sanctionIssuerTypeSchema = z.enum(
	SanctionIssuerType
) satisfies z.ZodType<SanctionIssuerType>;

export const sanctionSchema = z.object({
	id: z.string(),
	userId: z.string(),
	guildId: z.string(),
	type: sanctionTypeSchema,
	reason: z.string().nullable(),
	durationSec: z.number().nullable(),
	issuedBy: z.string(),
	issuedByType: sanctionIssuerTypeSchema,
	expiresAt: z.string().nullable(),
	revokedAt: z.string().nullable(),
	revokedBy: z.string().nullable(),
	revokeReason: z.string().nullable(),
	evidence: z.array(z.record(z.string(), z.unknown())).nullable(),
	createdAt: z.string(),
}) satisfies z.ZodType<Sanction>;

export const sanctionListSchema = pagedListSchema(
	sanctionSchema
) satisfies z.ZodType<SanctionListResponse>;

/** 4 routes. */
export class SanctionsResource extends AchilleaResource {
	/** `GET /sanctions` — liste paginée, filtrable par joueur, serveur, type, activité. */
	list(filters: SanctionFilters = {}): Promise<AchilleaClientResult<SanctionListResponse>> {
		return this.http.get("/sanctions", sanctionListSchema, { query: filters as QueryParams });
	}

	/** `POST /sanctions` — émet une sanction (staff). */
	create(payload: CreateSanctionPayload): Promise<AchilleaClientResult<Sanction>> {
		return this.http.post("/sanctions", sanctionSchema, payload);
	}

	/** `POST /sanctions/:id/revoke` — révoque une sanction active. */
	revoke(id: string, reason?: string): Promise<AchilleaClientResult<Sanction>> {
		return this.http.post(`/sanctions/${encodePathSegment(id)}/revoke`, sanctionSchema, {
			reason,
		});
	}

	/** `POST /sanctions/:id/appeal` — consigne un appel dans le journal de preuve. */
	appeal(id: string, message: string): Promise<AchilleaClientResult<Sanction>> {
		return this.http.post(`/sanctions/${encodePathSegment(id)}/appeal`, sanctionSchema, {
			message,
		});
	}
}
