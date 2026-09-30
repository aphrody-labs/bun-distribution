import "./setup";
import { describe, expect, it } from "bun:test";
import { CronRegistry } from "../src/api/cron-registry";

describe("S3 — Job Classification, Idempotence & Metrics", () => {
	it("classifies periodic jobs with owner, category, idempotence, and duplicate behavior", () => {
		const registry = new CronRegistry();
		registry.register({
			name: "jail-expiry",
			description: "Auto-unjail des membres dont la peine expire",
			owner: "moderation",
			category: "periodic",
			idempotent: true,
			duplicateBehavior: "skip",
			intervalMs: 60_000,
			fn: () => {},
		});

		const jobs = registry.list();
		const job = jobs.find((j) => j.name === "jail-expiry");
		expect(job).toBeDefined();
		expect(job!.owner).toBe("moderation");
		expect(job!.category).toBe("periodic");
		expect(job!.idempotent).toBe(true);
		expect(job!.duplicateBehavior).toBe("skip");
		expect(job!.intervalMs).toBe(60_000);
		expect(job!.runCount).toBe(0);
		expect(job!.lastRunAt).toBeNull();
		expect(job!.metrics).toBeNull();

		registry.stopAll();
	});

	it("classifies startup jobs via registerStartupJob without recurring timer", () => {
		const registry = new CronRegistry();
		let ran = false;

		registry.registerStartupJob({
			name: "wiki-auto-seed",
			description: "Auto-seed wiki si DB vide",
			owner: "wiki",
			idempotent: true,
			fn: () => {
				ran = true;
			},
		});

		const jobs = registry.list();
		const job = jobs.find((j) => j.name === "wiki-auto-seed");
		expect(job).toBeDefined();
		expect(job!.owner).toBe("wiki");
		expect(job!.category).toBe("startup");
		expect(job!.intervalMs).toBe(0);
		expect(job!.nextRunAt).toBeNull();

		registry.stopAll();
	});

	it("records comprehensive last run metrics on successful execution", async () => {
		const registry = new CronRegistry();
		registry.register({
			name: "economy-snapshot",
			owner: "economy",
			category: "periodic",
			intervalMs: 3600_000,
			fn: async () => {
				await Bun.sleep(15);
			},
		});

		const result = await registry.run("economy-snapshot");
		expect(result.ok).toBe(true);
		expect(result.durationMs).toBeGreaterThanOrEqual(10);
		expect(result.error).toBeNull();

		const jobs = registry.list();
		const job = jobs.find((j) => j.name === "economy-snapshot")!;
		expect(job.runCount).toBe(1);
		expect(job.lastRunAt).toBeGreaterThan(0);
		expect(job.lastSuccessAt).toBe(job.lastRunAt);
		expect(job.lastError).toBeNull();

		expect(job.metrics).toBeDefined();
		expect(job.metrics!.success).toBe(true);
		expect(job.metrics!.durationMs).toBe(job.lastDurationMs!);
		expect(job.metrics!.runCount).toBe(1);
		expect(job.metrics!.error).toBeNull();

		registry.stopAll();
	});

	it("records last run metrics and captures error explicitly on failure", async () => {
		const registry = new CronRegistry();
		registry.register({
			name: "failing-job",
			owner: "test",
			category: "periodic",
			intervalMs: 3600_000,
			fn: async () => {
				await Bun.sleep(5);
				throw new Error("Simulated database connection failure");
			},
		});

		const result = await registry.run("failing-job");
		expect(result.ok).toBe(false);
		expect(result.error).toBe("Simulated database connection failure");

		const job = registry.list().find((j) => j.name === "failing-job")!;
		expect(job.runCount).toBe(1);
		expect(job.lastRunAt).toBeGreaterThan(0);
		expect(job.lastSuccessAt).toBeNull();
		expect(job.lastError).toBe("Simulated database connection failure");

		expect(job.metrics).toBeDefined();
		expect(job.metrics!.success).toBe(false);
		expect(job.metrics!.error).toBe("Simulated database connection failure");

		registry.stopAll();
	});

	it("enforces skip duplicate behavior when duplicate execution is triggered concurrently", async () => {
		const registry = new CronRegistry();
		let finishJob: () => void;
		const jobWait = new Promise<void>((r) => {
			finishJob = r;
		});

		registry.register({
			name: "concurrent-job",
			owner: "system",
			category: "periodic",
			duplicateBehavior: "skip",
			intervalMs: 60_000,
			fn: async () => {
				await jobWait;
			},
		});

		const run1 = registry.run("concurrent-job");
		// Second trigger while first is still running
		const run2 = await registry.run("concurrent-job");

		expect(run2.ok).toBe(false);
		expect(run2.error).toBe("job déjà en cours");

		finishJob!();
		const res1 = await run1;
		expect(res1.ok).toBe(true);

		registry.stopAll();
	});
});
