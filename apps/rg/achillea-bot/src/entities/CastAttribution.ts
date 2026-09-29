import { type Rel } from "@mikro-orm/core";
import {
	Entity,
	Index,
	ManyToOne,
	PrimaryKey,
	Property,
	Unique,
} from "@mikro-orm/decorators/legacy";

import { CastSlot } from "./CastSlot";

// =============================================================================
// CastAttribution — T-2.1
// Assignation finale user → slot. userId NULL = slot non pourvu.
// UNIQUE (slot) — un slot ne peut avoir qu'une attribution à la fois.
// =============================================================================

@Entity({ tableName: "cast_attribution" })
@Unique({ properties: ["slot"] })
@Index({ properties: ["userId"] })
export class CastAttribution {
	@PrimaryKey({ type: "uuid", defaultRaw: "gen_random_uuid()" })
	id!: string;

	@ManyToOne(() => CastSlot, { deleteRule: "cascade" })
	slot!: Rel<CastSlot>;

	/** Discord snowflake — NULL = slot non pourvu */
	@Property({ type: "varchar", columnType: "varchar(32)", nullable: true })
	userId: string | null = null;

	@Property({ type: "datetime", columnType: "timestamptz", defaultRaw: "NOW()" })
	assignedAt: Date = new Date();

	/** Discord snowflake du staff qui a fait l'assignation */
	@Property({ type: "varchar", columnType: "varchar(32)" })
	assignedBy!: string;

	/** Confirmation J-2 (NULL = pas encore confirmé) */
	@Property({ type: "datetime", columnType: "timestamptz", nullable: true })
	confirmedAt: Date | null = null;

	/** Idempotence — notification J-2 déjà envoyée */
	@Property({ type: "boolean", default: false })
	notifiedJ2: boolean = false;

	/** Idempotence — notification H-2 déjà envoyée */
	@Property({ type: "boolean", default: false })
	notifiedH2: boolean = false;
}
