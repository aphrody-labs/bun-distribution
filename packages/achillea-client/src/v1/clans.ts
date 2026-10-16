/**
 * `/clans` — annuaire, membres, invitations, candidatures et administration.
 */

import { z } from "zod";

import type {
  ClanApplicationDTO,
  ClanDTO,
  ClanInviteDTO,
  ClanMemberDTO,
  NewClanPayload,
  UpdateClanPayload,
} from "@rosegriffon/achillea-types/domain/clan";
import type { Paginated } from "@rosegriffon/achillea-types/domain/common";
import { ClanState } from "@rosegriffon/achillea-types/enums/clanState";
import type { ClanMemberDistinction } from "@rosegriffon/achillea-types/enums/clanMemberRole";

import {
  apiDateSchema,
  clanMemberDistinctionSchema,
  clanMemberRoleSchema,
  pageMetaSchema,
  successResponseSchema,
  userDtoSchema,
} from "./common";
import { AchilleaResource, encodePathSegment, type AchilleaClientResult } from "./http";
import { imageGenerationResultSchema } from "./users";
import type {
  ClanApplicationResult,
  ClanMemberLimits,
  ClanRoleResponse,
  ImageGenerationResult,
  NewClanResponse,
  SuccessResponse,
} from "./pending-contracts";

export const clanStateSchema = z.enum(ClanState) satisfies z.ZodType<ClanState>;

const canonicalClanDtoSchema = z.object({
  id: z.number(),
  founders: z.array(z.string()),
  name: z.string(),
  shortenedName: z.string(),
  normalizedShortName: z.string(),
  clanAvatarUrl: z.string(),
  clanBiography: z.string(),
  fame: z.number().optional(),
  xUrl: z.string().nullable().optional(),
  instagramUrl: z.string().nullable().optional(),
  tiktokUrl: z.string().nullable().optional(),
  isRecruiting: z.boolean(),
  isInactive: z.boolean(),
  isHidden: z.boolean(),
  isDisbanded: z.boolean(),
  autoAcceptMembers: z.boolean(),
  state: clanStateSchema,
  createdAt: apiDateSchema,
  languages: z.array(z.string()),
  origin: z.string(),
  experience: z.object({ currentLevel: z.number(), totalXp: z.number() }),
  membersCount: z.number(),
  president: userDtoSchema,
});

/**
 * The first unified Elysia projection intentionally shipped the compact clan
 * shape used by the legacy Angular client.  Accept it at this boundary while
 * normalising it to the canonical shared DTO; otherwise Zod rejects the whole
 * list and the UI renders an empty state despite a non-empty database.
 */
const compactClanDtoSchema = z.object({
  id: z.number(),
  name: z.string(),
  shortName: z.string(),
  avatarUrl: z.string(),
  biography: z.string(),
  fame: z.number(),
  isRecruiting: z.boolean(),
  membersLimit: z.boolean(),
});

export const clanDtoSchema = z.union([canonicalClanDtoSchema, compactClanDtoSchema]).transform((value): ClanDTO => {
  if ("founders" in value) return value;
  return {
    id: value.id,
    founders: [],
    name: value.name,
    shortenedName: value.shortName,
    normalizedShortName: value.shortName.toLowerCase(),
    clanAvatarUrl: value.avatarUrl,
    clanBiography: value.biography,
    fame: value.fame,
    xUrl: null,
    instagramUrl: null,
    tiktokUrl: null,
    isRecruiting: value.isRecruiting,
    isInactive: false,
    isHidden: false,
    isDisbanded: false,
    autoAcceptMembers: false,
    state: ClanState.Approved,
    createdAt: new Date(0),
    languages: [],
    origin: "legacy",
    experience: { currentLevel: 1, totalXp: 0 },
    membersCount: 0,
    president: { id: "", username: value.name },
  };
}) satisfies z.ZodType<ClanDTO>;

const compactClanListSchema = z
  .object({
    data: z.array(clanDtoSchema),
    count: z.number(),
  })
  .transform(({ data, count }) => ({
    data,
    meta: { total: count },
  }));

const canonicalClanListSchema = z.object({
  data: z.array(clanDtoSchema),
  meta: pageMetaSchema,
});

const clanListSchema = z.union([canonicalClanListSchema, compactClanListSchema]);

export const clanMemberDtoSchema = z.object({
  clanRole: clanMemberRoleSchema,
  distinctions: z.array(z.string()),
  clanFameContributed: z.number(),
  createdAt: apiDateSchema,
  updatedAt: apiDateSchema,
  user: userDtoSchema,
}) satisfies z.ZodType<ClanMemberDTO>;

export const clanApplicationDtoSchema = z.object({
  id: z.number(),
  user: userDtoSchema,
  clan: clanDtoSchema,
  distinctions: z.array(clanMemberDistinctionSchema),
  createdAt: apiDateSchema,
  updatedAt: apiDateSchema,
}) satisfies z.ZodType<ClanApplicationDTO>;

export const clanInviteDtoSchema = z.object({
  id: z.number(),
  user: userDtoSchema,
  clan: clanDtoSchema,
  inviter: clanMemberDtoSchema,
  threadId: z.string().optional(),
  distinctions: z.array(clanMemberDistinctionSchema),
  createdAt: apiDateSchema,
  updatedAt: apiDateSchema,
  lastNotifiedAt: apiDateSchema,
}) satisfies z.ZodType<ClanInviteDTO>;

export const clanMemberLimitsSchema = z.object({
  playerLimit: z.number(),
  staffLimit: z.number(),
}) satisfies z.ZodType<ClanMemberLimits>;

export const clanRoleResponseSchema = z.object({
  role: z.number(),
}) satisfies z.ZodType<ClanRoleResponse>;

export const newClanResponseSchema = z.object({
  success: z.boolean(),
  clanId: z.number().optional(),
  conflict: z.string().optional(),
  error: z.string().optional(),
}) satisfies z.ZodType<NewClanResponse>;

export const clanApplicationResultSchema = z.object({
  success: z.boolean(),
  autojoin: z.boolean().optional(),
  error: z.string().optional(),
}) satisfies z.ZodType<ClanApplicationResult>;

/** `POST /clans/kick/:id` et `/clans/updateMember` renvoient la liste à jour. */
export const clanMembersMutationSchema = z.object({
  success: z.boolean(),
  members: z.array(clanMemberDtoSchema).optional(),
  error: z.string().optional(),
});

export type ClanMembersMutation = z.infer<typeof clanMembersMutationSchema>;

export const clanUpdateResultSchema = z.object({
  success: z.boolean(),
  clan: clanDtoSchema.optional(),
  error: z.string().optional(),
});

export type ClanUpdateResult = z.infer<typeof clanUpdateResultSchema>;

export type ClanListQuery = {
  page?: number;
  /** Taille de page — le contrôleur l'attend sous le nom `pagination`. */
  pagination?: number;
  state?: ClanState;
};

/** 20 routes. */
export class ClansResource extends AchilleaResource {
  /** `GET /clans` — annuaire paginé, filtré par état de validation. */
  list(query: ClanListQuery = {}): Promise<AchilleaClientResult<Paginated<ClanDTO>>> {
    return this.http.get("/clans", clanListSchema, {
      query,
    });
  }

  /** `GET /clans/:id` — fiche publique d'un clan. */
  get(id: number): Promise<AchilleaClientResult<ClanDTO>> {
    return this.http.get(`/clans/${encodePathSegment(id)}`, clanDtoSchema);
  }

  /** `GET /clans/:id/members` — effectif complet du clan. */
  members(id: number): Promise<AchilleaClientResult<ClanMemberDTO[]>> {
    return this.http.get(`/clans/${encodePathSegment(id)}/members`, z.array(clanMemberDtoSchema));
  }

  /** `GET /clans/member-limits` — quotas joueurs / staff en vigueur. */
  memberLimits(): Promise<AchilleaClientResult<ClanMemberLimits>> {
    return this.http.get("/clans/member-limits", clanMemberLimitsSchema);
  }

  /** `PATCH /clans/member-limits` — modifie les quotas (administrateurs). */
  updateMemberLimits(limits: ClanMemberLimits): Promise<AchilleaClientResult<ClanMemberLimits>> {
    return this.http.patch("/clans/member-limits", clanMemberLimitsSchema, limits);
  }

  /** `POST /clans/create` — dépose une demande de création de clan. */
  create(payload: NewClanPayload): Promise<AchilleaClientResult<NewClanResponse>> {
    return this.http.post("/clans/create", newClanResponseSchema, payload);
  }

  /** `PATCH /clans/:id` — édition par le président du clan ou un administrateur. */
  update(id: number, patch: UpdateClanPayload): Promise<AchilleaClientResult<ClanUpdateResult>> {
    return this.http.patch(`/clans/${encodePathSegment(id)}`, clanUpdateResultSchema, patch);
  }

  /** `GET /clans/role` — rôle du compte connecté dans son clan (`-1` hors clan). */
  myRole(): Promise<AchilleaClientResult<ClanRoleResponse>> {
    return this.http.get("/clans/role", clanRoleResponseSchema);
  }

  /** `POST /clans/kick/:id` — exclut un membre (motif obligatoire). */
  kickMember(userId: string, reason: string): Promise<AchilleaClientResult<ClanMembersMutation>> {
    return this.http.post(`/clans/kick/${encodePathSegment(userId)}`, clanMembersMutationSchema, { reason });
  }

  /** `POST /clans/updateMember` — change rôle et distinctions d'un membre. */
  updateMember(member: ClanMemberDTO): Promise<AchilleaClientResult<ClanMembersMutation>> {
    return this.http.post("/clans/updateMember", clanMembersMutationSchema, member);
  }

  /** `GET /clans/invites` — invitations émises par le clan (vice-président et plus). */
  invites(): Promise<AchilleaClientResult<ClanInviteDTO[]>> {
    return this.http.get("/clans/invites", z.array(clanInviteDtoSchema));
  }

  /** `POST /clans/invites/create` — invite un joueur dans le clan. */
  createInvite(userId: string, distinctions: ClanMemberDistinction[]): Promise<AchilleaClientResult<SuccessResponse>> {
    return this.http.post("/clans/invites/create", successResponseSchema, {
      userId,
      distinctions,
    });
  }

  /** `POST /clans/invites/revoke` — retire une invitation en attente. */
  revokeInvite(invite: ClanInviteDTO): Promise<AchilleaClientResult<SuccessResponse>> {
    return this.http.post("/clans/invites/revoke", successResponseSchema, invite);
  }

  /** `POST /clans/invites/notify` — relance le joueur invité sur Discord. */
  notifyInvite(invite: ClanInviteDTO): Promise<AchilleaClientResult<SuccessResponse>> {
    return this.http.post("/clans/invites/notify", successResponseSchema, invite);
  }

  /** `GET /clans/applications` — candidatures reçues par le clan. */
  applications(): Promise<AchilleaClientResult<ClanApplicationDTO[]>> {
    return this.http.get("/clans/applications", z.array(clanApplicationDtoSchema));
  }

  /** `POST /clans/applications/create` — candidature du compte connecté. */
  createApplication(
    clanId: number,
    distinctions: ClanMemberDistinction[],
  ): Promise<AchilleaClientResult<ClanApplicationResult>> {
    return this.http.post("/clans/applications/create", clanApplicationResultSchema, {
      clanId,
      distinctions,
    });
  }

  /** `POST /clans/applications/accept` — accepte une candidature. */
  acceptApplication(application: ClanApplicationDTO): Promise<AchilleaClientResult<SuccessResponse>> {
    return this.http.post("/clans/applications/accept", successResponseSchema, application);
  }

  /** `POST /clans/applications/reject` — refuse une candidature. */
  rejectApplication(application: ClanApplicationDTO): Promise<AchilleaClientResult<SuccessResponse>> {
    return this.http.post("/clans/applications/reject", successResponseSchema, application);
  }

  /** URL de `GET /clans/:id/poster.png` — affiche du clan. */
  posterUrl(id: number): string {
    return this.http.url(`/clans/${encodePathSegment(id)}/poster.png`);
  }

  /** `GET /clans/:id/poster.png` — affiche du clan en PNG. */
  poster(id: number): Promise<AchilleaClientResult<ArrayBuffer>> {
    return this.http.requestBytes(`/clans/${encodePathSegment(id)}/poster.png`);
  }

  /** `POST /clans/:id/poster/regenerate` — régénère et archive l'affiche. */
  regeneratePoster(id: number): Promise<AchilleaClientResult<ImageGenerationResult>> {
    return this.http.post(`/clans/${encodePathSegment(id)}/poster/regenerate`, imageGenerationResultSchema);
  }
}
