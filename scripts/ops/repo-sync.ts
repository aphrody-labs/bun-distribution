#!/usr/bin/env bun
/**
 * Synchronisation explicite des deux dépôts Rose Griffon.
 *
 * Le code est volontairement ici, dans rg : rg publie les applications et
 * l'orchestration ; nie publie les formats, les données et les outils NIE.
 * Le script ne fusionne jamais les dépôts et ne déploie jamais un commit.
 *
 * Exemples :
 *   bun scripts/ops/repo-sync.ts --repo all --pull --commit --push
 *   bun scripts/ops/repo-sync.ts --repo all --commit --dry-run
 *   bun scripts/ops/repo-sync.ts --repo all --pull --commit --push --vps=newvps
 *
 * Les options destructrices (stash, reset, force-push) n'existent pas. Un
 * arbre sale doit être traité explicitement par son auteur. Les chemins qui
 * pourraient contenir des secrets, des bases ou des artefacts volumineux sont
 * refusés avant tout `git add`.
 */

import { realpath, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";

type RepoKey = "rg" | "nie";

interface CommandResult {
	code: number;
	stdout: string;
	stderr: string;
}

interface RepoState {
	key: RepoKey;
	root: string;
	branch: string;
	head: string;
	clean: boolean;
	paths: string[];
	changed: boolean;
	committed: boolean;
	pushed: boolean;
	pulled: boolean;
	error?: string;
}

interface Flags {
	repos: RepoKey[];
	branch: string;
	rgRoot: string;
	nieRoot: string;
	commit: boolean;
	pull: boolean;
	push: boolean;
	dryRun: boolean;
	json: boolean;
	vps?: string;
	remoteChild: boolean;
}

// The deployment convention keeps application checkouts under the operator's
// home directory. Callers with another layout can override each root via env/CLI.
const WORKSPACE_ROOT = resolve(import.meta.dir, "../../..");
const defaultRepoRoot = (name: string): string => {
	const workspaceCheckout = resolve(WORKSPACE_ROOT, name);
	return existsSync(resolve(workspaceCheckout, ".git"))
		? workspaceCheckout
		: resolve(homedir(), name);
};
const DEFAULT_RG_ROOT = defaultRepoRoot("rg");
const DEFAULT_NIE_ROOT = defaultRepoRoot("nie");
const DEFAULT_BRANCH = "main";
const BUN = process.env.BUN_BIN ?? "bun";
const SENSITIVE_EXTENSION = /\.(?:env|pem|key|p12|pfx|sqlite|sqlite3|db|dump)$/iu;
const SENSITIVE_NAME = /^(?:\.env(?:\..*)?|credentials?.*|serviceaccount.*|id_[^/]+)$/iu;
const SENSITIVE_SEGMENTS = new Set([
	".secrets",
	"node_modules",
	".next",
	"target",
	"var",
	"outputs",
	"scratch",
	"coverage",
]);

function envFlag(name: string): boolean {
	return /^(?:1|true|yes|on)$/iu.test(process.env[name] ?? "");
}

function out(message: string, json: boolean): void {
	(json ? process.stderr : process.stdout).write(`${message}\n`);
}

function fail(message: string): never {
	throw new Error(message);
}

async function command(cwd: string, args: string[]): Promise<CommandResult> {
	const child = Bun.spawn(args, {
		cwd,
		stdout: "pipe",
		stderr: "pipe",
	});
	const [stdout, stderr] = await Promise.all([
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
	]);
	return { code: await child.exited, stdout, stderr };
}

async function git(root: string, args: string[], tolerateFailure = false): Promise<CommandResult> {
	const result = await command(root, ["git", "-c", `safe.directory=${root}`, ...args]);
	if (result.code !== 0 && !tolerateFailure) {
		const detail = result.stderr.trim() || result.stdout.trim() || `code ${result.code}`;
		fail(`${root}: git ${args.join(" ")} — ${detail}`);
	}
	return result;
}

function shellQuote(value: string): string {
	if (!/^[A-Za-z0-9_./:=+@-]+$/u.test(value)) {
		fail(`valeur SSH refusée (caractères inattendus) : ${value}`);
	}
	return value;
}

function parseStatus(raw: string): string[] {
	const fields = raw.split("\0").filter(Boolean);
	const paths: string[] = [];
	for (let index = 0; index < fields.length; index += 1) {
		const field = fields[index] ?? "";
		if (field.length < 3) continue;
		const status = field.slice(0, 2);
		if (!/^[ MARC?!][ MARC?!]$/u.test(status)) continue;
		paths.push(field.slice(3));
		// Porcelain v1 ajoute le nouveau nom comme champ suivant pour R/C.
		if ((status[0] === "R" || status[0] === "C") && fields[index + 1]) {
			paths.push(fields[index + 1] as string);
			index += 1;
		}
	}
	return paths;
}

function sensitivePath(path: string): string | undefined {
	const normalized = path.replaceAll("\\", "/").replace(/^\.\//u, "");
	const segments = normalized.split("/").filter(Boolean);
	if (segments.length === 0) return "chemin vide";
	const ocRegistry = /^data\/oc\/[^/]+\/(?:README\.md|manifest\.json|provenance\/)/iu.test(
		normalized
	);
	if (segments[0] === "data" && !ocRegistry) {
		return "données locales non versionnables";
	}
	if (normalized.includes("astro/sources/") || /(?:^|\/)source(?:\/|$)/iu.test(normalized)) {
		return "sources Astro privées";
	}
	if (segments.some((segment) => SENSITIVE_SEGMENTS.has(segment))) {
		return "artefact ou cache généré";
	}
	const basename = segments.at(-1) as string;
	if (SENSITIVE_NAME.test(basename) || SENSITIVE_EXTENSION.test(basename)) {
		return "secret ou base locale";
	}
	if (/(?:-wal|-shm|-journal)$/iu.test(basename)) return "fichier SQLite temporaire";
	return undefined;
}

async function ensureRepo(root: string, key: RepoKey): Promise<void> {
	const info = await stat(root).catch(() => undefined);
	if (!info?.isDirectory()) fail(`${key}: racine absente ou invalide : ${root}`);
	const top = (await git(root, ["rev-parse", "--show-toplevel"])).stdout.trim();
	const [actual, expected] = await Promise.all([
		realpath(top).catch(() => resolve(top)),
		realpath(root).catch(() => resolve(root)),
	]);
	if (actual !== expected) fail(`${key}: ${root} n'est pas la racine git (${top})`);
}

async function status(root: string): Promise<{ head: string; branch: string; paths: string[] }> {
	const [head, branch, changes] = await Promise.all([
		git(root, ["rev-parse", "HEAD"]),
		git(root, ["branch", "--show-current"]),
		git(root, ["status", "--porcelain=v1", "-z", "-uall"]),
	]);
	const currentBranch = branch.stdout.trim();
	if (!currentBranch) fail(`${root}: HEAD détachée, synchronisation refusée`);
	return {
		head: head.stdout.trim(),
		branch: currentBranch,
		paths: parseStatus(changes.stdout),
	};
}

async function diffCheck(root: string, cached = false): Promise<void> {
	const result = await git(
		root,
		cached ? ["diff", "--cached", "--check"] : ["diff", "--check"],
		true
	);
	if (result.code !== 0) {
		fail(
			`${root}: espaces/erreurs détectés par git diff --check : ${result.stdout || result.stderr}`
		);
	}
}

async function ensureSafePaths(root: string, paths: string[]): Promise<void> {
	const refused = paths
		.map((path) => ({ path, reason: sensitivePath(path) }))
		.filter((entry): entry is { path: string; reason: string } => Boolean(entry.reason));
	if (refused.length) {
		fail(
			`${root}: auto-ajout refusé pour ${refused
				.map(({ path, reason }) => `${path} (${reason})`)
				.join(", ")}. Retirez ces fichiers de l'arbre avant de relancer.`
		);
	}
}

async function pullFastForward(root: string, branch: string): Promise<void> {
	const current = (await git(root, ["status", "--porcelain"])).stdout.trim();
	if (current) fail(`${root}: --pull exige un arbre propre (aucun stash automatique)`);
	await git(root, ["fetch", "--prune", "origin", branch]);
	await git(root, ["merge", "--ff-only", `origin/${branch}`]);
}

async function checkpoint(root: string, dryRun: boolean): Promise<boolean> {
	const before = await status(root);
	if (before.paths.length === 0) return false;
	await ensureSafePaths(root, before.paths);
	await diffCheck(root);
	if (dryRun) return true;
	await git(root, ["add", "-A", "--", "."]);
	const staged = (await git(root, ["diff", "--cached", "--name-only", "-z"])).stdout;
	// --name-only n'est pas porcelain : chaque champ est directement un chemin.
	const names = staged.split("\0").filter(Boolean);
	await ensureSafePaths(root, names);
	await diffCheck(root, true);
	const stamp = new Date().toISOString().replace(/[.:]/gu, "-");
	await git(root, ["commit", "-m", `chore(sync): checkpoint ${stamp}`]);
	return true;
}

async function push(root: string, branch: string, dryRun: boolean): Promise<void> {
	const current = (await git(root, ["branch", "--show-current"])).stdout.trim();
	if (current !== branch)
		fail(`${root}: push refusé depuis ${current}, branche attendue ${branch}`);
	if ((await git(root, ["status", "--porcelain"])).stdout.trim()) {
		fail(`${root}: push refusé avec des modifications non commitées`);
	}
	if (!dryRun) await git(root, ["push", "origin", branch]);
}

async function processRepo(key: RepoKey, root: string, flags: Flags): Promise<RepoState> {
	const result: RepoState = {
		key,
		root,
		branch: flags.branch,
		head: "",
		clean: false,
		paths: [],
		changed: false,
		committed: false,
		pushed: false,
		pulled: false,
	};
	try {
		await ensureRepo(root, key);
		let current = await status(root);
		result.head = current.head;
		result.branch = current.branch;
		result.paths = current.paths;
		if (flags.pull) {
			if (flags.dryRun) {
				out(`${key}: pull prévu (fetch --prune + merge --ff-only)`, flags.json);
			} else {
				await pullFastForward(root, flags.branch);
				result.pulled = true;
				current = await status(root);
				result.head = current.head;
				result.branch = current.branch;
				result.paths = current.paths;
			}
		}
		const autoCommit = flags.commit || envFlag("REPO_SYNC_AUTOCOMMIT");
		if (autoCommit) {
			result.changed = await checkpoint(root, flags.dryRun);
			if (result.changed && !flags.dryRun) {
				result.committed = true;
				current = await status(root);
				result.head = current.head;
				result.paths = current.paths;
			}
		}
		const autoPush = flags.push || envFlag("REPO_SYNC_PUSH");
		if (autoPush) {
			await push(root, flags.branch, flags.dryRun);
			result.pushed = true;
		}
		result.clean = result.paths.length === 0;
		return result;
	} catch (error) {
		result.error = error instanceof Error ? error.message : String(error);
		return result;
	}
}

function parseValue(argv: string[], index: number, name: string): [string, number] {
	const argument = argv[index] ?? "";
	const prefix = `--${name}=`;
	if (argument.startsWith(prefix)) return [argument.slice(prefix.length), index];
	const value = argv[index + 1];
	if (!value || value.startsWith("--")) fail(`valeur manquante pour --${name}`);
	return [value, index + 1];
}

function parseArgs(argv: string[]): Flags {
	const flags = {
		repos: ["rg", "nie"] as RepoKey[],
		branch: process.env.REPO_SYNC_BRANCH ?? DEFAULT_BRANCH,
		rgRoot: process.env.RG_ROOT ?? DEFAULT_RG_ROOT,
		nieRoot: process.env.NIE_ROOT ?? DEFAULT_NIE_ROOT,
		commit: false,
		pull: false,
		push: false,
		dryRun: false,
		json: false,
		remoteChild: false,
	} as Flags;
	for (let index = 0; index < argv.length; index += 1) {
		const argument = argv[index] as string;
		if (argument === "--commit") flags.commit = true;
		else if (argument === "--pull") flags.pull = true;
		else if (argument === "--push") flags.push = true;
		else if (argument === "--dry-run") flags.dryRun = true;
		else if (argument === "--json") flags.json = true;
		else if (argument === "--remote-child") flags.remoteChild = true;
		else if (argument === "--vps") flags.vps = process.env.REPO_SYNC_VPS;
		else if (argument.startsWith("--vps=")) flags.vps = argument.slice("--vps=".length);
		else if (argument === "--repo" || argument.startsWith("--repo=")) {
			const [value, next] = parseValue(argv, index, "repo");
			flags.repos =
				value === "all" ? ["rg", "nie"] : value.split(",").map((item) => item as RepoKey);
			index = next;
		} else if (argument === "--branch" || argument.startsWith("--branch=")) {
			const [value, next] = parseValue(argv, index, "branch");
			flags.branch = value;
			index = next;
		} else if (argument === "--rg-root" || argument.startsWith("--rg-root=")) {
			const [value, next] = parseValue(argv, index, "rg-root");
			flags.rgRoot = resolve(value);
			index = next;
		} else if (argument === "--nie-root" || argument.startsWith("--nie-root=")) {
			const [value, next] = parseValue(argv, index, "nie-root");
			(flags as Flags & { nieRoot: string }).nieRoot = resolve(value);
			index = next;
		} else if (argument === "--help" || argument === "-h") {
			process.stdout.write(USAGE);
			process.exit(0);
		} else {
			fail(`option inconnue : ${argument}`);
		}
	}
	for (const repo of flags.repos) {
		if (repo !== "rg" && repo !== "nie") fail(`dépôt inconnu : ${repo}`);
	}
	if (!/^[A-Za-z0-9._/-]+$/u.test(flags.branch)) fail(`branche refusée : ${flags.branch}`);
	return flags;
}

async function syncVps(flags: Flags): Promise<CommandResult | undefined> {
	if (flags.remoteChild || !flags.vps) return undefined;
	if (!/^[A-Za-z0-9_.:@-]+$/u.test(flags.vps)) fail(`hôte VPS refusé : ${flags.vps}`);
	const remoteArgs = [
		"--repo",
		flags.repos.join(","),
		"--branch",
		flags.branch,
		"--rg-root",
		process.env.REPO_SYNC_REMOTE_RG_ROOT ?? DEFAULT_RG_ROOT,
		"--nie-root",
		process.env.REPO_SYNC_REMOTE_NIE_ROOT ?? DEFAULT_NIE_ROOT,
		"--remote-child",
	];
	if (flags.pull) remoteArgs.push("--pull");
	if (flags.commit) remoteArgs.push("--commit");
	if (flags.push) remoteArgs.push("--push");
	if (flags.dryRun) remoteArgs.push("--dry-run");
	if (flags.json) remoteArgs.push("--json");
	const remoteInfraRoot = process.env.REPO_SYNC_REMOTE_INFRA_ROOT ?? resolve(homedir(), "aphrody-infra");
	const remoteScript = `${remoteInfraRoot}/scripts/ops/repo-sync.ts`;
	const commandLine = [BUN, remoteScript, ...remoteArgs.map(shellQuote)].map(shellQuote).join(" ");
	return command(process.cwd(), [
		"ssh",
		"-o",
		"BatchMode=yes",
		"-o",
		"ConnectTimeout=15",
		flags.vps,
		commandLine,
	]);
}

const USAGE = `Usage : bun scripts/ops/repo-sync.ts [options]

Options
  --repo <rg|nie|all>   dépôts traités (défaut : all)
  --pull                  fetch + merge --ff-only depuis origin/<branche>
  --commit                checkpoint des changements sûrs (jamais secrets/cache)
  --push                  push origin/<branche> après un arbre propre
  --branch <nom>          branche (défaut : main)
  --rg-root <chemin>      racine RG (défaut : ${DEFAULT_RG_ROOT})
  --nie-root <chemin>   racine nie (défaut : ${DEFAULT_NIE_ROOT})
  --vps[=<hôte>]          rejoue la même opération sur un hôte SSH configuré
  --dry-run               montre les actions sans écrire
  --json                  sortie JSON (journal sur stderr)

Variables : REPO_SYNC_AUTOCOMMIT=1, REPO_SYNC_PUSH=1, REPO_SYNC_VPS,
REPO_SYNC_REMOTE_RG_ROOT, RG_ROOT, NIE_ROOT et REPO_SYNC_BRANCH.
`;

async function main(): Promise<number> {
	const flags = parseArgs(process.argv.slice(2));
	const results: RepoState[] = [];
	for (const key of flags.repos) {
		const root = key === "rg" ? flags.rgRoot : (flags as Flags & { nieRoot: string }).nieRoot;
		const result = await processRepo(key, root, flags);
		results.push(result);
		if (result.error) out(`✗ ${key}: ${result.error}`, flags.json);
		else {
			const actions = [
				result.pulled ? "pull" : "",
				result.committed ? "commit" : result.changed && flags.dryRun ? "commit prévu" : "",
				result.pushed ? "push" : "",
			].filter(Boolean);
			out(
				`✓ ${key} ${result.head.slice(0, 12)} — ${result.clean ? "propre" : `${result.paths.length} chemin(s) modifié(s)`}${actions.length ? ` [${actions.join(", ")}]` : ""}`,
				flags.json
			);
		}
	}
	const remote = await syncVps(flags).catch((error) => ({
		code: 1,
		stdout: "",
		stderr: error instanceof Error ? error.message : String(error),
	}));
	if (remote) {
		if (remote.code === 0) out(`✓ VPS ${flags.vps} synchronisé`, flags.json);
		else
			out(
				`✗ VPS ${flags.vps}: ${remote.stderr.trim() || remote.stdout.trim() || `code ${remote.code}`}`,
				flags.json
			);
	}
	const failed =
		results.some((result) => result.error) || (remote !== undefined && remote.code !== 0);
	if (flags.json)
		process.stdout.write(`${JSON.stringify({ results, vps: flags.vps ?? null, ok: !failed })}\n`);
	return failed ? 1 : 0;
}

const exitCode = await main().catch((error) => {
	process.stderr.write(`✗ ${error instanceof Error ? error.message : String(error)}\n`);
	return 1;
});
process.exit(exitCode);
