/**
 * Configuration runtime de la bibliothèque Azalée.
 *
 * Deux familles de données coexistent :
 *
 * 1. Les **projections SQL** (manifestes d'assets, formations, cutins et
 *    catalogue métier) viennent de PostgreSQL ; les modules embarqués ne
 *    contiennent que les types et projections explicitement nécessaires au
 *    client.
 * 2. Le **miroir SQLite de compatibilité** reste hors du package et est localisé
 *    au runtime par ce module.
 *
 * L'ordre de résolution est explicite → variable d'environnement → chemins
 * conventionnels, ce qui permet à la lib de fonctionner à l'identique sous
 * `next build` (cwd = `apps/website`), sous le serveur standalone (cwd =
 * `.next/standalone/apps/website`), en CLI et en test (cwd = racine du dépôt).
 */

import { existsSync } from "node:fs";
import path from "node:path";
import { isInagleDatabaseConfigured } from "@rosegriffon/db/pg";

/** Options de configuration explicites (priorité maximale). */
export interface AzaleeConfig {
  /** Dossier contenant le miroir SQLite de développement (`backups/mirror.sqlite`). */
  dataDir?: string;
  /** Chemin du miroir SQLite des tables `inagle_*`. */
  mirrorPath?: string;
}

const explicit: AzaleeConfig = {};

/** Whether the PostgreSQL projection used by wiki queries is configured. */
export function hasPostgresConfiguration(): boolean {
  return isInagleDatabaseConfigured();
}

/**
 * Fixe la configuration runtime. Appelable plusieurs fois (fusion), typiquement
 * une seule fois au démarrage de l'application hôte ou du CLI.
 */
export function configureAzalee(config: AzaleeConfig): void {
  if (config.dataDir !== undefined) explicit.dataDir = path.resolve(config.dataDir);
  if (config.mirrorPath !== undefined) explicit.mirrorPath = path.resolve(config.mirrorPath);
}

/** Renvoie la configuration explicite courante (lecture seule). */
export function getAzaleeConfig(): Readonly<AzaleeConfig> {
  return explicit;
}

/** Remet la configuration explicite à zéro (tests). */
export function resetAzaleeConfig(): void {
  delete explicit.dataDir;
  delete explicit.mirrorPath;
}

/**
 * Racine du package (`packages/azalee`), déduite de l'emplacement de ce module.
 * Sert de dernier recours pour remonter jusqu'à `apps/website/data` en monorepo.
 */
function packageRoot(): string {
  // `import.meta.dir` (Bun) / `import.meta.url` (Node) → `<pkg>/src`.
  const here = typeof import.meta.dir === "string" ? import.meta.dir : path.dirname(new URL(import.meta.url).pathname);
  return path.resolve(here, "..");
}

/** Candidats de dossier de données, du plus spécifique au plus générique. */
function dataDirCandidates(): string[] {
  const root = packageRoot();
  return [
    explicit.dataDir,
    process.env.AZALEE_DATA_DIR,
    process.env.IECODE_DATA_DIR,
    process.env.DATA_ROOT,
    // Serveur standalone Next (cwd = `.next/standalone/apps/website`) et
    // `next build` (cwd = `apps/website`).
    path.resolve(process.cwd(), "data"),
    // Exécution depuis la racine du monorepo (CLI, tests, scripts).
    path.resolve(process.cwd(), "apps/website/data"),
    // Depuis `packages/azalee` : ../../apps/website/data.
    path.resolve(root, "../../apps/website/data"),
  ].filter((p): p is string => Boolean(p));
}

/**
 * Marqueurs d'un vrai dossier de données Azalée. Sans ce filtre, un simple
 * `<cwd>/data` homonyme (il en existe un à la racine du monorepo, dédié aux
 * dumps Postgres) serait retenu — c'est exactement le type de « source
 * silencieuse » qu'on veut éviter.
 */
const DATA_DIR_MARKERS = ["backups/mirror.sqlite", "schema-snapshot"];

/**
 * Résout le dossier des artefacts runtime : premier candidat existant
 * contenant au moins un marqueur Azalée. Renvoie `null` si aucun ne
 * correspond (la lib reste utilisable pour tout ce qui ne touche pas ces
 * artefacts).
 */
export function resolveDataDir(): string | null {
  for (const candidate of dataDirCandidates()) {
    if (!existsSync(candidate)) continue;
    if (DATA_DIR_MARKERS.some(marker => existsSync(path.join(candidate, marker)))) {
      return candidate;
    }
  }
  return null;
}

/**
 * Résout le miroir SQLite des tables `inagle_*`.
 *
 * `SQLITE_DB_PATH` est épinglé en production (drop-in systemd) sur le miroir
 * canonique.
 */
export function resolveMirrorPath(): string | null {
  if (explicit.mirrorPath) return explicit.mirrorPath;
  if (process.env.SQLITE_DB_PATH) return path.resolve(process.env.SQLITE_DB_PATH);
  if (process.env.NIERS_MIRROR) {
    const configured = path.resolve(process.env.NIERS_MIRROR);
    return existsSync(configured) ? configured : null;
  }

  const root = packageRoot();
  const repoRoot = path.resolve(root, "../..");
  const candidates = [
    process.env.NIERS_MIRROR,
    path.resolve(repoRoot, "var/mirror.sqlite"),
    process.env.IECODE_DATA_DIR ? path.resolve(process.env.IECODE_DATA_DIR, "../var/mirror.sqlite") : undefined,
  ].filter((p): p is string => Boolean(p));

  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}
