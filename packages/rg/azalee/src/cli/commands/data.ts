/**
 * `azalee data` — pipeline de données unifié.
 *
 * Sous-commandes : `push`, `migrate`, `load`, `sync`, `typecheck`, `verify`,
 * `all`. Chacune **orchestre l'outil canonique existant** plutôt que de
 * dupliquer sa logique : le pipeline reste une façade, pas une seconde source
 * de vérité.
 */

import { existsSync, readdirSync, statSync } from "node:fs";

import type { Command } from "commander";

import { colors } from "../context";
import type { DataMigrateOptions, DataSyncOptions } from "../types";
import { resolveMirrorPath } from "../../config";

/** Racine du monorepo (les scripts orchestrés y sont ancrés). */
const REPO_ROOT = "/home/ubuntu/rg";
/** Fichier d'environnement chargé par le pousseur inagle. */
const AZALEE_ENV = `${REPO_ROOT}/apps/website/.env`;
/** Racine des dumps de jeu. */
const DATA_ROOT_DEFAULT =
	process.env.DATA_ROOT || process.env.DATA_PATH || "/home/ubuntu/nie/data";
const NIERS_ROOT = process.env.NIERS_ROOT || "/home/ubuntu/nie";
const NIERS_MIRROR_PUBLISHER = `${NIERS_ROOT}/scripts/donnees/miroir-inagle.sh`;
/** Âge maximal toléré pour le miroir SQLite, en heures. */
const MIRROR_MAX_AGE_H = 48;

/** Publisher canonique, avec repli explicite pour un checkout sans `niers`. */
function mirrorRefreshCommand(): string {
	return existsSync(NIERS_MIRROR_PUBLISHER)
		? NIERS_MIRROR_PUBLISHER
		: `echo "Canonical mirror publisher missing: ${NIERS_MIRROR_PUBLISHER}" >&2; exit 1`;
}

/**
 * Exécute une étape du pipeline et journalise son issue.
 *
 * `cmd` est une ligne de shell complète (pipes, `&&`) → confiée à `sh -c`, en
 * **synchrone** pour préserver l'ordre d'affichage des étapes.
 */
function runDataStep(label: string, cmd: string, env: Record<string, string> = {}): boolean {
	const t0 = Date.now();
	console.log(`${colors.cyan}▸ ${label}${colors.reset}\n  $ ${cmd}`);
	const res = Bun.spawnSync(["sh", "-c", cmd], {
		cwd: REPO_ROOT,
		stdout: "inherit",
		stderr: "inherit",
		env: { ...process.env, ...env },
	});
	if (res.exitCode === 0) {
		console.log(
			`${colors.green}✓ ${label} (${((Date.now() - t0) / 1000).toFixed(1)}s)${colors.reset}`
		);
		return true;
	}
	console.log(`${colors.red}✗ ${label} — échec${colors.reset}`);
	return false;
}

export function registerDataCommand(program: Command): void {
	const dataCmd = program
		.command("data")
		.description("Pipeline de données unifié (push/migrate/load/sync/typecheck/verify/all)");

	dataCmd
		.command("push")
		.description("Push inagle → Supabase (parse live du dump, delete+reinsert)")
		.action(() => {
			const ok = runDataStep(
				"data push (inagle → Supabase)",
				`bun packages/inagle/src/cli.ts push --env ${AZALEE_ENV}`,
				{ DATA_ROOT: DATA_ROOT_DEFAULT, DATA_PATH: DATA_ROOT_DEFAULT }
			);
			process.exit(ok ? 0 : 1);
		});

	dataCmd
		.command("migrate")
		.description(
			"Migrations SQL (better-auth_migrations/*.sql) — liste par défaut, --apply pour exécuter"
		)
		.option("--apply", "Applique les migrations via psql (rose_griffon local)")
		.action((opts: DataMigrateOptions) => {
			const dir = `${REPO_ROOT}/apps/website/supabase/migrations`;
			let files: string[] = [];
			try {
				files = readdirSync(dir)
					.filter((f: string) => f.endsWith(".sql"))
					.sort();
			} catch {
				console.log(`${colors.yellow}Aucun dossier de migrations: ${dir}${colors.reset}`);
				return;
			}
			if (files.length === 0) {
				console.log(`${colors.green}Aucune migration SQL en attente.${colors.reset}`);
				return;
			}
			console.log(`${colors.cyan}${files.length} migration(s) SQL:${colors.reset}`);
			for (const f of files) console.log(`  - ${f}`);
			if (!opts.apply) {
				console.log(
					`${colors.yellow}(dry-run — relancer avec --apply pour exécuter)${colors.reset}`
				);
				return;
			}
			let allOk = true;
			for (const f of files) {
				allOk =
					runDataStep(`migrate ${f}`, `sudo -u postgres psql -d rose_griffon -f ${dir}/${f}`) &&
					allOk;
			}
			process.exit(allOk ? 0 : 1);
		});

	dataCmd
		.command("load")
		.description("Publie le miroir SQLite canonique niers (repli local: backup:supabase)")
		.action(() => {
			const ok = runDataStep("data load (Supabase → miroir canonique)", mirrorRefreshCommand());
			process.exit(ok ? 0 : 1);
		});

	dataCmd
		.command("sync")
		.description("Synchronise Supabase ↔ miroir SQLite (incrémental ; --full pour complet)")
		.option("--full", "Resync complet")
		.option("--deletes", "Propage les suppressions")
		.action((opts: DataSyncOptions) => {
			const flags = `${opts.full ? " --full" : ""}${opts.deletes ? " --deletes" : ""}`;
			const ok = runDataStep(
				"data sync (Supabase ↔ SQLite)",
				`${mirrorRefreshCommand()}${flags}`
			);
			process.exit(ok ? 0 : 1);
		});

	dataCmd
		.command("typecheck")
		.description("Type-check strict (website + inagle, tsc --noEmit)")
		.action(() => {
			const a = runDataStep("typecheck website", `bun --filter @rosegriffon/website type-check`);
			const b = runDataStep("typecheck inagle", `bun --filter @rosegriffon/inagle type-check`);
			process.exit(a && b ? 0 : 1);
		});

	dataCmd
		.command("verify")
		.description(
				"Vérifie les chemins/données : PostgreSQL, DATA_ROOT et snapshot schéma"
		)
		.action(() => {
			let ok = true;
			const check = (label: string, cond: boolean, detail = "") => {
				console.log(
					`  ${cond ? colors.green + "✓" : colors.red + "✗"} ${label}${colors.reset}${detail ? ` — ${detail}` : ""}`
				);
				if (!cond) ok = false;
			};
			const mirrorPath = resolveMirrorPath();
			let mirror: string | null = null;
			let ageH = Infinity;
			if (mirrorPath && existsSync(mirrorPath)) {
				mirror = mirrorPath;
				ageH = (Date.now() - statSync(mirrorPath).mtimeMs) / 3_600_000;
			}
			check("miroir SQLite présent", !!mirror, mirror ? mirror.split("/").pop()! : "absent");
			check(
				"miroir récent (< 48h)",
				ageH < MIRROR_MAX_AGE_H,
				ageH === Infinity ? "?" : `${ageH.toFixed(1)}h`
			);
			check("DATA_ROOT existe", existsSync(DATA_ROOT_DEFAULT), DATA_ROOT_DEFAULT);
			check(
				"dump chara_param présent",
				existsSync(`${DATA_ROOT_DEFAULT}/common/gamedata/character`)
			);
			check("DATABASE_URL configurée", Boolean(process.env.DATABASE_URL || process.env.ROSE_GRIFFON_DATABASE_URL || process.env.RG_DATABASE_URL));
			check("snapshot schéma DB", existsSync(`${REPO_ROOT}/apps/website/data/schema-snapshot`));
			check(
				"standalone embarque un miroir",
				existsSync(`${REPO_ROOT}/apps/website/.next/standalone/apps/website/data/backups`)
			);
			console.log(
				ok
					? `${colors.green}verify OK${colors.reset}`
					: `${colors.red}verify: anomalies détectées${colors.reset}`
			);
			process.exit(ok ? 0 : 1);
		});

	dataCmd
		.command("all")
		.description("Pipeline complet ordonné : push → load → typecheck → verify")
		.action(() => {
			const steps: Array<[string, string, Record<string, string>]> = [
				[
					"push",
					`bun packages/inagle/src/cli.ts push --env ${AZALEE_ENV}`,
					{ DATA_ROOT: DATA_ROOT_DEFAULT, DATA_PATH: DATA_ROOT_DEFAULT },
				],
				["load", mirrorRefreshCommand(), {}],
				["typecheck website", `bun --filter @rosegriffon/website type-check`, {}],
				["typecheck inagle", `bun --filter @rosegriffon/inagle type-check`, {}],
			];
			for (const [label, cmd, env] of steps) {
				if (!runDataStep(label, cmd, env)) {
					console.log(`${colors.red}Pipeline interrompu à '${label}'.${colors.reset}`);
					process.exit(1);
				}
			}
			runDataStep("verify", `bun ${REPO_ROOT}/packages/azalee/src/cli.ts data verify`);
			console.log(`${colors.green}✓ pipeline data complet${colors.reset}`);
		});
}
