import { Exclude, Expose } from "class-transformer";

import type {
	CastAvailabilityStatus,
	CastEventKind,
	CastEventStatus,
	CastSlotRole,
} from "@/utils/enums";

// =============================================================================
// CastEventDTO
// =============================================================================

@Exclude()
export class CastEventDTO {
	@Expose() id!: string;
	@Expose() name!: string;
	@Expose() kind!: CastEventKind;
	@Expose() scheduledAt!: Date;
	@Expose() duration!: number;
	@Expose() tournamentId!: string | null;
	@Expose() status!: CastEventStatus;
	@Expose() description!: string | null;
	@Expose() twitchUrl!: string | null;
	@Expose() createdBy!: string;
	@Expose() createdAt!: Date;
	@Expose() updatedAt!: Date;
}

// =============================================================================
// CastSlotDTO
// =============================================================================

@Exclude()
export class CastSlotDTO {
	@Expose() id!: string;
	@Expose() role!: CastSlotRole;
	@Expose() required!: boolean;
	@Expose() defraymentAmount!: string | null;
	@Expose() defraymentCurrency!: string | null;
	@Expose() defraymentReason!: string | null;
	@Expose() notes!: string | null;
}

// =============================================================================
// CastAvailabilityDTO
// =============================================================================

@Exclude()
export class CastAvailabilityDTO {
	@Expose() id!: string;
	@Expose() userId!: string;
	@Expose() status!: CastAvailabilityStatus;
	@Expose() preferredRoles!: CastSlotRole[] | null;
	@Expose() notes!: string | null;
	@Expose() declaredAt!: Date;
}

// =============================================================================
// CastAttributionDTO
// =============================================================================

@Exclude()
export class CastAttributionDTO {
	@Expose() id!: string;
	@Expose() slotId!: string;
	@Expose() userId!: string | null;
	@Expose() assignedAt!: Date;
	@Expose() assignedBy!: string;
	@Expose() confirmedAt!: Date | null;
}

// =============================================================================
// CasterPublicDTO — vitrine sans auth
// =============================================================================

@Exclude()
export class CasterPublicDTO {
	@Expose() id!: string;
	@Expose() displayName!: string;
	@Expose() avatar!: string | null;
	/** bio non présente sur User actuellement — null en attendant migration T-3.x */
	@Expose() bio!: string | null;
	/** twitchUrl non présente sur User actuellement — null en attendant migration T-3.x */
	@Expose() twitchUrl!: string | null;
	@Expose() recentCasts!: number;
}
