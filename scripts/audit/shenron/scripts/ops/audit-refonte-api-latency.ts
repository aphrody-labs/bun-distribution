#!/usr/bin/env bun
/** Read-only latency and determinism probe for the public refonte API routes. */

type Probe = {
	path: string;
	statusCodes: number[];
	latenciesMs: number[];
	p50Ms: number;
	p95Ms: number;
	deterministic: boolean;
	acceptable: boolean;
};

const baseUrl = (process.env.REFONTE_API_BASE_URL ?? "https://dragonballfr.com").replace(/\/$/, "");
const iterations = Math.max(1, Math.min(20, Number(process.env.REFONTE_API_ITERATIONS ?? "3")));
const timeoutMs = Math.max(1_000, Math.min(30_000, Number(process.env.REFONTE_API_TIMEOUT_MS ?? "8000")));
const paths = ["/api/wiki/media?limit=1", "/api/wiki/timelines?limit=1", "/api/wiki/contributors?limit=1", "/api/wiki/events?limit=1"];

const percentile = (values: number[], p: number) => {
	const sorted = [...values].toSorted((a, b) => a - b);
	return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * p) - 1)] ?? 0;
};

const probes: Probe[] = [];
for (const path of paths) {
	const statusCodes: number[] = [];
	const latenciesMs: number[] = [];
	for (let index = 0; index < iterations; index++) {
		const started = performance.now();
		try {
			const response = await fetch(`${baseUrl}${path}`, { signal: AbortSignal.timeout(timeoutMs) });
			statusCodes.push(response.status);
		} catch {
			statusCodes.push(599);
		}
		latenciesMs.push(Math.round(performance.now() - started));
	}
	probes.push({
		path,
		statusCodes,
		latenciesMs,
		p50Ms: percentile(latenciesMs, 0.5),
		p95Ms: percentile(latenciesMs, 0.95),
		deterministic: new Set(statusCodes).size === 1,
		acceptable: statusCodes.every((status) => status >= 200 && status < 500),
	});
}

const report = {
	schema: "shenron-refonte-api-latency/v1",
	generatedAt: new Date().toISOString(),
	baseUrl,
	iterations,
	timeoutMs,
	probes,
	status: probes.every((probe) => probe.acceptable && probe.deterministic) ? "FAIT" : "INCOMPLET",
};
const output = `${JSON.stringify(report, null, 2)}\n`;
const outputFlag = process.argv.indexOf("--out");
if (outputFlag >= 0) {
	const target = process.argv[outputFlag + 1];
	if (!target) throw new Error("--out requires a file path");
	await Bun.write(target, output);
}
await Bun.write(Bun.stdout, output);
process.exitCode = report.status === "FAIT" ? 0 : 1;
