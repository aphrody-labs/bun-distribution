/**
 * `/organizations` — structures e-sport, leur revue et leurs managers.
 */

import { z } from "zod";

import type { Paginated } from "@rosegriffon/achillea-types/domain/common";
import type {
	OrganizationDTO,
	OrganizationValidationDTO,
	OrgManagerDTO,
} from "@rosegriffon/achillea-types/domain/organization";
import { OrganizationState } from "@rosegriffon/achillea-types/enums/organization";

import {
	apiDateSchema,
	apiEnvelopeSchema,
	countrySchema,
	pageMetaSchema,
	socialMediaDtoSchema,
	userDtoSchema,
} from "./common";
import {
	AchilleaResource,
	encodePathSegment,
	type AchilleaClientResult,
} from "./http";
import type { ApiEnvelope } from "./pending-contracts";

export const organizationStateSchema = z.enum(
	OrganizationState
) satisfies z.ZodType<OrganizationState>;

/**
 * `OrganizationDTO` et `OrgManagerDTO` se référencent mutuellement : le schéma
 * est donc paresseux des deux côtés, avec un type explicite pour couper le
 * cycle d'inférence.
 */
/**
 * Organisation, telle que l'API la sert RÉELLEMENT.
 *
 * Mesuré sur `GET /tournaments` : `id` est un NOMBRE, `owner` un simple
 * identifiant Discord (pas un utilisateur complet), et `orgManagers`,
 * `socialMedias`, `broadcastMedias` sont absents. Le contrat exigeait les six :
 * la validation échouait sur `data.0.organization`, donc les **9 tournois**
 * étaient rejetés en bloc et la page affichait « Aucun tournoi trouvé ».
 *
 * Les deux formes d'`owner` sont acceptées : `GET /tournaments` imbrique un
 * identifiant, `GET /organizations/:id` renvoie l'utilisateur entier. Une
 * organisation ne doit jamais pouvoir invalider le tournoi qui la cite.
 */
export const organizationDtoSchema: z.ZodType<OrganizationDTO> = z.object({
	id: z.union([z.string(), z.number()]).optional(),
	state: organizationStateSchema.optional(),
	name: z.string(),
	normalizedName: z.string(),
	logo: z.string(),
	description: z.string(),
	owner: z.union([z.string(), userDtoSchema]).optional(),
	orgManagers: z.array(userDtoSchema).optional(),
	managers: z.array(z.lazy(() => orgManagerDtoSchema)).optional(),
	preapproved: z.boolean().optional(),
	socialMedias: z.array(socialMediaDtoSchema).optional(),
	broadcastMedias: z.array(socialMediaDtoSchema).optional(),
	// L'API sert tantôt un code de langue nu (`"fr"`), tantôt le pays complet.
	// Le contrat n'acceptait que l'objet : un code sur deux caractères faisait
	// tomber toute l'organisation, donc tous les tournois qui la citent.
	origin: z.union([z.string(), countrySchema]).optional(),
	createdAt: apiDateSchema.optional(),
	updatedAt: apiDateSchema.optional(),
});

export const orgManagerDtoSchema: z.ZodType<OrgManagerDTO> = z.object({
	organization: z.union([z.number(), z.lazy(() => organizationDtoSchema)]).optional(),
	user: userDtoSchema,
	createdAt: apiDateSchema.optional(),
	updatedAt: apiDateSchema.optional(),
});

export const organizationValidationDtoSchema = z.object({
	id: z.string().optional(),
	reviewer: userDtoSchema,
	name: z.string().nullable(),
	logo: z.string().nullable(),
	description: z.string().nullable(),
	twitterUrl: z.string().nullable(),
	instagramUrl: z.string().nullable(),
	tiktokUrl: z.string().nullable(),
	twitchUrl: z.string().nullable(),
	youtubeUrl: z.string().nullable(),
}) satisfies z.ZodType<OrganizationValidationDTO>;

const organizationEnvelopeSchema = apiEnvelopeSchema(organizationDtoSchema);
const organizationListEnvelopeSchema = apiEnvelopeSchema(z.array(organizationDtoSchema));
const organizationCreateEnvelopeSchema = apiEnvelopeSchema(z.union([organizationDtoSchema, z.null()]));
/** Both deployed generations currently return `{ data, count }`; normalize it to Paginated. */
const organizationPageSchema: z.ZodType<Paginated<OrganizationDTO>> = z
	.object({
		data: z.array(organizationDtoSchema),
		count: z.number().optional(),
		total: z.number().optional(),
		meta: pageMetaSchema.optional(),
	})
	.transform(({ data, count, total, meta }) => ({
		data,
		meta: meta ?? { total: total ?? count ?? data.length },
	}));
const opaqueEnvelopeSchema = apiEnvelopeSchema(z.unknown());

export type OrganizationListQuery = {
	page?: number;
	/** Taille de page — le contrôleur l'attend sous le nom `pagination`. */
	pagination?: number;
	state?: OrganizationState;
}

/** 7 routes. */
export class OrganizationsResource extends AchilleaResource {
	/** `GET /organizations` — annuaire paginé, filtré par état de revue. */
	list(
		query: OrganizationListQuery = {}
	): Promise<AchilleaClientResult<Paginated<OrganizationDTO>>> {
		return this.http.get("/organizations", organizationPageSchema, {
			query,
		});
	}

	/** `GET /organizations/:id` — fiche d'une organisation. */
	get(id: number | string): Promise<AchilleaClientResult<ApiEnvelope<OrganizationDTO>>> {
		return this.http.get(`/organizations/${encodePathSegment(id)}`, organizationEnvelopeSchema);
	}

	/**
	 * `GET /organizations/me` — organisations du compte connecté.
	 *
	 * Longtemps inatteignable : le contrôleur la déclarait après `/:id`, qui
	 * capturait « me » comme identifiant. Corrigé côté API en remontant la
	 * route littérale avant le joker.
	 */
	mine(): Promise<AchilleaClientResult<ApiEnvelope<OrganizationDTO[]>>> {
		return this.http.get("/organizations/me", organizationListEnvelopeSchema);
	}

	/** `POST /organizations/create` — dépose une demande de création. */
	create(payload: OrganizationDTO): Promise<AchilleaClientResult<ApiEnvelope<OrganizationDTO | null>>> {
		return this.http.post("/organizations/create", organizationCreateEnvelopeSchema, payload);
	}

	/** `POST /organizations/validate` — même traitement, chemin de revue historique. */
	validate(
		payload: OrganizationDTO
	): Promise<AchilleaClientResult<ApiEnvelope<OrganizationDTO | null>>> {
		return this.http.post("/organizations/validate", organizationCreateEnvelopeSchema, payload);
	}

	/** `POST /organizations/:id/approve` — approuve une organisation en attente. */
	approve(id: number | string): Promise<AchilleaClientResult<ApiEnvelope<unknown>>> {
		return this.http.post(
			`/organizations/${encodePathSegment(id)}/approve`,
			opaqueEnvelopeSchema
		);
	}

	/** `POST /organizations/:id/reject` — rejette une organisation en attente. */
	reject(id: number | string): Promise<AchilleaClientResult<ApiEnvelope<unknown>>> {
		return this.http.post(
			`/organizations/${encodePathSegment(id)}/reject`,
			opaqueEnvelopeSchema
		);
	}
}
