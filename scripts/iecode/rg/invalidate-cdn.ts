#!/usr/bin/env bun
/**
 * invalidate-cdn.ts — Invalidation bornée du cache CDN de production (azalee).
 *
 * Surface CDN Azalée servie par Website (« Pipeline images » + « Service Worker ») :
 *   1. CDN statique nginx  : cdn.rosegriffon.fr/static/azalee/menu/  (~47k webp pré-extraits)
 *   2. G4TX live-decode    : cache disque des variantes, CÔTÉ CDN (origin séparé)
 *   3. Service Worker      : apps/rg-website/public/sw.js, constante CACHE_NAME — DOIT être
 *      bumpée après tout update d'assets/manifest, sinon les clients servent du stale.
 *
 * Leviers exposés (TOUS bornés et SÛRS) :
 *   --bump-sw            : incrémente la version de CACHE_NAME dans sw.js (levier principal,
 *                          fiable côté client). N'édite QUE cette ligne.
 *   --purge-g4tx <glob>  : purge les variantes G4TX en cache disque local SI un répertoire
 *                          de cache vérifié existe. No-op sinon (le cache vit côté CDN).
 *   --dry-run            : DÉFAUT (true) — affiche ce qui changerait, sans rien muter.
 *   --apply              : exécute réellement les mutations.
 *
 * Hors scope (volontairement) : aucun appel réseau prod, aucun sudo, aucun restart nginx.
 */

import { Glob } from "bun";
import { resolve } from "node:path";

// Racine du monorepo rg (ce fichier vit dans scripts/iecode/rg/).
// RG lives in the IECODE monorepo root unless RG_ROOT says otherwise.
const REPO_ROOT = resolve(process.env.RG_ROOT ?? resolve(import.meta.dir, "../../.."));
const SW_PATH = resolve(REPO_ROOT, "apps/rg-website/public/sw.js");

// ── Parsing minimal des arguments (sans dépendance) ──────────────────────────
interface CliArgs {
  bumpSw: boolean;
  purgeG4txGlob: string | null;
  apply: boolean; // si false → dry-run
}

function parseArgs(argv: string[]): CliArgs {
  let bumpSw = false;
  let purgeG4txGlob: string | null = null;
  let apply = false;
  let dryRunExplicit = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case "--bump-sw":
        bumpSw = true;
        break;
      case "--purge-g4tx":
        purgeG4txGlob = argv[i + 1] ?? "**/*";
        i++; // consomme la valeur
        break;
      case "--apply":
        apply = true;
        break;
      case "--dry-run":
        dryRunExplicit = true;
        break;
      default:
        console.warn(`⚠️  Argument inconnu ignoré : ${arg}`);
    }
  }

  // --dry-run et --apply explicites : --dry-run l'emporte (sécurité).
  if (dryRunExplicit) apply = false;
  return { bumpSw, purgeG4txGlob, apply };
}

// ── Levier 1 : bump de CACHE_NAME dans le Service Worker ─────────────────────
// Format observé : `const CACHE_NAME = "azalee-shell-v7-20260517";`
// On incrémente le segment `vN` (la première occurrence de v<chiffres>).
const CACHE_NAME_LINE_RE = /^(\s*const\s+CACHE_NAME\s*=\s*)(["'])(.*?)\2(\s*;?)/m;
const VERSION_TOKEN_RE = /v(\d+)/;

interface BumpResult {
  ok: boolean;
  before?: string;
  after?: string;
  reason?: string;
  nextContent?: string;
}

function computeBump(content: string): BumpResult {
  const match = content.match(CACHE_NAME_LINE_RE);
  if (!match) {
    return { ok: false, reason: "constante CACHE_NAME introuvable dans sw.js" };
  }
  const before = match[3];
  const vMatch = before.match(VERSION_TOKEN_RE);
  if (!vMatch) {
    return {
      ok: false,
      before,
      reason: `pas de segment de version « vN » dans « ${before} »`,
    };
  }
  const current = Number.parseInt(vMatch[1], 10);
  const next = current + 1;
  // Remplace UNIQUEMENT le premier token vN, en préservant le reste (ex. suffixe date).
  const after = before.replace(VERSION_TOKEN_RE, `v${next}`);

  // Reconstruit la ligne entière à l'identique sauf la valeur (édition surgicale).
  const nextContent = content.replace(
    CACHE_NAME_LINE_RE,
    (_full, p1, quote, _val, p4) => `${p1}${quote}${after}${quote}${p4}`,
  );

  return { ok: true, before, after, nextContent };
}

async function runBumpSw(apply: boolean): Promise<boolean> {
  const file = Bun.file(SW_PATH);
  if (!(await file.exists())) {
    console.error(`❌ Service Worker introuvable : ${SW_PATH}`);
    return false;
  }
  const content = await file.text();
  const result = computeBump(content);
  if (!result.ok) {
    console.error(`❌ --bump-sw : ${result.reason}`);
    return false;
  }

  console.log("── Service Worker (CACHE_NAME) ─────────────────────────────");
  console.log(`   fichier : ${SW_PATH}`);
  console.log(`   avant   : "${result.before}"`);
  console.log(`   après   : "${result.after}"`);

  if (!apply) {
    console.log("   mode    : DRY-RUN (aucune écriture) — relancer avec --apply");
    return true;
  }

  await Bun.write(SW_PATH, result.nextContent!);
  console.log("   écrit   : ✅ sw.js mis à jour");
  return true;
}

// ── Levier 2 : purge du cache disque G4TX (variantes) ────────────────────────
// Le cache des variantes G4TX vit normalement CÔTÉ CDN (origin séparé). On tente
// de découvrir un répertoire de cache *local* ; à défaut → no-op sûr.
const G4TX_CACHE_CANDIDATES = [
  "apps/rg-website/.cache/g4tx",
  "apps/rg-website/.g4tx-cache",
  "apps/rg-website/public/g4tx",
  "apps/rg-website/data/cache/g4tx",
  ".cache/g4tx",
];

async function discoverG4txCacheDir(): Promise<string | null> {
  for (const candidate of G4TX_CACHE_CANDIDATES) {
    const abs = resolve(REPO_ROOT, candidate);
    try {
      const stat = await Bun.file(abs).exists();
      // Bun.file(dir).exists() peut être false pour un dossier ; double-check via readdir.
      if (stat) return abs;
    } catch {
      /* ignore */
    }
    // Vérification dossier via Node fs (Bun.file ne stat pas fiablement un dir).
    try {
      const { stat: nodeStat } = await import("node:fs/promises");
      const s = await nodeStat(abs);
      if (s.isDirectory()) return abs;
    } catch {
      /* candidat absent */
    }
  }
  return null;
}

async function runPurgeG4tx(globPattern: string, apply: boolean): Promise<boolean> {
  console.log("── G4TX variant cache (disque local) ───────────────────────");
  const cacheDir = await discoverG4txCacheDir();
  if (!cacheDir) {
    console.log(
      "   g4tx cache dir not found, skipped (le cache des variantes vit côté CDN, " +
        "origin séparé — purge à effectuer là-bas).",
    );
    return true; // no-op = succès
  }

  console.log(`   répertoire : ${cacheDir}`);
  console.log(`   glob       : ${globPattern}`);

  // Énumération bornée AU SEIN du cacheDir uniquement.
  const glob = new Glob(globPattern);
  const matches: string[] = [];
  for await (const rel of glob.scan({ cwd: cacheDir, onlyFiles: true, dot: true })) {
    const abs = resolve(cacheDir, rel);
    // Garde-fou : ne JAMAIS sortir du cacheDir (anti-traversal).
    if (!abs.startsWith(cacheDir + "/")) {
      console.warn(`   ⚠️  ignoré (hors cache) : ${abs}`);
      continue;
    }
    matches.push(abs);
  }

  if (matches.length === 0) {
    console.log("   aucun fichier ne correspond — rien à purger.");
    return true;
  }

  console.log(`   ${matches.length} fichier(s) ciblé(s) :`);
  for (const m of matches.slice(0, 20)) console.log(`     - ${m}`);
  if (matches.length > 20) console.log(`     … (+${matches.length - 20} autres)`);

  if (!apply) {
    console.log("   mode       : DRY-RUN (aucune suppression) — relancer avec --apply");
    return true;
  }

  const { unlink } = await import("node:fs/promises");
  let deleted = 0;
  for (const abs of matches) {
    try {
      await unlink(abs);
      deleted++;
    } catch (err) {
      console.warn(`   ⚠️  échec suppression ${abs} : ${(err as Error).message}`);
    }
  }
  console.log(`   supprimé   : ✅ ${deleted}/${matches.length} fichier(s)`);
  return true;
}

// ── Entrée principale ────────────────────────────────────────────────────────
async function main() {
  const args = parseArgs(Bun.argv.slice(2));

  if (!args.bumpSw && args.purgeG4txGlob === null) {
    console.log(
      [
        "invalidate-cdn — invalidation bornée du cache CDN azalee/website",
        "",
        "Usage :",
        "  bun scripts/iecode/rg/invalidate-cdn.ts --bump-sw [--apply]",
        "  bun scripts/iecode/rg/invalidate-cdn.ts --purge-g4tx '<glob>' [--apply]",
        "",
        "Flags :",
        "  --bump-sw            incrémente CACHE_NAME (vN→vN+1) dans apps/rg-website/public/sw.js",
        "  --purge-g4tx <glob>  purge les variantes G4TX en cache disque local (no-op si absent)",
        "  --dry-run            défaut : affiche sans muter",
        "  --apply              exécute réellement les mutations",
      ].join("\n"),
    );
    return;
  }

  const mode = args.apply ? "APPLY (mutations réelles)" : "DRY-RUN (par défaut)";
  console.log(`▶ invalidate-cdn — mode : ${mode}\n`);

  let allOk = true;
  if (args.bumpSw) {
    allOk = (await runBumpSw(args.apply)) && allOk;
    console.log("");
  }
  if (args.purgeG4txGlob !== null) {
    allOk = (await runPurgeG4tx(args.purgeG4txGlob, args.apply)) && allOk;
    console.log("");
  }

  // Rappels hors-scope : actions manuelles côté prod (jamais automatisées ici).
  console.log("── Rappels (hors scope, à faire manuellement si nécessaire) ─");
  console.log("   • Restart/reload nginx (CDN statique) : NON exécuté par ce script.");
  console.log("   • Purge cache CDN G4TX côté origin : NON exécutée (réseau prod hors scope).");
  console.log("   • Redéploiement du frontend unifié : bun run deploy website");

  if (!allOk) process.exit(1);
}

main().catch(err => {
  console.error("❌ Erreur fatale :", err);
  process.exit(1);
});
