/**
 * @file lua-pipeline.ts
 * @description Pipeline complet : extraction strings, dictionnaire CRC32, décompilation batch
 * des 1143 scripts Lua 5.2 (.lua.bin) du jeu IEVR.
 *
 * Usage: npx tsx src/scripts/lua-pipeline.ts [--strings-only] [--decompile-only] [--skip-p2]
 */

import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { extractStrings, parseLuaBytecode } from "../../src/core/lua-bytecode.ts";
import { crc32StringHex } from "../../src/parsers/hash/crc32.ts";
import { iecodeDataRoot } from "../../src/core/roots.ts";
import { createPgClient, getInagleDatabaseURL } from "@rosegriffon/db/pg";

const DATA_ROOT = iecodeDataRoot();
const LUA_DIR = join(DATA_ROOT, "lua_scripts");
const ANALYSIS_DIR = join(LUA_DIR, "analysis");
const DECOMPILED_DIR = join(LUA_DIR, "decompiled");

// Priority patterns
const P0_PATTERNS = [
  "chara_bank_menu",
  "chara_filter_menu",
  "chara_edit_menu",
  "chara_edit_parts",
  "chara_pack_probability",
  "chara_pack_result",
  "players_universe_menu",
  "players_universe_search",
  "soccer_parameter_menu",
  "sp_tactics",
  "training_parameter",
  "ability_learning_board",
  "ability_list",
  "rpg_select_scout",
  "datafile_menu_category_chara",
  "shop_menu_buy",
  "soccer_summon_menu",
  "player_status_menu",
  "rpg_battle_training_chara_card",
  "medal_dict",
  "rarity_up_check",
];

const P1_PATTERNS = [
  "soccer_",
  "rpg_battle_",
  "team_dock_",
  "equip_",
  "inventory_",
  "soccer_team_",
  "enjoy_team_select",
  "select_first_team",
  "vs_route_town",
];

const MIN_FILE_SIZE = 200; // Skip stubs < 200 bytes

// ─── Helpers ────────────────────────────────────────────────

function ensureDir(dir: string) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function getFileList(): string[] {
  return readdirSync(LUA_DIR)
    .filter(f => f.endsWith(".lua.bin"))
    .filter(f => statSync(join(LUA_DIR, f)).size >= MIN_FILE_SIZE);
}

function getPriority(filename: string): "p0" | "p1" | "p2" {
  const lower = filename.toLowerCase();
  if (P0_PATTERNS.some(p => lower.includes(p))) return "p0";
  if (P1_PATTERNS.some(p => lower.startsWith(p))) return "p1";
  return "p2";
}

// ─── Étape 1 : Extraction strings ──────────────────────────

function extractAllStrings(files: string[]): Record<string, string[]> {
  console.log(`\n═══ Étape 1 : Extraction strings (${files.length} fichiers) ═══\n`);
  const result: Record<string, string[]> = {};
  let ok = 0,
    fail = 0;

  for (const file of files) {
    const key = basename(file, ".lua.bin");
    try {
      const buf = readFileSync(join(LUA_DIR, file));
      const bytecode = parseLuaBytecode(new Uint8Array(buf));
      const strings = extractStrings(bytecode);
      result[key] = strings;
      ok++;
    } catch {
      // Fallback: rz-bin strings
      try {
        const raw = execSync(`rz-bin -z "${join(LUA_DIR, file)}" 2>/dev/null`, {
          encoding: "utf-8",
          timeout: 5000,
        });
        const strings = raw
          .split("\n")
          .filter(l => l.includes("ascii") || l.includes("utf"))
          .map(l => l.split(/\s+/).pop()!)
          .filter(Boolean);
        result[key] = strings;
        ok++;
      } catch {
        result[key] = [];
        fail++;
      }
    }
  }

  console.log(`  ✓ ${ok} fichiers parsés, ${fail} échecs`);
  return result;
}

// ─── Étape 2 : Dictionnaire CRC32 ──────────────────────────

function buildCrc32Dictionary(allStrings: Record<string, string[]>): Record<string, string> {
  console.log(`\n═══ Étape 2 : Construction dictionnaire CRC32 ═══\n`);
  const dict: Record<string, string> = {};
  const uniqueStrings = new Set<string>();

  // Collect all unique strings from Lua scripts
  for (const strings of Object.values(allStrings)) {
    for (const s of strings) {
      if (s && s.length > 1 && s.length < 200) uniqueStrings.add(s);
    }
  }

  // Add Ghidra strings if available
  const ghidraStringsPath = process.env.GHIDRA_STRINGS_PATH;
  if (ghidraStringsPath && existsSync(resolve(ghidraStringsPath))) {
    try {
      const ghidraData = JSON.parse(readFileSync(resolve(ghidraStringsPath), "utf-8"));
      const ghidraStrings: string[] = Array.isArray(ghidraData)
        ? ghidraData.map((s: any) => s.value || s.string || s).filter((s: any) => typeof s === "string")
        : (Object.values(ghidraData)
            .flat()
            .filter((s: any) => typeof s === "string") as string[]);
      for (const s of ghidraStrings) {
        if (s && s.length > 1 && s.length < 200) uniqueStrings.add(s);
      }
      console.log(`  + ${ghidraStrings.length} strings Ghidra ajoutées`);
    } catch {
      /* ignore */
    }
  }

  console.log(`  ${uniqueStrings.size} strings uniques collectées`);

  // Compute CRC32 for each
  for (const str of uniqueStrings) {
    const hex = crc32StringHex(str);
    // Keep shorter/more readable name if collision
    if (!dict[hex] || str.length < dict[hex].length) {
      dict[hex] = str;
    }
  }

  console.log(`  ✓ ${Object.keys(dict).length} entrées CRC32`);
  return dict;
}

// ─── Étape 3 : Décompilation batch ─────────────────────────

interface DecompileResult {
  file: string;
  priority: string;
  status: "ok" | "partial" | "strings-only" | "skip";
  lines: number;
  error?: string;
}

function decompileBatch(files: string[], skipP2: boolean): DecompileResult[] {
  console.log(`\n═══ Étape 3 : Décompilation batch ═══\n`);
  const results: DecompileResult[] = [];
  const counts = { ok: 0, partial: 0, stringsOnly: 0, skip: 0 };

  // Sort by priority
  const sorted = files
    .map(f => ({ file: f, priority: getPriority(f) }))
    .sort((a, b) => {
      const order = { p0: 0, p1: 1, p2: 2 };
      return order[a.priority] - order[b.priority];
    });

  for (const { file, priority } of sorted) {
    const key = basename(file, ".lua.bin");
    const outDir = join(
      DECOMPILED_DIR,
      `${priority}-${priority === "p0" ? "critical" : priority === "p1" ? "gameplay" : "other"}`,
    );
    const outPath = join(outDir, `${key}.lua`);

    if (skipP2 && priority === "p2") {
      results.push({ file, priority, status: "skip", lines: 0 });
      counts.skip++;
      continue;
    }

    const srcPath = join(LUA_DIR, file);

    // P0/P1: full decompile with luadec-all
    if (priority === "p0" || priority === "p1") {
      try {
        execSync(`luadec-all "${srcPath}" "${outPath}" 2>/dev/null`, { timeout: 30000 });
        const lines = readFileSync(outPath, "utf-8").split("\n").length;
        if (lines > 10) {
          results.push({ file, priority, status: "ok", lines });
          counts.ok++;
          process.stdout.write(`  ✓ ${key} (${priority}, ${lines} lines)\n`);
          continue;
        }
      } catch {
        /* fallthrough */
      }
    }

    // P2 or fallback: unluac only (faster, partial)
    try {
      const output = execSync(`unluac "${srcPath}" 2>/dev/null`, {
        encoding: "utf-8",
        timeout: 15000,
      });
      // Remove crash stacktraces from output
      const clean = output
        .split("\n")
        .filter(l => !l.includes("Exception in thread") && !l.includes("\tat "))
        .join("\n");
      if (clean.trim().length > 50) {
        writeFileSync(outPath, clean);
        const lines = clean.split("\n").length;
        results.push({ file, priority, status: "partial", lines });
        counts.partial++;
        continue;
      }
    } catch {
      /* fallthrough */
    }

    // Last resort: strings only
    results.push({ file, priority, status: "strings-only", lines: 0 });
    counts.stringsOnly++;
  }

  console.log(`\n  Résultats :`);
  console.log(`    ✓ Complet     : ${counts.ok}`);
  console.log(`    ~ Partiel     : ${counts.partial}`);
  console.log(`    ○ Strings only: ${counts.stringsOnly}`);
  console.log(`    - Ignoré (P2) : ${counts.skip}`);

  return results;
}

// ─── Étape 4 : Résolution skills ────────────────────────────

async function resolveSkills(
  crc32Dict: Record<string, string>,
): Promise<{ resolved: Record<string, string>; unresolved: string[] }> {
  console.log(`\n═══ Étape 4 : Résolution des skills manquants ═══\n`);

  // Get unresolved skill IDs from DB
  let unresolvedIds: string[] = [];
  try {
    const client = createPgClient(getInagleDatabaseURL());
    try {
      await client.connect();
      const { rows } = await client.query<{ skill_id: string }>(`
				WITH char_skills AS (
					SELECT DISTINCT jsonb_array_elements(skills)->>'skillId' as skill_id
					FROM inagle_characters WHERE skills IS NOT NULL AND skills::text != '[]'
				)
				SELECT cs.skill_id FROM char_skills cs
				LEFT JOIN inagle_skills s ON s.id = cs.skill_id OR s.internal_code = cs.skill_id OR s.sheet_data->>'skillID' = cs.skill_id
				WHERE s.id IS NULL AND cs.skill_id NOT LIKE '0x0000000%'
      `);
      unresolvedIds = rows.map(row => row.skill_id);
    } finally {
      await client.end();
    }
  } catch {
    console.log("  ⚠ Impossible de requêter la DB, skip résolution skills");
    return { resolved: {}, unresolved: [] };
  }

  console.log(`  ${unresolvedIds.length} skill IDs non résolus`);

  const resolved: Record<string, string> = {};
  for (const id of unresolvedIds) {
    if (crc32Dict[id]) {
      resolved[id] = crc32Dict[id];
    }
  }

  const unresolved = unresolvedIds.filter(id => !resolved[id]);
  console.log(`  ✓ ${Object.keys(resolved).length} résolus via CRC32`);
  console.log(`  ✗ ${unresolved.length} toujours non résolus`);

  return { resolved, unresolved };
}

// ─── Main ───────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const stringsOnly = args.includes("--strings-only");
  const decompileOnly = args.includes("--decompile-only");
  const skipP2 = args.includes("--skip-p2");

  console.log("═══════════════════════════════════════════════════");
  console.log("  IEVR Lua Pipeline — Extraction & Analyse");
  console.log("═══════════════════════════════════════════════════");

  ensureDir(ANALYSIS_DIR);
  ensureDir(join(DECOMPILED_DIR, "p0-critical"));
  ensureDir(join(DECOMPILED_DIR, "p1-gameplay"));
  ensureDir(join(DECOMPILED_DIR, "p2-other"));

  const files = getFileList();
  console.log(`\n${files.length} fichiers .lua.bin (>= ${MIN_FILE_SIZE} bytes)`);
  const byPrio = { p0: 0, p1: 0, p2: 0 };
  for (const f of files) byPrio[getPriority(f)]++;
  console.log(`  P0 (critical): ${byPrio.p0} | P1 (gameplay): ${byPrio.p1} | P2 (other): ${byPrio.p2}`);

  // ── Étape 1 : Strings ──
  let allStrings: Record<string, string[]>;
  const stringsPath = join(ANALYSIS_DIR, "all-strings.json");
  if (decompileOnly && existsSync(stringsPath)) {
    allStrings = JSON.parse(readFileSync(stringsPath, "utf-8"));
    console.log(`\n(Strings chargées depuis cache: ${Object.keys(allStrings).length} fichiers)`);
  } else {
    allStrings = extractAllStrings(files);
    writeFileSync(stringsPath, JSON.stringify(allStrings, null, 2));
    console.log(`  → ${stringsPath}`);
  }

  if (stringsOnly) {
    console.log("\n--strings-only: terminé.");
    return;
  }

  // ── Étape 2 : CRC32 ──
  const crc32Dict = buildCrc32Dictionary(allStrings);
  const dictPath = join(ANALYSIS_DIR, "crc32-dictionary.json");
  writeFileSync(dictPath, JSON.stringify(crc32Dict, null, 2));
  console.log(`  → ${dictPath}`);

  // ── Étape 3 : Décompilation ──
  const decompileResults = decompileBatch(files, skipP2);
  const errorsPath = join(ANALYSIS_DIR, "decompile-errors.json");
  const errors = decompileResults.filter(r => r.status === "strings-only");
  writeFileSync(errorsPath, JSON.stringify(errors, null, 2));

  // ── Étape 4 : Skills ──
  const skillsResult = await resolveSkills(crc32Dict);
  writeFileSync(join(ANALYSIS_DIR, "resolved-skills.json"), JSON.stringify(skillsResult, null, 2));

  // ── Étape 5 : Rapport ──
  const totalStrings = Object.values(allStrings).reduce((sum, arr) => sum + arr.length, 0);
  const decompStats = {
    ok: decompileResults.filter(r => r.status === "ok").length,
    partial: decompileResults.filter(r => r.status === "partial").length,
    stringsOnly: decompileResults.filter(r => r.status === "strings-only").length,
    skip: decompileResults.filter(r => r.status === "skip").length,
  };

  const report = `# Rapport d'analyse Lua IEVR

Généré le ${new Date().toISOString().split("T")[0]}

## Statistiques

| Métrique | Valeur |
|---|---|
| Fichiers .lua.bin | ${files.length} |
| Stubs ignorés (<${MIN_FILE_SIZE}B) | ${readdirSync(LUA_DIR).filter(f => f.endsWith(".lua.bin")).length - files.length} |
| Strings extraites | ${totalStrings.toLocaleString("fr-FR")} |
| Strings uniques | ${Object.keys(crc32Dict).length > 0 ? `~${new Set(Object.values(allStrings).flat()).size}` : "?"} |
| Entrées CRC32 | ${Object.keys(crc32Dict).length.toLocaleString("fr-FR")} |

## Décompilation

| Status | Count |
|---|---|
| Complet (luadec-all) | ${decompStats.ok} |
| Partiel (unluac) | ${decompStats.partial} |
| Strings uniquement | ${decompStats.stringsOnly} |
| Ignoré (P2 skip) | ${decompStats.skip} |
| **Taux de succès** | **${Math.round(((decompStats.ok + decompStats.partial) / (files.length - decompStats.skip)) * 100)}%** |

## Résolution skills

| Métrique | Valeur |
|---|---|
| Skills non résolus (entrée) | ${skillsResult.resolved ? Object.keys(skillsResult.resolved).length + skillsResult.unresolved.length : "N/A"} |
| Résolus via CRC32 | ${Object.keys(skillsResult.resolved || {}).length} |
| Toujours non résolus | ${(skillsResult.unresolved || []).length} |

## Fichiers P0 (critiques) décompilés

${
  decompileResults
    .filter(r => r.priority === "p0" && r.status === "ok")
    .map(r => `- \`${basename(r.file, ".lua.bin")}\` — ${r.lines} lignes`)
    .join("\n") || "Aucun"
}
`;

  writeFileSync(join(ANALYSIS_DIR, "REPORT.md"), report);

  console.log("\n═══════════════════════════════════════════════════");
  console.log("  Pipeline terminé !");
  console.log("═══════════════════════════════════════════════════");
  console.log(`  Strings   : ${totalStrings.toLocaleString("fr-FR")} extraites`);
  console.log(`  CRC32     : ${Object.keys(crc32Dict).length.toLocaleString("fr-FR")} entrées`);
  console.log(`  Décompilés: ${decompStats.ok + decompStats.partial}/${files.length - decompStats.skip}`);
  console.log(`  Skills    : ${Object.keys(skillsResult.resolved || {}).length} résolus`);
  console.log(`  Output    : ${ANALYSIS_DIR}`);
}

main().catch(console.error);
