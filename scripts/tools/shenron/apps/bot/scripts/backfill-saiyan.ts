/**
 * Backfill du rôle Saiyan (auto-role) pour tous les membres qui ne l'ont pas.
 *
 * Le `assignAutoRole` natif tourne sur boot mais peut rater des users si :
 *  - guild.members.fetch() partial (sans intent GuildMembers)
 *  - bot offline au moment du join
 *  - membre ajouté hors range cache
 *
 * Usage : `bun apps/bot/scripts/backfill-saiyan.ts [--dry]`
 */

import "reflect-metadata";
import { Client, GatewayIntentBits } from "discord.js";
import { env } from "~/lib/env";
import { AUTO_ROLE_ID } from "~/lib/constants";

const DRY = process.argv.includes("--dry");
const TOKEN = env.DISCORD_TOKEN_GRAND_PRETRE ?? env.DISCORD_TOKEN_KAIO ?? env.DISCORD_TOKEN_SHENRON;
if (!TOKEN) {
	console.error("Need DISCORD_TOKEN_GRAND_PRETRE|KAIO|SHENRON");
	process.exit(1);
}

const client = new Client({
	intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers],
});

await client.login(TOKEN);
console.log(`✓ Logged in as ${client.user?.tag}`);

const guild = await client.guilds.fetch(env.GUILD_ID);
await guild.members.fetch();
console.log(`Cached ${guild.members.cache.size} members in ${guild.name}`);

const me = guild.members.me!;
const role = guild.roles.cache.get(AUTO_ROLE_ID);
if (!role) {
	console.error(`AUTO_ROLE_ID ${AUTO_ROLE_ID} introuvable !`);
	process.exit(1);
}
if (role.position >= me.roles.highest.position) {
	console.error(
		`Bot (${me.roles.highest.name} pos ${me.roles.highest.position}) ne peut pas assigner ${role.name} (pos ${role.position})`
	);
	process.exit(1);
}

let added = 0;
let already = 0;
let bots = 0;
let errors = 0;

for (const member of guild.members.cache.values()) {
	if (member.user.bot) {
		bots++;
		continue;
	}
	if (member.roles.cache.has(AUTO_ROLE_ID)) {
		already++;
		continue;
	}
	if (DRY) {
		console.log(`  [DRY] would add Saiyan to ${member.user.username}`);
		added++;
	} else {
		try {
			await member.roles.add(AUTO_ROLE_ID, "Backfill auto-role Saiyan");
			console.log(`  ✓ Saiyan → ${member.user.username}`);
			added++;
			await new Promise((r) => setTimeout(r, 200));
		} catch (err) {
			console.log(`  ✗ ${member.user.username}: ${err}`);
			errors++;
		}
	}
}

console.log("");
console.log(`=== Backfill Saiyan ${DRY ? "DRY" : "LIVE"} ===`);
console.log(`  Added:      ${added}`);
console.log(`  Already:    ${already}`);
console.log(`  Bots:       ${bots}`);
console.log(`  Errors:     ${errors}`);
await client.destroy();
process.exit(0);
