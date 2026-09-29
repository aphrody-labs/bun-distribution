import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Database } from "bun:sqlite";

const TARGET_USER_ID = "1527405876695142620"; // Omar (@omlar_)

async function getDiscordToken(): Promise<string> {
	if (process.env.DISCORD_TOKEN_SHENRON) return process.env.DISCORD_TOKEN_SHENRON;
	if (process.env.DISCORD_TOKEN) return process.env.DISCORD_TOKEN;

	const envPath = join(import.meta.dir, "..", ".env");
	const content = await readFile(envPath, "utf8").catch(() => "");
	for (const line of content.split("\n")) {
		const trimmed = line.trim();
		if (trimmed.startsWith("DISCORD_TOKEN_SHENRON=")) {
			return trimmed
				.slice("DISCORD_TOKEN_SHENRON=".length)
				.replace(/^['"]|['"]$/g, "")
				.trim();
		}
		if (trimmed.startsWith("DISCORD_TOKEN=")) {
			return trimmed
				.slice("DISCORD_TOKEN=".length)
				.replace(/^['"]|['"]$/g, "")
				.trim();
		}
	}
	throw new Error("DISCORD_TOKEN introuvable dans apps/shenron/bot/.env");
}

const SUMMARY_CONTENT = `🐉 **Rapport historique — métriques à revalider avant diffusion (Shenron Engine)**

**Manga OCR (Aphrody & Double Lecture)**
- Planches auditées & scellées : **139 planches** (Lot 1 : 100 planches · Lot 2 : 39 planches)
- Relecture indépendante : **100 % confirmée (0 anomalie)**
- Planches manga en base : **12 577 / 12 577 (Couverture 100 %)**
- Dépôt PostgreSQL versionné : **16 créations textuelles nettes (\`public.wiki_revisions\`)**

**Traduction FR des Databooks (Machine: AGY)**
- Planches traduites (cette session) : **+90 planches** (0 refus au juge, ratio de longueur parfait)
- Total planches FR en base : **1 701 planches traduites**
- Databooks à 100 % de complétude (reste 0) : **54 ouvrages officiels** (+19 complétés)
- Cache Redis db4 : **451 fiches · 13 592 transcriptions synchronisées**

**Infrastructure & Performances Base de Données**
- Index PostgreSQL : **180 index (+53 appliqués, dont \`db_manga_pages_locator_uid\`)**
- Statistiques tables : **79 tables analysées (\`ANALYZE\`)**
- Requête overview transcriptions : **458 ms → 130 ms (gain 3.5x)**
- Pages admin & API : \`/admin/assistance-ia\` (console de test & sondes RAG/Canon), \`/admin/transcriptions\` (compteurs dynamiques).

**État des Services VPS**
Les états de release, services, routes et contrôles doivent être ajoutés depuis
les sondes et catalogues courants d'aphrody-infra avant toute diffusion.`;

async function main() {
	const token = await getDiscordToken();

	console.log(`Ouverture du canal DM avec ${TARGET_USER_ID}...`);
	const channelRes = await fetch("https://discord.com/api/v10/users/@me/channels", {
		method: "POST",
		headers: {
			Authorization: `Bot ${token}`,
			"Content-Type": "application/json",
		},
		body: JSON.stringify({ recipient_id: TARGET_USER_ID }),
	});

	if (!channelRes.ok) {
		const err = await channelRes.text();
		throw new Error(`Impossible d'ouvrir le canal DM: ${channelRes.status} ${err}`);
	}

	const channelData = (await channelRes.json()) as { id: string };
	const channelId = channelData.id;
	console.log(`Canal DM ouvert : ${channelId}`);

	console.log("Envoi du résumé complet chiffré...");
	const msgRes = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages`, {
		method: "POST",
		headers: {
			Authorization: `Bot ${token}`,
			"Content-Type": "application/json",
		},
		body: JSON.stringify({ content: SUMMARY_CONTENT }),
	});

	if (!msgRes.ok) {
		const err = await msgRes.text();
		throw new Error(`Échec d'envoi du message: ${msgRes.status} ${err}`);
	}

	const msgData = (await msgRes.json()) as { id: string };
	console.log(`✓ Message envoyé avec succès à ${TARGET_USER_ID} (Message ID: ${msgData.id}) !`);

	// Enregistrement dans dm_messages SQLite si la table existe
	try {
		const dbPath = join(import.meta.dir, "..", "data", "bot.db");
		const db = new Database(dbPath);
		db.run(
			`INSERT INTO dm_messages (user_id, direction, content, persona, message_id, created_at)
			 VALUES (?, 'out', ?, 'shenron', ?, datetime('now'))`,
			[TARGET_USER_ID, SUMMARY_CONTENT, msgData.id]
		);
		console.log("✓ Archivé dans dm_messages de bot.db");
	} catch (e) {
		// Non bloquant
		console.log("Archive locale SQLite ignorée");
	}
}

main().catch((e) => {
	console.error("Erreur:", e.message);
	process.exit(1);
});
