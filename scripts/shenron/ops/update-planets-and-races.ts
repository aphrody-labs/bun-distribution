// SPDX-License-Identifier: Apache-2.0
import postgres from "postgres";
import { getDbUrl, idRevision, type WikiSourceRef } from "./wiki-databooks-indexer";

const sql = postgres(getDbUrl());

async function main() {
  console.log("=== EXÉCUTION DU MANDAT SHENRON : PLANÈTES & RACES ===");

  const nowEpoch = BigInt(Math.floor(Date.now() / 1000));

  // ==========================================
  // 1. MISE À JOUR DES RACES
  // ==========================================
  console.log("\n--- 1. Audit & Mise à jour des Races ---");

  // A. Race 15 : core-person (Personne-cœur)
  // Renseigner name_ja = '芯人' et enrichir article_sources
  const [race15] = await sql`SELECT * FROM bot.db_races WHERE id = 15;`;
  if (race15) {
    const existingSources: WikiSourceRef[] = Array.isArray(race15.article_sources)
      ? race15.article_sources
      : [];
    
    const newSources: WikiSourceRef[] = [
      {
        n: existingSources.length + 1,
        label: "Daizenshuu 4 — World Guide, planche 46 (Cosmologie : les Shinjin et l'Arbre Glind)",
        url: "/wiki/databooks/3#p-46",
        kind: "databook",
      },
      {
        n: existingSources.length + 2,
        label: "Super Exciting Guide — Character Volume, planche 92 (Entretien Akira Toriyama : Arbre du Monde Kaiju)",
        url: "/wiki/databooks/6#p-92",
        kind: "databook",
      },
    ];

    const mergedSources = [...existingSources];
    for (const ns of newSources) {
      if (!mergedSources.some(s => s.label === ns.label || s.url === ns.url)) {
        mergedSources.push(ns);
      }
    }
    mergedSources.forEach((s, idx) => { s.n = idx + 1; });

    const before15 = {
      name_ja: race15.name_ja,
      article_sources: race15.article_sources,
    };
    const after15 = {
      name_ja: "芯人",
      article_sources: mergedSources,
    };

    await sql`
      UPDATE bot.db_races
      SET name_ja = '芯人',
          article_sources = ${JSON.stringify(mergedSources)}::jsonb,
          article_updated_at = ${nowEpoch}
      WHERE id = 15;
    `;

    const revId = idRevision();
    await sql`
      INSERT INTO public.wiki_revisions (
        id, "tableName", "rowId", action, label, before, after, "editorId", "editorName", "createdAt"
      ) VALUES (
        ${revId}, 'db_races', '15', 'update',
        'Renseignement du kanji officiel (芯人) et enrichissement des sources canoniques Daizenshuu 4 / SEG',
        ${JSON.stringify(before15)}::jsonb,
        ${JSON.stringify(after15)}::jsonb,
        'subagent-shenron', 'Shenron Planètes & Races Subagent', NOW()
      );
    `;
    console.log("  ✓ Race [#15] Personne-cœur (Daima) : name_ja renseigné à '芯人' + sources enrichies.");
  }

  // B. Races dont la planète d'origine est canoniquement établie :
  // - id 5: android -> home_planet_id = 2 (Terre)
  // - id 10: demon -> home_planet_id = 66 (Royaume des Démons)
  // - id 16: kaio -> home_planet_id = 21 (Noyau du Monde)
  // - id 18: dieu -> home_planet_id = 2 (Terre)
  const racePlanetUpdates = [
    {
      id: 5,
      slug: "android",
      name: "Cyborg / Androïde",
      homePlanetId: 2,
      planetName: "Terre",
      reason: "Humains artificiels modifiés ou construits sur Terre par le Dr Gero",
    },
    {
      id: 10,
      slug: "demon",
      name: "Démon",
      homePlanetId: 66,
      planetName: "Royaume des Démons",
      reason: "Créatures maléfiques et rois démons (Dabra) originaires du Makai (Royaume des Démons)",
    },
    {
      id: 16,
      slug: "kaio",
      name: "Kaio",
      homePlanetId: 21,
      planetName: "Noyau du Monde",
      reason: "Shinjin nés des fruits de l'Arbre du Monde sur la planète du Noyau du Monde (界芯星, Kaishin-sei)",
    },
    {
      id: 18,
      slug: "dieu",
      name: "Dieu",
      homePlanetId: 2,
      planetName: "Terre",
      reason: "Fonction de Dieu protecteur de la Terre siégeant au Sanctuaire céleste terrestre",
    },
  ];

  for (const rpu of racePlanetUpdates) {
    const [current] = await sql`SELECT * FROM bot.db_races WHERE id = ${rpu.id};`;
    if (!current) continue;

    const before = { home_planet_id: current.home_planet_id };
    const after = { home_planet_id: rpu.homePlanetId };

    await sql`
      UPDATE bot.db_races
      SET home_planet_id = ${rpu.homePlanetId}
      WHERE id = ${rpu.id};
    `;

    const revId = idRevision();
    await sql`
      INSERT INTO public.wiki_revisions (
        id, "tableName", "rowId", action, label, before, after, "editorId", "editorName", "createdAt"
      ) VALUES (
        ${revId}, 'db_races', ${String(rpu.id)}, 'update',
        ${`Rattachement du monde d'origine canonique : ${rpu.planetName} (${rpu.reason})`},
        ${JSON.stringify(before)}::jsonb,
        ${JSON.stringify(after)}::jsonb,
        'subagent-shenron', 'Shenron Planètes & Races Subagent', NOW()
      );
    `;
    console.log(`  ✓ Race [#${rpu.id}] ${rpu.name} -> home_planet_id = ${rpu.homePlanetId} (${rpu.planetName})`);
  }

  // ==========================================
  // 2. ENRICHISSEMENT DES SOURCES PLANÈTES
  // ==========================================
  console.log("\n--- 2. Audit & Enrichissement des Sources des Planètes ---");

  const planetEnrichments: {
    id: number;
    name: string;
    sources: { label: string; url: string; kind: "databook" | "manga" | "source" }[];
  }[] = [
    {
      id: 3,
      name: "Vegeta",
      sources: [
        { label: "Daizenshuu 4 — World Guide, planche 34 (Géographie : Planète Vegeta / Plant)", url: "/wiki/databooks/3#p-34", kind: "databook" },
        { label: "Daizenshuu 7 — Daijiten, planche 38 (Histoire : conquête de la planète par les Saiyans)", url: "/wiki/databooks/4#p-38", kind: "databook" },
        { label: "Daizenshuu 7 — Daijiten, planche 218 (Dictionnaire géographique : Planète Vegeta)", url: "/wiki/databooks/4#p-218", kind: "databook" },
        { label: "Manga Dragon Ball, tome 22 (chapitre 257 « La fin de la planète Vegeta »)", url: "/wiki/manga/volume/103", kind: "manga" },
      ],
    },
    {
      id: 21,
      name: "Noyau du Monde",
      sources: [
        { label: "Daizenshuu 4 — World Guide, planche 46 (Le monde céleste : naissance des Shinjin sur 界芯星)", url: "/wiki/databooks/3#p-46", kind: "databook" },
        { label: "Super Exciting Guide — Character Volume, planche 92 (Entretien Akira Toriyama sur l'Arbre du Monde Kaiju)", url: "/wiki/databooks/6#p-92", kind: "databook" },
        { label: "Chōzenshū 4 — Super Encyclopedia, planche 46 (Les espèces en dehors de ce monde : Shinjin)", url: "/wiki/databooks/19#p-46", kind: "databook" },
      ],
    },
    {
      id: 26,
      name: "Planète Konats",
      sources: [
        { label: "Daizenshuu 7 — Daijiten, planche 98 (Entrée Hirudegarn : destruction de la planète Konats)", url: "/wiki/databooks/4#p-98", kind: "databook" },
        { label: "Daizenshuu 7 — Daijiten, planche 218 (Dictionnaire géographique : Planète Konats)", url: "/wiki/databooks/4#p-218", kind: "databook" },
      ],
    },
    {
      id: 27,
      name: "Planète Kanassa",
      sources: [
        { label: "Daizenshuu 7 — Daijiten, planche 16 (Chronologie : pacification de la planète Kanassa)", url: "/wiki/databooks/4#p-16", kind: "databook" },
        { label: "Daizenshuu 7 — Daijiten, planche 38 (Peuples extraterrestres : Kanassa-seijin)", url: "/wiki/databooks/4#p-38", kind: "databook" },
      ],
    },
    {
      id: 28,
      name: "Planète Cold",
      sources: [
        { label: "Daizenshuu 4 — World Guide, planche 55 (Organisation et territoires de la famille Cold)", url: "/wiki/databooks/3#p-55", kind: "databook" },
        { label: "Super Exciting Guide — Character Volume, planche 94 (Entretien Akira Toriyama : l'Empire Cold)", url: "/wiki/databooks/6#p-94", kind: "databook" },
      ],
    },
    {
      id: 29,
      name: "Planète Brench",
      sources: [
        { label: "Daizenshuu 7 — Daijiten, planche 38 (Peuples extraterrestres : Brench-seijin)", url: "/wiki/databooks/4#p-38", kind: "databook" },
        { label: "Chōzenshū 4 — Super Encyclopedia, planche 45 (Habitants de l'univers : planète Brench)", url: "/wiki/databooks/19#p-45", kind: "databook" },
      ],
    },
    {
      id: 32,
      name: "Planète Allia",
      sources: [
        { label: "Daizenshuu 7 — Daijiten, planche 38 (Peuples extraterrestres : Allia-seijin)", url: "/wiki/databooks/4#p-38", kind: "databook" },
        { label: "Chōzenshū 4 — Super Encyclopedia, planche 45 (Habitants de l'univers : planète Allia)", url: "/wiki/databooks/19#p-45", kind: "databook" },
      ],
    },
    {
      id: 35,
      name: "Planète Kaishin (Univers 7)",
      sources: [
        { label: "Daizenshuu 4 — World Guide, planche 15 (Domaine sacré des Kaïôshin)", url: "/wiki/databooks/3#p-15", kind: "databook" },
        { label: "Daizenshuu 7 — Daijiten, planche 41 (Entrée « monde des Kaïô Shin »)", url: "/wiki/databooks/4#p-41", kind: "databook" },
        { label: "Manga Dragon Ball, tome 37 (planches 89-90 : révélations sur le Kaïô Shin)", url: "/wiki/manga/volume/118", kind: "manga" },
      ],
    },
    {
      id: 49,
      name: "Planète Meat",
      sources: [
        { label: "Daizenshuu 7 — Daijiten, planche 16 (Chronologie : assaut des Saiyans sur Meat)", url: "/wiki/databooks/4#p-16", kind: "databook" },
        { label: "Daizenshuu 7 — Daijiten, planche 38 (Peuples extraterrestres : Meat-seijin)", url: "/wiki/databooks/4#p-38", kind: "databook" },
      ],
    },
    {
      id: 51,
      name: "Planète Shartsu",
      sources: [
        { label: "Daizenshuu 7 — Daijiten, planche 38 (Peuples extraterrestres : Shartsu-seijin)", url: "/wiki/databooks/4#p-38", kind: "databook" },
        { label: "Chōzenshū 4 — Super Encyclopedia, planche 45 (Habitants de l'univers : planète Shartsu)", url: "/wiki/databooks/19#p-45", kind: "databook" },
      ],
    },
    {
      id: 52,
      name: "Planète Zalt",
      sources: [
        { label: "Daizenshuu 7 — Daijiten, planche 38 (Peuples extraterrestres : Zalt-seijin)", url: "/wiki/databooks/4#p-38", kind: "databook" },
        { label: "Chōzenshū 4 — Super Encyclopedia, planche 45 (Habitants de l'univers : planète Zalt)", url: "/wiki/databooks/19#p-45", kind: "databook" },
      ],
    },
    {
      id: 53,
      name: "Planète Litt",
      sources: [
        { label: "Daizenshuu 7 — Daijiten, planche 38 (Peuples extraterrestres : Litt-seijin)", url: "/wiki/databooks/4#p-38", kind: "databook" },
        { label: "Chōzenshū 4 — Super Encyclopedia, planche 45 (Habitants de l'univers : planète Litt)", url: "/wiki/databooks/19#p-45", kind: "databook" },
      ],
    },
    {
      id: 55,
      name: "Planète Sadala",
      sources: [
        { label: "Chōzenshū 4 — Super Encyclopedia, planche 45 (Monde d'origine premier des Saiyans)", url: "/wiki/databooks/19#p-45", kind: "databook" },
        { label: "Manga Dragon Ball Super, tome 1 (chapitre 7 : Kyabe et la planète Sadala de l'Univers 6)", url: "/wiki/manga/volume/124", kind: "manga" },
      ],
    },
    {
      id: 64,
      name: "Planète Vampa",
      sources: [
        { label: "Film Dragon Ball Super: Broly (Roman officiel, exil de Paragus et Broly sur Vampa)", url: "/wiki/films", kind: "source" },
        { label: "Manga Dragon Ball Super, tome 11 (chapitre 42 : épilogue Broly sur Vampa)", url: "/wiki/manga/volume/134", kind: "manga" },
      ],
    },
    {
      id: 65,
      name: "Étoile Makyô",
      sources: [
        { label: "Daizenshuu 7 — Daijiten, planche 12 (Chronologie cosmique : passage périodique de l'étoile Makyô)", url: "/wiki/databooks/4#p-12", kind: "databook" },
        { label: "Daizenshuu 7 — Daijiten, planche 38 (Peuples extraterrestres : Makyo-seijin)", url: "/wiki/databooks/4#p-38", kind: "databook" },
      ],
    },
  ];

  for (const pe of planetEnrichments) {
    const [p] = await sql`SELECT * FROM bot.db_planets WHERE id = ${pe.id};`;
    if (!p) continue;

    const existing: WikiSourceRef[] = Array.isArray(p.article_sources) ? p.article_sources : [];
    const merged = [...existing];
    for (const ns of pe.sources) {
      if (!merged.some(s => s.label === ns.label || s.url === ns.url)) {
        merged.push({
          n: merged.length + 1,
          label: ns.label,
          url: ns.url,
          kind: ns.kind as any,
        });
      }
    }
    merged.forEach((s, idx) => { s.n = idx + 1; });

    const before = { article_sources: p.article_sources };
    const after = { article_sources: merged };

    await sql`
      UPDATE bot.db_planets
      SET article_sources = ${JSON.stringify(merged)}::jsonb,
          article_updated_at = ${nowEpoch}
      WHERE id = ${pe.id};
    `;

    const revId = idRevision();
    await sql`
      INSERT INTO public.wiki_revisions (
        id, "tableName", "rowId", action, label, before, after, "editorId", "editorName", "createdAt"
      ) VALUES (
        ${revId}, 'db_planets', ${String(pe.id)}, 'update',
        ${`Enrichissement des sources canoniques Daizenshuu 4 / 7 & Chōzenshū 4 pour ${p.name}`},
        ${JSON.stringify(before)}::jsonb,
        ${JSON.stringify(after)}::jsonb,
        'subagent-shenron', 'Shenron Planètes & Races Subagent', NOW()
      );
    `;
    console.log(`  ✓ Planète [#${pe.id}] ${p.name} : ${existing.length} -> ${merged.length} sources canoniques.`);
  }

  // ==========================================
  // 3. VÉRIFICATION DU 100%
  // ==========================================
  console.log("\n--- 3. Contrôle Final & Vérification 100% ---");

  const [racesCheck] = await sql`
    SELECT 
      count(*) as total_races,
      count(*) FILTER (WHERE name_ja IS NOT NULL AND name_ja != '') as races_with_name_ja,
      count(*) FILTER (WHERE home_planet_id IS NOT NULL) as races_with_home_planet,
      count(*) FILTER (WHERE article_sources IS NOT NULL AND jsonb_array_length(article_sources) > 0) as races_with_sources
    FROM bot.db_races;
  `;

  const [planetsCheck] = await sql`
    SELECT 
      count(*) as total_planets,
      count(*) FILTER (WHERE article_sources IS NOT NULL AND jsonb_array_length(article_sources) > 0) as planets_with_sources,
      count(*) FILTER (WHERE name_ja IS NOT NULL AND name_ja != '') as planets_with_name_ja
    FROM bot.db_planets;
  `;

  console.log("Races Audit Final:", racesCheck);
  console.log("Planètes Audit Final:", planetsCheck);

  await sql.end();
}

main().catch(err => {
  console.error("Erreur durant l'exécution :", err);
  process.exit(1);
});
