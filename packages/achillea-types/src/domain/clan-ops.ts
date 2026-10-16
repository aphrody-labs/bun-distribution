/** Résultats des mutations de clan. */

import type { SuccessResponse } from "./api";

export interface ClanMemberLimits {
  playerLimit: number;
  staffLimit: number;
}

/** `GET /clans/role` — `-1` quand l'appelant n'est dans aucun clan. */
export interface ClanRoleResponse {
  role: number;
}

export interface NewClanResponse extends SuccessResponse {
  clanId?: number;
  /** Renseigné sur un conflit de nom (409). */
  conflict?: string;
}

export interface ClanApplicationResult extends SuccessResponse {
  /** `true` quand le clan accepte automatiquement les candidatures. */
  autojoin?: boolean;
}

export interface ImageGenerationResult extends SuccessResponse {
  path?: string;
}
