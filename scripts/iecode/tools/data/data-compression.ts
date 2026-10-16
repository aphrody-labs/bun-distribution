#!/usr/bin/env bun
/**
 * data-compression.ts — Système de compression et décompression maximale de data/ sans perte.
 *
 * Utilise les meilleurs compresseurs Linux (7-Zip LZMA2 Ultra Solid, Zstandard Ultra -22)
 * combinés à un contrôle d'intégrité cryptographique SHA-256 strict pour garantir 0 perte de données.
 *
 * Commandes :
 *   bun scripts/iecode/tools/data/data-compression.ts status
 *   bun scripts/iecode/tools/data/data-compression.ts manifest
 *   bun scripts/iecode/tools/data/data-compression.ts verify
 *   bun scripts/iecode/tools/data/data-compression.ts compress [--format 7z|zstd|xz]
 *   bun scripts/iecode/tools/data/data-compression.ts decompress
 *   bun scripts/iecode/tools/data/data-compression.ts info-cpk <path-to-cpk>
 */

import {
  createReadStream,
  existsSync,
  readdirSync,
  statSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { resolve, relative, join } from "node:path";
import { createHash } from "node:crypto";

const root = resolve(import.meta.dir, "../../../..");
const dataDir = resolve(root, "data");
const manifestPath = resolve(dataDir, "manifest.sha256.json");
const archive7z = resolve(root, "data.7z");
const archiveZst = resolve(root, "data.tar.zst");
const archiveXz = resolve(root, "data.tar.xz");

interface ManifestData {
  generatedAt: string;
  totalFiles: number;
  totalBytes: number;
  files: Record<string, { size: number; sha256: string }>;
}

function findCommand(cmd: string): boolean {
  const res = Bun.spawnSync(["which", cmd]);
  return res.exitCode === 0 && Boolean(res.stdout.toString().trim());
}

function getBest7z(): string {
  if (findCommand("7za")) return "7za";
  if (findCommand("7z")) return "7z";
  throw new Error("7-Zip (7za ou 7z) n'est pas installé.");
}

async function computeFileSha256(filePath: string): Promise<{ sha256: string; size: number }> {
  const hash = createHash("sha256");
  let size = 0;
  for await (const chunk of createReadStream(filePath)) {
    hash.update(chunk);
    size += chunk.length;
  }
  return { sha256: hash.digest("hex"), size };
}

function walkDir(dir: string, fileList: string[] = []): string[] {
  if (!existsSync(dir)) return fileList;
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      walkDir(fullPath, fileList);
    } else if (entry.isFile()) {
      if (fullPath === manifestPath) continue; // Ne pas hasher le manifeste lui-même
      fileList.push(fullPath);
    }
  }
  return fileList;
}

export async function generateManifest(): Promise<void> {
  console.log(`[data-compression] Indexation et calcul SHA-256 de ${dataDir}...`);
  const allFiles = walkDir(dataDir);
  console.log(`[data-compression] ${allFiles.length} fichiers trouvés. Calcul des empreintes...`);

  const manifest: ManifestData = {
    generatedAt: new Date().toISOString(),
    totalFiles: allFiles.length,
    totalBytes: 0,
    files: {},
  };

  let processed = 0;
  for (const filePath of allFiles) {
    const rel = relative(dataDir, filePath).replaceAll("\\", "/");
    const { sha256, size } = await computeFileSha256(filePath);
    manifest.files[rel] = { size, sha256 };
    manifest.totalBytes += size;
    processed++;
    if (processed % 100 === 0 || processed === allFiles.length) {
      process.stdout.write(
        `\r[data-compression] Traité: ${processed}/${allFiles.length} fichiers...`,
      );
    }
  }
  process.stdout.write("\n");

  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), "utf8");
  console.log(
    `[data-compression] Manifeste enregistré dans ${manifestPath} (${(manifest.totalBytes / 1024 / 1024 / 1024).toFixed(2)} Go).`,
  );
}

export async function verifyIntegrity(): Promise<boolean> {
  if (!existsSync(manifestPath)) {
    console.warn(`[data-compression] Aucun manifeste d'intégrité trouvé à ${manifestPath}.`);
    return false;
  }

  const manifest: ManifestData = JSON.parse(readFileSync(manifestPath, "utf8"));
  console.log(
    `[data-compression] Vérification de ${manifest.totalFiles} fichiers par rapport au manifeste...`,
  );

  let valid = 0;
  let corrupted = 0;
  let missing = 0;

  for (const [relPath, expected] of Object.entries(manifest.files)) {
    const fullPath = join(dataDir, relPath);
    if (!existsSync(fullPath)) {
      console.error(`[ERREUR] Fichier manquant : ${relPath}`);
      missing++;
      continue;
    }

    const { sha256, size } = await computeFileSha256(fullPath);
    if (size !== expected.size || sha256 !== expected.sha256) {
      console.error(
        `[ERREUR] Altération détectée : ${relPath} (attendu ${expected.sha256}, obtenu ${sha256})`,
      );
      corrupted++;
    } else {
      valid++;
    }
  }

  console.log(
    `[data-compression] Bilan de vérification : ${valid} conformes, ${corrupted} altérés, ${missing} manquants.`,
  );
  return corrupted === 0 && missing === 0;
}

export async function compressData(format = "7z"): Promise<void> {
  if (!existsSync(dataDir)) {
    throw new Error(`Dossier data/ introuvable : ${dataDir}`);
  }

  if (!existsSync(manifestPath)) {
    console.log("[data-compression] Manifeste d'intégrité absent -> génération automatique...");
    await generateManifest();
  }

  console.log(`[data-compression] Lancement de la compression maximale (${format})...`);

  if (format === "7z") {
    const p7z = getBest7z();
    // 7z LZMA2 ultra solid, dictionnaire 64M, filtres de match étendus
    const proc = Bun.spawnSync(
      [
        p7z,
        "a",
        "-t7z",
        "-m0=lzma2",
        "-mx=9",
        "-mfb=273",
        "-md=64m",
        "-ms=on",
        "-y",
        archive7z,
        "data/",
      ],
      { cwd: root, stdout: "inherit", stderr: "inherit" },
    );
    if (proc.exitCode !== 0) throw new Error("Échec de la compression 7z.");
    console.log(
      `[data-compression] Archive créée : ${archive7z} (${(statSync(archive7z).size / 1024 / 1024 / 1024).toFixed(2)} Go).`,
    );
  } else if (format === "zstd") {
    if (!findCommand("zstd")) throw new Error("zstd n'est pas disponible.");
    const proc = Bun.spawnSync(
      ["sh", "-c", `tar -cf - data/ | zstd --ultra -22 -T0 -o "${archiveZst}"`],
      { cwd: root, stdout: "inherit", stderr: "inherit" },
    );
    if (proc.exitCode !== 0) throw new Error("Échec de la compression Zstandard.");
    console.log(
      `[data-compression] Archive créée : ${archiveZst} (${(statSync(archiveZst).size / 1024 / 1024 / 1024).toFixed(2)} Go).`,
    );
  } else {
    throw new Error(`Format de compression non pris en charge : ${format}`);
  }
}

export async function decompressData(): Promise<void> {
  let targetArchive = "";
  let format = "";

  if (existsSync(archive7z)) {
    targetArchive = archive7z;
    format = "7z";
  } else if (existsSync(archiveZst)) {
    targetArchive = archiveZst;
    format = "zstd";
  } else if (existsSync(archiveXz)) {
    targetArchive = archiveXz;
    format = "xz";
  } else {
    throw new Error("Aucune archive data (data.7z, data.tar.zst ou data.tar.xz) trouvée.");
  }

  console.log(`[data-compression] Décompression de ${targetArchive}...`);
  if (format === "7z") {
    const p7z = getBest7z();
    const proc = Bun.spawnSync([p7z, "x", "-y", targetArchive], {
      cwd: root,
      stdout: "inherit",
      stderr: "inherit",
    });
    if (proc.exitCode !== 0) throw new Error("Échec de la décompression 7z.");
  } else if (format === "zstd") {
    const proc = Bun.spawnSync(["sh", "-c", `zstd -d -c "${targetArchive}" | tar -xf -`], {
      cwd: root,
      stdout: "inherit",
      stderr: "inherit",
    });
    if (proc.exitCode !== 0) throw new Error("Échec de la décompression zstd.");
  }

  console.log(
    "[data-compression] Décompression achevée. Vérification de l'intégrité SHA-256 sans perte...",
  );
  const ok = await verifyIntegrity();
  if (!ok) {
    throw new Error("[data-compression] ALERTE : Données décompressées incomplètes ou corrompues.");
  }
  console.log("[data-compression] Intégrité 100% vérifiée : aucune perte de données.");
}

export function printStatus(): void {
  console.log("=== IECODE Data Compression Status ===");
  if (existsSync(dataDir)) {
    const files = walkDir(dataDir);
    let total = 0;
    for (const f of files) total += statSync(f).size;
    console.log(
      `- Dossier data/        : Présent (${files.length} fichiers, ${(total / 1024 / 1024 / 1024).toFixed(2)} Go)`,
    );
  } else {
    console.log("- Dossier data/        : Absent");
  }

  console.log(`- Manifeste SHA-256    : ${existsSync(manifestPath) ? "Présent" : "Absent"}`);
  console.log(
    `- Archive data.7z      : ${existsSync(archive7z) ? `${(statSync(archive7z).size / 1024 / 1024 / 1024).toFixed(2)} Go` : "Absente"}`,
  );
  console.log(
    `- Archive data.tar.zst : ${existsSync(archiveZst) ? `${(statSync(archiveZst).size / 1024 / 1024 / 1024).toFixed(2)} Go` : "Absente"}`,
  );
  console.log("======================================");
}

export function inspectCpk(cpkPath: string): void {
  const full = resolve(root, cpkPath);
  if (!existsSync(full)) {
    console.error(`Fichier CPK introuvable : ${full}`);
    return;
  }

  const fd = readFileSync(full);
  console.log(`=== CPK Inspector : ${full} ===`);
  console.log(`Taille : ${(fd.length / 1024 / 1024).toFixed(2)} Mo (${fd.length} octets)`);

  const magic = fd.subarray(0, 4).toString("ascii");
  console.log(`Magic  : "${magic}" (attendu "CPK " ou chiffré)`);
  if (magic !== "CPK ") {
    console.log(
      `Note   : Ce CPK est chiffré par CRI XOR. Le décodage utilise la clé CRC32 du nom de fichier.`,
    );
  }
}

const command = process.argv[2] ?? "status";

switch (command) {
  case "status":
    printStatus();
    break;
  case "manifest":
    await generateManifest();
    break;
  case "verify":
    await verifyIntegrity();
    break;
  case "compress":
    await compressData(process.argv[3] ?? "7z");
    break;
  case "decompress":
    await decompressData();
    break;
  case "info-cpk":
    inspectCpk(process.argv[3] ?? "");
    break;
  default:
    console.error(
      "Usage: bun scripts/iecode/tools/data/data-compression.ts [status|manifest|verify|compress|decompress|info-cpk]",
    );
    process.exit(1);
}
