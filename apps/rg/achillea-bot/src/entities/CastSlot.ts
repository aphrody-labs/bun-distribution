import { type Rel } from "@mikro-orm/core";
import { Entity, Enum, ManyToOne, PrimaryKey, Property } from "@mikro-orm/decorators/legacy";

import { CastSlotRole } from "@/utils/enums";

import { CastEvent } from "./CastEvent";

// =============================================================================
// CastSlot — T-2.1
// Besoin de cast attaché à un CastEvent (1 caster principal, 1 observateur…).
// Les champs defraiement* sont nullable — valeurs à définir post-décision CP
// « Charte CAST défraiement ».
// =============================================================================

@Entity({ tableName: "cast_slot" })
export class CastSlot {
	@PrimaryKey({ type: "uuid", defaultRaw: "gen_random_uuid()" })
	id!: string;

	@ManyToOne(() => CastEvent, { deleteRule: "cascade" })
	event!: Rel<CastEvent>;

	@Enum(() => CastSlotRole)
	role!: CastSlotRole;

	@Property({ type: "boolean", default: true })
	required: boolean = true;

	/** Montant défraiement — nullable tant que charte CP non décidée */
	@Property({ type: "decimal", columnType: "decimal(10,2)", nullable: true })
	defraymentAmount: string | null = null;

	/** Code devise ISO 4217 — nullable tant que charte CP non décidée */
	@Property({ type: "varchar", columnType: "varchar(3)", nullable: true })
	defraymentCurrency: string | null = null;

	/** Motif défraiement libre */
	@Property({ type: "text", nullable: true })
	defraymentReason: string | null = null;

	@Property({ type: "text", nullable: true })
	notes: string | null = null;
}
