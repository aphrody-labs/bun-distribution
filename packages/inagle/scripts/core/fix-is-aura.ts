/**
 * Ajoute et peuple la colonne is_aura dans inagle_skills.
 * is_aura = true si le skillID du skill est référencé dans aura_skill_config (vars[6] ou vars[7]).
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const DB = new Bun.SQL("postgres://postgres:***REMOVED***@127.0.0.1:54330/postgres");

function toHex(value: string): string {
  const n = parseInt(value, 10);
  const u = n >>> 0;
  return `0x${u.toString(16).toUpperCase().padStart(8, "0")}`;
}

// Extraire les hashes de skills liés aux auras depuis aura_skill_config
function getAuraSkillHashes(): Set<string> {
  const path = resolve(import.meta.dir, "../../data/common/gamedata/skill/aura_skill_config_1.04.09.00.cfg.bin.json");
  if (!existsSync(path)) return new Set();
  const data = JSON.parse(readFileSync(path, "utf-8"));
  const hashes = new Set<string>();

  function traverse(nodes: any[]) {
    for (const n of nodes) {
      if (n.name === "AURA_CMD_INFO_LIST_BEG_0" && n.children) {
        for (const c of n.children) {
          if (c.name.startsWith("AURA_CMD_INFO_") && !c.name.includes("REF_")) {
            const vars = c.variables;
            // vars[6] = skillId1, vars[7] = skillId2
            if (vars[6]?.type === "Int") {
              const h = toHex(vars[6].value);
              if (h !== "0x00000000") hashes.add(h);
            }
            if (vars[7]?.type === "Int") {
              const h = toHex(vars[7].value);
              if (h !== "0x00000000") hashes.add(h);
            }
          }
        }
      }
      if (n.children) traverse(n.children);
    }
  }

  traverse(data.entries);
  return hashes;
}

async function main() {
  console.log("Connexion à la DB...");

  // 1. Ajouter la colonne is_aura si elle n'existe pas
  await DB.query(`
    ALTER TABLE inagle_skills
    ADD COLUMN IF NOT EXISTS is_aura boolean NOT NULL DEFAULT false;
  `);
  console.log("Colonne is_aura ajoutée (ou déjà existante).");

  // 2. Extraire les hashes des skills d'aura
  const auraHashes = getAuraSkillHashes();
  console.log(`Hashes aura extraits : ${auraHashes.size}`);

  // 3. Récupérer tous les skills avec leur skillID depuis data
  const rows = await DB.query<{ id: string; skill_id: string }>(
    `SELECT id, data->>'skillID' AS skill_id FROM inagle_skills WHERE data->>'skillID' IS NOT NULL`,
  );
  console.log(`Skills avec skillID : ${rows.length}`);

  // 4. Identifier les is_aura = true
  const auraSkillIds: string[] = [];
  const normalSkillIds: string[] = [];

  for (const row of rows) {
    if (auraHashes.has(row.skill_id)) {
      auraSkillIds.push(row.id);
    } else {
      normalSkillIds.push(row.id);
    }
  }

  console.log(`Skills d'aura identifiés : ${auraSkillIds.length}`);
  console.log(`Skills normaux : ${normalSkillIds.length}`);

  // 5. Mettre à jour is_aura = true
  if (auraSkillIds.length > 0) {
    const placeholders = auraSkillIds.map((_, i) => `$${i + 1}`).join(", ");
    await DB.query(`UPDATE inagle_skills SET is_aura = true WHERE id IN (${placeholders})`, auraSkillIds);
    console.log(`${auraSkillIds.length} skills marqués is_aura = true`);
  }

  // 6. Remettre is_aura = false pour les non-aura (en cas de re-run)
  if (normalSkillIds.length > 0) {
    const placeholders = normalSkillIds.map((_, i) => `$${i + 1}`).join(", ");
    await DB.query(`UPDATE inagle_skills SET is_aura = false WHERE id IN (${placeholders})`, normalSkillIds);
  }

  // 7. Vérification
  const stats = await DB.query<{ is_aura: boolean; count: string }>(
    `SELECT is_aura, COUNT(*) as count FROM inagle_skills GROUP BY is_aura`,
  );
  console.log("\nRépartition finale :");
  for (const s of stats) {
    console.log(`  is_aura=${s.is_aura} : ${s.count} skills`);
  }

  await DB.close();
}

main().catch(console.error);
