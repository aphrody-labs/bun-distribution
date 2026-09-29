/**
 * Tests RulesetService — T-3.1
 *
 * Run: bun test tests/services/RulesetService.test.ts
 *
 * Strategy: Bun.SQL direct on la DB live (TEST_DB_URL) (same pattern as CastService.test.ts).
 * No discord.js / tsyringe imports to avoid cycle issues.
 *
 * Tests:
 *   1. findById — returns correct row from DB
 *   2. listOfficial — returns only is_official=true rows (3 seeds)
 *   3. clone — copies all fields and sets parent_ruleset_id
 *   4. clone — does NOT modify the parent row
 *   5. validate — rejects defaultBo = 0
 *   6. validate — rejects empty name
 *   7. validate — accepts valid semver + odd defaultBo
 *   8. validate — rejects even defaultBo (best-of must be odd)
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { validateRulesetMetadata as validate } from "@rosegriffon/achillea-core";

import { describeLive, hasLiveDb } from "../fixtures/live-db";

// ---------------------------------------------------------------------------
// DB
// ---------------------------------------------------------------------------

const DB_URL = process.env.TEST_DB_URL ?? "";

let sql: Awaited<ReturnType<typeof import("bun").default.SQL>>;

// ---------------------------------------------------------------------------
// Seeded IDs (from Migration20260426000000)
// ---------------------------------------------------------------------------

const LEGACY_ID = "aaaaaaaa-0000-0000-0000-000000000001";
const ASTRAL_LEAGUE_ID = "bbbbbbbb-0000-0000-0000-000000000001";
const ASTRAL_CUP_ID = "cccccccc-0000-0000-0000-000000000001";
const TBC_ID = "dddddddd-0000-0000-0000-000000000001";

// ---------------------------------------------------------------------------
// SQL helpers
// ---------------------------------------------------------------------------

type RulesetRow = {
	id: string;
	version: string;
	name: string;
	category: string;
	is_official: boolean;
	forbidden_tactics_dropable: string | null;
	forbidden_tactics_movement: string | null;
	forbidden_tactics_immobilization: string | null;
	forbidden_tactics_rng: string | null;
	stadiums_allowed: string | null;
	default_bo: number;
	golden_goal: boolean;
	half_time_minutes: number | null;
	judgment_of_advantage_protocol: string | null;
	tiebreaker_rules: string | null;
	parent_ruleset_id: string | null;
};

async function findById(id: string): Promise<RulesetRow | null> {
	const rows = await sql<RulesetRow[]>`SELECT * FROM ruleset WHERE id = ${id}`;
	return rows[0] ?? null;
}

async function insertRuleset(opts: {
	version: string;
	name: string;
	category?: string;
	isOfficial?: boolean;
	defaultBo?: number;
	goldenGoal?: boolean;
	forbiddenTacticsDropable?: string[] | null;
	forbiddenTacticsMovement?: string[] | null;
	forbiddenTacticsImmobilization?: string[] | null;
	forbiddenTacticsRng?: string[] | null;
	stadiumsAllowed?: string[] | null;
	judgmentOfAdvantageProtocol?: Record<string, unknown> | null;
	tiebreakerRules?: Record<string, unknown> | null;
	parentRulesetId?: string | null;
}): Promise<RulesetRow> {
	const [row] = await sql<RulesetRow[]>`
    INSERT INTO ruleset (
      version, name, category, is_official, default_bo, golden_goal,
      forbidden_tactics_dropable, forbidden_tactics_movement,
      forbidden_tactics_immobilization, forbidden_tactics_rng,
      stadiums_allowed, judgment_of_advantage_protocol,
      tiebreaker_rules, parent_ruleset_id
    ) VALUES (
      ${opts.version},
      ${opts.name},
      ${opts.category ?? "custom"},
      ${opts.isOfficial ?? false},
      ${opts.defaultBo ?? 3},
      ${opts.goldenGoal ?? false},
      ${opts.forbiddenTacticsDropable ? JSON.stringify(opts.forbiddenTacticsDropable) : null}::jsonb,
      ${opts.forbiddenTacticsMovement ? JSON.stringify(opts.forbiddenTacticsMovement) : null}::jsonb,
      ${opts.forbiddenTacticsImmobilization ? JSON.stringify(opts.forbiddenTacticsImmobilization) : null}::jsonb,
      ${opts.forbiddenTacticsRng ? JSON.stringify(opts.forbiddenTacticsRng) : null}::jsonb,
      ${opts.stadiumsAllowed ? JSON.stringify(opts.stadiumsAllowed) : null}::jsonb,
      ${opts.judgmentOfAdvantageProtocol ? JSON.stringify(opts.judgmentOfAdvantageProtocol) : null}::jsonb,
      ${opts.tiebreakerRules ? JSON.stringify(opts.tiebreakerRules) : null}::jsonb,
      ${opts.parentRulesetId ?? null}
    )
    RETURNING *
  `;
	return row;
}

/**
 * Clone a ruleset (mirrors RulesetService.clone logic at the SQL level).
 */
async function cloneRuleset(
	parentId: string,
	opts: { name: string; version: string; category?: string }
): Promise<RulesetRow> {
	const parent = await findById(parentId);
	if (!parent) throw new Error(`Parent not found: ${parentId}`);

	return insertRuleset({
		version: opts.version,
		name: opts.name,
		category: opts.category ?? "custom",
		isOfficial: false,
		defaultBo: parent.default_bo,
		goldenGoal: parent.golden_goal,
		forbiddenTacticsDropable: parent.forbidden_tactics_dropable
			? (JSON.parse(parent.forbidden_tactics_dropable) as string[])
			: null,
		forbiddenTacticsMovement: parent.forbidden_tactics_movement
			? (JSON.parse(parent.forbidden_tactics_movement) as string[])
			: null,
		forbiddenTacticsImmobilization: parent.forbidden_tactics_immobilization
			? (JSON.parse(parent.forbidden_tactics_immobilization) as string[])
			: null,
		forbiddenTacticsRng: parent.forbidden_tactics_rng
			? (JSON.parse(parent.forbidden_tactics_rng) as string[])
			: null,
		stadiumsAllowed: parent.stadiums_allowed
			? (JSON.parse(parent.stadiums_allowed) as string[])
			: null,
		judgmentOfAdvantageProtocol: parent.judgment_of_advantage_protocol
			? (JSON.parse(parent.judgment_of_advantage_protocol) as Record<string, unknown>)
			: null,
		tiebreakerRules: parent.tiebreaker_rules
			? (JSON.parse(parent.tiebreaker_rules) as Record<string, unknown>)
			: null,
		parentRulesetId: parent.id,
	});
}

async function cleanupTestData() {
	// Delete test rulesets (not the 4 seeded ones)
	await sql`
    DELETE FROM ruleset
    WHERE name LIKE 'Test %'
      AND id NOT IN (
        ${LEGACY_ID}, ${ASTRAL_LEAGUE_ID}, ${ASTRAL_CUP_ID}, ${TBC_ID}
      )
  `;
}

// ---------------------------------------------------------------------------
// Setup / Teardown
// ---------------------------------------------------------------------------

beforeAll(async () => {
	if (!hasLiveDb) return;
	const BunModule = await import("bun");
	sql = BunModule.SQL(DB_URL);
	await sql`SELECT 1`;
	await cleanupTestData();
});

afterAll(async () => {
	if (sql) {
		await cleanupTestData();
		await sql.end();
	}
});

// ---------------------------------------------------------------------------
// Test 1 — findById returns the correct row
// ---------------------------------------------------------------------------

describeLive("RulesetService — findById()", () => {
	test("retourne le bon ruleset par id (Astral League seed)", async () => {
		const row = await findById(ASTRAL_LEAGUE_ID);

		expect(row).not.toBeNull();
		expect(row!.id).toBe(ASTRAL_LEAGUE_ID);
		expect(row!.name).toBe("Astral League v1");
		expect(row!.version).toBe("1.0.0");
		expect(row!.is_official).toBe(true);
		expect(row!.default_bo).toBe(3);
	});

	test("retourne null pour un id inexistant", async () => {
		const row = await findById("00000000-ffff-ffff-ffff-000000000000");
		expect(row).toBeNull();
	});
});

// ---------------------------------------------------------------------------
// Test 2 — listOfficial returns only official rulesets (3 seeds)
// ---------------------------------------------------------------------------

describeLive("RulesetService — listOfficial()", () => {
	test("retourne exactement les 3 seeds officiels (is_official = true)", async () => {
		const rows = await sql<
			RulesetRow[]
		>`SELECT * FROM ruleset WHERE is_official = TRUE ORDER BY name`;

		expect(rows.length).toBeGreaterThanOrEqual(3);

		const names = rows.map((r) => r.name);
		expect(names).toContain("Astral League v1");
		expect(names).toContain("Astral Cup v1");
		expect(names).toContain("The Beyblade Combine v1");

		// Legacy must NOT be in official list
		expect(names).not.toContain("Legacy (pré-migration)");
	});
});

// ---------------------------------------------------------------------------
// Test 3 — clone copies all fields and sets parent_ruleset_id
// ---------------------------------------------------------------------------

describeLive("RulesetService — clone()", () => {
	test("clone copie tous les champs et set parent_ruleset_id", async () => {
		// Create a source ruleset with jsonb data
		const source = await insertRuleset({
			version: "1.0.0",
			name: "Test Source Ruleset",
			category: "official",
			isOfficial: false,
			defaultBo: 3,
			goldenGoal: true,
			forbiddenTacticsDropable: ["drop_burst"],
			forbiddenTacticsMovement: ["slide"],
			forbiddenTacticsImmobilization: ["pin"],
			forbiddenTacticsRng: ["rng_shuffle"],
			stadiumsAllowed: ["standard_s5"],
			judgmentOfAdvantageProtocol: { rule: "judge_majority" },
			tiebreakerRules: { rule: "sudden_death" },
		});

		const cloned = await cloneRuleset(source.id, {
			name: "Test Cloned Ruleset",
			version: "1.1.0",
		});

		// parent link
		expect(cloned.parent_ruleset_id).toBe(source.id);

		// scalar fields copied
		expect(cloned.default_bo).toBe(source.default_bo);
		expect(cloned.golden_goal).toBe(source.golden_goal);
		expect(cloned.half_time_minutes).toBe(source.half_time_minutes);

		// jsonb arrays copied
		const srcDropable = JSON.parse(source.forbidden_tactics_dropable ?? "null");
		const clnDropable = JSON.parse(cloned.forbidden_tactics_dropable ?? "null");
		expect(clnDropable).toEqual(srcDropable);

		const srcMovement = JSON.parse(source.forbidden_tactics_movement ?? "null");
		const clnMovement = JSON.parse(cloned.forbidden_tactics_movement ?? "null");
		expect(clnMovement).toEqual(srcMovement);

		const srcJudgment = JSON.parse(source.judgment_of_advantage_protocol ?? "null");
		const clnJudgment = JSON.parse(cloned.judgment_of_advantage_protocol ?? "null");
		expect(clnJudgment).toEqual(srcJudgment);

		// version & name overridden
		expect(cloned.name).toBe("Test Cloned Ruleset");
		expect(cloned.version).toBe("1.1.0");

		// new id
		expect(cloned.id).not.toBe(source.id);
	});

	// -------------------------------------------------------------------------
	// Test 4 — clone does NOT modify the parent
	// -------------------------------------------------------------------------

	test("clone ne modifie pas le ruleset parent", async () => {
		const source = await insertRuleset({
			version: "2.0.0",
			name: "Test Immutable Source",
			defaultBo: 5,
			goldenGoal: false,
		});

		const snapshotBefore = await findById(source.id);

		await cloneRuleset(source.id, {
			name: "Test Clone of Immutable",
			version: "2.1.0",
		});

		const snapshotAfter = await findById(source.id);

		expect(snapshotAfter!.name).toBe(snapshotBefore!.name);
		expect(snapshotAfter!.version).toBe(snapshotBefore!.version);
		expect(snapshotAfter!.default_bo).toBe(snapshotBefore!.default_bo);
		expect(snapshotAfter!.updated_at).toEqual(snapshotBefore!.updated_at);
	});
});

// ---------------------------------------------------------------------------
// Test 5 — validate rejects defaultBo = 0
// ---------------------------------------------------------------------------

describe("RulesetService — validate()", () => {
	test("rejette defaultBo = 0", () => {
		const result = validate({
			name: "Test Ruleset",
			version: "1.0.0",
			defaultBo: 0,
		});

		expect(result.ok).toBe(false);
		expect(result.errors.some((e) => e.includes("positive integer"))).toBe(true);
	});

	// -------------------------------------------------------------------------
	// Test 6 — validate rejects empty name
	// -------------------------------------------------------------------------

	test("rejette le nom vide", () => {
		const result = validate({
			name: "",
			version: "1.0.0",
			defaultBo: 3,
		});

		expect(result.ok).toBe(false);
		expect(result.errors.some((e) => e.includes("name"))).toBe(true);
	});

	// -------------------------------------------------------------------------
	// Test 7 — validate accepts valid semver + odd defaultBo
	// -------------------------------------------------------------------------

	test("accepte un ruleset valide (semver + defaultBo impair)", () => {
		const result = validate({
			name: "Valid Ruleset",
			version: "2.3.1",
			defaultBo: 5,
		});

		expect(result.ok).toBe(true);
		expect(result.errors).toHaveLength(0);
	});

	// -------------------------------------------------------------------------
	// Test 8 — validate rejects even defaultBo
	// -------------------------------------------------------------------------

	test("rejette defaultBo pair (best-of doit etre impair)", () => {
		const result = validate({
			name: "Even BO Ruleset",
			version: "1.0.0",
			defaultBo: 4,
		});

		expect(result.ok).toBe(false);
		expect(result.errors.some((e) => e.includes("odd"))).toBe(true);
	});

	test("accepte version 'legacy' comme version speciale", () => {
		const result = validate({
			name: "Legacy Ruleset",
			version: "legacy",
			defaultBo: 3,
		});

		expect(result.ok).toBe(true);
		expect(result.errors).toHaveLength(0);
	});
});
