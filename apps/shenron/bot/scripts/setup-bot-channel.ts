import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Database } from "bun:sqlite";

const PUBLIC_CATEGORY_ID = "1034579089383764090"; // ⌈🌍⌋ ⌜Public⌟
const CHANNEL_NAME = "🤖・shenron-commandes";
const CHANNEL_TOPIC = "⚡ Sanctuaire de Shenron — Invoquez le Dragon Sacré, consultez le Wiki, défiez le classement et gérez vos cartes de combat !";

async function getBotCredentials(): Promise<{ token: string; guildId: string }> {
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
	if (!token || !guildId) throw new Error("Credentials introuvables");
	return { token, guildId };
}

async function main() {
	const { token, guildId } = await getBotCredentials();

	// 1. Vérifier si le salon existe déjà
	console.log(`Recherche du salon ${CHANNEL_NAME} sur le serveur ${guildId}...`);
	const listRes = await fetch(`https://discord.com/api/v10/guilds/${guildId}/channels`, {
		headers: { Authorization: `Bot ${token}` },
	});
	const channels = (await listRes.json()) as any[];
	let existingChannel = channels.find(
		(c) => c.name === "🤖・shenron-commandes" || c.name === "shenron-commandes"
	);

	let channelId = existingChannel?.id;

	if (existingChannel) {
		console.log(`Le salon existe déjà : #${existingChannel.name} (${existingChannel.id})`);
	} else {
		// 2. Créer le salon dans la catégorie Public
		console.log(`Création du salon ${CHANNEL_NAME} dans la catégorie ${PUBLIC_CATEGORY_ID}...`);
		const createRes = await fetch(`https://discord.com/api/v10/guilds/${guildId}/channels`, {
			method: "POST",
			headers: {
				Authorization: `Bot ${token}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({
				name: CHANNEL_NAME,
				type: 0, // Guild Text
				parent_id: PUBLIC_CATEGORY_ID,
				topic: CHANNEL_TOPIC,
			}),
		});

		if (!createRes.ok) {
			const err = await createRes.text();
			throw new Error(`Échec création salon: ${createRes.status} ${err}`);
		}

		const newChannel = (await createRes.json()) as { id: string; name: string };
		channelId = newChannel.id;
		console.log(`✓ Salon créé avec succès : #${newChannel.name} (${newChannel.id}) !`);
	}

	// 3. Poster le message de bienvenue riche et interactif
	console.log("Envoi du message officiel de présentation...");
	const embed1 = {
		title: "🐉 LE SANCTUAIRE DE SHENRON — SALLE D'ENTRAÎNEMENT & COMMANDES",
		description:
			"**Que votre vœu soit exaucé !**\n" +
			"Bienvenue dans le salon officiel dédié à **Shenron** et aux fonctionnalités interactives de la communauté **Dragon Ball FR**.\n\n" +
			"Ce lieu sacré est spécialement conçu pour exécuter vos commandes, consulter le savoir canonique et mesurer votre puissance face aux autres guerriers du serveur.",
		color: 0xff6b00, // Orange DBZ Shenron
		fields: [
			{
				name: "⚡ COMBAT & PROGRESSION",
				value:
					"> ` /profil ` — Affiche votre carte de guerrier haute définition (XP, Rang, Scouter, Badge).\n" +
					"> ` /top ` — Consulte le classement interactif des membres les plus actifs du serveur.",
				inline: false,
			},
			{
				name: "📜 SAVOIR CANONIQUE & ARCHIVES",
				value:
					"> ` /canon [question] ` — Interroge l'arbitre canonique officiel (citations de Toriyama & databooks).\n" +
					"> ` /wiki [recherche] ` — Explore l'encyclopédie complète des personnages, techniques et sagas.\n" +
					"> ` /databooks [ouvrage] ` — Parcourt les scans et traductions françaises des guides officiels.",
				inline: false,
			},
			{
				name: "💰 ÉCONOMIE & ENTRAÎNEMENT",
				value:
					"> ` /shop ` — Dépensez vos Zeni dans la boutique officielle (titres, cadres, cartes rares).\n" +
					"> ` /inventaire ` — Gérez vos objets débloqués, cartes de combat et titres équipés.\n" +
					"> ` /fusion ` — Unissez vos forces avec un autre guerrier pour cumuler votre puissance !",
				inline: false,
			},
			{
				name: "🎲 JEUX DU ROYAUME DES MORTS",
				value:
					"> ` /morpion ` · ` /pendu ` · ` /pfc ` · ` /bingo ` — Défiez vos rivaux ou tentez votre chance !",
				inline: false,
			},
		],
		image: {
			url: "https://dragonballfr.com/dbz/og-dragonballfr.png",
		},
		footer: {
			text: "Dragon Ball FR • dragonballfr.com • Propulsé par le moteur Shenron",
			icon_url: "https://dragonballfr.com/icons/icon-192.png",
		},
		timestamp: new Date().toISOString(),
	};

	const components = [
		{
			type: 1, // Action Row
			components: [
				{
					type: 2, // Button
					style: 5, // Link
					label: "Encyclopédie Dragon Ball FR",
					url: "https://dragonballfr.com/wiki",
					emoji: { name: "🌐" },
				},
				{
					type: 2,
					style: 5,
					label: "Classements Communautaires",
					url: "https://dragonballfr.com/classements",
					emoji: { name: "🏆" },
				},
				{
					type: 2,
					style: 5,
					label: "Catalogue Databooks",
					url: "https://dragonballfr.com/databooks",
					emoji: { name: "📚" },
				},
			],
		},
	];

	const msgRes = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages`, {
		method: "POST",
		headers: {
			Authorization: `Bot ${token}`,
			"Content-Type": "application/json",
		},
		body: JSON.stringify({
			embeds: [embed1],
			components,
		}),
	});

	if (!msgRes.ok) {
		const err = await msgRes.text();
		console.error("Erreur postage message:", msgRes.status, err);
	} else {
		const msg = (await msgRes.json()) as { id: string };
		console.log(`✓ Message officiel posté avec succès (ID: ${msg.id}) !`);

		// 4. Épingler le message
		const pinRes = await fetch(
			`https://discord.com/api/v10/channels/${channelId}/pins/${msg.id}`,
			{
				method: "PUT",
				headers: { Authorization: `Bot ${token}` },
			}
		);
		if (pinRes.ok) console.log("✓ Message épinglé dans le salon !");
	}

	// 5. Mettre à jour channel.commands dans la base SQLite du bot
	try {
		const dbPath = join(import.meta.dir, "..", "data", "bot.db");
		const db = new Database(dbPath);
		db.run(
			`INSERT INTO settings (key, value, updated_at) VALUES ('channel.commands', ?, datetime('now'))
			 ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
			[channelId]
		);
		console.log(`✓ channel.commands configuré sur ${channelId} dans bot.db !`);
	} catch (e: any) {
		console.log("Mise à jour SQLite locale ignorée:", e.message);
	}

	console.log(`\n🎉 Configuration complète du salon terminée : <#${channelId}> !`);
}

main().catch((e) => {
	console.error("Erreur:", e.message);
	process.exit(1);
});
