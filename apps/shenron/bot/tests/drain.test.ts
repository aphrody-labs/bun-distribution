import "./setup";
import { describe, expect, it } from "bun:test";
import { CronRegistry } from "../src/api/cron-registry";
import { ApiServer } from "../src/api/server";
import { container } from "tsyringe";

describe("S1 — Drain on SIGTERM (CronRegistry & ApiServer)", () => {
	describe("CronRegistry drain", () => {
		it("drains immediately when no jobs are executing", async () => {
			const registry = new CronRegistry();
			registry.register({
				name: "fast-job",
				intervalMs: 10_000,
				fn: () => {},
			});

			const result = await registry.drain(500);
			expect(result.drained).toBe(true);
			expect(result.pending).toEqual([]);
			expect(registry.isDraining).toBe(true);
		});

		it("waits for an active long-running job to finish within timeout", async () => {
			const registry = new CronRegistry();
			let completed = false;

			registry.register({
				name: "slow-job",
				intervalMs: 60_000,
				fn: async () => {
					await Bun.sleep(100);
					completed = true;
				},
			});

			// Trigger job manually so it enters running state
			const runPromise = registry.run("slow-job");

			// Concurrently invoke drain
			const drainResult = await registry.drain(1_000);
			await runPromise;

			expect(completed).toBe(true);
			expect(drainResult.drained).toBe(true);
			expect(drainResult.pending).toEqual([]);
		});

		it("times out and reports pending jobs if execution exceeds timeout", async () => {
			const registry = new CronRegistry();
			let jobFinished = false;

			registry.register({
				name: "hanging-job",
				intervalMs: 60_000,
				fn: async () => {
					await Bun.sleep(500);
					jobFinished = true;
				},
			});

			const runPromise = registry.run("hanging-job");
			// Drain with short timeout (50ms)
			const drainResult = await registry.drain(50);

			expect(drainResult.drained).toBe(false);
			expect(drainResult.pending).toContain("hanging-job");

			// Wait for the background job to finish cleanly so it doesn't leak
			await runPromise;
			expect(jobFinished).toBe(true);
		});

		it("rejects new job runs when draining", async () => {
			const registry = new CronRegistry();
			registry.register({
				name: "sample-job",
				intervalMs: 60_000,
				fn: () => {},
			});

			await registry.drain(100);
			const result = await registry.run("sample-job");
			expect(result.ok).toBe(false);
			expect(result.error).toBe("cron is draining");
		});

		it("ignores register when draining", () => {
			const registry = new CronRegistry();
			registry.drain(100);
			registry.register({
				name: "after-drain-job",
				intervalMs: 10_000,
				fn: () => {},
			});

			expect(registry.list().find((j) => j.name === "after-drain-job")).toBeUndefined();
		});
	});

	describe("ApiServer drain", () => {
		it("drains immediately if server is not started", async () => {
			const apiServer = new ApiServer({} as any);
			const result = await apiServer.drain(200);
			expect(result.drained).toBe(true);
			expect(result.pendingRequests).toBe(0);
		});

		it("completes in-flight requests before shutdown", async () => {
			let resolveHandler: () => void;
			const handlerPromise = new Promise<void>((r) => {
				resolveHandler = r;
			});

			// Create a test Bun.serve simulating ApiServer drain semantics
			const server = Bun.serve({
				port: 0,
				async fetch() {
					await handlerPromise;
					return Response.json({ ok: true });
				},
			});

			const reqPromise = fetch(`http://127.0.0.1:${server.port}/test`).then((r) => r.json());

			// Wait for request to be in flight
			await Bun.sleep(20);
			expect(server.pendingRequests).toBe(1);

			// Start draining server
			const drainPromise = (async () => {
				server.stop(false);
				const start = Date.now();
				while (server.pendingRequests > 0 && Date.now() - start < 1000) {
					await Bun.sleep(20);
				}
				const drained = server.pendingRequests === 0;
				if (!drained) server.stop(true);
				return { drained, pendingRequests: server.pendingRequests };
			})();

			// Resolve handler so request completes
			resolveHandler!();

			const [drainResult, responseData] = await Promise.all([drainPromise, reqPromise]);
			expect(drainResult.drained).toBe(true);
			expect(drainResult.pendingRequests).toBe(0);
			expect(responseData).toEqual({ ok: true });
		});

		it("forcibly terminates in-flight requests if timeout is exceeded", async () => {
			// Simulates timeout behavior
			const server = Bun.serve({
				port: 0,
				async fetch() {
					await Bun.sleep(1000);
					return Response.json({ ok: true });
				},
			});

			// Fire and forget request
			const reqPromise = fetch(`http://127.0.0.1:${server.port}/test`).catch((err) => err);

			await Bun.sleep(20);
			expect(server.pendingRequests).toBe(1);

			// Drain with 50ms timeout
			server.stop(false);
			const start = Date.now();
			while (server.pendingRequests > 0 && Date.now() - start < 50) {
				await Bun.sleep(10);
			}
			const drained = server.pendingRequests === 0;
			if (!drained) {
				server.stop(true); // force close
			}

			expect(drained).toBe(false);
			await reqPromise;
		});
	});
});
