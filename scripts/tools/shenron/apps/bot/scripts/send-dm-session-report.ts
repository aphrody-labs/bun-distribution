import { Database } from "bun:sqlite";

const TARGET_USER_ID = "1527405876695142620";

async function discordToken(): Promise<string> {
	const env = await Bun.file(new URL("../.env", import.meta.url)).text().catch(() => "");
	for (const line of env.split("\n")) {
		const trimmed = line.trim();
		if (trimmed.startsWith("DISCORD_TOKEN_SHENRON=")) return trimmed.slice("DISCORD_TOKEN_SHENRON=".length).replace(/^['"]|['"]$/g, "").trim();
		if (trimmed.startsWith("DISCORD_TOKEN=")) return trimmed.slice("DISCORD_TOKEN=".length).replace(/^['"]|['"]$/g, "").trim();
	}
	if (process.env.DISCORD_TOKEN_SHENRON?.trim()) return process.env.DISCORD_TOKEN_SHENRON.trim();
	if (process.env.DISCORD_TOKEN?.trim()) return process.env.DISCORD_TOKEN.trim();
	throw new Error("DISCORD_TOKEN introuvable");
}

const reports = [
	`🐉 **Rapport complet de session — Shenron / Dragon Ball FR**

Salut Omar ! Voici le bilan vérifiable de la session.

**Données canoniques visibles**
• Personnages : 664, tous avec article, image et bibliographie.
• Planètes : 62 ; races : 18 ; sagas : 33.
• Techniques : 25 ; transformations : 17.
• Épisodes : 826 ; films : 28 ; jeux : 58.
• Databooks : 480 au total, 442 visibles après migrations (20 masqués logiquement).
• Manga : 245 volumes et 922 chapitres visibles.
• Objets : 5 restaurés avec preuves manga ; tournois : 10 sourcés.

**Nettoyage anti-fake data**
• Pages de jeu pur, boilerplates, placeholders, niveaux spéculatifs et chapitres impossibles retirés logiquement, avec révisions.
• OCR : familles bloquantes à zéro ; les signaux nécessitant une relecture humaine restent signalés, sans invention.`,
	`🖼️ **UI, images et catégories**

• Dragons : Shenron, Polunga, Super Shenron et Toronbo reliés à des assets locaux ; fallback décoratif explicite pour Ultimate Shenron.
• Fallbacks de catégorie ajoutés aux cartes objets, tournois, musiques, combats, voix, arcs et races.
• Mapping visuel explicite des lieux (Terre, Namek, Sadala, Vampa, Monde du Vide, Makai, etc.).
• Kinto-Un et Mafūba utilisent des assets locaux vérifiés.

**Correction éditoriale notable**
La fiche de la Planète de Maître Kaïô a été réécrite sur les seuls tomes 18 et 27 ; les anecdotes non prouvées (Beerus, Gregory, hommage Michael Jackson) ont été retirées.`,
	`📚 **Migration Anime Comics / Manga**

Les doublons certains ont été masqués logiquement et versionnés, avec redirection des anciennes fiches vers Manga :
• Databooks 32 → Manga 417, 33 → 416, 48 → 420, 312 → 418.
• Databooks 443–456 → volumes Manga/TVSP 404–417.

Total : **18 fiches migrées**, 18 révisions PostgreSQL, aucune suppression physique. Les **11 fiches Jump Anime Comics non équivalentes** restent dans Databooks pour arbitrage éditorial.

Les anciennes URLs /wiki/databooks/{id} redirigent vers le volume Manga correspondant.

**Sōshūhen et light novels**
• Les 18 Sōshūhen Databooks (465 et 469–485) ont été masqués et reliés aux volumes Manga 701–718 déjà présents.
• Les deux light novels (Databooks 58–59) ont été importés en nouveaux volumes Manga 719–720, série « Dragon Ball — Light Novels », puis masqués côté Databooks.
• Les 20 anciennes URLs redirigent vers leurs volumes Manga ; les couvertures et métadonnées sont conservées.

**Cosmologie → Lieux**
• /wiki/cosmologie et les fiches historiques redirigent vers /wiki/lieux.
• Cosmologie retirée de la navigation et du sitemap.
• Les 62 lignes planètes restent en base pour le RAG, les références et l’administration ; aucune donnée n’a été détruite.`,
	`✅ **Intégrité et validations**

• 506 bibliographies visibles stockées comme chaînes JSON reconstruites en tableaux JSON, chacune versionnée.
• 0 ancien lien /wiki/dragon-ball/ ou /wiki/planetes/ visible.
• 0 URL film numérique et 0 volume manga invalide dans les sources visibles.
• Audit articles : 0 anomalie.
• Contrat SQL wiki : toutes les tables/colonnes attendues présentes.
• Type-check Site : OK.
• Lint : 0 erreur (2 avertissements React préexistants dans admin/shop).
• Tests ciblés : 16/16 passés ; git diff --check OK.

**Reste à arbitrer**
• Les 3 exceptions éditoriales à conserver dans Databooks, si elles diffèrent encore des 11 fiches non équivalentes.
• Les databooks sans planches intérieures restent marqués incomplets, sans remplissage inventé.
• Les tests d’intégration PostgreSQL locale restent limités par l’authentification locale ; les audits distants autoritatifs sont verts.

Toutes les opérations sont journalisées dans PLAN.md, wiki_revisions et le salon admin.`,
];

async function main() {
	const token = await discordToken();
	const channelResponse = await fetch("https://discord.com/api/v10/users/@me/channels", {
		method: "POST",
		headers: { Authorization: `Bot ${token}`, "Content-Type": "application/json" },
		body: JSON.stringify({ recipient_id: TARGET_USER_ID }),
	});
	if (!channelResponse.ok) throw new Error(`DM channel: ${channelResponse.status} ${await channelResponse.text()}`);
	const channel = (await channelResponse.json()) as { id: string };
	const db = new Database(new URL("../data/bot.db", import.meta.url).pathname);
	try {
		for (const content of reports) {
			const response = await fetch(`https://discord.com/api/v10/channels/${channel.id}/messages`, {
				method: "POST",
				headers: { Authorization: `Bot ${token}`, "Content-Type": "application/json" },
				body: JSON.stringify({ content }),
			});
			if (!response.ok) throw new Error(`DM send: ${response.status} ${await response.text()}`);
			const message = (await response.json()) as { id: string };
			try {
				db.run("insert into dm_messages (user_id,direction,content,persona,message_id,created_at) values (?, 'out', ?, 'shenron', ?, datetime('now'))", [TARGET_USER_ID, content, message.id]);
			} catch {
				// L'archivage local ne doit pas empêcher l'envoi Discord.
			}
			await Bun.sleep(1200);
		}
	} finally {
		db.close();
	}
	console.log(JSON.stringify({ ok: true, recipient: TARGET_USER_ID, parts: reports.length }));
}

main().catch((error) => {
	console.error(error instanceof Error ? error.message : error);
	process.exit(1);
});
