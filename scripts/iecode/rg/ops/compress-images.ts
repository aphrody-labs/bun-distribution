#!/usr/bin/env bun
/**
 * Pipeline de compression d'images — réduit le poids des images raster du monorepo.
 *
 * Scanne des dossiers cibles (par défaut : data/images/menu d'azalee + public des apps),
 * détecte les fichiers .png/.jpg/.jpeg/.webp au-dessus d'un seuil de poids, et les ré-encode
 * en WebP qualité 80 (convention azalee : data/images/menu = webp q80).
 *
 * Encodeur : `cwebp` si présent (Bun.which), sinon repli sur le package `sharp` (déjà en deps).
 *
 * SÉCURITÉ :
 *   - dry-run par DÉFAUT — n'écrit jamais sans `--apply`.
 *   - en --apply : n'écrit le .webp que s'il est STRICTEMENT plus petit que l'original.
 *   - ne SUPPRIME un original png/jpg que si `--replace` ET webp plus petit.
 *   - ne touche jamais un fichier qu'on n'arrive pas à réduire.
 *
 * Usage :
 *   bun scripts/ops/compress-images.ts [--dir <path>]... [--quality 80] [--min-kb 50] [--apply] [--replace]
 */

import { Glob } from "bun";
import { extname, join, relative } from "node:path";

// --- Dossiers cibles par défaut (relatifs à la racine du monorepo) -----------
const DEFAULT_DIRS = ["apps/rg-website/data/images/menu", "apps/rg-website/public", "apps/rg-website/public"];

// Extensions raster candidates à la recompression.
const EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp"]);

interface Options {
  dirs: string[];
  quality: number;
  minKb: number;
  apply: boolean;
  replace: boolean;
}

interface FileResult {
  path: string; // chemin relatif lisible
  before: number;
  after: number; // taille du webp encodé (0 si non encodé)
  encoded: boolean; // un webp plus petit a été produit
  written: boolean; // écrit sur disque (--apply)
  deletedOriginal: boolean; // original supprimé (--replace)
  skipReason?: string;
}

/** Parse les arguments CLI (Bun.argv). `--dir` est répétable. */
function parseArgs(argv: string[]): Options {
  const dirs: string[] = [];
  let quality = 80;
  let minKb = 50;
  let apply = false;
  let replace = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case "--dir":
        dirs.push(argv[++i]);
        break;
      case "--quality":
        quality = Number(argv[++i]);
        break;
      case "--min-kb":
        minKb = Number(argv[++i]);
        break;
      case "--apply":
        apply = true;
        break;
      case "--replace":
        replace = true;
        break;
      case "--dry-run":
        apply = false; // explicite, mais c'est déjà le défaut
        break;
      default:
        if (arg?.startsWith("--")) {
          console.warn(`Option inconnue ignorée : ${arg}`);
        }
    }
  }

  if (!Number.isFinite(quality) || quality < 1 || quality > 100) {
    throw new Error(`--quality invalide : ${quality} (attendu 1..100)`);
  }
  if (!Number.isFinite(minKb) || minKb < 0) {
    throw new Error(`--min-kb invalide : ${minKb}`);
  }

  return {
    dirs: dirs.length > 0 ? dirs : DEFAULT_DIRS,
    quality,
    minKb,
    apply,
    replace,
  };
}

/** Formate un nombre d'octets en chaîne lisible. */
function fmtBytes(n: number): string {
  if (n < 1024) return `${n} o`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} Ko`;
  return `${(n / (1024 * 1024)).toFixed(2)} Mo`;
}

/** Pourcentage économisé (positif = gain). */
function pct(before: number, after: number): string {
  if (before === 0) return "0.0%";
  return `${(((before - after) / before) * 100).toFixed(1)}%`;
}

/**
 * Encode un fichier vers WebP en mémoire, retourne les octets encodés.
 * Préfère `cwebp` (CLI) ; repli sur `sharp` si indisponible.
 */
async function encodeWebp(inputPath: string, quality: number, cwebpBin: string | null): Promise<Uint8Array> {
  if (cwebpBin) {
    // cwebp lit le fichier d'entrée, écrit le webp sur stdout ("-o -").
    const proc = Bun.spawn([cwebpBin, "-quiet", "-q", String(quality), inputPath, "-o", "-"], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const out = new Uint8Array(await new Response(proc.stdout).arrayBuffer());
    const code = await proc.exited;
    if (code !== 0) {
      const err = await new Response(proc.stderr).text();
      throw new Error(`cwebp a échoué (code ${code}) : ${err.trim()}`);
    }
    return out;
  }

  // Repli sharp (déjà dépendance des apps). Import indirect pour éviter la
  // résolution statique au bundling (sharp n'est pas en deps de la racine).
  const sharpModule = "sharp";
  const { default: sharp } = (await import(sharpModule)) as {
    default: (input: Buffer) => { webp: (o: { quality: number }) => { toBuffer: () => Promise<Buffer> } };
  };
  const input = await Bun.file(inputPath).arrayBuffer();
  const out = await sharp(Buffer.from(input)).webp({ quality }).toBuffer();
  return new Uint8Array(out);
}

/** Cherche le chemin de sortie .webp pour un fichier donné. */
function webpTarget(inputPath: string): string {
  const ext = extname(inputPath);
  if (ext.toLowerCase() === ".webp") return inputPath; // ré-encodage in-place
  return inputPath.slice(0, inputPath.length - ext.length) + ".webp";
}

async function main() {
  const root = process.cwd();
  const opts = parseArgs(Bun.argv.slice(2));
  const cwebpBin = Bun.which("cwebp");
  const encoder = cwebpBin ? `cwebp (${cwebpBin})` : "sharp (repli)";

  console.log("Pipeline de compression d'images");
  console.log(`  Encodeur : ${encoder}`);
  console.log(`  Qualité  : ${opts.quality}`);
  console.log(`  Seuil    : > ${opts.minKb} Ko`);
  console.log(`  Mode     : ${opts.apply ? "APPLY (écriture)" : "DRY-RUN (aucune écriture)"}`);
  console.log(`  Replace  : ${opts.replace ? "oui (supprime l'original si plus petit)" : "non"}`);
  console.log(`  Dossiers : ${opts.dirs.join(", ")}`);
  console.log("");

  const minBytes = opts.minKb * 1024;
  const results: FileResult[] = [];

  for (const dir of opts.dirs) {
    const absDir = join(root, dir);
    // Vérifie l'existence du dossier avant de scanner.
    try {
      const stat = await Bun.file(join(absDir, ".")).exists();
      void stat;
    } catch {
      // noop
    }

    const glob = new Glob("**/*");
    let scanned = false;
    for await (const rel of glob.scan({ cwd: absDir, onlyFiles: true })) {
      scanned = true;
      const ext = extname(rel).toLowerCase();
      if (!EXTENSIONS.has(ext)) continue;

      const abs = join(absDir, rel);
      const file = Bun.file(abs);
      const before = file.size;
      if (before <= minBytes) continue; // sous le seuil, on ignore

      const display = relative(root, abs);
      let encoded: Uint8Array;
      try {
        encoded = await encodeWebp(abs, opts.quality, cwebpBin);
      } catch (e) {
        results.push({
          path: display,
          before,
          after: 0,
          encoded: false,
          written: false,
          deletedOriginal: false,
          skipReason: `erreur encodage : ${(e as Error).message}`,
        });
        continue;
      }

      const after = encoded.length;
      const isSmaller = after < before;

      const result: FileResult = {
        path: display,
        before,
        after,
        encoded: isSmaller,
        written: false,
        deletedOriginal: false,
      };

      if (!isSmaller) {
        result.skipReason = "déjà optimal (webp non plus petit)";
        results.push(result);
        continue;
      }

      // --apply : on écrit le webp (strictement plus petit garanti ici).
      if (opts.apply) {
        const target = webpTarget(abs);
        await Bun.write(target, encoded);
        result.written = true;

        // --replace : supprimer l'original png/jpg (jamais si déjà .webp).
        if (opts.replace && ext !== ".webp" && target !== abs) {
          await Bun.file(abs).delete();
          result.deletedOriginal = true;
        }
      }

      results.push(result);
    }

    if (!scanned) {
      console.warn(`  (dossier vide ou absent : ${dir})`);
    }
  }

  // --- Rapport ------------------------------------------------------------
  let totalBefore = 0;
  let totalAfter = 0;
  let savedFiles = 0;

  console.log("Rapport par fichier :");
  if (results.length === 0) {
    console.log("  (aucun fichier candidat au-dessus du seuil)");
  }
  for (const r of results) {
    if (r.encoded) {
      totalBefore += r.before;
      totalAfter += r.after;
      savedFiles++;
      const flag = r.deletedOriginal ? " [webp écrit, original supprimé]" : r.written ? " [webp écrit]" : " [dry-run]";
      console.log(`  ✓ ${r.path}  ${fmtBytes(r.before)} → ${fmtBytes(r.after)}  (−${pct(r.before, r.after)})${flag}`);
    } else {
      console.log(`  · ${r.path}  ${fmtBytes(r.before)}  — ${r.skipReason ?? "ignoré"}`);
    }
  }

  console.log("");
  console.log("Total :");
  console.log(`  Fichiers compressibles : ${savedFiles} / ${results.length} candidats`);
  console.log(
    `  Avant → Après : ${fmtBytes(totalBefore)} → ${fmtBytes(totalAfter)}  (−${pct(totalBefore, totalAfter)})`,
  );
  console.log(`  Économie : ${fmtBytes(totalBefore - totalAfter)}`);
  if (!opts.apply && savedFiles > 0) {
    console.log("");
    console.log("  DRY-RUN : aucune écriture effectuée. Relancer avec --apply pour appliquer.");
  }
}

main().catch(e => {
  console.error(`Erreur fatale : ${(e as Error).message}`);
  process.exit(1);
});
