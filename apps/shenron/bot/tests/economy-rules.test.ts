import { describe, expect, test } from "bun:test";
import { CANON_INFLATION_FACTOR, CANON_PRICES, canonEquivalent } from "~/lib/economy-canon";
import { changePercent, computeIndex, indexedPrice } from "~/lib/inflation-rules";
import { assess, flagExcess, MAX_BALANCE_SHARE, MAX_RATE, noticeReference } from "~/lib/ursaf-rules";
import { auditInputs, auditValue, neutralize } from "~/lib/input-audit";

describe("économie canon", () => {
	test("les repères sont triés et sourcés", () => {
		const prix = CANON_PRICES.map((p) => p.zeni);
		expect([...prix].toSorted((a, b) => a - b)).toEqual(prix);
		for (const p of CANON_PRICES) expect(p.source.url).toStartWith("https://dragonballfr.com/");
	});

	test("l'inflation canon du Budokai vaut ×2,96", () => {
		expect(CANON_INFLATION_FACTOR).toBeCloseTo(2.96, 2);
	});

	test("équivalent canon : le plus gros repère qui tient dans le montant", () => {
		expect(canonEquivalent(1_000_000)?.price.key).toBe("budokai");
		expect(canonEquivalent(1_000_000)?.times).toBe(2);
		expect(canonEquivalent(30)).toBeNull();
	});
});

describe("indice des prix", () => {
	const base = { referenceSupply: 1_000_000, elasticity: 0.5, maxDailyChange: 0.02 };

	test("masse stable : indice stable", () => {
		expect(computeIndex({ ...base, supply: 1_000_000, previousIndex: 1 })).toBe(1);
	});

	test("la hausse est bornée à 2 % par jour", () => {
		expect(computeIndex({ ...base, supply: 4_000_000, previousIndex: 1 })).toBe(1.02);
	});

	test("jamais sous 1, jamais au-dessus du facteur canon", () => {
		expect(computeIndex({ ...base, supply: 100, previousIndex: 1 })).toBe(1);
		expect(
			computeIndex({ ...base, supply: 1e15, previousIndex: 2.95, maxDailyChange: 1 })
		).toBeCloseTo(CANON_INFLATION_FACTOR, 4);
	});

	test("prix arrondis à un palier lisible", () => {
		expect(indexedPrice(5_000, 1.037)).toBe(5_200);
		expect(indexedPrice(50_000, 1.02)).toBe(51_000);
		expect(indexedPrice(999_999, 1)).toBe(1_000_000);
		expect(indexedPrice(0, 2)).toBe(0);
	});

	test("variation en pourcentage", () => {
		expect(changePercent(1, 1.05)).toBe(5);
		expect(changePercent(0, 2)).toBe(0);
	});
});

describe("URSAF", () => {
	const flag = (
		id: number,
		code: string,
		severity: "medium" | "high" | "critical",
		meta: Record<string, unknown>
	) => ({ id, code, severity, meta });

	test("seul l'excès au-dessus du seuil est imposable", () => {
		expect(
			flagExcess(flag(1, "SPIKE", "high", { amount: 1_000_000, threshold: 25_000 })).gains
		).toBe(975_000);
	});

	test("pas de double imposition entre plafonds qui se recouvrent", () => {
		const a = assess({
			flags: [
				flag(1, "HOURLY_CAP", "high", { hourSum: 500_000, threshold: 80_000 }),
				flag(2, "DAILY_CAP", "high", { daySum: 500_000, threshold: 250_000 }),
			],
			balance: 10_000_000,
			previousNotices: 0,
		});
		expect(a?.taxable).toBe(420_000);
		expect(a?.amount).toBe(210_000);
	});

	test("les pics distincts s'additionnent", () => {
		const a = assess({
			flags: [
				flag(1, "SPIKE", "critical", { amount: 1_025_000, threshold: 25_000 }),
				flag(2, "SPIKE", "critical", { amount: 1_025_000, threshold: 25_000 }),
			],
			balance: 50_000_000,
			previousNotices: 0,
		});
		expect(a?.taxable).toBe(2_000_000);
		expect(a?.rate).toBe(0.9);
		expect(a?.amount).toBe(1_800_000);
	});

	test("récidive : majoration plafonnée à 95 %", () => {
		const a = assess({
			flags: [flag(1, "SPIKE", "critical", { amount: 1_025_000, threshold: 25_000 })],
			balance: 50_000_000,
			previousNotices: 5,
		});
		expect(a?.rate).toBe(MAX_RATE);
	});

	test("l'avis ne prend jamais plus de la moitié du solde", () => {
		const a = assess({
			flags: [flag(1, "SPIKE", "high", { amount: 10_025_000, threshold: 25_000 })],
			balance: 300_000,
			previousNotices: 0,
		});
		expect(a?.amount).toBe(300_000 * MAX_BALANCE_SHARE);
	});

	test("cas réel : un ratio fortune/niveau ne vide plus un compte", () => {
		// Simulation du 2026-09-12 : solde 27,9 M, excès de fortune 30,4 M, critique.
		const a = assess({
			flags: [flag(1, "RATIO", "critical", { balance: 27_899_460, maxReasonable: -2_469_950 })],
			balance: 27_899_460,
			previousNotices: 0,
		});
		expect(a?.amount).toBe(Math.floor(27_899_460 * MAX_BALANCE_SHARE));
	});

	test("sous le minimum, pas d'avis ; signaux sans montant non taxés", () => {
		expect(
			assess({
				flags: [flag(1, "VELOCITY", "high", { hourEvents: 90 })],
				balance: 1e6,
				previousNotices: 0,
			})
		).toBeNull();
	});

	test("référence d'avis", () => {
		expect(noticeReference(42, new Date("2026-09-12T00:00:00Z"))).toBe("URSAF-2026-000042");
	});
});

describe("audit des entrées", () => {
	test("une entrée saine ne lève rien", () => {
		expect(
			auditInputs([
				{ name: "mise", value: 150 },
				{ name: "mot", value: "kamehameha" },
			]).score
		).toBe(0);
	});

	test("astuces numériques et caractères invisibles", () => {
		expect(auditValue("mise", Infinity)[0]?.code).toBe("NON_FINITE");
		expect(auditValue("mise", "1e309")[0]?.code).toBe("NUMERIC_TRICK");
		expect(auditValue("pseudo", "Go\u200Bku").some((f) => f.code === "ZERO_WIDTH")).toBe(true);
		expect(auditValue("texte", "\u202Eabc").some((f) => f.code === "BIDI")).toBe(true);
	});

	test("mentions de masse et invitations cumulent leur poids", () => {
		const a = auditInputs([{ name: "message", value: "@everyone rejoignez discord.gg/abcd" }]);
		expect(a.findings.map((f) => f.code).toSorted()).toEqual(["INVITE", "MASS_MENTION"]);
		expect(a.score).toBe(7);
	});

	test("neutralisation : pas de mention ni de bloc de code", () => {
		expect(neutralize("@everyone `x`")).toBe("@\u200Beveryone ˋxˋ");
	});
});
