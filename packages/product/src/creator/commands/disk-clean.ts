import { statfs, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { resolve } from "node:path";

import { parse, UsageError } from "../../shared/args.ts";
import { formatBytes } from "../../shared/format.ts";
import { clearDir, expandStar, treeStats } from "../../shared/fsutil.ts";
import { listProcessesNative, pick, type ProcInfo } from "./adobe-clean.ts";
import { catalog, type CacheTarget } from "./disk-clean/catalog.ts";
import { findDuplicates, walk } from "./disk-clean/scan.ts";
import type { Command } from "./types.ts";

const HELP = `creator-kit disk-clean <scan|clean|dupes> [options]

Optimise le stockage du PC sans toucher à tes documents.

  scan    espace disque, caches récupérables, plus gros dossiers et fichiers (lecture seule)
  clean   vide les caches régénérables (navigateurs, shaders GPU, temporaires, Adobe, Discord…)
  dupes   cherche les doublons exacts (taille, puis empreinte) ; rapport seul, ne supprime rien

Options :
  --root <dossier>   dossier analysé par scan/dupes (défaut : ton dossier utilisateur)
  --top <n>          nombre de lignes des classements (défaut 15)
  --only <ids>       clean : ne traite que ces caches (ex. chrome,temp) ; scan les liste
  --apply            clean : exécute (par défaut : simulation)
  --min-size <Mo>    dupes : taille minimale (défaut 1)
  --report <fichier> dupes : écrit le rapport JSON complet
  -h, --help

Les caches de navigateur ne sont vidés que si le navigateur est fermé.
Pour aller plus loin (admin, non automatisé) : "cleanmgr /sageset:1", "Dism /Online /Cleanup-Image /StartComponentCleanup".`;

export interface Io {
  env: Record<string, string | undefined>;
  list: () => Promise<ProcInfo[]>;
  log: (line: string) => void;
  /** Catalog flavour; defaults to the running platform. */
  platform?: NodeJS.Platform;
}

const nativeIo = (): Io => ({
  env: process.env,
  list: listProcessesNative,
  log: line => console.log(line),
});

async function volume(path: string, io: Io): Promise<void> {
  try {
    const info = await statfs(path);
    const total = info.blocks * info.bsize;
    const free = info.bavail * info.bsize;
    io.log(
      `Disque de ${path} : ${formatBytes(free)} libres sur ${formatBytes(total)} (${Math.round((free / total) * 100)} %)`,
    );
  } catch {
    // unsupported volume
  }
}

async function targetStats(target: CacheTarget): Promise<{ paths: string[]; bytes: number }> {
  const paths = (await Promise.all(target.patterns.map(expandStar))).flat();
  const sizes = await Promise.all(paths.map(path => treeStats(path)));
  const bytes = sizes.reduce((sum, stats) => sum + stats.bytes, 0);
  return { paths, bytes };
}

export async function scan(io: Io, root: string, top: number): Promise<number> {
  await volume(root, io);
  io.log("\nCaches récupérables (clean) :");
  let total = 0;
  const targets = catalog(io.env, io.platform);
  const sizes = await Promise.all(targets.map(target => targetStats(target)));
  for (const [index, target] of targets.entries()) {
    const { bytes } = sizes[index]!;
    total += bytes;
    if (bytes > 0) io.log(`  ${formatBytes(bytes).padStart(9)}  ${target.id.padEnd(12)} ${target.label}`);
  }
  io.log(`  ${formatBytes(total).padStart(9)}  total`);
  io.log(`\nAnalyse de ${root} …`);
  const result = await walk(root, { topFiles: top });
  io.log(`${result.totalFiles} fichiers, ${formatBytes(result.totalBytes)}`);
  io.log("\nPlus gros dossiers :");
  for (const dir of result.topDirs.slice(0, top)) io.log(`  ${formatBytes(dir.bytes).padStart(9)}  ${dir.path}`);
  io.log("\nPlus gros fichiers :");
  for (const file of result.files) io.log(`  ${formatBytes(file.bytes).padStart(9)}  ${file.path}`);
  return 0;
}

export async function clean(io: Io, apply: boolean, only: string[] | undefined): Promise<number> {
  const running = await io.list();
  let total = 0;
  let skipped = 0;
  for (const target of catalog(io.env, io.platform)) {
    if (only && !only.includes(target.id)) continue;
    const locks = target.lockedBy ? pick(running, target.lockedBy) : [];
    if (locks.length > 0) {
      io.log(`  ignoré  ${target.id} : ${[...new Set(locks.map(p => p.name))].join(", ")} ouvert`);
      continue;
    }
    const olderThanMs = (target.minAgeDays ?? 0) * 86_400_000;
    let bytes = 0;
    // oxlint-disable-next-line no-await-in-loop -- nettoyage séquentiel par cible : les motifs peuvent se recouvrir, une suppression concurrente du même dossier échouerait
    for (const path of (await Promise.all(target.patterns.map(expandStar))).flat()) {
      // oxlint-disable-next-line no-await-in-loop -- nettoyage séquentiel par cible : les motifs peuvent se recouvrir, une suppression concurrente du même dossier échouerait
      const result = await clearDir(path, apply, olderThanMs);
      bytes += result.bytes;
      skipped += result.skipped;
    }
    total += bytes;
    if (bytes > 0) io.log(`  ${formatBytes(bytes).padStart(9)}  ${target.id.padEnd(12)} ${target.label}`);
  }
  io.log(
    `${apply ? "Libéré" : "Récupérable"} : ${formatBytes(total)}${skipped ? `  (${skipped} élément(s) en cours d'utilisation ignorés)` : ""}`,
  );
  if (!apply) io.log("Simulation : relance avec --apply pour exécuter.");
  return 0;
}

export async function dupes(io: Io, root: string, minMb: number, top: number, report?: string): Promise<number> {
  io.log(`Recherche de doublons dans ${root} (≥ ${minMb} Mo) …`);
  const groups = await findDuplicates(root, Math.round(minMb * 1024 * 1024));
  const wasted = groups.reduce((sum, g) => sum + g.wasted, 0);
  io.log(`${groups.length} groupe(s), ${formatBytes(wasted)} récupérables en gardant une copie par groupe`);
  for (const group of groups.slice(0, top)) {
    io.log(`\n  ${formatBytes(group.bytes)} x ${group.paths.length}`);
    for (const path of group.paths) io.log(`    ${path}`);
  }
  if (report) {
    await writeFile(report, JSON.stringify(groups, null, 2));
    io.log(`\nRapport complet : ${report}`);
  }
  return 0;
}

export async function run(argv: string[], io: Io = nativeIo()): Promise<number> {
  const { values, positionals } = parse(argv, {
    root: { type: "string" },
    top: { type: "string" },
    only: { type: "string" },
    apply: { type: "boolean" },
    "min-size": { type: "string" },
    report: { type: "string" },
    help: { type: "boolean", short: "h" },
  });
  if (values.help) {
    io.log(HELP);
    return 0;
  }
  const action = positionals[0] ?? "scan";
  const root = resolve(values.root ?? homedir());
  const top = Number(values.top ?? 15);
  switch (action) {
    case "scan":
      return scan(io, root, top);
    case "clean":
      return clean(io, values.apply === true, values.only?.split(","));
    case "dupes":
      return dupes(io, root, Number(values["min-size"] ?? 1), top, values.report);
    default:
      throw new UsageError(`Action inconnue : ${action}`);
  }
}

const command: Command = {
  name: "disk-clean",
  summary: "Analyser et nettoyer le stockage (caches, temporaires, gros fichiers, doublons)",
  run: argv => run(argv),
};

export default command;
