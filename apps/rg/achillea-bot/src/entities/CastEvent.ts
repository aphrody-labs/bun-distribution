import { Entity, Enum, Index, PrimaryKey, Property } from "@mikro-orm/decorators/legacy";

import { CastEventKind, CastEventStatus } from "@/utils/enums";
import { CustomBaseEntity } from "./BaseEntity";

// =============================================================================
// CastEvent — T-2.1
// Représente un événement à caster (match, tournoi, stream, autre).
// =============================================================================

@Entity({ tableName: "cast_event" })
@Index({ properties: ["status"] })
export class CastEvent extends CustomBaseEntity {
	@PrimaryKey({ type: "uuid", defaultRaw: "gen_random_uuid()" })
	id!: string;

	@Property({ type: "varchar", columnType: "varchar(255)" })
	name!: string;

	@Enum(() => CastEventKind)
	kind!: CastEventKind;

	@Property({ type: "datetime", columnType: "timestamptz" })
	scheduledAt!: Date;

	/** Durée en minutes */
	@Property({ type: "int" })
	duration: number = 60;

	/** FK optionnelle vers Tournament.id (uuid) */
	@Property({ type: "uuid", nullable: true })
	tournamentId: string | null = null;

	@Enum(() => CastEventStatus)
	status: CastEventStatus = CastEventStatus.Planned;

	@Property({ type: "text", nullable: true })
	description: string | null = null;

	@Property({ type: "varchar", columnType: "varchar(512)", nullable: true })
	twitchUrl: string | null = null;

	/** Discord snowflake de l'auteur */
	@Property({ type: "varchar", columnType: "varchar(32)" })
	createdBy!: string;
}
