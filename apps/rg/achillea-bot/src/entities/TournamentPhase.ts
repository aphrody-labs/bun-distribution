import { type Rel } from "@mikro-orm/core";
import { Entity, Enum, ManyToOne, PrimaryKey, Property } from "@mikro-orm/decorators/legacy";

import { PhaseKind, PhaseStatus } from "@/utils/enums";

import { CustomBaseEntity } from "./BaseEntity";
import { Tournament } from "./Tournament";

export interface PhaseConfig {
	rounds?: number;
	seeded?: boolean;
	qualifiersCount?: number;
	size?: number;
	tiebreakers?: string[];
	[key: string]: unknown;
}

@Entity({ tableName: "tournament_phase" })
export class TournamentPhase extends CustomBaseEntity {
	@PrimaryKey({ type: "uuid", defaultRaw: "gen_random_uuid()" })
	id!: string;

	@ManyToOne(() => Tournament, { deleteRule: "cascade" })
	tournament!: Rel<Tournament>;

	@Property()
	index!: number;

	@Enum(() => PhaseKind)
	kind!: PhaseKind;

	@Property({ type: "jsonb", nullable: true })
	config: PhaseConfig | null = null;

	@Enum({ items: () => PhaseStatus, default: PhaseStatus.Pending })
	status: PhaseStatus = PhaseStatus.Pending;

	@Property({ nullable: true })
	startedAt: Date | null = null;

	@Property({ nullable: true })
	endedAt: Date | null = null;

	@Property({ default: 0 })
	qualifiersCount: number = 0;
}
