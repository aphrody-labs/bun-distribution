#!/usr/bin/env bun
/**
 * scripts/shenron/sync-bxc-crawls.ts
 *
 * Transfers BXC SQLite snapshot to the application VPS for technical
 * PostgreSQL upsert, then cleans up the remote staging copy.
 * Centralized and managed by aphrody-infra.
 */
import { homedir } from "node:os";
import { join } from "node:path";

const dryRun = process.argv.includes("--dry-run");
const jsonOutput = process.argv.includes("--json");

function getArg(flag: string): string | undefined {
	const idx = process.argv.indexOf(flag);
	return idx !== -1 && idx + 1 < process.argv.length ? process.argv[idx + 1] : undefined;
}

const remoteHost = getArg("--host") ?? process.env.BXC_SQL_HOST ?? "vps";
const localDatabase = getArg("--db") ?? process.env.BXC_DRAGONBALL_DB_PATH
	?? join(homedir(), "bxc", "data", "dragonball-exhaustive", "bxc.sqlite");
const remoteRepository = process.env.BXC_SQL_REMOTE_REPOSITORY ?? "shenron";
const remoteStageDirectory = ".cache/shenron-bxc-import";
const remoteDatabase = `${remoteStageDirectory}/dragonball-exhaustive.sqlite`;

type RunResult = { code: number; stdout: string; stderr: string };

async function run(command: string[], options: { inherit?: boolean } = {}): Promise<RunResult> {
	const child = Bun.spawn(command, {
		stdout: options.inherit ? "inherit" : "pipe",
		stderr: options.inherit ? "inherit" : "pipe",
	});
	if (options.inherit) return { code: await child.exited, stdout: "", stderr: "" };
	const [stdout, stderr, code] = await Promise.all([
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
		child.exited,
	]);
	return { code, stdout: stdout.trim(), stderr: stderr.trim() };
}

function shellQuote(value: string): string {
	return `'${value.replaceAll("'", `"'"'`)}'`;
}

async function main() {
	const localFile = Bun.file(localDatabase);
	if (!(await localFile.exists())) {
		const msg = `BXC SQLite database not found: ${localDatabase}`;
		if (jsonOutput) {
			console.log(JSON.stringify({ status: "error", error: msg }));
			process.exit(1);
		}
		throw new Error(msg);
	}

	if (dryRun) {
		const report = {
			status: "dry-run",
			localDatabase,
			remoteHost,
			remoteStageDirectory,
			remoteDatabase,
		};
		console.log(JSON.stringify(report, null, 2));
		return;
	}

	// Probe remote host home directory
	const remoteHome = await run(["ssh", "-o", "ConnectTimeout=10", remoteHost, "pwd"]);
	if (remoteHome.code !== 0 || !remoteHome.stdout.startsWith("/")) {
		throw new Error(`Remote host ${remoteHost} unreachable: ${remoteHome.stderr || remoteHome.stdout}`);
	}
	const remoteRoot = remoteHome.stdout;
	const stagePath = `${remoteRoot}/${remoteStageDirectory}`;
	const remoteRepoPath = `${remoteRoot}/${remoteRepository}`;
	const importerPath = "scripts/ops/import-bxc-crawls-to-postgres.ts";

	// Prepare remote staging
	const prepare = await run([
		"ssh", "-o", "ConnectTimeout=10", remoteHost,
		`mkdir -p ${shellQuote(stagePath)} && test -f ${shellQuote(`${remoteRepoPath}/${importerPath}`)} && test -f ${shellQuote(`${remoteRoot}/.shenron-neon.env`)}`,
	]);
	if (prepare.code !== 0) {
		throw new Error(`Remote staging preparation failed on ${remoteHost}: ${prepare.stderr || prepare.stdout}`);
	}

	// Transfer SQLite snapshot
	const transfer = await run([
		"rsync", "--archive", "--partial", "--append-verify", "--chmod=F600",
		localDatabase, `${remoteHost}:${stagePath}/dragonball-exhaustive.sqlite`,
	], { inherit: !jsonOutput });
	if (transfer.code !== 0) {
		throw new Error(`Transfer of SQLite database failed (code ${transfer.code})`);
	}

	// Run technical import
	const importCommand = [
		"set -eu",
		`cd ${shellQuote(remoteRepoPath)}`,
		`set -a; . ${shellQuote(`${remoteRoot}/.shenron-neon.env`)}; set +a`,
		`${shellQuote("/usr/local/bin/bun")} ${importerPath} ${shellQuote(`${stagePath}/dragonball-exhaustive.sqlite`)}`,
		`rm -f ${shellQuote(`${stagePath}/dragonball-exhaustive.sqlite`)}`,
	].join("; ");

	const imported = await run(["ssh", "-o", "ConnectTimeout=15", remoteHost, importCommand]);
	if (imported.code !== 0) {
		throw new Error(`Remote PostgreSQL import failed: ${imported.stderr || imported.stdout}`);
	}

	const result = {
		status: "ok",
		localDatabase,
		remoteHost,
		imported: imported.stdout,
	};

	if (jsonOutput) {
		console.log(JSON.stringify(result));
	} else {
		console.log(`✓ Synchronized and imported ${localDatabase} on ${remoteHost}`);
	}
}

await main();
