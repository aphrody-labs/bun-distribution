#!/usr/bin/env bun
/**
 * Boucle continue de contrôle de la spécification.
 * Arrêt propre : Ctrl-C / SIGINT. Par défaut, un tour par minute.
 */

const rawInterval = Number(process.env.REFONTE_AUDIT_INTERVAL_MS ?? "60000");
const intervalMs = Number.isFinite(rawInterval) ? Math.max(1000, rawInterval) : 60000;
const reportPath = process.env.REFONTE_AUDIT_REPORT ?? ".coord/architecture-refonte-last.json";
const historyPath = process.env.REFONTE_AUDIT_HISTORY ?? ".coord/architecture-refonte-history.jsonl";
const historyLimit = 200;
const runtimeValidation = process.env.REFONTE_AUDIT_RUNTIME === "1";
const fullValidation = process.env.REFONTE_AUDIT_FULL === "1";
const once = process.env.REFONTE_AUDIT_ONCE === "1";
const serialValidation = process.env.REFONTE_AUDIT_SERIAL === "1";
const apiValidation = process.env.REFONTE_AUDIT_API === "1";
let stopping = false;
let failureStreak = 0;

const stop = () => {
	if (stopping) return;
	stopping = true;
	console.log("\n[watch-refonte] arrêt demandé ; aucun nouveau tour ne sera lancé.");
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);

console.log(
	`[watch-refonte] boucle active — intervalle ${intervalMs} ms, runtime=${runtimeValidation ? "on" : "off"}, api=${apiValidation ? "on" : "off"}, full=${fullValidation ? "on" : "off"}, serial=${serialValidation ? "on" : "off"}, once=${once ? "on" : "off"}, history=${historyPath} (Ctrl-C pour arrêter)`,
);

while (!stopping) {
	const child = Bun.spawn(["bun", "run", "audit:architecture", "--json-out", reportPath], {
		stdout: "inherit",
		stderr: "inherit",
	});
	const exitCode = await child.exited;
	if (exitCode !== 0) console.error(`[watch-refonte] audit en échec (code ${exitCode})`);
	let runtimeCode: number | null = null;
	let fullCode: number | null = null;
	let apiCode: number | null = null;
	if (runtimeValidation && exitCode === 0 && !stopping) {
		const runtime = Bun.spawn(["bun", "test", "apps/site/tests/databook-features.test.ts"], {
			stdout: "inherit",
			stderr: "inherit",
		});
		runtimeCode = await runtime.exited;
		if (runtimeCode !== 0) console.error(`[watch-refonte] validation runtime en échec (code ${runtimeCode})`);
	}
	if (apiValidation && !stopping) {
		const api = Bun.spawn(["bun", "run", "audit:refonte-api", "--out", `${reportPath}.api.json`], {
			stdout: "inherit",
			stderr: "inherit",
		});
		apiCode = await api.exited;
		if (apiCode !== 0) console.error(`[watch-refonte] sonde API en échec (code ${apiCode})`);
	}
	if (fullValidation && !stopping) {
		const fullArgs = ["bun", "test", "apps/site/tests"];
		if (serialValidation) fullArgs.push("--parallel=1");
		const full = Bun.spawn(fullArgs, {
			stdout: "inherit",
			stderr: "inherit",
		});
		fullCode = await full.exited;
		if (fullCode !== 0) console.error(`[watch-refonte] suite complète en échec (code ${fullCode})`);
	}
	const passed = exitCode === 0 && (runtimeValidation ? runtimeCode === 0 : true) && (apiValidation ? apiCode === 0 : true) && (fullValidation ? fullCode === 0 : true);
	failureStreak = passed ? 0 : failureStreak + 1;
	const runtimeReport = {
		generatedAt: new Date().toISOString(),
		structuralExitCode: exitCode,
		runtimeExitCode: runtimeCode,
		apiExitCode: apiCode,
		fullSuiteExitCode: fullCode,
		serialValidation,
		status: passed ? "FAIT" : "INCOMPLET",
		failureStreak,
		escalation: failureStreak >= 3 ? "ADMIN_REQUIRED" : null,
	};
	await Bun.write(`${reportPath}.runtime.json`, `${JSON.stringify(runtimeReport, null)}\n`);
	let history: string[] = [];
	if (await Bun.file(historyPath).exists()) {
		history = (await Bun.file(historyPath).text()).split("\n").filter(Boolean).slice(-(historyLimit - 1));
	}
	history.push(JSON.stringify(runtimeReport));
	await Bun.write(historyPath, `${history.join("\n")}\n`);
	if (stopping) break;
	if (once) break;
	await Bun.sleep(intervalMs);
}

console.log("[watch-refonte] boucle arrêtée proprement.");
