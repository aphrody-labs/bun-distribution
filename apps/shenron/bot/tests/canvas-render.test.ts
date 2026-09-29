import "./setup";
import "reflect-metadata";
import { describe, expect, test } from "bun:test";
import { container, DependencyContainer } from "tsyringe";
import { writeFileSync } from "node:fs";
import "~/lib/canvas-kit";

import { CardService } from "~/services/CardService";
import { GaugeService } from "~/services/GaugeService";
import { LeaderboardService } from "~/services/LeaderboardService";
import { FusionService } from "~/services/FusionService";

const fakeUser = (id: string, name: string) =>
	({
		id,
		username: name,
		displayName: name,
		displayAvatarURL: () => `https://cdn.discordapp.com/embed/avatars/${Number(id) % 5}.png`,
	}) as any;

const OUT = "/tmp/shenron-canvas";
import { mkdirSync } from "node:fs";
mkdirSync(OUT, { recursive: true });

// Le rendu réel exige le binding natif skia. Sur les runners CI (GLIBC trop
// ancienne / pas de binaire darwin) le shim no-op de preload.ts est actif et
// produit des buffers vides — on skip alors ces assertions de taille.
const canvasNativeOk = (globalThis as Record<string, unknown>).shenronCanvasNativeOk !== false;
const d = canvasNativeOk ? describe : describe.skip;

d("canvas rendering — visual smoke", () => {
	test("CardService renders K/M/B/T xp without unreadable glyphs", async () => {
		const c = container.createChildContainer();
		const card = c.resolve(CardService);
		const cases = [
			{ xp: 250, label: "small" },
			{ xp: 12_500, label: "k" },
			{ xp: 1_500_000, label: "m" },
			{ xp: 999_000_000_000, label: "t" },
		];
		for (const { xp, label } of cases) {
			const buf = await card.render({
				discordUser: fakeUser("100", "Goku"),
				xp,
				zeni: 5_500,
				messageCount: 420,
				cardKey: "ssj",
				badge: "🔥",
				title: "Saiyan",
				rank: 1,
			});
			writeFileSync(`${OUT}/card-${label}.png`, buf);
			expect(buf.length).toBeGreaterThan(5_000);
		}
	}, 15_000);

	test("CardService safely renders with invalid/slug color and banner background", async () => {
		const c = container.createChildContainer();
		const card = c.resolve(CardService);
		// Test with invalid CSS color identifier like "couleur_vert" (previous crash)
		const bufColor = await card.render({
			discordUser: fakeUser("101", "Vegeta"),
			xp: 50_000,
			zeni: 10_000,
			messageCount: 150,
			cardKey: "vegeta",
			color: "couleur_vert",
			rank: 5,
		});
		expect(bufColor.length).toBeGreaterThan(5_000);

		// Test with equipped banner background
		const bufBanner = await card.render({
			discordUser: fakeUser("102", "Trunks"),
			xp: 75_000,
			zeni: 25_000,
			messageCount: 300,
			cardKey: "default",
			bannerPath: "assets/banners/banner-01.jpg",
			color: "#00E5FF",
			badge: "亀",
			title: "Guerrier du Futur",
			rank: 3,
		});
		expect(bufBanner.length).toBeGreaterThan(5_000);
	});

	test("GaugeService renders pct 0-101", async () => {
		const c = container.createChildContainer();
		const g = c.resolve(GaugeService);
		for (const pct of [0, 42, 87, 100, 101]) {
			const buf = await g.render({
				user: fakeUser("100", "Goku"),
				title: "GAYDAR DE BULMA",
				subtitle: "Scanner calibré sur Master Roshi",
				pct,
				accent: "#FF4FB0",
				accentDark: "#3a0420",
			});
			writeFileSync(`${OUT}/gauge-${pct}.png`, buf);
			expect(buf.length).toBeGreaterThan(5_000);
		}
	});

	test("LeaderboardService renders 10 entries", async () => {
		const c = container.createChildContainer();
		const lb = c.resolve(LeaderboardService);
		const entries = Array.from({ length: 10 }, (_, i) => ({
			id: `${100 + i}`,
			username: `Saiyan${i + 1}`,
			avatarURL: `https://cdn.discordapp.com/embed/avatars/${i % 5}.png`,
			xp: Math.floor(Math.random() * 5_000_000) + 1_000,
			zeni: Math.floor(Math.random() * 100_000),
		}));
		const buf = await lb.render(entries, {
			title: "LEADERBOARD KI",
			subtitle: "Top combattants de l'univers 7",
			page: 1,
			totalPages: 5,
		});
		writeFileSync(`${OUT}/leaderboard.png`, buf);
		expect(buf.length).toBeGreaterThan(5_000);
	});
});

d("canvas rendering — cartes de jeux", () => {
	test("pendu et bingo produisent un PNG lisible", async () => {
		const { renderPenduCard, renderBingoCard } = await import("~/lib/game-cards");
		const pendu = await renderPenduCard({
			word: "kame sennin",
			found: new Set(["k", "a", "e"]),
			missed: new Set(["z", "x"]),
			errors: 2,
			maxErrors: 4,
			status: "playing",
			level: "normal",
			category: "Personnage",
		});
		writeFileSync(`${OUT}/pendu.png`, pendu);
		expect(pendu.subarray(1, 4).toString()).toBe("PNG");
		expect(pendu.length).toBeGreaterThan(5_000);

		const bingo = await renderBingoCard({
			min: 1,
			max: 1000,
			range: { lo: 501, hi: 749 },
			guesses: [
				{ value: 500, hint: "higher" },
				{ value: 750, hint: "lower" },
			],
			attemptsUsed: 2,
			maxAttempts: 9,
			status: "playing",
			level: "difficile",
			lastHint: "lower",
		});
		writeFileSync(`${OUT}/bingo.png`, bingo);
		expect(bingo.length).toBeGreaterThan(5_000);
	});
});
