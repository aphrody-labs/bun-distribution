// SPDX-License-Identifier: Apache-2.0
/**
 * Prépare et déclenche le secours Vercel du frontend unifié Rose Griffon.
 * Les services stateful restent sur le VPS ou doivent être migrés séparément.
 */

import { chmod, mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

// RG lives in the IECODE monorepo root unless RG_ROOT says otherwise.
const root = resolve(process.env.RG_ROOT ?? resolve(import.meta.dir, "../../.."));
const configDir = join(homedir(), ".config", "aphrody", "vercel");
const authFile = join(configDir, "auth.json");
const mode = process.argv[2] ?? "preflight";

const projects = [
	{ app: "apps/rg-website", project: "rosegriffon-fr", domain: "rosegriffon.fr" },
] as const;

async function run(args: string[], allowFailure = false): Promise<string> {
	const proc = Bun.spawn(args, {
		cwd: root,
		env: { ...process.env, VERCEL_TELEMETRY_DISABLED: "1" },
		stderr: "pipe",
		stdout: "pipe",
	});
	const [stdout, stderr, code] = await Promise.all([
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
		proc.exited,
	]);
	if (code !== 0 && !allowFailure) {
		throw new Error(stderr.trim() || `${args[0]} a quitté avec le code ${code}`);
	}
	return stdout.trim();
}

async function secureToken(): Promise<void> {
	const token = process.env.VERCEL_TOKEN?.trim();
	if (!token) return;
	await mkdir(configDir, { recursive: true, mode: 0o700 });
	await chmod(configDir, 0o700);
	await writeFile(authFile, `${JSON.stringify({ token })}\n`, { mode: 0o600 });
	await chmod(authFile, 0o600);
}

async function preflight(): Promise<void> {
	await secureToken();
	await run(["vercel", "--version"]);
	const identity = await run(["vercel", "whoami", "--global-config", configDir]);
	console.log(`Vercel authentifié: ${identity}`);
	for (const project of projects) {
		console.log(`${project.domain}: frontend Next.js déployable (${project.app})`);
	}
	console.log("VPS requis: PostgreSQL/PostgREST, Storage, Realtime SSE, CDN dynamique, RAG, MCP et bots.");
}

async function deploy(): Promise<void> {
	await preflight();
	for (const project of projects) {
		const url = await run([
			"vercel",
			"deploy",
			project.app,
			"--prod",
			"--yes",
			"--skip-domain",
			"--project",
			project.project,
			"--global-config",
			configDir,
		]);
		console.log(`${project.domain} prêt sur ${url}`);
	}
	console.log("Aucun DNS modifié. Valider les URLs, synchroniser les variables, puis basculer les domaines dans Vercel/OVH.");
}

if (mode === "preflight") await preflight();
else if (mode === "deploy") await deploy();
else throw new Error("Usage: bun scripts/iecode/rg/vercel-failover.ts [preflight|deploy]");
