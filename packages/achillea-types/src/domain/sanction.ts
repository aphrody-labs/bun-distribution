import type { SanctionIssuerType, SanctionType } from "../enums/sanction";

import type { PageQuery, PagedList } from "./common";

export interface Sanction {
  id: string;
  userId: string;
  guildId: string;
  type: SanctionType;
  reason: string | null;
  durationSec: number | null;
  issuedBy: string;
  issuedByType: SanctionIssuerType;
  expiresAt: string | null;
  revokedAt: string | null;
  revokedBy: string | null;
  revokeReason: string | null;
  evidence: Record<string, unknown>[] | null;
  createdAt: string;
}

export interface SanctionFilters extends PageQuery {
  userId?: string;
  guildId?: string;
  type?: SanctionType;
  active?: boolean;
}

export type SanctionListResponse = PagedList<Sanction>;

export interface CreateSanctionPayload {
  userId: string;
  guildId: string;
  type: SanctionType;
  reason?: string | null;
  durationSec?: number | null;
  evidence?: Record<string, unknown>[] | null;
}
