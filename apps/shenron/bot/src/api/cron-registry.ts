import { container, singleton } from "tsyringe";
import { logger } from "~/lib/logger";
import { EventBusService } from "~/services/EventBusService";
import { SettingsService } from "~/services/SettingsService";

/**
 * Registry centralisée des jobs périodiques (équivalent `@Schedule` de tscord).
 *
 * Permet au dashboard d'inspecter et de déclencher manuellement les tâches qui
 * tournent en arrière-plan (XP vocal tick, scan bio role, jail expiry, …).
 *
 * Usage :
 *   1. À l'init du service : `cron.register({ name: "jail-expiry", intervalMs: 60_000, fn: () => this.tick() })`
 *   2. Le registry démarre le `setInterval` (avec `.unref()`).
 *   3. Stocke `lastRunAt`, `lastDurationMs`, `runCount`, `lastError`.
 *   4. `/cron` GET les expose ; `/cron/:name/trigger` POST déclenche manuellement.
 */

export type JobCategory = "periodic" | "startup";
export type DuplicateBehavior = "skip" | "queue" | "replace";

export interface JobMetrics {
	durationMs: number;
	lastDurationMs: number;
	timestamp: number;
	success: boolean;
	error: string | null;
	runCount: number;
}

export interface CronJob {
	name: string;
	intervalMs: number;
	fn: () => Promise<void> | void;
	description?: string;
	owner?: string;
	category?: JobCategory;
	idempotent?: boolean;
	duplicateBehavior?: DuplicateBehavior;
}

interface JobState extends CronJob {
	owner: string;
	category: JobCategory;
	idempotent: boolean;
	duplicateBehavior: DuplicateBehavior;
	lastRunAt: number | null;
	lastSuccessAt: number | null;
	lastDurationMs: number | null;
	runCount: number;
	lastError: string | null;
	timer: ReturnType<typeof setInterval> | null;
	running: boolean;
	metrics: JobMetrics | null;
}

@singleton()
export class CronRegistry {
	private jobs = new Map<string, JobState>();
	private draining = false;

	get isDraining(): boolean {
		return this.draining;
	}

	register(job: CronJob): void {
		if (this.draining) {
			logger.warn({ name: job.name }, "CronRegistry: en cours d'arrêt (draining), enregistrement ignoré");
			return;
		}
		if (this.jobs.has(job.name)) {
			logger.warn({ name: job.name }, "CronRegistry: job déjà enregistré, skip");
			return;
		}
		const state: JobState = {
			...job,
			owner: job.owner ?? "system",
			category: job.category ?? (job.intervalMs > 0 ? "periodic" : "startup"),
			idempotent: job.idempotent ?? true,
			duplicateBehavior: job.duplicateBehavior ?? "skip",
			lastRunAt: null,
			lastSuccessAt: null,
			lastDurationMs: null,
			runCount: 0,
			lastError: null,
			timer: null,
			running: false,
			metrics: null,
		};
		this.jobs.set(job.name, state);

		if (state.intervalMs > 0) {
			state.timer = setInterval(() => this.run(job.name), job.intervalMs);
			state.timer.unref();
			void this.applyOverride(job.name).catch((err) =>
				logger.warn({ err, name: job.name }, "cron applyOverride failed")
			);
		}
		logger.debug(
			{ name: job.name, owner: state.owner, category: state.category, intervalMs: job.intervalMs },
			"cron registered"
		);
	}

	/** Enregistre un job de démarrage avec observation et métriques de premier run. */
	registerStartupJob(job: Omit<CronJob, "intervalMs" | "category">): void {
		this.register({
			...job,
			intervalMs: 0,
			category: "startup",
		});
	}

	/** Lit l'override `cron.<name>.interval_ms` et reschedule si différent. */
	private async applyOverride(name: string): Promise<void> {
		const job = this.jobs.get(name);
		if (!job) return;
		const settings = container.resolve(SettingsService);
		const overrideMs = await settings.getInt(`cron.${name}.interval_ms`, 0);
		if (overrideMs > 0 && overrideMs !== job.intervalMs) {
			this.reschedule(name, overrideMs);
		}
	}

	/**
	 * Recharge la cadence depuis SettingsService. Appelé par l'API quand l'admin
	 * édite la cadence via le dashboard.
	 */
	async reload(name: string): Promise<{ ok: boolean; intervalMs: number }> {
		const job = this.jobs.get(name);
		if (!job) return { ok: false, intervalMs: 0 };
		await this.applyOverride(name);
		return { ok: true, intervalMs: job.intervalMs };
	}

	/** Reschedule programmatique (utilisée en interne — clear + setInterval). */
	private reschedule(name: string, intervalMs: number): void {
		const job = this.jobs.get(name);
		if (!job) return;
		if (intervalMs < 1_000) {
			logger.warn({ name, intervalMs }, "cron reschedule: interval trop court (<1s), skip");
			return;
		}
		if (job.timer) clearInterval(job.timer);
		job.intervalMs = intervalMs;
		job.timer = setInterval(() => this.run(job.name), intervalMs);
		job.timer.unref();
		logger.info({ name, intervalMs }, "cron rescheduled");
	}

	async run(name: string): Promise<{ ok: boolean; durationMs: number; error: string | null }> {
		const job = this.jobs.get(name);
		if (!job) return { ok: false, durationMs: 0, error: "job inconnu" };
		if (this.draining) {
			logger.warn({ name }, "cron run rejeté: en cours d'arrêt (draining)");
			return { ok: false, durationMs: 0, error: "cron is draining" };
		}
		if (job.running) {
			logger.debug({ name }, "cron déjà en cours, exécution ignorée");
			return { ok: false, durationMs: 0, error: "job déjà en cours" };
		}
		job.running = true;
		const t0 = Bun.nanoseconds() / 1e6;
		try {
			await job.fn();
			const duration = Math.round(Bun.nanoseconds() / 1e6 - t0);
			const now = Date.now();
			job.lastRunAt = now;
			job.lastSuccessAt = now;
			job.lastDurationMs = duration;
			job.runCount++;
			job.lastError = null;
			job.metrics = {
				durationMs: duration,
				lastDurationMs: duration,
				timestamp: now,
				success: true,
				error: null,
				runCount: job.runCount,
			};
			container.resolve(EventBusService).emit("cron:run", { name, ok: true, durationMs: duration });
			return { ok: true, durationMs: duration, error: null };
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			const duration = Math.round(Bun.nanoseconds() / 1e6 - t0);
			const now = Date.now();
			job.lastRunAt = now;
			job.lastDurationMs = duration;
			job.runCount++;
			job.lastError = msg;
			job.metrics = {
				durationMs: duration,
				lastDurationMs: duration,
				timestamp: now,
				success: false,
				error: msg,
				runCount: job.runCount,
			};
			logger.warn({ err, name }, "cron job failed");
			container
				.resolve(EventBusService)
				.emit("cron:run", { name, ok: false, durationMs: job.lastDurationMs });
			return { ok: false, durationMs: job.lastDurationMs, error: msg };
		} finally {
			job.running = false;
		}
	}

	list() {
		return [...this.jobs.values()].map((j) => ({
			name: j.name,
			description: j.description ?? null,
			owner: j.owner,
			category: j.category,
			idempotent: j.idempotent,
			duplicateBehavior: j.duplicateBehavior,
			intervalMs: j.intervalMs,
			lastRunAt: j.lastRunAt,
			lastSuccessAt: j.lastSuccessAt,
			lastDurationMs: j.lastDurationMs,
			runCount: j.runCount,
			lastError: j.lastError,
			running: j.running,
			nextRunAt: j.lastRunAt && j.intervalMs > 0 ? j.lastRunAt + j.intervalMs : null,
			metrics: j.metrics,
		}));
	}

	/**
	 * Arrête tous les timers et attend que les jobs en cours se terminent
	 * (ou que le timeout expire) lors d'un arrêt gracieux (SIGTERM/SIGINT).
	 */
	async drain(timeoutMs = 10_000): Promise<{ drained: boolean; pending: string[] }> {
		this.draining = true;
		// 1. Coupe immédiatement les timers périodiques
		for (const j of this.jobs.values()) {
			if (j.timer) {
				clearInterval(j.timer);
				j.timer = null;
			}
		}

		// 2. Attend que les jobs actifs finissent
		const start = Date.now();
		while (Date.now() - start < timeoutMs) {
			const running = [...this.jobs.values()].filter((j) => j.running).map((j) => j.name);
			if (running.length === 0) {
				logger.info("CronRegistry: all jobs drained successfully");
				return { drained: true, pending: [] };
			}
			await Bun.sleep(20);
		}

		const remaining = [...this.jobs.values()].filter((j) => j.running).map((j) => j.name);
		const drained = remaining.length === 0;
		if (!drained) {
			logger.warn({ remaining, timeoutMs }, "CronRegistry: drain timed out with active jobs");
		}
		return { drained, pending: remaining };
	}

	stopAll(): void {
		this.draining = true;
		for (const j of this.jobs.values()) {
			if (j.timer) {
				clearInterval(j.timer);
				j.timer = null;
			}
		}
		this.jobs.clear();
	}
}
