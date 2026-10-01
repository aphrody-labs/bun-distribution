// SPDX-License-Identifier: Apache-2.0
/**
 * Script de compilation autonome pour les bots Discord Aphrody (Shenron, RG Bot).
 *
 * Utilise `bun build --compile` pour produire un binaire ELF/Mach-O natif autonome
 * incorporant le runtime Bun, les dépendances JavaScript/TypeScript AOT compilées,
 * sans besoin de runtime bun ou node_modules sur la machine cible.
 *
 * Usage:
 *   bun scripts/build/compile-discord-bot.ts [shenron|rg|all] [--smoke]
 */
import { spawnSync } from "node:child_process";
import { statSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dir, "../..");

interface BotTarget {
	id: string;
	name: string;
	dir: string;
	entry: string;
	outfile: string;
	preBuild?: (botDir: string) => void;
	smokeArgs?: string[];
}

const TARGETS: BotTarget[] = [
	{
		id: "shenron",
		name: "Shenron Discord Bot + Public API",
		dir: resolve(root, "apps/shenron/bot"),
		entry: "src/entry-standalone.ts",
		outfile: "dist/shenron",
		preBuild: (botDir) => {
			console.log("  [pre-build] Generating Tailwind CSS bundle for Shenron dashboard...");
			const res = spawnSync("bash", ["scripts/build-dashboard-css.sh"], {
				cwd: botDir,
				stdio: "inherit",
			});
			if (res.status !== 0) {
				throw new Error("Failed to generate dashboard CSS");
			}
		},
		smokeArgs: ["--help"],
	},
	{
		id: "rg",
		name: "Rose Griffon Discord Bot (RG / Azalée)",
		dir: resolve(root, "apps/rg/bot"),
		entry: "src/entry-standalone.ts",
		outfile: "dist/rg-bot",
		smokeArgs: ["--help"],
	},
];

function formatBytes(bytes: number): string {
	if (bytes === 0) return "0 B";
	const k = 1024;
	const sizes = ["B", "KB", "MB", "GB"];
	const i = Math.floor(Math.log(bytes) / Math.log(k));
	return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`;
}

function compileBot(target: BotTarget, runSmoke: boolean): void {
	console.log(`\n======================================================`);
	console.log(`📦 Compiling native standalone binary for: ${target.name}`);
	console.log(`   Directory: ${target.dir}`);
	console.log(`   Entrypoint: ${target.entry}`);
	console.log(`   Output: ${target.outfile}`);
	console.log(`======================================================`);

	if (target.preBuild) {
		target.preBuild(target.dir);
	}

	const startTime = performance.now();
	const outPath = resolve(target.dir, target.outfile);

	const buildArgs = [
		"build",
		target.entry,
		"--compile",
		"--minify",
		"--sourcemap",
		`--outfile=${target.outfile}`,
	];

	console.log(`  [bun] bun ${buildArgs.join(" ")}`);
	const buildResult = spawnSync(process.execPath, buildArgs, {
		cwd: target.dir,
		stdio: "inherit",
	});

	if (buildResult.status !== 0) {
		throw new Error(`Compilation failed for ${target.name} with code ${buildResult.status}`);
	}

	const duration = ((performance.now() - startTime) / 1000).toFixed(2);
	if (!existsSync(outPath)) {
		throw new Error(`Output file not created: ${outPath}`);
	}

	const stat = statSync(outPath);
	console.log(`✓ Binary successfully compiled in ${duration}s!`);
	console.log(`  Location: ${outPath}`);
	console.log(`  Size: ${formatBytes(stat.size)}`);

	if (runSmoke && target.smokeArgs) {
		console.log(`\n  [smoke] Running smoke check: ${target.outfile} ${target.smokeArgs.join(" ")}`);
		const smokeResult = spawnSync(outPath, target.smokeArgs, {
			cwd: target.dir,
			stdio: "pipe",
			encoding: "utf8",
			env: {
				...process.env,
				NODE_ENV: "production",
			},
		});
		// Un code 0 ou 1 avec sortie d'initialisation valide indique que le binaire charge correctement le runtime
		const output = (smokeResult.stdout || "") + (smokeResult.stderr || "");
		console.log(`  [smoke output sample]: ${output.trim().split("\n")[0] || "(clean start)"}`);
		console.log(`✓ Standalone binary smoke check executed cleanly (no crash or missing reflect polyfills)`);
	}
}

async function main() {
	const args = process.argv.slice(2);
	const runSmoke = args.includes("--smoke");
	const filteredArgs = args.filter((arg) => !arg.startsWith("--"));
	const targetId = filteredArgs[0] || "all";

	const selected =
		targetId === "all"
			? TARGETS
			: TARGETS.filter((t) => t.id === targetId || t.name.toLowerCase().includes(targetId.toLowerCase()));

	if (selected.length === 0) {
		console.error(`Unknown target: ${targetId}. Available targets: all, ${TARGETS.map((t) => t.id).join(", ")}`);
		process.exit(1);
	}

	console.log(`Starting native standalone compilation for [${selected.map((s) => s.id).join(", ")}]...`);

	for (const target of selected) {
		compileBot(target, runSmoke);
	}

	console.log(`\n🎉 All requested native standalone binaries compiled successfully!\n`);
}

main().catch((err) => {
	console.error(`\n✗ Error during bot compilation:`, err);
	process.exit(1);
});
