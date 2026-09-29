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

export interface CronJob {
	name: string;
	intervalMs: number;
	fn: () => Promise<void> | void;
	description?: string;
}

interface JobState extends CronJob {
	lastRunAt: number | null;
	lastDurationMs: number | null;
	runCount: number;
	lastError: string | null;
	timer: ReturnType<typeof setInterval> | null;
	running: boolean;
}

@singleton()
export class CronRegistry {
	private jobs = new Map<string, JobState>();

	register(job: CronJob): void {
		if (this.jobs.has(job.name)) {
			logger.warn({ name: job.name }, "CronRegistry: job déjà enregistré, skip");
			return;
		}
		const state: JobState = {
			...job,
			lastRunAt: null,
			lastDurationMs: null,
			runCount: 0,
			lastError: null,
			timer: null,
			running: false,
		};
		this.jobs.set(job.name, state);

		// Lit l'override `cron.<name>.interval_ms` depuis SettingsService au boot.
		// L'override est asynchrone → on démarre d'abord avec la cadence par défaut
		// puis on reschedule si un override existe (silently no-op si SettingsService
		// pas encore prêt, ce qui est OK : reschedule() peut être rappelé via API).
		state.timer = setInterval(() => this.run(job.name), job.intervalMs);
		state.timer.unref();
		void this.applyOverride(job.name).catch((err) =>
			logger.warn({ err, name: job.name }, "cron applyOverride failed")
		);
		logger.debug({ name: job.name, intervalMs: job.intervalMs }, "cron registered");
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
		if (job.running) {
			logger.debug({ name }, "cron déjà en cours, exécution ignorée");
			return { ok: false, durationMs: 0, error: "job déjà en cours" };
		}
		job.running = true;
		const t0 = Bun.nanoseconds() / 1e6;
		try {
			await job.fn();
			const duration = Math.round(Bun.nanoseconds() / 1e6 - t0);
			job.lastRunAt = Date.now();
			job.lastDurationMs = duration;
			job.runCount++;
			job.lastError = null;
			container.resolve(EventBusService).emit("cron:run", { name, ok: true, durationMs: duration });
			return { ok: true, durationMs: duration, error: null };
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			job.lastRunAt = Date.now();
			job.lastDurationMs = Math.round(Bun.nanoseconds() / 1e6 - t0);
			job.runCount++;
			job.lastError = msg;
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
			intervalMs: j.intervalMs,
			lastRunAt: j.lastRunAt,
			lastDurationMs: j.lastDurationMs,
			runCount: j.runCount,
			lastError: j.lastError,
			running: j.running,
			nextRunAt: j.lastRunAt ? j.lastRunAt + j.intervalMs : null,
		}));
	}

	stopAll(): void {
		for (const j of this.jobs.values()) {
			if (j.timer) clearInterval(j.timer);
		}
		this.jobs.clear();
	}
}
