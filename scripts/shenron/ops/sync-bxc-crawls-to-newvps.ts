#!/usr/bin/env bun

/**
 * Transfers the current VPS BXC SQLite snapshot to the application VPS for a
 * technical PostgreSQL upsert, then removes the remote staging copy.
 *
 * Crawl data is never promoted here: the importer writes only external source
 * records with `canonical_eligible = false`.
 */
import { homedir } from "node:os";
import { join } from "node:path";

const remoteHost = process.env.BXC_SQL_HOST ?? "vps";
const localDatabase = process.env.BXC_DRAGONBALL_DB_PATH
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

const localFile = Bun.file(localDatabase);
if (!(await localFile.exists())) throw new Error(`BXC SQLite introuvable: ${localDatabase}`);

const activeCrawl = await run([
	"systemctl", "--user", "is-active", "--quiet", "shenron-bxc-mass-crawl.service",
]);
if (activeCrawl.code === 0) {
	console.log(JSON.stringify({ status: "skipped", reason: "crawl-active" }));
	process.exit(0);
}

const remoteHome = await run(["ssh", "-o", "ConnectTimeout=15", remoteHost, "pwd"]);
if (remoteHome.code !== 0 || !remoteHome.stdout.startsWith("/")) {
	throw new Error(`Home distant illisible: ${remoteHome.stderr || remoteHome.stdout}`);
}
const remoteRoot = remoteHome.stdout;
const stagePath = `${remoteRoot}/${remoteStageDirectory}`;
const remoteRepositoryPath = `${remoteRoot}/${remoteRepository}`;
const importerPath = "scripts/ops/import-bxc-crawls-to-postgres.ts";

const prepare = await run([
	"ssh", "-o", "ConnectTimeout=15", remoteHost,
	`mkdir -p ${shellQuote(stagePath)} && test -f ${shellQuote(`${remoteRepositoryPath}/scripts/ops/import-bxc-crawls-to-postgres.ts`)} && test -f ${shellQuote(`${remoteRoot}/.shenron-neon.env`)}`,
]);
if (prepare.code !== 0) throw new Error(`Préparation distante impossible: ${prepare.stderr || prepare.stdout}`);

const importerTransfer = await run([
	"rsync", "--archive", "--chmod=F644",
	importerPath, `${remoteHost}:${remoteRepositoryPath}/${importerPath}`,
], { inherit: true });
if (importerTransfer.code !== 0) throw new Error(`Transfert de l'importeur échoué (code ${importerTransfer.code}).`);

const transfer = await run([
	"rsync", "--archive", "--partial", "--append-verify", "--chmod=F600",
	localDatabase, `${remoteHost}:${stagePath}/dragonball-exhaustive.sqlite`,
], { inherit: true });
if (transfer.code !== 0) throw new Error(`Transfert SQLite échoué (code ${transfer.code}).`);

const importCommand = [
	"set -eu",
	`cd ${shellQuote(remoteRepositoryPath)}`,
	`set -a; . ${shellQuote(`${remoteRoot}/.shenron-neon.env`)}; set +a`,
	`${shellQuote("/usr/local/bin/bun")} scripts/ops/import-bxc-crawls-to-postgres.ts ${shellQuote(`${stagePath}/dragonball-exhaustive.sqlite`)}`,
	`rm -f ${shellQuote(`${stagePath}/dragonball-exhaustive.sqlite`)}`,
].join("; ");
const imported = await run(["ssh", "-o", "ConnectTimeout=15", remoteHost, importCommand]);
if (imported.code !== 0) throw new Error(`Import PostgreSQL échoué: ${imported.stderr || imported.stdout}`);

console.log(JSON.stringify({
	status: "ok",
	localDatabase,
	remoteHost,
	remoteDatabase,
	result: imported.stdout,
}));
