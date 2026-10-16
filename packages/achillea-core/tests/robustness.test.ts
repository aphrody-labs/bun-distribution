/**
 * Robustesse : ce que les fonctions pures font des entrées hostiles.
 *
 * Toutes ces valeurs arrivent réellement — `NaN` d'un `parseInt` sur une query
 * string, `Infinity` d'une division, un total négatif d'un `COUNT` sur une vue
 * vide, une date invalide d'un enregistrement ancien. Une fonction de domaine
 * qui rend `NaN` ou un tableau vide au lieu d'un résultat borné produit un
 * écran cassé, pas une erreur : c'est le genre de bug qui survit des mois.
 *
 * Les invariants sont écrits comme des propriétés, pas comme des cas : ils
 * tiennent pour tout le domaine d'entrée, y compris ce qu'on n'a pas imaginé.
 */

import { describe, expect, test } from "bun:test";

import {
	CastAvailabilityStatus,
	CastSlotRole,
	MatchFormat,
	StageType,
	WalletTransactionDirection,
	WalletTransactionType,
	type CastAvailability,
	type WalletTransaction,
} from "@rosegriffon/achillea-types";

import {
	byeCount,
	gamesToWin,
	matchGameCount,
	nextPowerOfTwo,
	roundLabel,
	singleEliminationRounds,
	stageMatchCount,
	stageRounds,
	standardSeedOrder,
} from "../src/brackets/index";
import { rankCandidatesForRole } from "../src/casts/index";
import { distinctionPriority, memberDistinctionPriority } from "../src/clans/index";
import { buildQueryString, joinApiUrl, withQuery } from "../src/http/index";
import { discordDefaultAvatarIndex, rankImagePath, resolveDiscordAvatarUrl } from "../src/identity/index";
import {
	buildPageMeta,
	clampPage,
	clampPageSize,
	hasNextPage,
	normalizePageQuery,
	pageCount,
	pageOffset,
	pageWindow,
} from "../src/pagination/index";
import { freeSeeds, freeSlots, seedByElo, sortBySeed } from "../src/participants/index";
import { downsample, longestStreak, mean, median, winRate, winRatePercent } from "../src/stats/index";
import {
	clamp,
	euclideanMod,
	toCount,
	toFinite,
	toPositiveInt,
} from "../src/numbers/index";
import { netAmount, signedAmount, totalsByType } from "../src/wallet/index";

/** Entrées numériques hostiles, passées à chaque fonction qui prend un nombre. */
const HOSTILE_NUMBERS = [
	Number.NaN,
	Number.POSITIVE_INFINITY,
	Number.NEGATIVE_INFINITY,
	-1,
	-0,
	0,
	0.5,
	1.9,
	Number.MAX_SAFE_INTEGER,
] as const;

function isFiniteNonNegativeInteger(value: number): boolean {
	return Number.isInteger(value) && value >= 0;
}

describe("pagination", () => {
	test("pageCount rend toujours un entier positif ou nul", () => {
		for (const total of HOSTILE_NUMBERS) {
			for (const size of HOSTILE_NUMBERS) {
				const result = pageCount(total, size);
				expect(isFiniteNonNegativeInteger(result), `pageCount(${total}, ${size}) = ${result}`).toBe(
					true
				);
			}
		}
	});

	test("clampPageSize reste dans [1, 100] quoi qu'on lui donne", () => {
		for (const size of HOSTILE_NUMBERS) {
			const result = clampPageSize(size);
			expect(result, `clampPageSize(${size})`).toBeGreaterThanOrEqual(1);
			expect(result).toBeLessThanOrEqual(100);
			expect(Number.isInteger(result)).toBe(true);
		}
	});

	test("clampPage reste dans [1, pageCount] quoi qu'on lui donne", () => {
		for (const page of HOSTILE_NUMBERS) {
			for (const total of [0, 1, 41, 1000]) {
				const result = clampPage(page, total, 20);
				expect(result, `clampPage(${page}, ${total})`).toBeGreaterThanOrEqual(1);
				expect(result).toBeLessThanOrEqual(Math.max(1, pageCount(total, 20)));
			}
		}
	});

	test("pageOffset ne rend jamais un décalage négatif ou fractionnaire", () => {
		for (const page of HOSTILE_NUMBERS) {
			const result = pageOffset(page, 20);
			expect(isFiniteNonNegativeInteger(result), `pageOffset(${page}) = ${result}`).toBe(true);
		}
	});

	test("buildPageMeta reste cohérent avec lui-même", () => {
		for (const total of [0, 1, 41, 1000]) {
			for (const limit of [1, 20, 100]) {
				const meta = buildPageMeta(999, limit, total);
				expect(meta.pageCount).toBe(pageCount(total, limit));
				expect(meta.page).toBeLessThanOrEqual(Math.max(1, meta.pageCount));
				expect(meta.total).toBe(total);
				// Le décalage de la dernière page doit rester dans les données.
				if (meta.total > 0) expect(pageOffset(meta.page, meta.limit)).toBeLessThan(meta.total);
			}
		}
	});

	test("pageWindow rend toujours une fenêtre non vide quand il y a des pages", () => {
		// Régression : avec une page courante au-delà du dernier numéro, la borne
		// basse dépassait la borne haute et la fenêtre sortait vide — une
		// pagination qui disparaît de l'écran plutôt que de se recaler.
		for (const current of [-5, 0, 1, 3, 10, 999, Number.NaN]) {
			const window = pageWindow(current, 3);
			expect(window.length, `pageWindow(${current}, 3) = [${window}]`).toBeGreaterThan(0);
			expect(window.every((page) => page >= 1 && page <= 3)).toBe(true);
			expect([...window].sort((a, b) => a - b)).toEqual(window);
		}
		expect(pageWindow(1, 0)).toEqual([]);
	});

	test("normalizePageQuery produit toujours un offset utilisable", () => {
		for (const page of HOSTILE_NUMBERS) {
			for (const pageSize of HOSTILE_NUMBERS) {
				const { page: p, pageSize: s, offset } = normalizePageQuery({ page, pageSize });
				expect(isFiniteNonNegativeInteger(offset)).toBe(true);
				expect(offset).toBe((p - 1) * s);
				expect(p).toBeGreaterThanOrEqual(1);
			}
		}
	});

	test("freeSlots ne rend jamais un nombre de places négatif", () => {
		const roster = [{ status: undefined }, { status: undefined }];
		for (const capacity of HOSTILE_NUMBERS) {
			const result = freeSlots(roster, capacity);
			expect(isFiniteNonNegativeInteger(result), `freeSlots(${capacity}) = ${result}`).toBe(true);
		}
	});

	test("hasNextPage et pageCount ne se contredisent jamais", () => {
		for (const total of [0, 1, 20, 21, 1000]) {
			const pages = pageCount(total, 20);
			expect(hasNextPage(pages, total, 20)).toBe(false);
			if (pages > 1) expect(hasNextPage(1, total, 20)).toBe(true);
		}
	});
});

describe("brackets", () => {
	test("les compteurs de tours et de matchs sont des entiers positifs", () => {
		for (const size of HOSTILE_NUMBERS) {
			for (const type of [
				StageType.single_elimination,
				StageType.double_elimination,
				StageType.round_robin,
				StageType.league,
			]) {
				const rounds = stageRounds(type, size);
				const matches = stageMatchCount(type, size);
				expect(isFiniteNonNegativeInteger(rounds), `stageRounds(${type}, ${size}) = ${rounds}`).toBe(
					true
				);
				expect(
					isFiniteNonNegativeInteger(matches),
					`stageMatchCount(${type}, ${size}) = ${matches}`
				).toBe(true);
			}
		}
	});

	test("nextPowerOfTwo et byeCount restent finis", () => {
		for (const size of HOSTILE_NUMBERS) {
			expect(Number.isFinite(nextPowerOfTwo(size)), `nextPowerOfTwo(${size})`).toBe(true);
			expect(isFiniteNonNegativeInteger(byeCount(size)), `byeCount(${size})`).toBe(true);
		}
	});

	test("un arbre a toujours assez de places pour ses inscrits", () => {
		for (const size of [1, 2, 3, 7, 8, 9, 16, 33, 128]) {
			expect(nextPowerOfTwo(size)).toBeGreaterThanOrEqual(size);
			expect(byeCount(size) + size).toBe(size <= 1 ? size : nextPowerOfTwo(size));
			expect(2 ** singleEliminationRounds(size)).toBeGreaterThanOrEqual(size);
		}
	});

	test("standardSeedOrder est une permutation exacte de 1..n", () => {
		for (const size of [1, 2, 4, 8, 16, 32, 64]) {
			const order = standardSeedOrder(size);
			expect(order).toHaveLength(size);
			expect([...order].sort((a, b) => a - b)).toEqual(
				Array.from({ length: size }, (_, index) => index + 1)
			);
		}
	});

	test("le seeding standard oppose toujours des seeds complémentaires au 1er tour", () => {
		for (const size of [4, 8, 16, 32]) {
			const order = standardSeedOrder(size);
			for (let i = 0; i < order.length; i += 2) {
				expect((order[i] as number) + (order[i + 1] as number)).toBe(size + 1);
			}
		}
	});

	test("le nombre de manches et le seuil de victoire restent cohérents", () => {
		for (const format of Object.values(MatchFormat)) {
			for (const custom of [...HOSTILE_NUMBERS, null, undefined]) {
				const games = matchGameCount(format, custom as number | null | undefined);
				const toWin = gamesToWin(format, custom as number | null | undefined);
				expect(isFiniteNonNegativeInteger(games), `matchGameCount(${format}, ${custom})`).toBe(true);
				expect(games).toBeGreaterThanOrEqual(1);
				expect(toWin).toBeGreaterThanOrEqual(1);
				expect(toWin).toBeLessThanOrEqual(games === 2 ? 2 : games);
			}
		}
	});

	test("roundLabel ne rend jamais un libellé technique", () => {
		for (const size of [2, 4, 8, 16, 32]) {
			for (let round = 1; round <= singleEliminationRounds(size); round++) {
				const label = roundLabel(round, size);
				expect(label.length).toBeGreaterThan(0);
				expect(label).not.toContain("undefined");
				expect(label).not.toContain("NaN");
			}
		}
		expect(roundLabel(0, 16)).toBe("");
		expect(roundLabel(1, 1)).toBe("");
	});
});

describe("statistiques", () => {
	test("winRate reste dans [0, 1] pour toute entrée", () => {
		for (const wins of HOSTILE_NUMBERS) {
			for (const total of HOSTILE_NUMBERS) {
				const rate = winRate(wins, total);
				expect(Number.isFinite(rate), `winRate(${wins}, ${total}) = ${rate}`).toBe(true);
				expect(rate).toBeGreaterThanOrEqual(0);
				expect(rate).toBeLessThanOrEqual(1);
			}
		}
	});

	test("winRatePercent arrondit sans produire NaN", () => {
		for (const digits of [0, 1, 2]) {
			for (const wins of HOSTILE_NUMBERS) {
				const percent = winRatePercent(wins, 10, digits);
				expect(Number.isFinite(percent), `winRatePercent(${wins}, 10, ${digits})`).toBe(true);
			}
		}
	});

	test("mean et median restent finis, y compris sur des valeurs extrêmes", () => {
		const samples = [[], [0], [-5, 5], HOSTILE_NUMBERS.filter(Number.isFinite)] as number[][];
		for (const values of samples) {
			expect(Number.isFinite(mean(values)), `mean(${values})`).toBe(true);
			expect(Number.isFinite(median(values)), `median(${values})`).toBe(true);
		}
	});

	test("median est bien une valeur centrale", () => {
		for (const values of [[3, 1, 2], [4, 1, 2, 3], [7], [-1, -2]]) {
			const result = median(values);
			expect(result).toBeGreaterThanOrEqual(Math.min(...values));
			expect(result).toBeLessThanOrEqual(Math.max(...values));
		}
	});

	test("downsample conserve les extrémités et la taille demandée", () => {
		const values = Array.from({ length: 97 }, (_, index) => index);
		for (const points of [2, 3, 10, 50, 96, 97, 200]) {
			const sampled = downsample(values, points);
			expect(sampled[0]).toBe(0);
			expect(sampled.at(-1)).toBe(96);
			expect(sampled.length).toBeLessThanOrEqual(Math.max(points, 2));
			expect(sampled.every((value) => Number.isInteger(value))).toBe(true);
		}
		expect(downsample([], 5)).toEqual([]);
		expect(downsample([1], 5)).toEqual([1]);
	});

	test("longestStreak ne dépasse jamais la longueur de la série", () => {
		for (const results of [[], [false], [true], [true, true, false, true]]) {
			expect(longestStreak(results)).toBeLessThanOrEqual(results.length);
			expect(longestStreak(results)).toBeGreaterThanOrEqual(0);
		}
	});
});

describe("portefeuille", () => {
	const tx = (
		type: WalletTransactionType,
		amount: number,
		direction: WalletTransactionDirection
	): WalletTransaction => ({ id: 1, type, amount, reason: null, direction, createdAt: "" });

	test("le signe suit toujours le sens, jamais le signe saisi", () => {
		for (const amount of [-50, 0, 50]) {
			expect(
				signedAmount(tx(WalletTransactionType.Credit, amount, WalletTransactionDirection.In))
			).toBeGreaterThanOrEqual(0);
			expect(
				signedAmount(tx(WalletTransactionType.Debit, amount, WalletTransactionDirection.Out))
			).toBeLessThanOrEqual(0);
		}
	});

	test("netAmount est la somme exacte des montants signés", () => {
		const movements = [
			tx(WalletTransactionType.Credit, 100, WalletTransactionDirection.In),
			tx(WalletTransactionType.Fine, 30, WalletTransactionDirection.Out),
			tx(WalletTransactionType.Payout, 20, WalletTransactionDirection.In),
		];
		expect(netAmount(movements)).toBe(90);
		expect(netAmount([])).toBe(0);
		expect(netAmount(movements)).toBe(movements.reduce((sum, m) => sum + signedAmount(m), 0));
	});

	test("totalsByType couvre tous les types, même absents du journal", () => {
		const totals = totalsByType([]);
		for (const type of Object.values(WalletTransactionType)) {
			expect(totals[type], `${type} absent de la ventilation`).toBe(0);
		}
	});
});

describe("inscrits", () => {
	const participant = (username: string, seed: number | null, elo: number) => ({
		seed,
		user: { username, soloRank: { elo } },
	});

	test("sortBySeed est une permutation, jamais une perte", () => {
		const roster = [
			participant("c", null, 100),
			participant("a", 3, 900),
			participant("b", 1, 500),
			participant("d", null, 200),
		];
		const sorted = sortBySeed(roster);
		expect(sorted).toHaveLength(roster.length);
		expect(new Set(sorted.map((p) => p.user.username))).toEqual(
			new Set(roster.map((p) => p.user.username))
		);
	});

	test("seedByElo attribue des seeds contigus à partir de 1", () => {
		const roster = [
			participant("a", null, 900),
			participant("b", null, 900),
			participant("c", null, 100),
		];
		const seeded = seedByElo(roster);
		expect(seeded.map((entry) => entry.seed)).toEqual([1, 2, 3]);
		// Départage déterministe à Elo égal : deux appels donnent le même ordre.
		expect(seedByElo(roster).map((e) => e.participant.user.username)).toEqual(
			seeded.map((e) => e.participant.user.username)
		);
	});

	test("freeSeeds ne propose jamais un seed déjà pris ni hors capacité", () => {
		const roster = [participant("a", 2, 0), participant("b", null, 0), participant("c", 99, 0)];
		for (const capacity of [0, 1, 4, 8]) {
			const free = freeSeeds(roster, capacity);
			expect(free.every((seed) => seed >= 1 && seed <= capacity)).toBe(true);
			expect(free).not.toContain(2);
			expect(new Set(free).size).toBe(free.length);
		}
	});
});

describe("casts et clans", () => {
	test("une date de déclaration invalide ne désordonne pas les candidats", () => {
		// `Date.parse` rend NaN sur une date illisible : une comparaison qui en
		// dépend rend un ordre arbitraire, et le tri perd des éléments sur
		// certains moteurs. Le classement doit rester total.
		const avail = (userId: string, declaredAt: string): CastAvailability => ({
			id: userId,
			userId,
			status: CastAvailabilityStatus.Available,
			preferredRoles: null,
			notes: null,
			declaredAt,
		});

		const ranked = rankCandidatesForRole(
			[
				avail("invalide", "pas-une-date"),
				avail("tard", "2026-01-03T00:00:00Z"),
				avail("tot", "2026-01-01T00:00:00Z"),
			],
			CastSlotRole.CasterMain
		);

		expect(ranked).toHaveLength(3);
		expect(new Set(ranked.map((a) => a.userId))).toEqual(new Set(["invalide", "tard", "tot"]));
		// Les dates lisibles restent dans le bon ordre relatif.
		expect(ranked.findIndex((a) => a.userId === "tot")).toBeLessThan(
			ranked.findIndex((a) => a.userId === "tard")
		);
	});

	test("distinctionPriority rend toujours un rang comparable", () => {
		for (const value of ["", "Staff", "Joueur", "Content Creator", "inconnu", "  Staff  "]) {
			const priority = distinctionPriority(value);
			expect(Number.isFinite(priority), `distinctionPriority(${JSON.stringify(value)})`).toBe(true);
			expect(priority).toBeGreaterThan(0);
		}
		expect(memberDistinctionPriority([])).toBeGreaterThan(0);
	});
});

describe("URL et identité", () => {
	test("joinApiUrl ne produit jamais de double barre ni de /api/api", () => {
		const bases = ["", "/", "/api", "https://x.fr", "https://x.fr/", "https://x.fr/api", "https://x.fr/api/"];
		const paths = ["/users", "users", "/api/users", "/api"];
		for (const base of bases) {
			for (const path of paths) {
				const url = joinApiUrl(base, path);
				expect(url, `joinApiUrl(${base}, ${path})`).not.toContain("//users");
				expect(url).not.toContain("/api/api");
				expect(url.startsWith("http") || url.startsWith("/")).toBe(true);
			}
		}
	});

	test("buildQueryString garde les valeurs falsy signifiantes", () => {
		// `0` et `false` sont des filtres valides : les omettre change la requête.
		expect(buildQueryString({ page: 0 })).toBe("?page=0");
		expect(buildQueryString({ actif: false })).toBe("?actif=false");
		expect(buildQueryString({ q: "", vide: null, absent: undefined })).toBe("");
		expect(buildQueryString({ q: "a b&c=d" })).toBe("?q=a+b%26c%3Dd");
		expect(withQuery("/x", { a: [1, 2], b: null })).toBe("/x?a=1&a=2");
	});

	test("resolveDiscordAvatarUrl rend toujours une URL absolue", () => {
		const cases: Array<[string | null | undefined, string | null | undefined]> = [
			["42", null],
			["42", ""],
			["42", "   "],
			[null, "abc"],
			[undefined, undefined],
			["pas-un-snowflake", "a_ff00"],
			["42", "https://cdn.discordapp.com/avatars/42/abc.webp?size=64"],
		];
		for (const [id, avatar] of cases) {
			const url = resolveDiscordAvatarUrl(id, avatar);
			expect(url.startsWith("https://"), `resolveDiscordAvatarUrl(${id}, ${avatar}) = ${url}`).toBe(
				true
			);
			expect(url).not.toContain("undefined");
			expect(url).not.toContain("null");
		}
	});

	test("discordDefaultAvatarIndex reste dans [0, 5]", () => {
		for (const id of ["0", "42", "123456789012345678", "-1", "abc", ""]) {
			const index = discordDefaultAvatarIndex(id);
			expect(index, `discordDefaultAvatarIndex(${id}) = ${index}`).toBeGreaterThanOrEqual(0);
			expect(index).toBeLessThanOrEqual(5);
		}
	});

	test("rankImagePath ne produit jamais de double barre", () => {
		for (const base of ["ranks", "ranks/", "https://cdn.fr/img", "https://cdn.fr/img/"]) {
			expect(rankImagePath("Or", base)).not.toContain("//or");
		}
	});
});

describe("coercition numérique", () => {
	test("toFinite neutralise NaN et les infinis", () => {
		for (const value of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, "abc", null, undefined, {}]) {
			expect(toFinite(value, 7), `toFinite(${String(value)})`).toBe(7);
		}
		expect(toFinite("42")).toBe(42);
		expect(toFinite(-3.5)).toBe(-3.5);
		expect(toFinite(0)).toBe(0);
	});

	test("toCount rend toujours un entier positif ou nul", () => {
		for (const value of [Number.NaN, Number.NEGATIVE_INFINITY, -9, -0.5, "abc", null]) {
			expect(toCount(value), `toCount(${String(value)})`).toBe(0);
		}
		expect(toCount(3.9)).toBe(3);
		expect(toCount("7")).toBe(7);
		expect(toCount(Number.POSITIVE_INFINITY, 5)).toBe(5);
		// `Number(null)` et `Number("")` valent 0 : un repli qui ne se déclenche
		// pas laisse passer un zéro plausible et faux.
		expect(toCount(null, 5)).toBe(5);
		expect(toCount("", 5)).toBe(5);
		expect(toCount([], 5)).toBe(5);
	});

	test("toPositiveInt respecte son minimum", () => {
		expect(toPositiveInt(Number.NaN)).toBe(1);
		expect(toPositiveInt(0)).toBe(1);
		expect(toPositiveInt(-4)).toBe(1);
		expect(toPositiveInt(2.9)).toBe(2);
		expect(toPositiveInt(0, 256, 16)).toBe(16);
		expect(toPositiveInt(Number.NaN, 256, 16)).toBe(256);
	});

	test("clamp borne des deux côtés, NaN compris", () => {
		expect(clamp(Number.NaN, 2, 8)).toBe(2);
		expect(clamp(-5, 2, 8)).toBe(2);
		expect(clamp(99, 2, 8)).toBe(8);
		expect(clamp(5, 2, 8)).toBe(5);
	});

	test("euclideanMod rend toujours un reste du signe du diviseur", () => {
		// `-1 % 6` vaut `-1` en JavaScript : un index négatif sur une liste.
		for (const value of [-13, -6, -1, 0, 1, 6, 13]) {
			const result = euclideanMod(value, 6);
			expect(result, `euclideanMod(${value}, 6) = ${result}`).toBeGreaterThanOrEqual(0);
			expect(result).toBeLessThan(6);
			// Propriété définissante du modulo. `Math.abs` neutralise `-0`, que
			// `toBe` distingue de `0` (`Object.is`).
			expect(Math.abs((value - result) % 6)).toBe(0);
		}
	});
});
