/**
 * `domain/brackets.ts` recopie volontairement les unions de `brackets-model`
 * pour garder le contrat à zéro dépendance runtime.
 *
 * Ce test rend la copie sûre : `brackets-model` est une devDependency, et les
 * assertions ci-dessous échouent au `type-check` dès que la lib diverge.
 */

import { describe, expect, test } from "bun:test";

import type {
	GrandFinalType as LibGrandFinalType,
	Id as LibId,
	RoundRobinMode as LibRoundRobinMode,
	SeedOrdering as LibSeedOrdering,
	StageType as LibStageType,
} from "brackets-model";

import type {
	BracketId,
	BracketsStageType,
	GrandFinalType,
	RoundRobinMode,
	SeedOrdering,
} from "../src/domain/brackets";
import { BracketMatchStatus } from "../src/domain/brackets";

/** Échoue à la compilation si `A` et `B` ne sont pas le même type. */
type Exact<A, B> = [A] extends [B] ? ([B] extends [A] ? true : never) : never;

describe("compatibilité brackets-model", () => {
	test("les unions recopiées sont identiques à celles de la lib", () => {
		const stageType: Exact<BracketsStageType, LibStageType> = true;
		const seedOrdering: Exact<SeedOrdering, LibSeedOrdering> = true;
		const grandFinal: Exact<GrandFinalType, LibGrandFinalType> = true;
		const roundRobin: Exact<RoundRobinMode, LibRoundRobinMode> = true;
		const id: Exact<BracketId, LibId> = true;

		expect([stageType, seedOrdering, grandFinal, roundRobin, id]).toEqual([
			true,
			true,
			true,
			true,
			true,
		]);
	});

	test("les statuts de match gardent leur valeur numérique persistée", () => {
		expect(BracketMatchStatus).toMatchObject({
			Locked: 0,
			Waiting: 1,
			Ready: 2,
			Running: 3,
			Completed: 4,
			Archived: 5,
		});
	});
});
