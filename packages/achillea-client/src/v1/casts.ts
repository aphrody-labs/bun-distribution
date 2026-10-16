/**
 * `/casts` — évènements à diffuser, disponibilités des casters, attributions.
 */

import { z } from "zod";

import type {
  CastAttribution,
  CastAvailability,
  CastEvent,
  CastEventDetail,
  CastEventFilters,
  CastEventListResponse,
  CastSlot,
  CasterPublic,
  ChecklistItem,
  CreateCastEventPayload,
} from "@rosegriffon/achillea-types/domain/cast";
import {
  CastAvailabilityStatus,
  CastEventKind,
  CastEventStatus,
  CastSlotRole,
} from "@rosegriffon/achillea-types/enums/cast";

import { pagedListSchema } from "./common";
import { AchilleaResource, encodePathSegment, type AchilleaClientResult, type QueryParams } from "./http";
import type { CastAutoAssignResult, CastSurveyResult } from "./pending-contracts";

export const castEventKindSchema = z.enum(CastEventKind) satisfies z.ZodType<CastEventKind>;
export const castEventStatusSchema = z.enum(CastEventStatus) satisfies z.ZodType<CastEventStatus>;
export const castSlotRoleSchema = z.enum(CastSlotRole) satisfies z.ZodType<CastSlotRole>;
export const castAvailabilityStatusSchema = z.enum(CastAvailabilityStatus) satisfies z.ZodType<CastAvailabilityStatus>;

export const castEventSchema = z.object({
  id: z.string(),
  name: z.string(),
  kind: castEventKindSchema,
  scheduledAt: z.string(),
  duration: z.number(),
  tournamentId: z.string().nullable(),
  status: castEventStatusSchema,
  description: z.string().nullable(),
  twitchUrl: z.string().nullable(),
  createdBy: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
}) satisfies z.ZodType<CastEvent>;

export const castSlotSchema = z.object({
  id: z.string(),
  role: castSlotRoleSchema,
  required: z.boolean(),
  defraymentAmount: z.string().nullable(),
  defraymentCurrency: z.string().nullable(),
  defraymentReason: z.string().nullable(),
  notes: z.string().nullable(),
}) satisfies z.ZodType<CastSlot>;

export const castAvailabilitySchema = z.object({
  id: z.string(),
  userId: z.string(),
  status: castAvailabilityStatusSchema,
  preferredRoles: z.array(castSlotRoleSchema).nullable(),
  notes: z.string().nullable(),
  declaredAt: z.string(),
}) satisfies z.ZodType<CastAvailability>;

export const castAttributionSchema = z.object({
  id: z.string(),
  slotId: z.string(),
  userId: z.string().nullable(),
  assignedAt: z.string(),
  assignedBy: z.string(),
  confirmedAt: z.string().nullable(),
}) satisfies z.ZodType<CastAttribution>;

export const checklistItemSchema = z.object({
  slot: castSlotSchema,
  attribution: castAttributionSchema.nullable(),
  casterId: z.string().nullable(),
  confirmed: z.boolean(),
}) satisfies z.ZodType<ChecklistItem>;

export const castEventDetailSchema = z.object({
  event: castEventSchema,
  slots: z.array(castSlotSchema),
  attributions: z.array(castAttributionSchema),
  checklist: z.array(checklistItemSchema),
}) satisfies z.ZodType<CastEventDetail>;

export const casterPublicSchema = z.object({
  id: z.string(),
  displayName: z.string(),
  avatar: z.string().nullable(),
  bio: z.string().nullable(),
  twitchUrl: z.string().nullable(),
  recentCasts: z.number(),
}) satisfies z.ZodType<CasterPublic>;

export const castEventListSchema = pagedListSchema(castEventSchema) satisfies z.ZodType<CastEventListResponse>;

export const castSurveyResultSchema = z.object({
  success: z.boolean(),
  eventId: z.string(),
  poolSize: z.number(),
}) satisfies z.ZodType<CastSurveyResult>;

export const castAutoAssignResultSchema = z.object({
  created: z.number(),
  attributions: z.array(castAttributionSchema),
}) satisfies z.ZodType<CastAutoAssignResult<CastAttribution>>;

export interface RecordAvailabilityPayload {
  status: CastAvailabilityStatus;
  preferredRoles?: CastSlotRole[] | null;
  notes?: string | null;
}

/** 9 routes. */
export class CastsResource extends AchilleaResource {
  /** `GET /casts/events` — évènements à caster, filtrés et paginés. */
  listEvents(filters: CastEventFilters = {}): Promise<AchilleaClientResult<CastEventListResponse>> {
    return this.http.get("/casts/events", castEventListSchema, {
      query: filters as QueryParams,
    });
  }

  /** `GET /casts/events/:id` — postes, attributions et checklist d'un évènement. */
  getEvent(id: string): Promise<AchilleaClientResult<CastEventDetail>> {
    return this.http.get(`/casts/events/${encodePathSegment(id)}`, castEventDetailSchema);
  }

  /** `POST /casts/events` — crée un évènement et ses postes (administrateurs). */
  createEvent(payload: CreateCastEventPayload): Promise<AchilleaClientResult<CastEvent>> {
    return this.http.post("/casts/events", castEventSchema, payload);
  }

  /** `POST /casts/events/:id/survey` — ouvre le sondage de disponibilités. */
  openSurvey(id: string, casterPool: string[]): Promise<AchilleaClientResult<CastSurveyResult>> {
    return this.http.post(`/casts/events/${encodePathSegment(id)}/survey`, castSurveyResultSchema, { casterPool });
  }

  /** `POST /casts/events/:id/availability` — déclare sa disponibilité. */
  recordAvailability(id: string, payload: RecordAvailabilityPayload): Promise<AchilleaClientResult<CastAvailability>> {
    return this.http.post(`/casts/events/${encodePathSegment(id)}/availability`, castAvailabilitySchema, payload);
  }

  /** `POST /casts/events/:id/auto-assign` — répartit automatiquement les postes. */
  autoAssign(
    id: string,
    maxSlotsPerCaster?: number,
  ): Promise<AchilleaClientResult<CastAutoAssignResult<CastAttribution>>> {
    return this.http.post(`/casts/events/${encodePathSegment(id)}/auto-assign`, castAutoAssignResultSchema, {
      maxSlotsPerCaster,
    });
  }

  /** `PATCH /casts/attributions/:id` — remplace le caster d'une attribution. */
  swapAttribution(attributionId: string, newCasterId: string): Promise<AchilleaClientResult<CastAttribution>> {
    return this.http.patch(`/casts/attributions/${encodePathSegment(attributionId)}`, castAttributionSchema, {
      newCasterId,
    });
  }

  /** `POST /casts/attributions/:id/confirm` — confirmation par le caster assigné. */
  confirmAttribution(attributionId: string): Promise<AchilleaClientResult<CastAttribution>> {
    return this.http.post(`/casts/attributions/${encodePathSegment(attributionId)}/confirm`, castAttributionSchema);
  }

  /** `GET /casts/casters` — vitrine publique des casters. */
  listCasters(): Promise<AchilleaClientResult<CasterPublic[]>> {
    return this.http.get("/casts/casters", z.array(casterPublicSchema));
  }
}
