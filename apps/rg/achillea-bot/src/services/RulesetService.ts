import { createAchilleaSql } from "@rosegriffon/db/achillea-sql";
import { validateRulesetMetadata } from "@rosegriffon/achillea-core";
import type { RulesetValidationResult } from "@rosegriffon/achillea-core";
import type { Generated, Kysely } from "kysely";
import { singleton } from "tsyringe";

import { RulesetCategory } from "@/utils/enums";

interface RulesetDatabase {
	ruleset: {
		id: Generated<string>;
		created_at: Generated<Date>;
		updated_at: Generated<Date>;
		version: string;
		name: string;
		category: string;
		is_official: boolean;
		forbidden_tactics_dropable: string[] | null;
		forbidden_tactics_movement: string[] | null;
		forbidden_tactics_immobilization: string[] | null;
		forbidden_tactics_rng: string[] | null;
		stadiums_allowed: string[] | null;
		default_bo: number;
		golden_goal: boolean;
		half_time_minutes: number | null;
		judgment_of_advantage_protocol: Record<string, unknown> | null;
		tiebreaker_rules: Record<string, unknown> | null;
		parent_ruleset_id: string | null;
	};
}

const sql = createAchilleaSql<RulesetDatabase>() as Kysely<RulesetDatabase>;

type RulesetRow = Omit<RulesetDatabase["ruleset"], "id" | "created_at" | "updated_at"> & {
	id: string;
	created_at: Date;
	updated_at: Date;
};

export interface RulesetRecord {
	id: string;
	createdAt: Date;
	updatedAt: Date;
	version: string;
	name: string;
	category: RulesetCategory;
	isOfficial: boolean;
	forbiddenTacticsDropable: string[] | null;
	forbiddenTacticsMovement: string[] | null;
	forbiddenTacticsImmobilization: string[] | null;
	forbiddenTacticsRng: string[] | null;
	stadiumsAllowed: string[] | null;
	defaultBo: number;
	goldenGoal: boolean;
	halfTimeMinutes: number | null;
	judgmentOfAdvantageProtocol: Record<string, unknown> | null;
	tiebreakerRules: Record<string, unknown> | null;
	parentRulesetId: string | null;
}

export interface CloneOpts {
	name: string;
	version: string;
	category?: RulesetCategory;
}

export type ValidationResult = RulesetValidationResult;

function mapRuleset(row: RulesetRow): RulesetRecord {
	return {
		id: row.id,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
		version: row.version,
		name: row.name,
		category: row.category as RulesetCategory,
		isOfficial: row.is_official,
		forbiddenTacticsDropable: row.forbidden_tactics_dropable,
		forbiddenTacticsMovement: row.forbidden_tactics_movement,
		forbiddenTacticsImmobilization: row.forbidden_tactics_immobilization,
		forbiddenTacticsRng: row.forbidden_tactics_rng,
		stadiumsAllowed: row.stadiums_allowed,
		defaultBo: row.default_bo,
		goldenGoal: row.golden_goal,
		halfTimeMinutes: row.half_time_minutes,
		judgmentOfAdvantageProtocol: row.judgment_of_advantage_protocol,
		tiebreakerRules: row.tiebreaker_rules,
		parentRulesetId: row.parent_ruleset_id,
	};
}

@singleton()
export class RulesetService {
	private readonly db = sql;

	async findById(id: string): Promise<RulesetRecord> {
		const row = await this.db.selectFrom("ruleset").selectAll().where("id", "=", id).executeTakeFirst();
		if (!row) throw new Error(`Ruleset not found: ${id}`);
		return mapRuleset(row);
	}

	async listOfficial(): Promise<RulesetRecord[]> {
		const rows = await this.db
			.selectFrom("ruleset")
			.selectAll()
			.where("is_official", "=", true)
			.orderBy("name", "asc")
			.execute();
		return rows.map(mapRuleset);
	}

	async clone(parentId: string, opts: CloneOpts): Promise<RulesetRecord> {
		const parent = await this.db.selectFrom("ruleset").selectAll().where("id", "=", parentId).executeTakeFirst();
		if (!parent) throw new Error(`Parent ruleset not found: ${parentId}`);

		const row = await this.db
			.insertInto("ruleset")
			.values({
				version: opts.version,
				name: opts.name,
				category: opts.category ?? RulesetCategory.Custom,
				is_official: false,
				forbidden_tactics_dropable: parent.forbidden_tactics_dropable ? [...parent.forbidden_tactics_dropable] : null,
				forbidden_tactics_movement: parent.forbidden_tactics_movement ? [...parent.forbidden_tactics_movement] : null,
				forbidden_tactics_immobilization: parent.forbidden_tactics_immobilization ? [...parent.forbidden_tactics_immobilization] : null,
				forbidden_tactics_rng: parent.forbidden_tactics_rng ? [...parent.forbidden_tactics_rng] : null,
				stadiums_allowed: parent.stadiums_allowed ? [...parent.stadiums_allowed] : null,
				default_bo: parent.default_bo,
				golden_goal: parent.golden_goal,
				half_time_minutes: parent.half_time_minutes,
				judgment_of_advantage_protocol: parent.judgment_of_advantage_protocol ? { ...parent.judgment_of_advantage_protocol } : null,
				tiebreaker_rules: parent.tiebreaker_rules ? { ...parent.tiebreaker_rules } : null,
				parent_ruleset_id: parent.id,
			})
			.returningAll()
			.executeTakeFirstOrThrow();

		return mapRuleset(row);
	}

	validate(ruleset: { name: string; version: string; defaultBo: number }): ValidationResult {
		return validateRulesetMetadata(ruleset);
	}
}
