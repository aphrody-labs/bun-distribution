import { type Rel } from "@mikro-orm/core";
import { Entity, Enum, ManyToOne, PrimaryKey, Property } from "@mikro-orm/decorators/legacy";

import { RulesetCategory } from "@/utils/enums";

import { CustomBaseEntity } from "./BaseEntity";

// ===========================================
// ================= Entity ==================
// ===========================================

@Entity({ tableName: "ruleset" })
export class Ruleset extends CustomBaseEntity {
	@PrimaryKey({ type: "uuid", defaultRaw: "gen_random_uuid()" })
	id!: string;

	/** Semver string e.g. "1.0.0" or "legacy" */
	@Property({ type: "varchar", columnType: "varchar(32)" })
	version!: string;

	/** Human-readable name e.g. "Astral League v1" */
	@Property({ type: "varchar", columnType: "varchar(128)" })
	name!: string;

	@Enum({ items: () => RulesetCategory, default: RulesetCategory.Custom })
	category: RulesetCategory = RulesetCategory.Custom;

	/** Whether this is a shipped official ruleset (read-only for end-users) */
	@Property({ default: false })
	isOfficial: boolean = false;

	// ---- Forbidden tactics -----------------------------------------------

	@Property({ type: "jsonb", nullable: true })
	forbiddenTacticsDropable: string[] | null = null;

	@Property({ type: "jsonb", nullable: true })
	forbiddenTacticsMovement: string[] | null = null;

	@Property({ type: "jsonb", nullable: true })
	forbiddenTacticsImmobilization: string[] | null = null;

	@Property({ type: "jsonb", nullable: true })
	forbiddenTacticsRng: string[] | null = null;

	// ---- Stadium / format ------------------------------------------------

	@Property({ type: "jsonb", nullable: true })
	stadiumsAllowed: string[] | null = null;

	/** Best of N default (must be > 0 and odd) */
	@Property({ default: 3 })
	defaultBo: number = 3;

	@Property({ default: false })
	goldenGoal: boolean = false;

	/** Half-time rest duration in minutes (null = no half-time) */
	@Property({ nullable: true })
	halfTimeMinutes: number | null = null;

	// ---- Tiebreaker & judgement -------------------------------------------

	@Property({ type: "jsonb", nullable: true })
	judgmentOfAdvantageProtocol: Record<string, unknown> | null = null;

	@Property({ type: "jsonb", nullable: true })
	tiebreakerRules: Record<string, unknown> | null = null;

	// ---- Versioning (self-reference) -------------------------------------

	/** Parent ruleset when this was created via clone() */
	@ManyToOne(() => Ruleset, { nullable: true, deleteRule: "set null" })
	parentRuleset?: Rel<Ruleset> | null = null;
}
