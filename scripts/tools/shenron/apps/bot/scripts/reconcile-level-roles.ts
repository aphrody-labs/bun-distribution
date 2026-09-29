/**
 * Réconcilie les rôles level pour tous les users actifs.
 *
 * Pour chaque user en DB avec xp > 0, calcule le `targetLevel = levelForXP(xp)`
 * et lui assigne le rôle correspondant + tous les rôles inférieurs s'il les
 * a pas. Idempotent. Logue les actions.
 *
 * Usage : `bun apps/bot/scripts/reconcile-level-roles.ts [--dry] [--guild=ID]`
 *
 * Utile quand `handleLevelUp()` n'a pas pu poser le rôle (bot offline,
 * permissions, race condition, hierarchy, etc.).
 */

import "reflect-metadata";
import { container } from "tsyringe";
import { Client, GatewayIntentBits } from "discord.js";
import { gt } from "drizzle-orm";
import { DatabaseService } from "~/db/index";
import { users, levelRewards } from "~/db/schema";
import { env } from "~/lib/env";
import { levelForXP } from "~/lib/xp";

const DRY = process.argv.includes("--dry");
const GUILD_ID = process.argv.find((a) => a.startsWith("--guild="))?.split("=")[1] ?? env.GUILD_ID;
const BOT_TOKEN = env.DISCORD_TOKEN_KAIO ?? env.DISCORD_TOKEN_SHENRON;

if (!BOT_TOKEN) {
	console.error("Need DISCORD_TOKEN_KAIO or DISCORD_TOKEN_SHENRON");
	process.exit(1);
}

const dbs = container.resolve(DatabaseService);
const db = dbs.db;

const rewards = await db.select().from(levelRewards).orderBy(levelRewards.level);
console.log(`Loaded ${rewards.length} level rewards`);
if (rewards.length === 0) {
	console.error("No level_rewards in DB. Configure via /admin/levels first.");
	process.exit(1);
}

const allUsers = await db.select().from(users).where(gt(users.xp, 0));
console.log(`Loaded ${allUsers.length} users with xp > 0`);

const client = new Client({
	intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers],
});

await client.login(BOT_TOKEN);
console.log(`✓ Logged in as ${client.user?.tag}`);

const guild = await client.guilds.fetch(GUILD_ID);
console.log(`Guild: ${guild.name} (${guild.id})`);

await guild.members.fetch();
console.log(`Cached ${guild.members.cache.size} members`);

const me = guild.members.me!;
console.log(`Bot highest role: ${me.roles.highest.name} (position ${me.roles.highest.position})`);

let added = 0;
let skipped = 0;
let missing = 0;
let aboveHierarchy = 0;
let alreadyHas = 0;

for (const user of allUsers) {
	const targetLevel = levelForXP(user.xp);
	if (targetLevel < 1) continue;

	const member = guild.members.cache.get(user.id);
	if (!member) {
		missing++;
		continue;
	}

	// Tous les rôles level <= targetLevel
	const expectedRoles = rewards.filter((r) => r.level <= targetLevel);
	for (const reward of expectedRoles) {
		if (member.roles.cache.has(reward.roleId)) {
			alreadyHas++;
			continue;
		}
		const role = guild.roles.cache.get(reward.roleId);
		if (!role) {
			console.log(`  ⚠ role ${reward.roleId} introuvable (level ${reward.level})`);
			skipped++;
			continue;
		}
		if (role.position >= me.roles.highest.position) {
			console.log(`  ⚠ role ${role.name} above bot — skipped`);
			aboveHierarchy++;
			continue;
		}
		if (DRY) {
			console.log(`  [DRY] would add ${role.name} to ${member.user.username} (lvl ${targetLevel})`);
		} else {
			try {
				await member.roles.add(reward.roleId, `Reconcile level ${targetLevel}`);
				console.log(
					`  ✓ +${role.name} → ${member.user.username} (lvl ${targetLevel}, xp ${user.xp})`
				);
				added++;
				await new Promise((r) => setTimeout(r, 200)); // rate-limit
			} catch (err) {
				console.log(`  ✗ ${role.name} → ${member.user.username}: ${err}`);
				skipped++;
			}
		}
	}
}

console.log("");
console.log(`=== Réconciliation ${DRY ? "DRY-RUN" : "LIVE"} ===`);
console.log(`  Added:           ${added}`);
console.log(`  Already had:     ${alreadyHas}`);
console.log(`  Skipped (err):   ${skipped}`);
console.log(`  Missing member:  ${missing}`);
console.log(`  Above hierarchy: ${aboveHierarchy}`);

await client.destroy();
process.exit(0);
