// SPDX-License-Identifier: Apache-2.0
/**
 * Workflow complet Bun / WinClean pour Aphrody OS.
 * Assure le nettoyage haute performance du système de fichiers, l'élagage des caches,
 * la détection asynchrone des doublons byte-exact et l'interfaçage avec les métriques WinClean.
 */

import { readdir, stat, unlink, rm } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";

const ROOT = process.cwd();
const PRUNED_DIRS = new Set([".git", "node_modules", "target", ".cargo"]);

interface FileEntry {
  path: string;
  size: number;
}

async function fastScan(dir: string, results: FileEntry[] = []): Promise<FileEntry[]> {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!PRUNED_DIRS.has(entry.name)) {
          await fastScan(fullPath, results);
        }
      } else if (entry.isFile()) {
        try {
          const s = await stat(fullPath);
          results.push({ path: fullPath, size: s.size });
        } catch { }
      }
    }
  } catch { }
  return results;
}

async function getSha256(filePath: string): Promise<string> {
  const file = Bun.file(filePath);
  const buf = await file.arrayBuffer();
  return createHash("sha256").update(Buffer.from(buf)).digest("hex");
}

async function run() {
  const t0 = performance.now();
  console.log("==========================================================");
  console.log(" [APHRODY OS WINCLEAN] Workflow de maintenance (Bun)     ");
  console.log("==========================================================");
  console.log(`Cible racine : ${ROOT}`);

  // 1. Purge des dossiers temporaires et artefacts connus
  const knownTrashDirs = [
    join(ROOT, "target"),
    join(ROOT, ".turbo"),
    join(ROOT, ".cache"),
    join(ROOT, "var", "runs"),
    join(ROOT, "dist", "tmp")
  ];

  console.log("\n[1/4] Nettoyage des répertoires temporaires...");
  for (const d of knownTrashDirs) {
    try {
      const s = await stat(d).catch(() => null);
      if (s && s.isDirectory()) {
        console.log(`-> Suppression dossier : ${d}`);
        await rm(d, { recursive: true, force: true });
      }
    } catch { }
  }

  // 2. Scan récursif avec exclusion native des arborescences volumineuses
  console.log("\n[2/4] Indexation ultra-rapide des fichiers...");
  const scanStart = performance.now();
  const files = await fastScan(ROOT);
  console.log(`-> ${files.length} fichiers indexés en ${(performance.now() - scanStart).toFixed(1)} ms.`);

  // 3. Purge des logs et artefacts de debug
  console.log("\n[3/4] Purge des fichiers logs et symboles de débogage...");
  const debugExtensions = new Set([".pdb", ".ilk", ".dmp", ".dump", ".tmp", ".tsbuildinfo"]);
  let cleanedDebugFiles = 0;

  for (const file of files) {
    const lower = file.path.toLowerCase();
    if (lower.includes("fixtures")) continue;

    const isDebug = Array.from(debugExtensions).some((ext) => lower.endsWith(ext));
    const isLog = lower.endsWith(".log") && !lower.includes("fixtures");

    if (isDebug || isLog) {
      try {
        await unlink(file.path);
        cleanedDebugFiles++;
      } catch { }
    }
  }
  console.log(`-> ${cleanedDebugFiles} fichiers de logs/debug purgés.`);

  // 4. Déduplication par taille puis par empreinte SHA-256
  console.log("\n[4/4] Détection des doublons byte-exact...");
  const sizeMap = new Map<number, string[]>();
  for (const file of files) {
    if (file.size > 20 * 1024) {
      const group = sizeMap.get(file.size) || [];
      group.push(file.path);
      sizeMap.set(file.size, group);
    }
  }

  const potentialGroups = Array.from(sizeMap.entries()).filter(([_, paths]) => paths.length > 1);
  console.log(`-> ${potentialGroups.length} groupe(s) de taille identique analysé(s).`);

  let duplicateCount = 0;
  let purgedTempDuplicates = 0;

  for (const [_, paths] of potentialGroups) {
    const hashMap = new Map<string, string[]>();
    for (const p of paths) {
      try {
        const hash = await getSha256(p);
        const list = hashMap.get(hash) || [];
        list.push(p);
        hashMap.set(hash, list);
      } catch { }
    }

    for (const [hash, matching] of hashMap.entries()) {
      if (matching.length > 1) {
        duplicateCount++;
        for (let i = 1; i < matching.length; i++) {
          const candidate = matching[i];
          const cLower = candidate.toLowerCase();
          if (cLower.includes("var") || cLower.includes("tmp") || cLower.includes("cache") || cLower.includes("backup")) {
            try {
              await unlink(candidate);
              purgedTempDuplicates++;
            } catch { }
          }
        }
      }
    }
  }

  console.log(`-> Doublons exacts répertoriés : ${duplicateCount}, doublons temporaires purgés : ${purgedTempDuplicates}`);

  const elapsed = ((performance.now() - t0) / 1000).toFixed(2);
  console.log("\n==========================================================");
  console.log(` [APHRODY OS WINCLEAN] Workflow Bun exécuté en ${elapsed} s.`);
  console.log("==========================================================");
}

run().catch(console.error);
