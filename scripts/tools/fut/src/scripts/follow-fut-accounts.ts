/**
 * Copyright 2026 aphrody-code
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { XClient, XSession } from "@aphrody/x";

export interface FutAccountTarget {
	handle: string;
	category: "DATABASE" | "LEAKER" | "OFFICIAL" | "COMMUNITY_FR" | "TRADER";
	description: string;
}

export const TARGET_FUT_ACCOUNTS: FutAccountTarget[] = [
	// 1. Portails & Bases de données
	{ handle: "FUTBIN", category: "DATABASE", description: "FUTBin officiel - Base de données & prix du marché" },
	{ handle: "FUTxGG", category: "DATABASE", description: "FUT.GG officiel - Base de données, évolutions & SBCs" },
	{ handle: "FUTWIZ", category: "DATABASE", description: "Futwiz officiel - Stats & actualités" },

	// 2. Leakers majeurs & Dataminers
	{ handle: "fifa_romania", category: "LEAKER", description: "FUT Romania (FifaTradingRomania) - Leaks majeurs & SBCs" },
	{ handle: "AsyFutTrader", category: "LEAKER", description: "ASY FUT (Azyfut) - Leaks exclusifs cartes & promos" },
	{ handle: "FutSheriff", category: "LEAKER", description: "Fut Sheriff - Leaker #1 mondial FUT" },
	{ handle: "Fut_scoreboard", category: "LEAKER", description: "FUT Scoreboard - Datamining packs, écrans & cartes" },
	{ handle: "Criminal__x", category: "LEAKER", description: "Sahil (Criminal__x) - Leaks stats, PlayStyles & SBCs" },
	{ handle: "Futdonk", category: "LEAKER", description: "Donk - Leaks & actualités marché" },
	{ handle: "FutPoliceLeaks", category: "LEAKER", description: "FUT Police Leaks - Leaks promos & équipes" },
	{ handle: "WeaverFUT", category: "LEAKER", description: "Weaver - Leaks évolutions & contenu quotidien" },

	// 3. Comptes officiels EA SPORTS FC
	{ handle: "EASPORTSFC", category: "OFFICIAL", description: "EA SPORTS FC Officiel (Global)" },
	{ handle: "easportsfcfr", category: "OFFICIAL", description: "EA SPORTS FC France Officiel" },
	{ handle: "EASFCDirect", category: "OFFICIAL", description: "EA SPORTS FC Direct Communication (Serveurs, patchs & maintenance)" },

	// 4. Actualités & Communauté FR
	{ handle: "robert87000", category: "COMMUNITY_FR", description: "Robert87000 FC27 - Actualités, analyses & leaks FR" },
	{ handle: "BruceGrannec", category: "COMMUNITY_FR", description: "Bruce Grannec - Quadruple champion du monde, avis méta" },
	{ handle: "brak2K", category: "COMMUNITY_FR", description: "Brak - Actualités & animations compétitives" },
];

export async function followAllFutAccounts(options: { delayMs?: number } = {}) {
	const delayMs = options.delayMs ?? 1500;
	const session = XSession.loadOrEnv();
	const client = new XClient(session);

	const who = await client.whoami();
	console.log(`[x-follow] Connecté en tant que @${who.screen_name} (${who.name}) [ID: ${who.id}]`);
	console.log(`[x-follow] Lancement du suivi de ${TARGET_FUT_ACCOUNTS.length} comptes cibles FUT...\n`);

	const results: Array<{
		handle: string;
		name?: string;
		category: string;
		followers?: number;
		status: "FOLLOWED" | "ALREADY_OR_ERROR";
		error?: string;
	}> = [];

	for (const target of TARGET_FUT_ACCOUNTS) {
		try {
			process.stdout.write(`→ @${target.handle} (${target.description})... `);
			const user = await client.userByScreenName(target.handle);
			await client.follow(user.id);
			console.log(`✅ Suivi ! (${(user.followers_count ?? 0).toLocaleString()} followers)`);
			results.push({
				handle: target.handle,
				name: user.name,
				category: target.category,
				followers: user.followers_count,
				status: "FOLLOWED",
			});
		} catch (err: any) {
			console.log(`⚠️ Erreur : ${err.message}`);
			results.push({
				handle: target.handle,
				category: target.category,
				status: "ALREADY_OR_ERROR",
				error: err.message,
			});
		}

		// Pacing delay between follows to stay natural
		await new Promise((r) => setTimeout(r, delayMs));
	}

	const followedCount = results.filter((r) => r.status === "FOLLOWED").length;
	console.log(`\n🎉 Terminé : ${followedCount}/${TARGET_FUT_ACCOUNTS.length} comptes suivis avec succès !`);
	return results;
}

if (import.meta.main) {
	await followAllFutAccounts();
}
