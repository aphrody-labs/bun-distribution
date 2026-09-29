import { type Rel } from "@mikro-orm/core";
import {
	Entity,
	Enum,
	Index,
	ManyToOne,
	PrimaryKey,
	Property,
	Unique,
} from "@mikro-orm/decorators/legacy";

import { CastAvailabilityStatus, CastSlotRole } from "@/utils/enums";

import { CastEvent } from "./CastEvent";

// =============================================================================
// CastAvailability — T-2.1
// Déclaration de disponibilité d'un membre cellule cast pour un CastEvent.
// UNIQUE (userId, eventId) — un membre ne peut avoir qu'une dispo par event.
// =============================================================================

@Entity({ tableName: "cast_availability" })
@Unique({ properties: ["userId", "event"] })
@Index({ properties: ["event"] })
export class CastAvailability {
	@PrimaryKey({ type: "uuid", defaultRaw: "gen_random_uuid()" })
	id!: string;

	/** Discord snowflake du membre cellule cast */
	@Property({ type: "varchar", columnType: "varchar(32)" })
	userId!: string;

	@ManyToOne(() => CastEvent, { deleteRule: "cascade" })
	event!: Rel<CastEvent>;

	@Enum(() => CastAvailabilityStatus)
	status: CastAvailabilityStatus = CastAvailabilityStatus.Unavailable;

	/**
	 * Rôles préférés — tableau de CastSlotRole stocké en JSONB.
	 * Pas de contrainte DB sur les valeurs — validé au service layer.
	 */
	@Property({ type: "jsonb", nullable: true })
	preferredRoles: CastSlotRole[] | null = null;

	@Property({ type: "text", nullable: true })
	notes: string | null = null;

	@Property({ type: "datetime", columnType: "timestamptz", defaultRaw: "NOW()" })
	declaredAt: Date = new Date();
}
