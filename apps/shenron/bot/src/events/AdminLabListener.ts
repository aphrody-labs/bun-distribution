import { inject, injectable } from "tsyringe";
import { Bot, Discord, On, type ArgsOf } from "discordx";
import { DatabaseService } from "~/db/index";
import { TrainingService } from "~/services/TrainingService";
import { AdminReportGoalService } from "~/services/AdminReportGoalService";
import { ADMIN_LAB_CHANNEL_ID } from "~/lib/admin-lab";
import { logger } from "~/lib/logger";

/**
 * AdminLabListener — Écoute et automatisation en temps réel du salon admin (🤖・lab-ia-admin).
 *
 * 1. Archive chaque message échangé dans SQLite (admin_lab_messages).
 * 2. Répond instantanément aux commandes rapides d'administration :
 *    - `!eval` ou `!train` : lance une passe d'évaluation RAG en direct.
 *    - `!status` ou `!statut` : affiche l'état temps réel du RAG, des APIs et des services.
 *    - `!goal <titre> [| <description>]` : fixe un objectif et synchronise docs/GOALS.md.
 *    - `!report <titre> [| <description>]` : consigne un signalement et synchronise docs/ADMIN-REPORTS.md.
 *    - `!help` : liste les commandes disponibles dans le salon.
 * 3. Répond aux questions de lore/canon adressées à Shenron de façon sobre et sourcée.
 */
@Discord()
@Bot("shenron")
@injectable()
export class AdminLabListener {
	constructor(
		@inject(DatabaseService) private dbs: DatabaseService,
		@inject(TrainingService) private training: TrainingService,
		@inject(AdminReportGoalService) private reportGoal: AdminReportGoalService
	) {}

	@On({ event: "messageCreate" })
	async onMessage([message]: ArgsOf<"messageCreate">) {
		if (message.channelId !== ADMIN_LAB_CHANNEL_ID) return;
		if (message.author.bot) return;

		// 1. Archivage local immédiat du message
		try {
			this.dbs.sqlite
				.query(
					`INSERT INTO admin_lab_messages (message_id, user_id, user_tag, content, has_attachments, created_at)
					 VALUES (?, ?, ?, ?, ?, ?)
					 ON CONFLICT(message_id) DO UPDATE SET content = excluded.content`
				)
				.run(
					message.id,
					message.author.id,
					message.author.tag,
					message.content,
					message.attachments.size > 0 ? 1 : 0,
					Date.now()
				);
		} catch (err) {
			logger.warn({ err }, "[AdminLabListener] Erreur archivage message lab");
		}

		const text = message.content.trim();
		if (!text) return;

		// 2. Commandes rapides avec préfixe '!'
		if (text.startsWith("!")) {
			const [cmd, ...restArgs] = text.slice(1).split(/\s+/);
			const cmdLower = cmd.toLowerCase();
			const fullArg = restArgs.join(" ").trim();

			// Commande !eval / !train
			if (cmdLower === "eval" || cmdLower === "train") {
				const sampleSize = fullArg ? parseInt(fullArg, 10) : 25;
				const replyMsg = await message.reply({
					content: `⏳ Exécution du banc d'évaluation RAG (${isNaN(sampleSize) ? 25 : sampleSize} cas)...`,
				});

				try {
					const metrics = await this.training.evaluateRag(isNaN(sampleSize) ? 25 : sampleSize);
					await replyMsg.edit({
						content: "",
						embeds: [
							{
								color: metrics.sidecarActive ? 0x22c55e : 0xeab308,
								title: "🎯 RÉSULTATS ÉVALUATION RAG EN DIRECT",
								description: [
									`Évaluation exécutée sur **${metrics.cases}** requêtes dorées en **${metrics.durationMs}ms**.`,
									"",
									`• **Recall@1 :** \`${((metrics.recall[1] ?? 0) * 100).toFixed(1)}%\``,
									`• **Recall@3 :** \`${((metrics.recall[3] ?? 0) * 100).toFixed(1)}%\``,
									`• **Recall@5 :** \`${((metrics.recall[5] ?? 0) * 100).toFixed(1)}%\``,
									`• **Recall@10 :** \`${((metrics.recall[10] ?? 0) * 100).toFixed(1)}%\``,
									`• **MRR :** \`${(metrics.mrr * 100).toFixed(1)}%\``,
									`• **nDCG@10 :** \`${(metrics.ndcg * 100).toFixed(1)}%\``,
									`• **Sidecar ONNX :** ${metrics.sidecarActive ? "🟢 En ligne" : "🟠 Hors-ligne"}`,
									`• **Misses :** \`${metrics.misses.length} cas en échec\``,
								].join("\n"),
								timestamp: new Date().toISOString(),
							},
						],
					});
				} catch (err: any) {
					await replyMsg.edit({
						content: `❌ Erreur lors de l'évaluation : ${err?.message ?? err}`,
					});
				}
				return;
			}

			// Commande !status / !statut
			if (cmdLower === "status" || cmdLower === "statut") {
				const stats = await this.training.getStats();
				await message.reply({
					embeds: [
						{
							color: 0x3b82f6,
							title: "📡 ÉTAT DU SYSTÈME SHENRON & LAB IA",
							description: [
								"**Base de Données & Modèle :**",
								`• Chunks RAG : \`${stats.totalChunks.toLocaleString("fr-FR")}\``,
								`• Vecteurs ONNX : \`${stats.totalVectors.toLocaleString("fr-FR")}\``,
								`• Cas du banc doré : \`${stats.totalGoldCases}\``,
								`• Retours d'entraînement : \`${stats.totalFeedbacks}\` (${stats.pendingFeedbacks} en attente)`,
								"",
								"**Services & Connectivité :**",
								`• Embeddings E5 (aphrody-shenron-embed) : ${stats.sidecarStatus === "online" ? "🟢 En ligne" : "🔴 Hors-ligne"}`,
								`• API Site Next.js : ${stats.siteApiStatus === "online" ? "🟢 En ligne" : "🔴 Hors-ligne"}`,
								`• API Bot Shenron (port 5006) : ${stats.botApiStatus === "online" ? "🟢 En ligne" : "🔴 Hors-ligne"}`,
							].join("\n"),
							timestamp: new Date().toISOString(),
						},
					],
				});
				return;
			}

			// Commande !goal
			if (cmdLower === "goal") {
				if (!fullArg) {
					await message.reply({
						content: "Usage : `!goal <Titre> [| <Description>]`\nExemple : `!goal Optimiser le reranker | Affiner les seuils de similarité pour DB Daima`",
					});
					return;
				}

				const parts = fullArg.split("|").map((p) => p.trim());
				const title = parts[0]!;
				const description = parts[1] ?? title;

				const res = await this.reportGoal.createGoal({
					userId: message.author.id,
					userTag: message.author.tag,
					title,
					description,
					priority: "p1",
					targetSession: "prochaine",
				});

				await message.reply({
					embeds: [
						{
							color: 0x10b981,
							title: `🎯 Objectif #${res.id} enregistré`,
							description: [
								`**Titre :** ${title}`,
								`**Description :** ${description}`,
								"",
								"✓ Synchronisé en direct dans `docs/GOALS.md`.",
								"✓ Pris en compte pour la prochaine session des agents.",
							].join("\n"),
						},
					],
				});
				return;
			}

			// Commande !report
			if (cmdLower === "report") {
				if (!fullArg) {
					await message.reply({
						content: "Usage : `!report <Titre> [| <Description>]`\nExemple : `!report Manque fiche Glorio | Daima épisode 1 n'a pas encore de fiche complète`",
					});
					return;
				}

				const parts = fullArg.split("|").map((p) => p.trim());
				const title = parts[0]!;
				const description = parts[1] ?? title;

				const res = await this.reportGoal.createReport({
					userId: message.author.id,
					userTag: message.author.tag,
					category: "wiki",
					title,
					description,
					severity: "minor",
				});

				await message.reply({
					embeds: [
						{
							color: 0xf59e0b,
							title: `⚠️ Signalement #${res.id} consigné`,
							description: [
								`**Titre :** ${title}`,
								`**Description :** ${description}`,
								"",
								"✓ Synchronisé en direct dans `docs/ADMIN-REPORTS.md`.",
								"✓ Priorisé pour traitement par l'équipe et les agents.",
							].join("\n"),
						},
					],
				});
				return;
			}

			// Commande !help
			if (cmdLower === "help" || cmdLower === "aide") {
				await message.reply({
					embeds: [
						{
							color: 0x6366f1,
							title: "🛠️ COMMANDES DU SALON LAB IA ADMIN",
							description: [
								"Ce salon est réservé aux administrateurs pour piloter l'entraînement et la doctrine.",
								"",
								"• `!eval [nombre]` : Lance une passe d'évaluation RAG immédiate.",
								"• `!status` : Diagnostic de santé de tous les services (RAG, sidecar, API site/bot).",
								"• `!goal <titre> [| <desc>]` : Fixe un objectif pour les prochaines sessions d'agents.",
								"• `!report <titre> [| <desc>]` : Signale une erreur ou un manque sur le site/bot.",
								"• `!help` : Affiche ce récapitulatif.",
								"",
								"Vous pouvez également utiliser les commandes slash complètes : `/train`, `/goal`, `/report`.",
							].join("\n"),
						},
					],
				});
				return;
			}
		}

		// 3. Question canonique adressée à Shenron (si mention directe ou mot clé 'shenron')
		const mentionsBot = message.mentions.has(message.client.user?.id ?? "");
		const startsWithShenron = text.toLowerCase().startsWith("shenron");

		if (mentionsBot || startsWithShenron) {
			const cleanQuery = text
				.replace(/<@!?[0-9]+>/g, "")
				.replace(/^shenron[\s,:]*/i, "")
				.trim();

			if (cleanQuery.length >= 3) {
				try {
					const canonRes = await this.training.inspectCanon(cleanQuery);
					if (canonRes) {
						await message.reply({
							embeds: [
								{
									color: canonRes.tier === "canon" ? 0x22c55e : canonRes.tier === "retcon" ? 0xf59e0b : 0xef4444,
									title: `📜 Canonicité : ${canonRes.verdict}`,
									description: [
										`• **Niveau :** \`${canonRes.tierLabel}\` (Score: ${canonRes.score}/100)`,
										`• **Nature :** ${canonRes.nature}`,
										canonRes.toriyamaQuote ? `• **Akira Toriyama :** *« ${canonRes.toriyamaQuote.text} »* (${canonRes.toriyamaQuote.source})` : "",
										`• **Preuves :** ${canonRes.referencesCount} références, ${canonRes.planchesCount} planches manga`,
									].filter(Boolean).join("\n"),
								},
							],
						});
					}
				} catch (err) {
					logger.debug({ err }, "[AdminLabListener] Erreur réponse canonique");
				}
			}
		}
	}
}
