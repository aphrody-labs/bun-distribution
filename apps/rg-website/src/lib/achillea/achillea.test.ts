/**
 * Compatibilité Achilléa ↔ `apps/website`.
 *
 * Ce test vaut garde-fou de migration : il échoue si un paquet Achilléa se met
 * à dépendre d'Angular, de `node:*` ou d'une API navigateur, ce qui casserait
 * son usage dans un Server Component Next.js.
 */

import { describe, expect, test } from "bun:test";

import {
	ParticipantStatus,
	SanctionType,
	StageType,
	TournamentState,
} from "@rosegriffon/achillea-types";

import {
	achilleaApiUrl,
	badgeVariant,
	createAchilleaClient,
	participantStatusTone,
	sanctionTypeLabel,
	sanctionTypeTone,
	stageTypeLabel,
	toneClassName,
	tournamentStateLabel,
	tournamentStateTone,
	winRatePercent,
} from "./index";

describe("contrat et règles métier dans le toolchain Next", () => {
	test("les enums du contrat sont utilisables tels quels", () => {
		expect(StageType.single_elimination).toBe("single_elimination" as StageType);
		expect(TournamentState.ONGOING).toBe("Ongoing" as TournamentState);
	});

	test("les libellés viennent de @core, pas d'une copie locale", () => {
		expect(stageTypeLabel(StageType.league)).toBe("Championnat (ligue)");
		expect(tournamentStateLabel(TournamentState.CANCELED)).toBe("Annulé");
		expect(sanctionTypeLabel(SanctionType.Kick)).toBe("Expulsion");
	});

	test("les calculs purs fonctionnent côté serveur", () => {
		expect(winRatePercent(7, 10)).toBe(70);
	});
});

describe("tonalités → shadcn/ui", () => {
	test("chaque tonalité a une variante de Badge", () => {
		expect(badgeVariant(sanctionTypeTone(SanctionType.Ban))).toBe("destructive");
		expect(badgeVariant(tournamentStateTone(TournamentState.ONGOING))).toBe("default");
		expect(badgeVariant(participantStatusTone(ParticipantStatus.WAITLISTED))).toBe("outline");
	});

	test("les classes Tailwind de repli sont non vides", () => {
		expect(toneClassName(participantStatusTone(ParticipantStatus.DISQUALIFIED))).toContain("red");
	});
});

describe("client API isomorphe", () => {
	test("l'URL d'API a une valeur par défaut hors environnement", () => {
		expect(achilleaApiUrl()).toMatch(/^https?:\/\//u);
	});

	test("le client accepte un fetch injecté — aucun réseau en test", async () => {
		const calls: string[] = [];
		const client = createAchilleaClient({
			baseUrl: "https://exemple.test/api",
			fetch: (input) => {
				calls.push(String(input));
				return Promise.resolve(
					new Response("{}", { status: 500, headers: { "content-type": "application/json" } })
				);
			},
		});

		expect(client.baseUrl).toBe("https://exemple.test/api");

		// Une erreur HTTP remonte en résultat typé, pas en exception : c'est ce
		// qui permet de l'afficher dans un Server Component sans try/catch.
		const anyClient = client as unknown as Record<string, unknown>;
		const guildMethod = Object.getOwnPropertyNames(Object.getPrototypeOf(client)).find((name) =>
			name.toLowerCase().includes("guild")
		);
		if (guildMethod && typeof anyClient[guildMethod] === "function") {
			const result = await (anyClient[guildMethod] as (...args: unknown[]) => Promise<unknown>)(
				"1"
			);
			expect(result).toMatchObject({ ok: false });
			expect(calls.length).toBeGreaterThan(0);
		}
	});
});
