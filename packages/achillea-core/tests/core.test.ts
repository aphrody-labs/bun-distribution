import { describe, expect, test } from "bun:test";

import {
	AchilleaRole,
	achilleaRoleToUserRole,
	buildAbilityFor,
	chunkArray,
	computeMatchElo,
	computePercentile,
	DEFAULT_K_FACTOR,
	eloDelta,
	eloToRankKey,
	eloToTier,
	ESCALATION_WINDOW_SEC,
	evaluateEscalation,
	evaluateLicenseValidity,
	evaluateProposalOutcome,
	expectedScore,
	progressiveEloDelta,
	tierEloFactors,
	formatAchCurrency,
	formatDate,
	formatLicenseNumber,
	generateQrSecret,
	isValidLicenseNumber,
	isValidUrl,
	LicenseStatus,
	normalizeNames,
	parseLicenseNumber,
	ProposalStatus,
	safeEqual,
	SanctionType,
	signHmacSha256,
	UserRole,
	userRoleToAchilleaRole,
	validString,
	verifyHmacSha256,
	VotingStrategy,
} from "../src/index";

describe("elo", () => {
	test("scores attendus symétriques pour des ratings égaux", () => {
		expect(expectedScore(1000, 1000)).toBeCloseTo(0.5, 6);
	});

	test("computeMatchElo : delta ~ K/2 à égalité, perdant borné", () => {
		const r = computeMatchElo(1000, 1000);
		expect(r.delta).toBe(Math.round(DEFAULT_K_FACTOR / 2));
		expect(r.newWinner).toBe(1000 + r.delta);
		expect(r.newLoser).toBeGreaterThanOrEqual(0);
	});

	test("computeMatchElo : favori gagne peu, outsider perd peu", () => {
		const r = computeMatchElo(2000, 1000);
		expect(r.delta).toBeLessThan(DEFAULT_K_FACTOR / 2);
	});

	test("computeMatchElo : rating perdant borné à 0", () => {
		// Perdant à 2 contre un adversaire de même niveau : perd ~16 → clamp à 0.
		const r = computeMatchElo(2, 2);
		expect(r.newLoser).toBe(0);
	});

	test("eloDelta : victoire vs nul vs défaite", () => {
		expect(eloDelta(1000, 1000, 1, 32)).toBe(16);
		expect(eloDelta(1000, 1000, 0.5, 32)).toBe(0);
		expect(eloDelta(1000, 1000, 0, 32)).toBe(-16);
	});

	test("progressiveEloDelta : Fer gagne gros / perd peu (+20 / -5 à égalité)", () => {
		// Index 0 = Fer : winK 40, lossK 10.
		expect(progressiveEloDelta(0, 0, 1, 0)).toBe(20);
		expect(progressiveEloDelta(0, 0, 0, 0)).toBe(-5);
	});

	test("progressiveEloDelta : Divin équilibré (±16 à égalité)", () => {
		// Index 8 = Divin : winK = lossK = 32 → symétrique comme l'Elo classique.
		expect(progressiveEloDelta(800, 800, 1, 8)).toBe(16);
		expect(progressiveEloDelta(800, 800, 0, 8)).toBe(-16);
	});

	test("progressiveEloDelta : durcissement progressif des pertes Fer→Divin", () => {
		const perteFer = progressiveEloDelta(0, 0, 0, 0); // -5
		const perteOr = progressiveEloDelta(0, 0, 0, 3); // -9
		const perteDivin = progressiveEloDelta(0, 0, 0, 8); // -16
		expect(perteFer).toBeGreaterThan(perteOr); // -5 > -9
		expect(perteOr).toBeGreaterThan(perteDivin); // -9 > -16
	});

	test("progressiveEloDelta : index hors bornes clampé (≥10 = Légendaire)", () => {
		expect(progressiveEloDelta(2200, 2200, 1, 99)).toBe(16);
		expect(progressiveEloDelta(0, 0, 1, -3)).toBe(20); // négatif → Fer
	});

	test("tierEloFactors : bornes", () => {
		expect(tierEloFactors(0)).toEqual({ winK: 40, lossK: 10 });
		expect(tierEloFactors(8)).toEqual({ winK: 32, lossK: 32 });
		expect(tierEloFactors(50)).toEqual({ winK: 32, lossK: 32 });
	});
});

describe("ranking", () => {
	const tiers = [
		{ key: "Bronze", minElo: 0, maxElo: 1199, gradient: [] },
		{ key: "Gold", minElo: 1200, maxElo: 1599, gradient: [] },
	];

	test("eloToTier / eloToRankKey", () => {
		expect(eloToTier(1300, tiers)?.key).toBe("Gold");
		expect(eloToRankKey(50, tiers)).toBe("Bronze");
		expect(eloToRankKey(9999, tiers)).toBe("Unranked");
	});

	test("computePercentile", () => {
		expect(computePercentile(1, 1000)).toBe(0.1);
		expect(computePercentile(500, 1000)).toBe(50);
		expect(computePercentile(null, 1000)).toBeNull();
		expect(computePercentile(5, 0)).toBeNull();
	});
});

describe("sanctions", () => {
	test("barème d'escalade 3 / 5 / 8", () => {
		expect(evaluateEscalation(2)).toBeNull();
		expect(evaluateEscalation(3)).toEqual({ type: SanctionType.Mute, durationSec: 60 * 60 });
		expect(evaluateEscalation(5)).toEqual({ type: SanctionType.Mute, durationSec: 24 * 60 * 60 });
		expect(evaluateEscalation(8)).toEqual({
			type: SanctionType.Ban,
			durationSec: 7 * 24 * 60 * 60,
		});
		expect(ESCALATION_WINDOW_SEC).toBe(30 * 24 * 60 * 60);
	});
});

describe("votes", () => {
	test("MAJORITY : verrou anticipé pour", () => {
		expect(
			evaluateProposalOutcome({
				approvals: 3,
				rejections: 0,
				totalEligible: 4,
				minParticipationRatio: 0.5,
				strategy: VotingStrategy.MAJORITY,
			})
		).toBe(ProposalStatus.APPROVED);
	});

	test("UNANIMOUS : un refus rejette", () => {
		expect(
			evaluateProposalOutcome({
				approvals: 2,
				rejections: 1,
				totalEligible: 4,
				minParticipationRatio: 1,
				strategy: VotingStrategy.UNANIMOUS,
			})
		).toBe(ProposalStatus.REJECTED);
	});

	test("UNANIMOUS : approuvé seulement si tous pour", () => {
		expect(
			evaluateProposalOutcome({
				approvals: 3,
				rejections: 0,
				totalEligible: 3,
				minParticipationRatio: 1,
				strategy: VotingStrategy.UNANIMOUS,
			})
		).toBe(ProposalStatus.APPROVED);
	});

	test("EXPIRED sous quorum", () => {
		expect(
			evaluateProposalOutcome({
				approvals: 1,
				rejections: 0,
				totalEligible: 10,
				minParticipationRatio: 0.5,
				strategy: VotingStrategy.MAJORITY,
				expired: true,
			})
		).toBe(ProposalStatus.EXPIRED);
	});

	test("reste PENDING (null) si rien à décider", () => {
		expect(
			evaluateProposalOutcome({
				approvals: 1,
				rejections: 1,
				totalEligible: 10,
				minParticipationRatio: 0.5,
				strategy: VotingStrategy.MAJORITY,
			})
		).toBeNull();
	});

	test("SUPERMAJORITY_2_3", () => {
		expect(
			evaluateProposalOutcome({
				approvals: 4,
				rejections: 0,
				totalEligible: 6,
				minParticipationRatio: 0.5,
				strategy: VotingStrategy.SUPERMAJORITY_2_3,
			})
		).toBe(ProposalStatus.APPROVED);
	});
});

describe("licenses", () => {
	test("format / parse / validation ACH-YYYY-#####", () => {
		expect(formatLicenseNumber(2026, 42)).toBe("ACH-2026-00042");
		expect(parseLicenseNumber("ACH-2026-00042")).toEqual({ year: 2026, seq: 42 });
		expect(parseLicenseNumber("BAD")).toBeNull();
		expect(isValidLicenseNumber("ACH-2026-00042")).toBe(true);
		expect(isValidLicenseNumber("ACH-26-42")).toBe(false);
	});

	test("generateQrSecret : 64 hex chars", () => {
		const s = generateQrSecret();
		expect(s).toMatch(/^[0-9a-f]{64}$/);
		expect(generateQrSecret()).not.toBe(s);
	});

	test("safeEqual", () => {
		expect(safeEqual("abc", "abc")).toBe(true);
		expect(safeEqual("abc", "abd")).toBe(false);
		expect(safeEqual("abc", "ab")).toBe(false);
	});

	test("evaluateLicenseValidity : révoquée avant expirée", () => {
		const future = Date.now() + 1000;
		expect(evaluateLicenseValidity({ status: LicenseStatus.Active, validUntil: future })).toEqual({
			valid: true,
		});
		expect(evaluateLicenseValidity({ status: LicenseStatus.Revoked, validUntil: future })).toEqual({
			valid: false,
			reason: "revoked",
		});
		expect(
			evaluateLicenseValidity({ status: LicenseStatus.Active, validUntil: Date.now() - 1000 })
		).toEqual({ valid: false, reason: "expired" });
	});

	test("HMAC sign / verify (Web Crypto)", async () => {
		const sig = await signHmacSha256("payload", "secret");
		expect(sig).toMatch(/^[0-9a-f]{64}$/);
		expect(await verifyHmacSha256("payload", sig, "secret")).toBe(true);
		expect(await verifyHmacSha256("payload", sig, "autre")).toBe(false);
	});
});

describe("names / validation / format", () => {
	test("normalizeNames", () => {
		expect(normalizeNames("Hello123")).toBe("HELLO123");
		// Majuscules accentuées translittérées en ASCII majuscule ; les minuscules
		// accentuées gardent leur casse (comportement historique du bot).
		expect(normalizeNames("CAFÉ")).toBe("CAFE");
		expect(normalizeNames("café")).toBe("CAFe");
	});

	test("validString / isValidUrl / chunkArray", () => {
		expect(validString("a", "b")).toBe(true);
		expect(validString("a", "")).toBe(false);
		expect(validString()).toBe(false);
		expect(isValidUrl("https://x.fr")).toBe(true);
		expect(isValidUrl("nope")).toBe(false);
		expect(chunkArray([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
	});

	test("formatDate / formatAchCurrency", () => {
		expect(formatDate(new Date("2026-01-15T10:30:00Z"), "onlyDateFileName", "UTC")).toBe(
			"2026-01-15"
		);
		expect(formatAchCurrency(1500)).toContain("ACH");
	});
});

describe("access (RBAC)", () => {
	test("mapping UserRole <-> AchilleaRole", () => {
		expect(userRoleToAchilleaRole(UserRole.Moderator)).toBe(AchilleaRole.staff);
		expect(achilleaRoleToUserRole(AchilleaRole.owner)).toBe(UserRole.SuperAdministrator);
	});

	test("CASL : permissions par rôle", () => {
		const staff = buildAbilityFor(AchilleaRole.staff);
		expect(staff.can("moderate", "Sanction")).toBe(true);
		expect(staff.can("manage", "User")).toBe(false);

		const owner = buildAbilityFor(AchilleaRole.owner);
		expect(owner.can("manage", "all")).toBe(true);
	});
});
