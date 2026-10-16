/**
 * Suite de tests approfondie de @rosegriffon/achillea-core (logique pure, multi-runtime).
 *
 * Complémentaire de `core.test.ts` : on cible ici les fonctions / constantes
 * exportées peu ou pas couvertes et les cas limites de CHAQUE domaine
 * (elo, ranking, sanctions, votes, names, format, validation, licenses,
 * access/RBAC). Aucune DB, aucun binding natif : uniquement des standards Web
 * (Web Crypto, Intl, URL) + @casl/ability + transliterate.
 */

import { describe, expect, test } from "bun:test";

import {
	AchilleaRole,
	achilleaRoleToUserRole,
	ACH_CURRENCY_SYMBOL,
	applyEloUpdate,
	buildAbilityFor,
	chunkArray,
	computeMatchElo,
	computePercentile,
	DEFAULT_BASE_RATING,
	DEFAULT_K_FACTOR,
	DEFAULT_LOCALE,
	DEFAULT_TIMEZONE,
	eloDelta,
	eloToRankKey,
	eloToTier,
	ESCALATION_TIERS,
	ESCALATION_WINDOW_SEC,
	evaluateEscalation,
	evaluateLicenseValidity,
	evaluateProposalOutcome,
	expectedScore,
	formatAchCurrency,
	formatDate,
	formatLicenseNumber,
	formatNumber,
	generateQrSecret,
	isValidLicenseNumber,
	isValidUrl,
	LICENSE_NUMBER_REGEX,
	LICENSE_PREFIX,
	LICENSE_SEQ_PADDING,
	LICENSE_VALIDITY_MS,
	LicenseStatus,
	normalizeNames,
	numberAlign,
	parseLicenseNumber,
	ProposalStatus,
	safeEqual,
	SanctionIssuerType,
	SanctionType,
	signHmacSha256,
	UNRANKED_KEY,
	UserRole,
	userRoleToAchilleaRole,
	validString,
	verifyHmacSha256,
	VotingStrategy,
} from "../src/index";

describe("elo — cas limites & helpers non couverts", () => {
	test("constantes par défaut", () => {
		expect(DEFAULT_K_FACTOR).toBe(32);
		expect(DEFAULT_BASE_RATING).toBe(0);
	});

	test("expectedScore : asymétrie favori/outsider et bornes 0..1", () => {
		const favori = expectedScore(1400, 1000);
		const outsider = expectedScore(1000, 1400);
		// Les deux probabilités sont complémentaires et le favori est > 0.5.
		expect(favori + outsider).toBeCloseTo(1, 6);
		expect(favori).toBeGreaterThan(0.5);
		expect(outsider).toBeLessThan(0.5);
		// Écart de 400 points ELO ≈ 10:1 (≈ 0.909).
		expect(favori).toBeCloseTo(0.909, 2);
	});

	test("eloDelta : variation nulle quand le résultat suit la probabilité", () => {
		// Favori massif (Δ400) attendu à ~0.909 ; une victoire ne rapporte presque rien.
		const win = eloDelta(1400, 1000, 1, 32);
		expect(win).toBe(Math.round(32 * (1 - expectedScore(1400, 1000))));
		expect(win).toBeGreaterThanOrEqual(0);
		expect(win).toBeLessThan(16);
		// Une défaite du favori coûte cher (proche de -K).
		const loss = eloDelta(1400, 1000, 0, 32);
		expect(loss).toBeLessThan(-16);
	});

	test("applyEloUpdate : application normale et clamp à 0", () => {
		expect(applyEloUpdate(1000, 20)).toEqual({ newElo: 1020, clampedDelta: 20 });
		// Delta négatif au-delà du rating : borné à 0, clampedDelta recalculé.
		expect(applyEloUpdate(10, -50)).toEqual({ newElo: 0, clampedDelta: -10 });
		// Pile à zéro reste à zéro.
		expect(applyEloUpdate(0, -5)).toEqual({ newElo: 0, clampedDelta: 0 });
	});

	test("computeMatchElo : K personnalisé respecté", () => {
		const r = computeMatchElo(1000, 1000, 40);
		expect(r.delta).toBe(20);
		expect(r.newWinner).toBe(1020);
		expect(r.newLoser).toBe(980);
	});
});

describe("ranking — bornes inclusives & hors barème", () => {
	const tiers = [
		{ key: "Bronze", minElo: 0, maxElo: 1199, gradient: [] },
		{ key: "Argent", minElo: 1200, maxElo: 1599, gradient: [] },
		{ key: "Or", minElo: 1600, maxElo: 2000, gradient: [] },
	];

	test("eloToTier : bornes basse et haute incluses", () => {
		expect(eloToTier(0, tiers)?.key).toBe("Bronze");
		expect(eloToTier(1199, tiers)?.key).toBe("Bronze");
		expect(eloToTier(1200, tiers)?.key).toBe("Argent");
		expect(eloToTier(2000, tiers)?.key).toBe("Or");
	});

	test("eloToTier : hors barème → null", () => {
		expect(eloToTier(2001, tiers)).toBeNull();
		expect(eloToTier(-1, tiers)).toBeNull();
		expect(eloToTier(1000, [])).toBeNull();
	});

	test("eloToRankKey : libellé Unranked hors barème", () => {
		expect(UNRANKED_KEY).toBe("Unranked");
		expect(eloToRankKey(2500, tiers)).toBe(UNRANKED_KEY);
		expect(eloToRankKey(1600, tiers)).toBe("Or");
	});

	test("computePercentile : arrondi, plancher 0.1 et entrées invalides", () => {
		// Plancher à 0.1 même pour le top 1.
		expect(computePercentile(1, 100000)).toBe(0.1);
		// Arrondi à une décimale.
		expect(computePercentile(333, 1000)).toBe(33.3);
		expect(computePercentile(1000, 1000)).toBe(100);
		// Entrées invalides → null.
		expect(computePercentile(0, 1000)).toBeNull();
		expect(computePercentile(10, 0)).toBeNull();
		expect(computePercentile(10, -5)).toBeNull();
	});
});

describe("sanctions — barème d'escalade complet", () => {
	test("ESCALATION_TIERS : trié du plus sévère au moins sévère", () => {
		expect(ESCALATION_TIERS.map((t) => t.threshold)).toEqual([8, 5, 3]);
		expect(ESCALATION_TIERS[0]?.decision.type).toBe(SanctionType.Ban);
	});

	test("evaluateEscalation : sous le 1er seuil → null", () => {
		expect(evaluateEscalation(0)).toBeNull();
		expect(evaluateEscalation(2)).toBeNull();
	});

	test("evaluateEscalation : palier le plus élevé atteint l'emporte", () => {
		expect(evaluateEscalation(3)).toEqual({ type: SanctionType.Mute, durationSec: 3600 });
		expect(evaluateEscalation(4)).toEqual({ type: SanctionType.Mute, durationSec: 3600 });
		expect(evaluateEscalation(6)).toEqual({ type: SanctionType.Mute, durationSec: 86400 });
		expect(evaluateEscalation(10)).toEqual({
			type: SanctionType.Ban,
			durationSec: 7 * 86400,
		});
	});

	test("ESCALATION_WINDOW_SEC = 30 jours et enums sanction exposés", () => {
		expect(ESCALATION_WINDOW_SEC).toBe(2592000);
		expect(SanctionType.Warn).toBe("warn");
		expect(SanctionIssuerType.System).toBe("system");
	});
});

describe("votes — stratégies & quorum", () => {
	test("MAJORITY : rejet anticipé impossible à rattraper", () => {
		expect(
			evaluateProposalOutcome({
				approvals: 0,
				rejections: 3,
				totalEligible: 4,
				minParticipationRatio: 0.5,
				strategy: VotingStrategy.MAJORITY,
			})
		).toBe(ProposalStatus.REJECTED);
	});

	test("MAJORITY : quorum atteint départage à la majorité simple", () => {
		// 3 votes sur 4, quorum = 2 ; 2 pour / 1 contre → approuvé.
		expect(
			evaluateProposalOutcome({
				approvals: 2,
				rejections: 1,
				totalEligible: 4,
				minParticipationRatio: 0.5,
				strategy: VotingStrategy.MAJORITY,
			})
		).toBe(ProposalStatus.APPROVED);
	});

	test("SUPERMAJORITY_2_3 : rejet quand le seuil 2/3 devient inatteignable", () => {
		// 6 éligibles → seuil total ceil(2/3*6)=4 ; 0 pour + 3 votes restants = 3 < 4.
		expect(
			evaluateProposalOutcome({
				approvals: 0,
				rejections: 3,
				totalEligible: 6,
				minParticipationRatio: 0.5,
				strategy: VotingStrategy.SUPERMAJORITY_2_3,
			})
		).toBe(ProposalStatus.REJECTED);
	});

	test("SUPERMAJORITY_2_3 : reste en attente si quorum non atteint", () => {
		// 2 pour / 0 contre sur 6 : seuil 2/3 encore atteignable mais quorum (3) non atteint.
		expect(
			evaluateProposalOutcome({
				approvals: 2,
				rejections: 0,
				totalEligible: 6,
				minParticipationRatio: 0.5,
				strategy: VotingStrategy.SUPERMAJORITY_2_3,
			})
		).toBeNull();
	});

	test("UNANIMOUS : expiration sous quorum → EXPIRED", () => {
		expect(
			evaluateProposalOutcome({
				approvals: 2,
				rejections: 0,
				totalEligible: 4,
				minParticipationRatio: 1,
				strategy: VotingStrategy.UNANIMOUS,
				expired: true,
			})
		).toBe(ProposalStatus.EXPIRED);
	});

	test("UNANIMOUS : un refus rejette même expiré (priorité au refus)", () => {
		expect(
			evaluateProposalOutcome({
				approvals: 1,
				rejections: 1,
				totalEligible: 4,
				minParticipationRatio: 1,
				strategy: VotingStrategy.UNANIMOUS,
				expired: true,
			})
		).toBe(ProposalStatus.REJECTED);
	});
});

describe("names — translittération Unicode stylisé & rejet", () => {
	test("minuscules ASCII → majuscules", () => {
		expect(normalizeNames("abc")).toBe("ABC");
		expect(normalizeNames("Player1")).toBe("PLAYER1");
	});

	test("lettres mathématiques gras (bold) → ASCII majuscule", () => {
		// 𝐀 = U+1D400 (bloc mathematical bold, mappé sur le bloc à 0x1D538-... selon impl)
		// On utilise un bloc présent dans alphaBlocks : Fraktur 𝔄 = U+1D504.
		expect(normalizeNames("𝔄")).toBe("A");
		// Double-struck 𝔸 = U+1D538.
		expect(normalizeNames("𝔸")).toBe("A");
	});

	test("chiffres mathématiques bold → ASCII", () => {
		// 𝟎 = U+1D7CE (mathematical bold digit zero).
		expect(normalizeNames("𝟎𝟗")).toBe("09");
	});

	test("lettres cerclées → ASCII majuscule", () => {
		// Ⓐ = U+24B6 (circled capital A).
		expect(normalizeNames("Ⓐ")).toBe("A");
	});

	test("accents : majuscule translittérée, minuscule conserve sa casse", () => {
		expect(normalizeNames("CAFÉ")).toBe("CAFE");
		expect(normalizeNames("café")).toBe("CAFe");
	});

	test("caractère non normalisable (marque combinante seule) → chaîne vide (rejet)", () => {
		// U+0301 (accent aigu combinant isolé) : translittéré en "" → signal de rejet.
		expect(normalizeNames("́")).toBe("");
	});
});

describe("format — Intl portable", () => {
	test("constantes par défaut", () => {
		expect(DEFAULT_TIMEZONE).toBe("Europe/Paris");
		expect(DEFAULT_LOCALE).toBe("fr-FR");
		expect(ACH_CURRENCY_SYMBOL).toBe("ACH");
	});

	test("formatNumber : séparateur de milliers fr-FR (espace insécable)", () => {
		const out = formatNumber(1500);
		expect(out).toMatch(/^1\s500$/u);
	});

	test("formatAchCurrency : montant + symbole ACH, décimales tronquées", () => {
		const out = formatAchCurrency(1500.9);
		expect(out.endsWith(" ACH")).toBe(true);
		expect(out).toMatch(/^1\s501\sACH$/u);
		expect(formatAchCurrency(0)).toBe("0 ACH");
	});

	test("formatDate : masques default / onlyDate / onlyDateFileName (UTC)", () => {
		const d = new Date("2026-01-15T10:30:45Z");
		expect(formatDate(d, "default", "UTC")).toBe("15/01/2026 - 10:30:45");
		expect(formatDate(d, "onlyDate", "UTC")).toBe("15/01/2026");
		expect(formatDate(d, "onlyDateFileName", "UTC")).toBe("2026-01-15");
		// Accepte aussi un timestamp / une string ISO.
		expect(formatDate(d.getTime(), "onlyDateFileName", "UTC")).toBe("2026-01-15");
		expect(formatDate("2026-01-15T10:30:45Z", "onlyDate", "UTC")).toBe("15/01/2026");
	});
});

describe("validation — helpers purs", () => {
	test("validString : rejette non-string, vide et trim-vide", () => {
		expect(validString("ok")).toBe(true);
		expect(validString("a", "b", "c")).toBe(true);
		expect(validString("a", "   ")).toBe(false);
		expect(validString("a", 42 as unknown as string)).toBe(false);
		expect(validString(null as unknown as string)).toBe(false);
		expect(validString()).toBe(false);
	});

	test("isValidUrl : absolues valides vs invalides", () => {
		expect(isValidUrl("https://rosegriffon.fr")).toBe(true);
		expect(isValidUrl("http://localhost:4002/api")).toBe(true);
		expect(isValidUrl("ftp://x.fr")).toBe(true);
		expect(isValidUrl("pas-une-url")).toBe(false);
		expect(isValidUrl("/chemin/relatif")).toBe(false);
	});

	test("numberAlign : padding espace, alignement à droite", () => {
		expect(numberAlign(5)).toBe(" 5");
		expect(numberAlign(42)).toBe("42");
		expect(numberAlign(7, 4)).toBe("   7");
		// Si déjà plus long que l'alignement : inchangé.
		expect(numberAlign(12345, 2)).toBe("12345");
	});

	test("chunkArray : taille par défaut 2, dernier chunk partiel, vide", () => {
		expect(chunkArray([1, 2, 3])).toEqual([[1, 2], [3]]);
		expect(chunkArray([1, 2, 3, 4], 3)).toEqual([[1, 2, 3], [4]]);
		expect(chunkArray([])).toEqual([]);
	});
});

describe("licenses — format / validité / crypto", () => {
	test("constantes du format", () => {
		expect(LICENSE_PREFIX).toBe("ACH");
		expect(LICENSE_SEQ_PADDING).toBe(5);
		expect(LICENSE_VALIDITY_MS).toBe(365 * 24 * 60 * 60 * 1000);
		expect(LICENSE_NUMBER_REGEX.test("ACH-2026-00042")).toBe(true);
	});

	test("formatLicenseNumber + round-trip parse", () => {
		const n = formatLicenseNumber(2026, 7);
		expect(n).toBe("ACH-2026-00007");
		expect(parseLicenseNumber(n)).toEqual({ year: 2026, seq: 7 });
		// Numéro à 5 chiffres pleins (pas de troncature).
		expect(formatLicenseNumber(2026, 12345)).toBe("ACH-2026-12345");
	});

	test("isValidLicenseNumber : formats incorrects rejetés", () => {
		expect(isValidLicenseNumber("ACH-2026-00042")).toBe(true);
		expect(isValidLicenseNumber("ach-2026-00042")).toBe(false);
		expect(isValidLicenseNumber("ACH-2026-4242")).toBe(false);
		expect(isValidLicenseNumber("XYZ-2026-00042")).toBe(false);
		expect(isValidLicenseNumber("")).toBe(false);
	});

	test("evaluateLicenseValidity : ordre révoquée > expirée > active", () => {
		const future = Date.now() + 60_000;
		const past = Date.now() - 60_000;
		expect(evaluateLicenseValidity({ status: LicenseStatus.Active, validUntil: future })).toEqual({
			valid: true,
		});
		// Révoquée même si validUntil futur.
		expect(evaluateLicenseValidity({ status: LicenseStatus.Revoked, validUntil: future })).toEqual({
			valid: false,
			reason: "revoked",
		});
		// Active mais date dépassée → expirée.
		expect(evaluateLicenseValidity({ status: LicenseStatus.Active, validUntil: past })).toEqual({
			valid: false,
			reason: "expired",
		});
		// Statut Expired → expirée même si date future.
		expect(evaluateLicenseValidity({ status: LicenseStatus.Expired, validUntil: future })).toEqual({
			valid: false,
			reason: "expired",
		});
	});

	test("evaluateLicenseValidity : accepte Date / ISO string et respecte `now`", () => {
		const fixedNow = 1_000_000_000_000;
		expect(
			evaluateLicenseValidity(
				{ status: LicenseStatus.Active, validUntil: new Date(fixedNow + 1000) },
				fixedNow
			)
		).toEqual({ valid: true });
		expect(
			evaluateLicenseValidity(
				{ status: LicenseStatus.Active, validUntil: new Date(fixedNow + 1000).toISOString() },
				fixedNow + 5000
			)
		).toEqual({ valid: false, reason: "expired" });
	});

	test("safeEqual : longueurs différentes, identiques, divergentes", () => {
		expect(safeEqual("abcdef", "abcdef")).toBe(true);
		expect(safeEqual("abcdef", "abcdeg")).toBe(false);
		expect(safeEqual("abc", "abcd")).toBe(false);
		expect(safeEqual("", "")).toBe(true);
	});

	test("generateQrSecret : 64 hex, unique à chaque appel", () => {
		const a = generateQrSecret();
		const b = generateQrSecret();
		expect(a).toMatch(/^[0-9a-f]{64}$/);
		expect(b).toMatch(/^[0-9a-f]{64}$/);
		expect(a).not.toBe(b);
	});

	test("HMAC-SHA256 : déterminisme, vérif OK/KO et sensibilité au secret", async () => {
		const sig1 = await signHmacSha256("ACH-2026-00042", "secret-clef");
		const sig2 = await signHmacSha256("ACH-2026-00042", "secret-clef");
		expect(sig1).toBe(sig2);
		expect(sig1).toMatch(/^[0-9a-f]{64}$/);
		expect(await verifyHmacSha256("ACH-2026-00042", sig1, "secret-clef")).toBe(true);
		// Mauvais secret.
		expect(await verifyHmacSha256("ACH-2026-00042", sig1, "mauvais-secret")).toBe(false);
		// Payload altéré.
		expect(await verifyHmacSha256("ACH-2026-00043", sig1, "secret-clef")).toBe(false);
	});
});

describe("access — RBAC CASL & mapping de rôles", () => {
	test("mapping UserRole <-> AchilleaRole (round-trip complet)", () => {
		expect(userRoleToAchilleaRole(UserRole.User)).toBe(AchilleaRole.member);
		expect(userRoleToAchilleaRole(UserRole.Moderator)).toBe(AchilleaRole.staff);
		expect(userRoleToAchilleaRole(UserRole.Administrator)).toBe(AchilleaRole.admin);
		expect(userRoleToAchilleaRole(UserRole.SuperAdministrator)).toBe(AchilleaRole.owner);

		expect(achilleaRoleToUserRole(AchilleaRole.member)).toBe(UserRole.User);
		expect(achilleaRoleToUserRole(AchilleaRole.staff)).toBe(UserRole.Moderator);
		expect(achilleaRoleToUserRole(AchilleaRole.admin)).toBe(UserRole.Administrator);
		expect(achilleaRoleToUserRole(AchilleaRole.owner)).toBe(UserRole.SuperAdministrator);
	});

	test("member : peut voir, ne peut ni modérer ni gérer", () => {
		const member = buildAbilityFor(AchilleaRole.member);
		expect(member.can("view", "Tournament")).toBe(true);
		expect(member.can("moderate", "Sanction")).toBe(false);
		expect(member.can("manage", "User")).toBe(false);
		expect(member.can("cast", "CastEvent")).toBe(false);
	});

	test("staff : view all + moderate Sanction + cast, mais pas manage", () => {
		const staff = buildAbilityFor(AchilleaRole.staff);
		expect(staff.can("view", "all")).toBe(true);
		expect(staff.can("moderate", "Sanction")).toBe(true);
		expect(staff.can("cast", "CastEvent")).toBe(true);
		expect(staff.can("manage", "User")).toBe(false);
		expect(staff.can("manage", "all")).toBe(false);
	});

	test("admin : manage all sauf User role:owner", () => {
		const admin = buildAbilityFor(AchilleaRole.admin);
		expect(admin.can("manage", "Tournament")).toBe(true);
		expect(admin.can("manage", "User")).toBe(true);
		// Ne peut pas gérer un user dont le rôle est owner.
		expect(admin.can("manage", { __caslSubjectType__: "User", role: "owner" } as never)).toBe(
			false
		);
	});

	test("owner : manage all", () => {
		const owner = buildAbilityFor(AchilleaRole.owner);
		expect(owner.can("manage", "all")).toBe(true);
		expect(owner.can("manage", "User")).toBe(true);
		expect(owner.can("moderate", "Sanction")).toBe(true);
	});
});
