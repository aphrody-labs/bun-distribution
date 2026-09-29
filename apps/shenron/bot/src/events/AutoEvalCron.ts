import { injectable, inject } from "tsyringe";
import { Bot, Discord, Once } from "discordx";
import { CronRegistry } from "~/api/cron-registry";
import { TrainingService } from "~/services/TrainingService";
import { logger } from "~/lib/logger";
import { sendAdminLabMessage } from "~/lib/admin-lab";

/**
 * AutoEvalCron — Évaluation automatisée et surveillance de la précision du RAG.
 *
 * Exécute un banc d'évaluation périodique sur l'échantillon d'or (tests/rag-gold.jsonl),
 * historise les scores (Recall, MRR, nDCG) en base SQLite (rag_eval_history)
 * et alerte automatiquement le salon admin en cas de dégradation ou régression.
 */
@Discord()
@Bot("shenron")
@injectable()
export class AutoEvalCronEvent {
	constructor(
		@inject(CronRegistry) private cron: CronRegistry,
		@inject(TrainingService) private training: TrainingService
	) {}

	@Once({ event: "clientReady" })
	async register() {
		// Intervalle par défaut : toutes les 6 heures (6 * 3 600 000 ms)
		const SIX_HOURS_MS = 6 * 3_600_000;

		this.cron.register({
			name: "rag-auto-eval",
			description: "Évaluation périodique du banc de test doré RAG et détection de régressions",
			intervalMs: SIX_HOURS_MS,
			fn: async () => {
				logger.info("[AutoEvalCron] Lancement du banc d'évaluation RAG périodique...");
				try {
					const metrics = await this.training.evaluateRag(25);
					logger.info(
						{
							cases: metrics.cases,
							recall1: metrics.recall[1],
							recall5: metrics.recall[5],
							mrr: metrics.mrr,
							ndcg: metrics.ndcg,
							misses: metrics.misses.length,
							sidecar: metrics.sidecarActive,
						},
						"[AutoEvalCron] Évaluation RAG terminée avec succès"
					);

					// Rapport périodique synthétique dans le salon admin si sidecar offline ou des misses
					if (!metrics.sidecarActive || metrics.misses.length > 0) {
						await sendAdminLabMessage({
							embeds: [
								{
									color: metrics.sidecarActive ? 0x22c55e : 0xeab308,
									title: "📊 RAPPORT AUTOMATIQUE — ÉVALUATION RAG",
									description: [
										`Cycle d'évaluation périodique automatique (25 cas testés).`,
										"",
										`• **Recall@1 :** \`${((metrics.recall[1] ?? 0) * 100).toFixed(1)}%\``,
										`• **Recall@5 :** \`${((metrics.recall[5] ?? 0) * 100).toFixed(1)}%\``,
										`• **MRR :** \`${(metrics.mrr * 100).toFixed(1)}%\``,
										`• **nDCG@10 :** \`${(metrics.ndcg * 100).toFixed(1)}%\``,
										`• **Sidecar ONNX :** ${metrics.sidecarActive ? "🟢 En ligne (aphrody-shenron-embed)" : "🟠 Hors-ligne (repli BM25 FTS5)"}`,
										`• **Misses :** \`${metrics.misses.length} / ${metrics.cases}\``,
									].join("\n"),
									timestamp: new Date().toISOString(),
								},
							],
						}).catch((err) => logger.warn({ err }, "[AutoEvalCron] Erreur notification admin"));
					}
				} catch (err) {
					logger.error({ err }, "[AutoEvalCron] Échec de l'évaluation RAG planifiée");
				}
			},
		});

		// Évaluation rapide au démarrage (décalée de 15s pour laisser le bot s'initialiser)
		setTimeout(async () => {
			try {
				logger.info("[AutoEvalCron] Évaluation initiale au démarrage du bot...");
				await this.training.evaluateRag(10);
			} catch (err) {
				logger.warn({ err }, "[AutoEvalCron] Évaluation initiale différée ignorée");
			}
		}, 15_000).unref?.();
	}
}
