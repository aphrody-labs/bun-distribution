/**
 * Génère un glossaire Inazuma Eleven depuis les données inagle.
 *
 * Parse tous les textes FR du jeu via les APIs existantes et produit :
 * - Un fichier Markdown condensé pour injection dans CLAUDE.md / agent
 * - Noms de personnages, techniques, items, équipes, lieux, descriptions
 *
 * Usage: npx tsx src/scripts/generate-glossary.ts
 */

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { DATA_ROOT } from "../../src/core/paths.ts";
import { createInagleService } from "../../src/service.ts";

async function main() {
  console.log("Chargement du service inagle...");
  const svc = await createInagleService();

  // ─── Personnages ─────────────────────────────────────────────────
  const chars = svc.characters.all() as any[];
  const charaNames = new Set<string>();
  const charaDescriptions: string[] = [];

  for (const c of chars) {
    if (c.names?.fr) charaNames.add(c.names.fr);
    if (c.descriptions?.fr) {
      const desc = c.descriptions.fr.replace(/\\n/g, " ").trim();
      if (desc.length > 20 && desc.length < 200) charaDescriptions.push(desc);
    }
  }

  // ─── Techniques ──────────────────────────────────────────────────
  const skills = svc.skills.moves() as any[];
  const skillNames = new Map<string, string>(); // nom → catégorie
  const skillDescriptions: string[] = [];
  const catNames: Record<number, string> = {
    1: "Tir",
    2: "Dribble",
    3: "Bloc",
    4: "Arrêt",
    5: "Spécial",
  };

  for (const sk of skills) {
    const name = sk.name_FR || sk.displayName;
    if (name) {
      const cat = typeof sk.category === "object" ? sk.category?.fr : catNames[sk.category] || "?";
      skillNames.set(name, cat);
    }
    if (sk.desc_FR) {
      const desc = sk.desc_FR.replace(/\\n/g, " ").trim();
      if (desc.length > 20 && desc.length < 300) skillDescriptions.push(desc);
    }
  }

  // ─── Auras ───────────────────────────────────────────────────────
  const auras = svc.skills.auraAll() as any[];
  const auraNames = new Map<string, string>(); // nom → subType label

  const subTypeLabels: Record<string, string> = {
    Keshin: "Esprit Guerrier",
    Soul: "Totem",
    Awakening: "Éveil",
    ModeChange: "Mode",
    Miximax: "Miximax",
    Aura: "Aura",
  };

  for (const a of auras) {
    if (a.name_FR) auraNames.set(a.name_FR, subTypeLabels[a.subType] || "Aura");
  }

  // ─── Passifs ─���───────────────────────────────────────────────────
  const passives = svc.skills.passiveAll() as any[];
  const passiveNames: string[] = [];
  for (const p of passives) {
    const name = (p as any).name_FR || (p as any).displayName;
    if (name) passiveNames.push(name);
  }

  // ─── Équipes ─────────────────────────────────────────────────────
  const teams = svc.teams.allTeams() as any[];
  const teamNames: string[] = [];
  for (const t of teams) {
    if (t.name_FR) teamNames.push(t.name_FR);
  }

  // ─── Items ───────────────────────────────────────────────────────
  const items = svc.items.allItems() as any[];
  const itemNames: string[] = [];
  for (const i of items) {
    const name = i.names?.fr || i.name;
    if (name && !name.includes("<CHARA_NAME>")) itemNames.push(name);
  }

  // ─── Générer le glossaire ────────────────────────────────────────
  const glossary: Record<string, any> = {
    _meta: {
      generatedAt: new Date().toISOString(),
      source: "inagle MCP — données IEVR",
      totalEntries:
        charaNames.size +
        skillNames.size +
        auraNames.size +
        passiveNames.length +
        teamNames.length +
        itemNames.length,
    },
    terminologie: {
      "Super Technique":
        "Technique spéciale (Hissatsu en JP). Catégories : Tir, Dribble, Bloc, Arrêt, Spécial.",
      "Esprit Guerrier":
        "Keshin (化身) — avatar spirituel invoqué par un joueur. Augmente les stats.",
      Totem: "Soul (ソウル) — esprit animal qui booste le joueur.",
      Éveil: "Awakening — transformation qui débloque de nouvelles capacités.",
      Mode: "Mode Change — changement de style de jeu.",
      Miximax: "Fusion temporaire avec l'esprit d'un autre joueur.",
      Tension: "Jauge d'énergie consommée par les Super Techniques (pas TP, pas mana).",
      "Feu (火)": "Élément 1 — fort contre Forêt, faible contre Montagne.",
      "Forêt (林)": "Élément 2 — fort contre Vent, faible contre Feu.",
      "Vent (風)": "Élément 3 — fort contre Montagne, faible contre Forêt.",
      "Montagne (山)": "Élément 4 — fort contre Feu, faible contre Vent.",
      "Gardien (GK)": "Goalkeeper — dernière ligne de défense.",
      "Défenseur (DF)": "Protège la zone arrière, intercepte les attaques.",
      "Milieu (MF)": "Midfielder — lien entre défense et attaque.",
      "Attaquant (FW)": "Forward — marque les buts.",
    },
    personnages: {
      total: charaNames.size,
      noms: [...charaNames].sort().slice(0, 500),
      descriptions_exemples: charaDescriptions.slice(0, 50),
    },
    techniques: {
      total: skillNames.size,
      parCategorie: {} as Record<string, string[]>,
      descriptions_exemples: skillDescriptions.slice(0, 50),
    },
    auras: {
      total: auraNames.size,
      parType: {} as Record<string, string[]>,
    },
    passifs: { total: passiveNames.length, noms: passiveNames.sort().slice(0, 100) },
    equipes: { total: teamNames.length, noms: teamNames.sort() },
    items: { total: itemNames.length, noms: itemNames.sort().slice(0, 200) },
  };

  // Group skills by category
  for (const [name, cat] of skillNames) {
    if (!glossary.techniques.parCategorie[cat]) glossary.techniques.parCategorie[cat] = [];
    glossary.techniques.parCategorie[cat].push(name);
  }
  for (const cat of Object.keys(glossary.techniques.parCategorie)) {
    glossary.techniques.parCategorie[cat].sort();
  }

  // Group auras by subtype
  for (const [name, type] of auraNames) {
    if (!glossary.auras.parType[type]) glossary.auras.parType[type] = [];
    glossary.auras.parType[type].push(name);
  }

  // ─── Écrire les fichiers ───��─────────────────────────────────────
  const outDir = join(DATA_ROOT, "glossary");
  const { mkdirSync } = await import("node:fs");
  mkdirSync(outDir, { recursive: true });

  // Markdown condensé pour CLAUDE.md / agent system prompt
  const md = [
    "# Glossaire Inazuma Eleven: Victory Road",
    "",
    "## Terminologie officielle française",
    "",
    ...Object.entries(glossary.terminologie).map(([k, v]) => `- **${k}** : ${v}`),
    "",
    `## Personnages (${charaNames.size})`,
    "",
    [...charaNames].sort().slice(0, 200).join(", "),
    "",
    `## Super Techniques (${skillNames.size})`,
    "",
    ...Object.entries(glossary.techniques.parCategorie).map(
      ([cat, names]) =>
        `### ${cat} (${(names as string[]).length})\n${(names as string[]).slice(0, 40).join(", ")}`,
    ),
    "",
    `## Esprits Guerriers / Totems / Éveils (${auraNames.size})`,
    "",
    ...Object.entries(glossary.auras.parType).map(
      ([type, names]) =>
        `### ${type} (${(names as string[]).length})\n${(names as string[]).join(", ")}`,
    ),
    "",
    `## Équipes (${teamNames.length})`,
    "",
    teamNames.sort().join(", "),
    "",
    `## Exemples de descriptions de personnages`,
    "",
    ...charaDescriptions.slice(0, 20).map((d) => `> ${d}`),
    "",
    `## Exemples de descriptions de techniques`,
    "",
    ...skillDescriptions.slice(0, 20).map((d) => `> ${d}`),
  ].join("\n");

  const mdPath = join(outDir, "inazuma-glossary.md");
  writeFileSync(mdPath, md);
  console.log(`Glossaire Markdown : ${mdPath}`);

  // Stats
  console.log("\n=== RÉSUMÉ ===");
  console.log(`Personnages : ${charaNames.size}`);
  console.log(`Techniques  : ${skillNames.size}`);
  console.log(`Auras       : ${auraNames.size}`);
  console.log(`Passifs     : ${passiveNames.length}`);
  console.log(`Équipes     : ${teamNames.length}`);
  console.log(`Items       : ${itemNames.length}`);
  console.log(`TOTAL       : ${glossary._meta.totalEntries}`);
}

main().catch(console.error);
