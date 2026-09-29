#!/usr/bin/env bun
import { resolve } from "node:path";
import { stat } from "node:fs/promises";
import { embedHealthUrl } from "@shenron/pipeline/ai/config";

type Probe = {
	status: "ok" | "error";
	httpStatus: number | null;
	latencyMs: number;
	detail?: string;
};

async function probe(url: string, timeoutMs = 8_000): Promise<Probe> {
	const started = performance.now();
	try {
		const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
		return {
			status: response.ok ? "ok" : "error",
			httpStatus: response.status,
			latencyMs: Math.round(performance.now() - started),
		};
	} catch (error) {
		return {
			status: "error",
			httpStatus: null,
			latencyMs: Math.round(performance.now() - started),
			detail: error instanceof Error ? error.message : String(error),
		};
	}
}

async function coordSnapshot() {
	const now = Date.now();
	const files: Array<{
		path: string;
		bytes: number;
		lines: number;
		invalidLines: number;
		repeatedIds: number;
		ageSeconds: number;
	}> = [];
	for await (const relative of new Bun.Glob(".coord/*.{json,jsonl,txt}").scan({
		cwd: process.cwd(),
		onlyFiles: true,
	})) {
		const file = Bun.file(relative);
		const text = await file.text();
		const metadata = await stat(relative);
		const lines = text.split("\n").filter(Boolean);
		let invalidLines = 0;
		const eventSignatures = new Set<string>();
		let repeatedIds = 0;
		if (relative.endsWith(".jsonl")) {
			for (const line of lines) {
				try {
					const value = JSON.parse(line) as {
						id?: unknown;
						status?: unknown;
						description?: unknown;
						createdAt?: unknown;
					};
					if (typeof value.id === "string") {
						// A task may legitimately appear several times while moving
						// submitted → working → completed. Count only an identical
						// event replay, not a normal lifecycle transition.
						const signature = JSON.stringify({
							id: value.id,
							status: value.status,
							description: value.description,
							createdAt: value.createdAt,
						});
						if (eventSignatures.has(signature)) repeatedIds++;
						eventSignatures.add(signature);
					}
				} catch {
					invalidLines++;
				}
			}
		}
		files.push({
			path: relative,
			bytes: file.size,
			lines: lines.length,
			invalidLines,
			repeatedIds,
			ageSeconds: Math.max(0, Math.round((now - metadata.mtimeMs) / 1_000)),
		});
	}
	return {
		files,
		invalidLines: files.reduce((sum, file) => sum + file.invalidLines, 0),
		repeatedIds: files.reduce((sum, file) => sum + file.repeatedIds, 0),
		staleHeartbeats: files
			.filter((file) => file.path.includes("heartbeat-") && file.ageSeconds > 900)
			.map((file) => file.path),
	};
}

const snapshot = {
	schema: "shenron-observability/v1",
	generatedAt: new Date().toISOString(),
	services: {
		site: await probe("https://dragonballfr.com/"),
		siteHealth: await probe("https://dragonballfr.com/api/health"),
		bot: await probe("https://bot.dragonballfr.com/health"),
		mcp: await probe("https://mcp.dragonballfr.com/health"),
	},
	optionalServices: {
		// Le sidecar est volontairement déporté ; son état est visible sans rendre
		// le snapshot des services publics rouge lorsqu'il est absent localement.
		// Adresse lue par le résolveur unique (APHRODY_AI_EMBED_BASE_URL puis alias) ;
		// sans configuration, l'embedder est signalé comme non configuré.
		ragSidecar: await (async (): Promise<Probe> => {
			const url = embedHealthUrl(process.env);
			return url
				? probe(url.href, 1_500)
				: { status: "error", httpStatus: null, latencyMs: 0, detail: "embedder not configured (APHRODY_AI_EMBED_BASE_URL)" };
		})(),
	},
	coord: await coordSnapshot(),
};

const json = `${JSON.stringify(snapshot, null, 2)}\n`;
const outputFlag = process.argv.indexOf("--out");
if (outputFlag >= 0) {
	const target = process.argv[outputFlag + 1];
	if (!target) throw new Error("--out requires a file path");
	await Bun.write(resolve(target), json);
}
await Bun.write(Bun.stdout, json);
process.exitCode =
	Object.values(snapshot.services).every((service) => service.status === "ok") &&
	snapshot.coord.invalidLines === 0
		? 0
		: 1;
