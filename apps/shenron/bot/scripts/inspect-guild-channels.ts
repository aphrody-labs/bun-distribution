import { readFile } from "node:fs/promises";
import { join } from "node:path";

async function main() {
	const envPath = join(import.meta.dir, "..", ".env");
	const content = await readFile(envPath, "utf8").catch(() => "");
	let token = "";
	let guildId = "";
	for (const line of content.split("\n")) {
		const trimmed = line.trim();
		if (trimmed.startsWith("DISCORD_TOKEN_SHENRON=")) {
			token = trimmed.slice("DISCORD_TOKEN_SHENRON=".length).replace(/^['"]|['"]$/g, "").trim();
		}
		if (!token && trimmed.startsWith("DISCORD_TOKEN=")) {
			token = trimmed.slice("DISCORD_TOKEN=".length).replace(/^['"]|['"]$/g, "").trim();
		}
		if (trimmed.startsWith("GUILD_ID=")) {
			guildId = trimmed.slice("GUILD_ID=".length).replace(/^['"]|['"]$/g, "").trim();
		}
	}

	if (!token || !guildId) throw new Error("Token ou GuildId introuvable");

	const res = await fetch(`https://discord.com/api/v10/guilds/${guildId}/channels`, {
		headers: { Authorization: `Bot ${token}` },
	});
	const channels = (await res.json()) as any[];
	if (!Array.isArray(channels)) {
		console.error("Erreur API:", channels);
		return;
	}

	console.log(`=== CHANNELS DU SERVEUR (${guildId}) : ${channels.length} au total ===`);
	const categories = channels.filter((c) => c.type === 4);
	console.log("\n--- CATÉGORIES ---");
	for (const cat of categories) {
		console.log(`[CAT ${cat.id}] ${cat.name} (position: ${cat.position})`);
	}

	console.log("\n--- SALONS TEXTUELS EXISTANTS ---");
	const textChannels = channels.filter((c) => c.type === 0);
	for (const tc of textChannels) {
		const parentCat = categories.find((c) => c.id === tc.parent_id);
		console.log(`  #${tc.name} [ID: ${tc.id}] (cat: ${parentCat?.name ?? "aucune"})`);
	}
}

main().catch(console.error);
