/**
 * Exhaustivité : tout membre d'enum du contrat doit être connu de `@core`.
 *
 * `Record<Enum, string>` protège les tables qui existent, mais reste muet sur
 * l'enum entier qu'on a oublié de libeller, et sur le `switch` à `default` qui
 * range un nouveau membre dans « secondaire » sans rien dire. Ces deux angles
 * morts sont couverts ici, en croisant les exports réels du contrat avec le
 * registre de `@core`.
 */

import { describe, expect, test } from "bun:test";

import * as contract from "@rosegriffon/achillea-types";
import {
	CastAvailabilityStatus,
	CastEventStatus,
	LicenseStatus,
	OrganizationState,
	ParticipantStatus,
	PlayerNoteSeverity,
	SanctionType,
	TournamentState,
	WalletTransactionDirection,
} from "@rosegriffon/achillea-types";

import {
	enumValues,
	LABELLED_ENUMS,
	UNLABELLED_ENUMS,
	type EnumLike,
} from "../src/labels/registry";
import {
	castAvailabilityStatusTone,
	castEventStatusTone,
	licenseStatusTone,
	organizationStateTone,
	participantStatusTone,
	playerNoteSeverityTone,
	sanctionTypeTone,
	tournamentStateTone,
	walletDirectionTone,
	TONE_TO_SHADCN_BADGE,
	TONE_TO_TAILWIND,
	type Tone,
} from "../src/presentation/index";

/** Un export du contrat est-il un enum ? (objet de valeurs scalaires). */
function isEnumExport(value: unknown): value is EnumLike {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
	const values = Object.values(value);
	return (
		values.length > 0 &&
		values.every((member) => typeof member === "string" || typeof member === "number")
	);
}

const contractEnums = Object.entries(contract as Record<string, unknown>)
	.filter(([, value]) => isEnumExport(value))
	.map(([name, value]) => [name, value as EnumLike] as const);

describe("enums du contrat", () => {
	test("le contrat n'exporte que des enums, jamais de table de libellés", () => {
		// `ClanMemberRoleName` a longtemps vécu ici : des libellés français dans
		// un paquet dont la raison d'être est d'être traduisible mécaniquement.
		const frenchLabelLike = contractEnums.filter(([name]) =>
			/Name$|Label|LABELS$/u.test(name)
		);
		expect(frenchLabelLike.map(([name]) => name)).toEqual([]);
	});

	test("chaque enum est soit libellé, soit explicitement dispensé", () => {
		const orphans = contractEnums
			.map(([name]) => name)
			.filter((name) => !(name in LABELLED_ENUMS) && !(name in UNLABELLED_ENUMS));

		expect(
			orphans,
			`Enums sans libellé ni dispense : ${orphans.join(", ")}. Ajouter une table dans ` +
				"`src/labels/`, ou une justification dans `UNLABELLED_ENUMS`."
		).toEqual([]);
	});

	test("le registre ne référence aucun enum disparu du contrat", () => {
		const known = new Set(contractEnums.map(([name]) => name));
		const stale = [...Object.keys(LABELLED_ENUMS), ...Object.keys(UNLABELLED_ENUMS)].filter(
			(name) => !known.has(name)
		);
		expect(stale).toEqual([]);
	});

	test("une dispense sans justification n'en est pas une", () => {
		for (const [name, reason] of Object.entries(UNLABELLED_ENUMS)) {
			expect(reason.length, `${name} : justification vide`).toBeGreaterThan(20);
		}
	});

	test("chaque membre d'enum a un libellé non vide", () => {
		const missing: string[] = [];
		for (const [name, table] of Object.entries(LABELLED_ENUMS)) {
			const enumeration = contractEnums.find(([exported]) => exported === name)?.[1];
			if (!enumeration) continue;
			for (const value of enumValues(enumeration)) {
				const label = table[value];
				if (typeof label !== "string" || label.trim().length === 0) {
					missing.push(`${name}.${String(value)}`);
				}
			}
		}
		expect(missing).toEqual([]);
	});

	test("deux membres d'un même enum n'ont pas le même libellé", () => {
		const collisions: string[] = [];
		for (const [name, table] of Object.entries(LABELLED_ENUMS)) {
			const enumeration = contractEnums.find(([exported]) => exported === name)?.[1];
			if (!enumeration) continue;

			const seen = new Map<string, string>();
			for (const value of enumValues(enumeration)) {
				const label = table[value] as string;
				const previous = seen.get(label);
				if (previous !== undefined) {
					collisions.push(`${name} : « ${label} » partagé par ${previous} et ${String(value)}`);
				}
				seen.set(label, String(value));
			}
		}
		expect(collisions).toEqual([]);
	});

	test("aucun libellé ne laisse fuiter la valeur technique", () => {
		// Un `labelOf` qui retombe sur `String(key)` rendrait « single_elimination »
		// ou « PENDING_APPROVAL » à l'écran : le signe qu'une entrée manque.
		const raw: string[] = [];
		for (const [name, table] of Object.entries(LABELLED_ENUMS)) {
			const enumeration = contractEnums.find(([exported]) => exported === name)?.[1];
			if (!enumeration) continue;
			for (const value of enumValues(enumeration)) {
				const label = table[value] as string;
				if (typeof value === "string" && label === value && /[_A-Z]{2,}/u.test(value)) {
					raw.push(`${name}.${value}`);
				}
			}
		}
		expect(raw).toEqual([]);
	});
});

describe("tonalités", () => {
	const TONES: readonly Tone[] = ["success", "warn", "info", "danger", "secondary", "contrast"];

	/** Chaque mappeur, avec l'enum qu'il doit couvrir intégralement. */
	const MAPPERS: ReadonlyArray<{
		name: string;
		enumeration: EnumLike;
		tone: (value: never) => Tone;
	}> = [
		{ name: "sanctionTypeTone", enumeration: SanctionType, tone: sanctionTypeTone as never },
		{
			name: "playerNoteSeverityTone",
			enumeration: PlayerNoteSeverity,
			tone: playerNoteSeverityTone as never,
		},
		{ name: "castEventStatusTone", enumeration: CastEventStatus, tone: castEventStatusTone as never },
		{
			name: "castAvailabilityStatusTone",
			enumeration: CastAvailabilityStatus,
			tone: castAvailabilityStatusTone as never,
		},
		{ name: "tournamentStateTone", enumeration: TournamentState, tone: tournamentStateTone as never },
		{
			name: "participantStatusTone",
			enumeration: ParticipantStatus,
			tone: participantStatusTone as never,
		},
		{ name: "licenseStatusTone", enumeration: LicenseStatus, tone: licenseStatusTone as never },
		{
			name: "organizationStateTone",
			enumeration: OrganizationState,
			tone: organizationStateTone as never,
		},
		{
			name: "walletDirectionTone",
			enumeration: WalletTransactionDirection,
			tone: walletDirectionTone as never,
		},
	];

	test("chaque mappeur rend une tonalité connue pour chaque membre", () => {
		const invalid: string[] = [];
		for (const { name, enumeration, tone } of MAPPERS) {
			for (const value of enumValues(enumeration)) {
				const result = (tone as (v: unknown) => Tone)(value);
				if (!TONES.includes(result)) invalid.push(`${name}(${String(value)}) → ${result}`);
			}
		}
		expect(invalid).toEqual([]);
	});

	test("un mappeur ne range pas tous ses membres dans la même tonalité", () => {
		// Symptôme d'un `switch` dont les `case` ne matchent plus (valeurs d'enum
		// renommées) : tout tombe dans le `default`.
		const flattened: string[] = [];
		for (const { name, enumeration, tone } of MAPPERS) {
			const values = enumValues(enumeration);
			if (values.length < 3) continue;
			const distinct = new Set(values.map((value) => (tone as (v: unknown) => Tone)(value)));
			if (distinct.size === 1) flattened.push(`${name} → ${[...distinct][0]}`);
		}
		expect(flattened).toEqual([]);
	});

	test("chaque tonalité a une variante shadcn et des classes Tailwind", () => {
		for (const tone of TONES) {
			expect(TONE_TO_SHADCN_BADGE[tone], `variante manquante pour ${tone}`).toBeTruthy();
			expect(TONE_TO_TAILWIND[tone]?.length, `classes manquantes pour ${tone}`).toBeGreaterThan(0);
		}
		expect(Object.keys(TONE_TO_SHADCN_BADGE).sort()).toEqual([...TONES].sort());
		expect(Object.keys(TONE_TO_TAILWIND).sort()).toEqual([...TONES].sort());
	});
});
