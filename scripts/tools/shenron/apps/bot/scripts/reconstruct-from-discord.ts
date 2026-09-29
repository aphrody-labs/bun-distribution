#!/usr/bin/env bun
/**
 * Reconstruction du bot.db via les rôles Discord live.
 *
 * IDEMPOTENT — safe à relancer en cron quotidien :
 *   • Users INEXISTANTS : insère avec xp = seuil min du palier détecté.
 *   • Users EXISTANTS   : NE TOUCHE PAS xp / zeni (préserve la progression réelle).
 *                          Met à jour UNIQUEMENT currentLevelRoleId + lastLevelReached
 *                          si le rôle Discord a changé (promotion).
 *
 * Historique : avant ce patch, ce script écrasait xp/zeni de TOUS les users à
 * chaque run, ramenant les Saiyan à 9 000 000 XP / 11 000 zeni chaque matin
 * via shenron-guild-sync.timer. Cause racine du bug "XP/zeni ne progressent pas".
 *
 * Source : apps/bot/data/guild-scan.json (généré par scripts/scan-ids.ts).
 */

import "reflect-metadata";
import { container } from "tsyringe";
import { DatabaseService } from "~/db/index";
import { users } from "~/db/schema";
import { eq } from "drizzle-orm";
import { readFileSync } from "node:fs";

const ROLE_TO_LEVEL: Record<string, { level: number; xp: number; zeni: number }> = {
	"1058910891124457482": { level: 1, xp: 1_000, zeni: 1_000 + 1_000 },
	"1058910426164908075": { level: 2, xp: 5_000, zeni: 1_000 + 2_000 },
	"1058910477847109743": { level: 3, xp: 10_000, zeni: 1_000 + 3_000 },
	"1058910518720593920": { level: 4, xp: 25_000, zeni: 1_000 + 4_000 },
	"1058910672068563024": { level: 5, xp: 50_000, zeni: 1_000 + 5_000 },
	"1058910743736614962": { level: 6, xp: 100_000, zeni: 1_000 + 6_000 },
	"1058910776687087637": { level: 7, xp: 250_000, zeni: 1_000 + 7_000 },
	"1074616048487247902": { level: 8, xp: 500_000, zeni: 1_000 + 8_000 },
	"1074616052350193674": { level: 9, xp: 1_000_000, zeni: 1_000 + 9_000 },
	"1074619485450932304": { level: 10, xp: 9_000_000, zeni: 1_000 + 10_000 },
};

type ScannedUser = {
	id: string;
	username: string;
	bot: boolean;
	roles: string[];
};

const scan = JSON.parse(
	readFileSync(new URL("../data/guild-scan.json", import.meta.url), "utf-8")
) as { users: ScannedUser[] };

const dbs = container.resolve(DatabaseService);
const db = dbs.db;

let imported = 0;
let skipped = 0;
const byLevel: Record<number, number> = {};

for (const m of scan.users) {
	if (m.bot) {
		skipped++;
		continue;
	}
	// Trouve le PLUS HAUT level reward qu'il possède
	let best: { level: number; xp: number; zeni: number; roleId: string } | null = null;
	for (const rid of m.roles) {
		const lr = ROLE_TO_LEVEL[rid];
		if (lr && (!best || lr.level > best.level)) {
			best = { ...lr, roleId: rid };
		}
	}

	if (!best) {
		// User sans rôle level — on insère quand même avec defaults
		const existing = await db
			.select({ id: users.id })
			.from(users)
			.where(eq(users.id, m.id))
			.limit(1);
		if (existing.length === 0) {
			await db.insert(users).values({
				id: m.id,
				xp: 0,
				zeni: 1000,
				lastLevelReached: 0,
				currentLevelRoleId: null,
				totalVoiceMs: 0,
				messageCount: 0,
				dailyStreak: 0,
			});
		}
		continue;
	}

	const existing = await db.select({ id: users.id }).from(users).where(eq(users.id, m.id)).limit(1);

	if (existing.length === 0) {
		await db.insert(users).values({
			id: m.id,
			xp: best.xp,
			zeni: best.zeni,
			lastLevelReached: best.level,
			currentLevelRoleId: best.roleId,
			totalVoiceMs: 0,
			messageCount: 0,
			dailyStreak: 0,
		});
	} else {
		// PRESERVE xp/zeni — sync uniquement le rôle level Discord (promotion détectée).
		await db
			.update(users)
			.set({
				lastLevelReached: best.level,
				currentLevelRoleId: best.roleId,
			})
			.where(eq(users.id, m.id));
	}

	imported++;
	byLevel[best.level] = (byLevel[best.level] ?? 0) + 1;
}

console.log(`\n✓ ${imported} users reconstructed (${skipped} bots skipped)`);
console.log("Distribution par niveau récupéré :");
for (const [lvl, count] of Object.entries(byLevel).toSorted(
	(a, b) => Number(a[0]) - Number(b[0])
)) {
	console.log(`  L${lvl.padStart(2)} → ${count} users`);
}
console.log(`\nTotal users dans la DB :`);
const all = await db.select({ id: users.id }).from(users);
console.log(`  ${all.length} rows`);

dbs.close();
