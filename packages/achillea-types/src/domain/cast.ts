import type { CastAvailabilityStatus, CastEventKind, CastEventStatus, CastSlotRole } from "../enums/cast";

import type { PageQuery, PagedList } from "./common";

export interface CastEvent {
  id: string;
  name: string;
  kind: CastEventKind;
  scheduledAt: string;
  duration: number;
  tournamentId: string | null;
  status: CastEventStatus;
  description: string | null;
  twitchUrl: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface CastSlot {
  id: string;
  role: CastSlotRole;
  required: boolean;
  defraymentAmount: string | null;
  defraymentCurrency: string | null;
  defraymentReason: string | null;
  notes: string | null;
}

export interface CastAvailability {
  id: string;
  userId: string;
  status: CastAvailabilityStatus;
  preferredRoles: CastSlotRole[] | null;
  notes: string | null;
  declaredAt: string;
}

export interface CastAttribution {
  id: string;
  slotId: string;
  userId: string | null;
  assignedAt: string;
  assignedBy: string;
  confirmedAt: string | null;
}

export interface CasterPublic {
  id: string;
  displayName: string;
  avatar: string | null;
  bio: string | null;
  twitchUrl: string | null;
  recentCasts: number;
}

/** Ligne de checklist : un poste, son attributaire éventuel, sa confirmation. */
export interface ChecklistItem {
  slot: CastSlot;
  attribution: CastAttribution | null;
  casterId: string | null;
  confirmed: boolean;
}

export interface CastEventDetail {
  event: CastEvent;
  slots: CastSlot[];
  attributions: CastAttribution[];
  checklist: ChecklistItem[];
}

export type CastEventListResponse = PagedList<CastEvent>;

export interface CastEventFilters extends PageQuery {
  status?: CastEventStatus;
  from?: string;
  to?: string;
}

export interface CreateCastEventPayload {
  name: string;
  kind: CastEventKind;
  scheduledAt: string;
  duration?: number;
  tournamentId?: string | null;
  twitchUrl?: string | null;
  description?: string | null;
  slots: Array<{ role: CastSlotRole; required?: boolean }>;
}

export interface CastSurveyResult {
  success: boolean;
  eventId: string;
  poolSize: number;
}

/**
 * `POST /casts/:id/auto-assign`. Générique sur l'attribution : l'API renvoie
 * la forme complète, un appelant peut n'en valider qu'une projection.
 */
export interface CastAutoAssignResult<TAttribution> {
  created: number;
  attributions: TAttribution[];
}
