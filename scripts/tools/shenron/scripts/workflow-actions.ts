#!/usr/bin/env bun
/** Actions déterministes du workflow Dragon Ball.
 *
 * Les sous-agents ne mutent rien. Ce programme prépare et simule les dépôts,
 * puis ne les applique qu'avec `--apply`, après une sauvegarde PostgreSQL VPS.
 */
import { existsSync } from "node:fs";
import { copyFile, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { classerDefaut } from "../../../../apps/shenron/site/src/lib/databooks-defauts";

const ROOT = resolve(import.meta.dir, "..");
const args = Bun.argv.slice(2);
const command = args[0];
const apply = args.includes("--apply");
const sourceRoot = resolve(ROOT, option("source") ?? "data/sj-ocr");
const runDir = resolve(ROOT, option("run-dir") ?? join("var", "dragon-ball-workflow-actions"));
const actionDir = join(runDir, "actions");
/** Home directory of the remote account (SHENRON_REMOTE_HOME), the Shenron checkout and the Bun it runs; never hard-coded. */
function remoteHome(): string {
	const home = process.env.SHENRON_REMOTE_HOME?.trim();
	if (!home?.startsWith("/")) throw new Error("SHENRON_REMOTE_HOME must be the absolute home directory of the remote account");
	return home.replace(/\/+$/, "");
}
const remoteBun = () => `${remoteHome()}/.bun/bin/bun`;
const remotePath = () => `${remoteHome()}/.bun/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin`;

/** SSH host (alias or user@host) of the production VPS; never hard-coded. */
function sshHost(): string {
	const host = process.env.SHENRON_SSH_HOST?.trim();
	if (!host) {
		throw new Error("SHENRON_SSH_HOST manquant : définir l'alias SSH ou user@host du VPS (ex. dans ~/.ssh/config).");
	}
	return host;
}

function option(name: string): string | undefined {
	const index = args.indexOf(`--${name}`);
	return index >= 0 ? args[index + 1] : undefined;
}

async function run(
	commandLine: string[],
	options: { cwd?: string; log?: string } = {}
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
	const proc = Bun.spawn(commandLine, {
		cwd: options.cwd ?? ROOT,
		stdout: "pipe",
		stderr: "pipe",
	});
	const [exitCode, stdout, stderr] = await Promise.all([
		proc.exited,
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
	]);
	if (options.log) await writeFile(options.log, `${stdout}${stderr}`, "utf8");
	return { exitCode, stdout, stderr };
}

async function cleanupRemoteStaging(remotePath: string, logName: string): Promise<void> {
	if (!remotePath.startsWith("/tmp/shenron-") || remotePath.includes("..")) {
		throw new Error(`chemin de staging distant refusé: ${remotePath}`);
	}
	const result = await run(
		["ssh", sshHost(), `rm -rf -- ${shellQuote(remotePath)} && test ! -e ${shellQuote(remotePath)}`],
		{ log: join(actionDir, logName) }
	);
	if (result.exitCode !== 0) {
		console.warn(`nettoyage du staging distant en échec: ${remotePath}`);
		return;
	}
	console.log("✓ staging distant nettoyé");
}

let backupDone = false;
async function backupPostgres(): Promise<void> {
	if (backupDone || !apply) return;
	await mkdir(actionDir, { recursive: true });
	const logPath = join(actionDir, "postgres-backup.log");
	if (existsSync(logPath)) {
		const previous = await readFile(logPath, "utf8");
		if (/shenron_site-\d{8}-\d{6}\.sql\.gz/.test(previous)) {
			backupDone = true;
			console.log("✓ sauvegarde PostgreSQL déjà validée pour ce run");
			return;
		}
	}
	const result = await run(
		["ssh", sshHost(), `cd ${shellQuote(`${remoteHome()}/shenron`)} && bash scripts/backup-shenron-pg.sh`],
		{ log: logPath }
	);
	if (result.exitCode !== 0) {
		throw new Error(
			`sauvegarde PostgreSQL refusée (code ${result.exitCode}): ${result.stderr.trim()}`
		);
	}
	backupDone = true;
	console.log("✓ sauvegarde PostgreSQL VPS terminée");
}

interface ManifestEntry {
	image?: string;
}

interface OcrResult {
	image?: string;
	text?: { kind?: string; markdown?: string };
}

interface PreparedLot {
	name: string;
	path: string;
	expected: number;
	healthy: number;
	rejected: number;
}

async function prepareOcrLots(): Promise<{
	prepared: PreparedLot[];
	incompleteLots: number;
	unreadableLines: number;
}> {
	const outputRoot = join(actionDir, "ocr-approved");
	await mkdir(outputRoot, { recursive: true });
	const directories = (await readdir(sourceRoot, { withFileTypes: true }))
		.filter((entry) => entry.isDirectory() && /^lot-\d+$/.test(entry.name))
		.map((entry) => entry.name)
		.toSorted();
	const prepared: PreparedLot[] = [];
	let incompleteLots = 0;
	let unreadableLines = 0;

	for (const name of directories) {
		const sourceLot = join(sourceRoot, name);
		const manifestPath = join(sourceLot, "manifeste.json");
		const resultsPath = join(sourceLot, "resultats.jsonl");
		if (!existsSync(manifestPath) || !existsSync(resultsPath)) {
			incompleteLots++;
			continue;
		}
		const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
			planches?: number;
			entrees?: ManifestEntry[];
		};
		const expectedNames = new Set(
			(manifest.entrees ?? []).map((entry) => basename(entry.image ?? ""))
		);
		const expected = expectedNames.size || Number(manifest.planches ?? 0);
		const unique = new Map<string, { raw: string; result: OcrResult }>();
		for (const line of (await readFile(resultsPath, "utf8")).split(/\r?\n/)) {
			if (!line.trim()) continue;
			try {
				const result = JSON.parse(line) as OcrResult;
				const key = basename(result.image ?? "").toLowerCase();
				if (key) unique.set(key, { raw: JSON.stringify(result), result });
			} catch {
				unreadableLines++;
			}
		}
		const complete =
			expectedNames.size > 0 &&
			expected > 0 &&
			[...expectedNames].every((key) => unique.has(key.toLowerCase()));
		if (!complete) {
			incompleteLots++;
			continue;
		}

		const healthy: string[] = [];
		let rejected = 0;
		for (const { raw, result } of unique.values()) {
			const markdown = result.text?.kind === "text" ? (result.text.markdown ?? "").trim() : "";
			if (!markdown || classerDefaut(markdown) !== null) {
				rejected++;
				continue;
			}
			healthy.push(raw);
		}
		if (healthy.length === 0) continue;
		const targetLot = join(outputRoot, name);
		await mkdir(targetLot, { recursive: true });
		await Promise.all([
			copyFile(manifestPath, join(targetLot, "manifeste.json")),
			writeFile(join(targetLot, "resultats.jsonl"), `${healthy.join("\n")}\n`, "utf8"),
		]);
		prepared.push({ name, path: targetLot, expected, healthy: healthy.length, rejected });
	}
	return { prepared, incompleteLots, unreadableLines };
}

async function ocr(): Promise<void> {
	const report = await prepareOcrLots();
	const reportPath = join(actionDir, "ocr-prepare.json");
	await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
	console.log(
		`${report.prepared.length} lot(s) complet(s) préparé(s) · ${report.incompleteLots} incomplet(s) · ${report.prepared.reduce((sum, lot) => sum + lot.healthy, 0)} page(s) saines · ${report.prepared.reduce((sum, lot) => sum + lot.rejected, 0)} rejetée(s)`
	);
	if (report.unreadableLines > 0)
		throw new Error(`${report.unreadableLines} ligne(s) JSONL illisible(s)`);
	if (report.prepared.length === 0) return;

	const targets = report.prepared.map((lot) => lot.path);
	const verify = await run(["bun", "apps/site/scripts/databooks.ts", "verifie", ...targets], {
		log: join(actionDir, "ocr-verify.log"),
	});
	if (verify.exitCode !== 0) throw new Error("le filtre OCR a laissé passer une page fautive");

	const simulation = await run(
		["bun", "apps/site/scripts/databooks.ts", "depose", ...targets, "--simulation"],
		{ log: join(actionDir, "ocr-deposit-simulation.log") }
	);
	if (simulation.exitCode !== 0)
		throw new Error(`simulation du dépôt OCR en échec: ${simulation.stderr.trim()}`);
	console.log("✓ simulation du dépôt OCR validée");
	if (!apply) return;

	await backupPostgres();
	const stagingName = basename(runDir).replace(/[^a-zA-Z0-9._-]/g, "-");
	const remoteStaging = `/tmp/shenron-ocr-${stagingName}`;
	const makeStaging = await run(["ssh", sshHost(), `mkdir -p -- '${remoteStaging}'`], {
		log: join(actionDir, "ocr-staging.log"),
	});
	if (makeStaging.exitCode !== 0)
		throw new Error(`préparation du dépôt OCR distant en échec: ${makeStaging.stderr.trim()}`);
	const upload = await run(["scp", "-r", ...targets, `${sshHost()}:${remoteStaging}/`], {
		log: join(actionDir, "ocr-upload.log"),
	});
	if (upload.exitCode !== 0)
		throw new Error(`transfert du dépôt OCR en échec: ${upload.stderr.trim()}`);
	const remoteTargets = report.prepared.map((lot) => `${remoteStaging}/${lot.name}`);
	const remoteCommand = [
		"sudo systemd-run --wait --collect --pipe",
		`-p EnvironmentFile=${remoteHome()}/.shenron-neon.env`,
		`-p Environment=PATH=${remotePath()}`,
		`--working-directory=${remoteHome()}/shenron`,
		`${remoteBun()} apps/site/scripts/databooks.ts depose`,
		...remoteTargets.map((target) => `'${target}'`),
	].join(" ");
	const deposit = await run(["ssh", sshHost(), remoteCommand], {
		log: join(actionDir, "ocr-deposit.log"),
	});
	if (deposit.exitCode !== 0) throw new Error(`dépôt OCR en échec: ${deposit.stderr.trim()}`);
	console.log(
		`✓ ${report.prepared.reduce((sum, lot) => sum + lot.healthy, 0)} page(s) OCR saines déposées`
	);
	await cleanupRemoteStaging(remoteStaging, "ocr-cleanup.log");
}

async function manga(): Promise<void> {
	const remote = [
		"sudo systemd-run --wait --collect --pipe",
		`-p EnvironmentFile=${remoteHome()}/.shenron-neon.env`,
		`-p Environment=PATH=${remotePath()}`,
		`--working-directory=${remoteHome()}/shenron/apps/bot`,
		`${remoteBun()} scripts/reconstruct-manga-pages-from-disk.ts`,
	];
	const dry = await run(["ssh", sshHost(), `${remote.join(" ")} --dry-run`], {
		log: join(actionDir, "manga-reconstruct-simulation.log"),
	});
	if (dry.exitCode !== 0)
		throw new Error(`simulation reconstruction manga en échec: ${dry.stderr.trim()}`);
	console.log("✓ simulation de reconstruction des pages manga validée sur le VPS");
	if (!apply) return;

	await backupPostgres();
	const rebuild = await run(["ssh", sshHost(), remote.join(" ")], {
		log: join(actionDir, "manga-reconstruct.log"),
	});
	if (rebuild.exitCode !== 0)
		throw new Error(`reconstruction manga en échec: ${rebuild.stderr.trim()}`);
	console.log("✓ index des pages manga reconstruit depuis les assets locaux du VPS");
}

interface WikiProposal {
	target: string;
	field: string;
	value: string;
	source_refs: string[];
	decision: "propose" | "accept" | "leave_empty" | "reject";
	operation: "fill_empty" | "correct_existing";
	section_label: string;
}

interface ConsensusProposal extends WikiProposal {
	reviewers: string[];
}

const WIKI_TABLES = new Set([
	"db_characters",
	"db_planets",
	"db_techniques",
	"db_transformations",
	"db_races",
	"db_sagas",
	"db_arcs",
	"db_episodes",
	"db_movies",
	"db_games",
	"db_databooks",
]);
const WIKI_FIELDS = new Set(["description", "article", "synopsis", "name_ja"]);
const WIKI_SECTION_TYPES = new Set([
	"character",
	"planet",
	"technique",
	"transformation",
	"race",
	"saga",
	"episode",
	"movie",
	"game",
]);

function shellQuote(value: string): string {
	return `'${value.replaceAll("'", `'"'"'`)}'`;
}

function proposalKey(proposal: WikiProposal): string {
	return JSON.stringify({
		target: proposal.target,
		field: proposal.field,
		value: proposal.value,
		source_refs: [...proposal.source_refs].toSorted(),
		operation: proposal.operation,
		section_label: proposal.section_label,
	});
}

function validPrimaryRefs(refs: string[]): boolean {
	if (refs.length === 0) return false;
	return refs.every((ref) => {
		const normalized = ref.toLowerCase();
		return (
			!/^https?:\/\//.test(normalized) &&
			!/(fandom|wikipedia|anilist|jikan)/.test(normalized) &&
			/(manga|databook|planche|tome|data\/sj-ocr|wiki\/databooks)/.test(normalized)
		);
	});
}

function validateWikiProposal(proposal: WikiProposal): string | null {
	if (!proposal.value.trim()) return "valeur vide";
	if (proposal.value.length > 40_000) return "valeur trop longue";
	if (!validPrimaryRefs(proposal.source_refs)) return "référence primaire locale absente";
	if (!new Set(["fill_empty", "correct_existing"]).has(proposal.operation))
		return "opération invalide";
	const fieldTarget = /^(db_[a-z_]+)#(\d+)$/.exec(proposal.target);
	if (fieldTarget) {
		if (!WIKI_TABLES.has(fieldTarget[1]!)) return "table interdite";
		if (!WIKI_FIELDS.has(proposal.field)) return "colonne interdite";
		if (proposal.section_label !== "") return "section_label doit être vide pour un champ";
		return null;
	}
	const sectionTarget = /^section:([a-z]+):(\d+):([a-z0-9-]+)$/.exec(proposal.target);
	if (!sectionTarget) return "cible invalide";
	if (!WIKI_SECTION_TYPES.has(sectionTarget[1]!)) return "type de section interdit";
	if (proposal.field !== "body") return "champ de section invalide";
	if (!proposal.section_label.trim()) return "libellé de section manquant";
	return null;
}

async function wiki(): Promise<void> {
	const reviewDir = join(runDir, "shenron-review");
	if (!existsSync(reviewDir)) throw new Error("sorties de revue Shenron absentes");
	const reviewFiles = (await readdir(reviewDir))
		.filter((name) => /^shenron-review-\d+\.json$/.test(name))
		.toSorted();
	if (reviewFiles.length !== 4)
		throw new Error(`consensus impossible: ${reviewFiles.length}/4 revues présentes`);

	const accepted = new Map<string, { proposal: WikiProposal; reviewers: Set<string> }>();
	for (const file of reviewFiles) {
		const parsed = JSON.parse(await readFile(join(reviewDir, file), "utf8")) as {
			proposals?: WikiProposal[];
		};
		const seen = new Set<string>();
		for (const proposal of parsed.proposals ?? []) {
			if (proposal.decision !== "accept") continue;
			const key = proposalKey(proposal);
			if (seen.has(key)) continue;
			seen.add(key);
			const current = accepted.get(key) ?? { proposal, reviewers: new Set<string>() };
			current.reviewers.add(file.replace(/\.json$/, ""));
			accepted.set(key, current);
		}
	}

	const consensus: ConsensusProposal[] = [];
	const rejected: { target: string; reason: string; votes: number }[] = [];
	for (const { proposal, reviewers } of accepted.values()) {
		if (reviewers.size < 3) {
			rejected.push({
				target: proposal.target,
				reason: "moins de 3 acceptations sur 4",
				votes: reviewers.size,
			});
			continue;
		}
		const invalid = validateWikiProposal(proposal);
		if (invalid) {
			rejected.push({ target: proposal.target, reason: invalid, votes: reviewers.size });
			continue;
		}
		consensus.push({
			...proposal,
			source_refs: [...proposal.source_refs].toSorted(),
			reviewers: [...reviewers].toSorted(),
		});
	}

	const consensusRoot = join(actionDir, "wiki-consensus");
	await mkdir(consensusRoot, { recursive: true });
	for (const [index, proposal] of consensus.entries()) {
		const directory = join(consensusRoot, `proposal-${String(index + 1).padStart(4, "0")}`);
		await mkdir(directory, { recursive: true });
		await Promise.all([
			writeFile(join(directory, "value.md"), `${proposal.value.trim()}\n`, "utf8"),
			writeFile(
				join(directory, "sources.json"),
				`${JSON.stringify(proposal.source_refs, null, 2)}\n`,
				"utf8"
			),
		]);
	}

	const report = {
		reviewers: reviewFiles.length,
		consensus: consensus.map((proposal) => ({
			...proposal,
			value: `[${proposal.value.length} signes]`,
		})),
		rejected,
		simulated: [] as string[],
		blocked_precondition: [] as { target: string; operation: string; observed: string }[],
		applied: [] as string[],
	};
	if (consensus.length === 0) {
		await writeFile(
			join(actionDir, "wiki-consensus.json"),
			`${JSON.stringify(report, null, 2)}\n`,
			"utf8"
		);
		console.log("✓ aucune proposition wiki n'atteint le consensus 3/4");
		return;
	}

	const stagingName = basename(runDir).replace(/[^a-zA-Z0-9._-]/g, "-");
	const remoteStaging = `/tmp/shenron-wiki-${stagingName}`;
	const makeStaging = await run(["ssh", sshHost(), `mkdir -p -- '${remoteStaging}'`], {
		log: join(actionDir, "wiki-staging.log"),
	});
	if (makeStaging.exitCode !== 0)
		throw new Error(`préparation wiki distante en échec: ${makeStaging.stderr.trim()}`);
	const upload = await run(["scp", "-r", consensusRoot, `${sshHost()}:${remoteStaging}/`], {
		log: join(actionDir, "wiki-upload.log"),
	});
	if (upload.exitCode !== 0)
		throw new Error(`transfert des propositions wiki en échec: ${upload.stderr.trim()}`);

	const eligible: { proposal: ConsensusProposal; command: string }[] = [];
	for (const [index, proposal] of consensus.entries()) {
		const directory = `${remoteStaging}/wiki-consensus/proposal-${String(index + 1).padStart(4, "0")}`;
		const fieldTarget = /^(db_[a-z_]+)#(\d+)$/.exec(proposal.target);
		const sectionTarget = /^section:([a-z]+):(\d+):([a-z0-9-]+)$/.exec(proposal.target);
		const argumentsPart = fieldTarget
			? [
					"champ",
					"--table",
					shellQuote(fieldTarget[1]!),
					"--id",
					fieldTarget[2]!,
					"--colonne",
					shellQuote(proposal.field),
				].join(" ")
			: [
					"section",
					"--type",
					shellQuote(sectionTarget![1]!),
					"--id",
					sectionTarget![2]!,
					"--cle",
					shellQuote(sectionTarget![3]!),
					"--label",
					shellQuote(proposal.section_label),
				].join(" ");
		const command = [
			"sudo systemd-run --wait --collect --pipe",
			`-p EnvironmentFile=${remoteHome()}/.shenron-neon.env`,
			`-p Environment=PATH=${remotePath()}`,
			`--working-directory=${remoteHome()}/shenron`,
			`${remoteBun()} apps/site/scripts/depose-wiki.ts`,
			argumentsPart,
			"--fichier",
			shellQuote(`${directory}/value.md`),
			"--sources",
			shellQuote(`${directory}/sources.json`),
		].join(" ");
		const simulation = await run(["ssh", sshHost(), command], {
			log: join(actionDir, `wiki-simulation-${String(index + 1).padStart(4, "0")}.log`),
		});
		if (simulation.exitCode !== 0)
			throw new Error(`simulation wiki ${proposal.target} en échec: ${simulation.stderr.trim()}`);
		const empty = /avant\s*:\s*∅/.test(simulation.stdout);
		if (
			(proposal.operation === "fill_empty" && !empty) ||
			(proposal.operation === "correct_existing" && empty)
		) {
			report.blocked_precondition.push({
				target: proposal.target,
				operation: proposal.operation,
				observed: empty ? "vide" : "non vide",
			});
			continue;
		}
		report.simulated.push(proposal.target);
		eligible.push({ proposal, command });
	}
	console.log(
		`✓ ${eligible.length}/${consensus.length} proposition(s) wiki simulée(s) et préconditions validées`
	);

	if (apply && eligible.length > 0) {
		await backupPostgres();
		for (const [index, item] of eligible.entries()) {
			const result = await run(["ssh", sshHost(), `${item.command} --appliquer`], {
				log: join(actionDir, `wiki-apply-${String(index + 1).padStart(4, "0")}.log`),
			});
			if (result.exitCode !== 0)
				throw new Error(`dépôt wiki ${item.proposal.target} en échec: ${result.stderr.trim()}`);
			report.applied.push(item.proposal.target);
		}
		console.log(`✓ ${report.applied.length} proposition(s) wiki déposée(s) et versionnée(s)`);
	}
	await writeFile(
		join(actionDir, "wiki-consensus.json"),
		`${JSON.stringify(report, null, 2)}\n`,
		"utf8"
	);
	await cleanupRemoteStaging(remoteStaging, "wiki-cleanup.log");
}

await mkdir(actionDir, { recursive: true });
switch (command) {
	case "ocr":
		await ocr();
		break;
	case "manga":
		await manga();
		break;
	case "wiki":
		await wiki();
		break;
	default:
		console.error(
			"Usage: bun scripts/workflow-actions.ts <ocr|manga|wiki> [--run-dir <dir>] [--apply]"
		);
		process.exitCode = 2;
}
