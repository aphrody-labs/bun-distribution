/**
 * Audit zukan_hash assignments: compare DB assignments vs actual zukan data
 * to find mismatched images (wrong person, wrong position/element, wrong era).
 *
 * Run: npx tsx scripts/audit-zukan-matches.ts
 */

import * as path from "node:path";
import {
  AUDIT_ERAS as ERAS,
  auditNormElem as normElem,
  auditNormPos as normPos,
  auditSpearmanCorrelation as spearmanCorrelation,
  auditZukanGameToSeries as zukanGameToSeries,
} from "../../src/zukan/audit.ts";
import { createPgClient, getInagleDatabaseURL } from "@rosegriffon/db/pg";

const __dirname = import.meta.dir;

interface ZukanEntry {
  name: string;
  nickname?: string;
  zukanHash?: string;
  position?: string;
  element?: string;
  stats?: Record<string, number>;
  game?: string;
  gender?: string;
}

interface DbRow {
  id: string;
  name_en: string;
  name_fr: string;
  name_ja: string;
  position: string;
  element: string;
  gender: string | null;
  rarity_label: string;
  series: string | null;
  zukan_hash: string | null;
  stat_frappe: number | null;
  stat_controle: number | null;
  stat_technique: number | null;
  stat_pression: number | null;
  stat_physique: number | null;
  stat_agilite: number | null;
  stat_intelligence: number | null;
}

async function main() {
  // Load zukan data (EN + JA)
  const zukanPath = path.resolve(__dirname, "../data/zukan/param_en.json");
  const zukanData: ZukanEntry[] = await Bun.file(zukanPath).json();
  const zukanJaPath = path.resolve(__dirname, "../data/zukan/param_ja.json");
  const zukanJaData: ZukanEntry[] = (await Bun.file(zukanJaPath).exists()) ? await Bun.file(zukanJaPath).json() : [];

  // Index zukan by hash
  const zukanByHash = new Map<string, ZukanEntry[]>();
  for (const z of zukanData) {
    if (z.zukanHash) {
      if (!zukanByHash.has(z.zukanHash)) zukanByHash.set(z.zukanHash, []);
      zukanByHash.get(z.zukanHash)!.push(z);
    }
  }
  // Index JA zukan by hash for zukanNameJa
  const zukanJaByHash = new Map<string, ZukanEntry>();
  for (const z of zukanJaData) {
    if (z.zukanHash && !zukanJaByHash.has(z.zukanHash)) {
      zukanJaByHash.set(z.zukanHash, z);
    }
  }
  console.log(`Zukan: ${zukanData.length} entries, ${zukanByHash.size} unique hashes`);

  // Connect to DB
  const client = createPgClient(getInagleDatabaseURL());
  await client.connect();

  const { rows } = await client.query<DbRow>(
    `SELECT id, name_en, name_fr, name_ja, position, element, gender,
            rarity_label, series, zukan_hash,
            stat_frappe, stat_controle, stat_technique, stat_pression,
            stat_physique, stat_agilite, stat_intelligence
     FROM inagle_characters
     WHERE zukan_hash IS NOT NULL
     ORDER BY name_en, id`,
  );
  console.log(`DB: ${rows.length} rows with zukan_hash\n`);

  interface Mismatch {
    type: string;
    dbId: string;
    dbName: string;
    dbFr: string;
    dbPos: string;
    dbElem: string;
    dbSeries: string | null;
    dbRarity: string;
    dbGender: string | null;
    zukanName: string;
    zukanPos: string;
    zukanElem: string;
    zukanGame: string;
    zukanGender: string;
    hash: string;
    reasons: string[];
    statCorrelation?: number;
  }

  const mismatches: Mismatch[] = [];

  for (const db of rows) {
    const zukanEntries = zukanByHash.get(db.zukan_hash!);
    if (!zukanEntries || zukanEntries.length === 0) {
      mismatches.push({
        type: "STALE_HASH",
        dbId: db.id,
        dbName: db.name_en,
        dbFr: db.name_fr,
        dbPos: db.position,
        dbElem: db.element,
        dbSeries: db.series,
        dbRarity: db.rarity_label,
        dbGender: db.gender,
        zukanName: "?",
        zukanPos: "?",
        zukanElem: "?",
        zukanGame: "?",
        zukanGender: "?",
        hash: db.zukan_hash!,
        reasons: ["STALE: hash not in current zukan data"],
      });
      continue;
    }

    const z = zukanEntries[0];

    // Name comparison
    const dbNameEn = (db.name_en || "").toLowerCase().trim();
    const zukanName = (z.name || "").toLowerCase().trim();
    const dbNameFr = (db.name_fr || "").toLowerCase().trim();

    // Check if names relate (first word match, contains, etc.)
    const zukanFirst = zukanName.split(/\s+/)[0];
    const dbFirst = dbNameEn.split(/\s+/)[0];
    const dbFirstFr = dbNameFr.split(/\s+/)[0];

    // MixiMax: "arion × victor" — base is "arion"
    const isMixiMax = dbNameEn.includes("×") || dbNameEn.includes("+");
    const dbBaseName = isMixiMax ? dbNameEn.split(/[×+]/)[0].trim().split(/\s+/)[0] : null;

    const nameMatch =
      zukanName === dbNameEn ||
      zukanName === dbNameFr ||
      zukanFirst === dbFirst ||
      zukanFirst === dbFirstFr ||
      (dbBaseName && zukanFirst === dbBaseName) ||
      zukanName.includes(dbFirst) ||
      dbNameEn.includes(zukanFirst);

    // Position mismatch
    const posMismatch = z.position && db.position && normPos(z.position) !== normPos(db.position);

    // Element mismatch (ignore for MixiMax since it can change)
    const elemMismatch = !isMixiMax && z.element && db.element && normElem(z.element) !== normElem(db.element);

    // Gender mismatch
    const zGender = z.gender === "Male" ? "M" : z.gender === "Female" ? "F" : null;
    const genderMismatch = zGender && db.gender && zGender !== db.gender;

    // Era/series — Ares heroes are expected to have OG-era images
    const isAresHero = db.rarity_label === "Héros" && db.series === "Ares";
    const zSeries = zukanGameToSeries(z.game);
    const dbEra = db.series ? ERAS[db.series] : null;
    const zEra = zSeries ? ERAS[zSeries] : null;
    const eraMismatch = !isAresHero && dbEra && zEra && dbEra !== zEra;

    // Stats correlation
    let statCorrelation: number | undefined;
    if (z.stats && db.stat_frappe != null) {
      const zArr = [
        z.stats.kick || 0,
        z.stats.control || 0,
        z.stats.technique || 0,
        z.stats.pressure || 0,
        z.stats.physical || 0,
        z.stats.agility || 0,
        z.stats.intelligence || 0,
      ];
      const dArr = [
        db.stat_frappe || 0,
        db.stat_controle || 0,
        db.stat_technique || 0,
        db.stat_pression || 0,
        db.stat_physique || 0,
        db.stat_agilite || 0,
        db.stat_intelligence || 0,
      ];
      const zTotal = zArr.reduce((a, b) => a + b, 0);
      const dTotal = dArr.reduce((a, b) => a + b, 0);
      if (zTotal > 0 && dTotal > 0) {
        statCorrelation = spearmanCorrelation(zArr, dArr);
      }
    }

    const reasons: string[] = [];
    if (!nameMatch) reasons.push(`NAME: zukan="${z.name}" ≠ db="${db.name_en}"`);
    if (posMismatch) reasons.push(`POS: zukan=${z.position} ≠ db=${db.position}`);
    if (elemMismatch) reasons.push(`ELEM: zukan=${z.element} ≠ db=${db.element}`);
    if (genderMismatch) reasons.push(`GENDER: zukan=${z.gender} ≠ db=${db.gender}`);
    if (eraMismatch) reasons.push(`ERA: zukan=${zSeries}(${zEra}) ≠ db=${db.series}(${dbEra})`);
    if (statCorrelation !== undefined && statCorrelation < 0.3) {
      reasons.push(`STATS: correlation=${statCorrelation.toFixed(2)} (very low)`);
    }

    if (reasons.length > 0) {
      mismatches.push({
        type: reasons.some(r => r.startsWith("NAME"))
          ? "NAME_MISMATCH"
          : reasons.some(r => r.startsWith("GENDER"))
            ? "GENDER_MISMATCH"
            : "ATTR_MISMATCH",
        dbId: db.id,
        dbName: db.name_en,
        dbFr: db.name_fr,
        dbPos: db.position,
        dbElem: db.element,
        dbSeries: db.series,
        dbRarity: db.rarity_label,
        dbGender: db.gender,
        zukanName: z.name,
        zukanPos: z.position || "?",
        zukanElem: z.element || "?",
        zukanGame: z.game || "?",
        zukanGender: z.gender || "?",
        hash: db.zukan_hash!,
        reasons,
        statCorrelation,
      });
    }
  }

  // ── Results ──
  const nameMM = mismatches.filter(m => m.type === "NAME_MISMATCH");
  const genderMM = mismatches.filter(m => m.type === "GENDER_MISMATCH");
  const attrMM = mismatches.filter(m => m.type === "ATTR_MISMATCH");
  const staleMM = mismatches.filter(m => m.type === "STALE_HASH");

  console.log("═══════════════════════════════════════════════════");
  console.log("              ZUKAN MISMATCH AUDIT");
  console.log("═══════════════════════════════════════════════════");
  console.log(`Total assignments audited: ${rows.length}`);
  console.log(`Total mismatches found: ${mismatches.length}`);
  console.log(`  NAME mismatches (wrong person!): ${nameMM.length}`);
  console.log(`  GENDER mismatches: ${genderMM.length}`);
  console.log(`  ATTR mismatches (pos/elem/era): ${attrMM.length}`);
  console.log(`  STALE hashes: ${staleMM.length}`);
  console.log(`Match rate: ${(((rows.length - mismatches.length) / rows.length) * 100).toFixed(1)}%\n`);

  // ── NAME MISMATCHES ── (most severe — wrong person's image!)
  console.log("═══════════════════════════════════════════════════");
  console.log("  NAME MISMATCHES — Wrong person's image assigned!");
  console.log("═══════════════════════════════════════════════════");
  // Deduplicate by name pair for readability
  const seenNamePairs = new Set<string>();
  let nameCount = 0;
  for (const m of nameMM) {
    const key = `${m.dbName}|${m.zukanName}`;
    if (seenNamePairs.has(key)) continue;
    seenNamePairs.add(key);
    nameCount++;
    const corr = m.statCorrelation !== undefined ? ` stats_corr=${m.statCorrelation.toFixed(2)}` : "";
    console.log(`  DB: "${m.dbName}" (${m.dbFr}) [${m.dbPos}/${m.dbElem}] ${m.dbSeries || "?"} ${m.dbRarity}`);
    console.log(`  → Zukan image: "${m.zukanName}" [${m.zukanPos}/${m.zukanElem}] ${m.zukanGame}${corr}`);
    console.log(`    ${m.reasons.join(" | ")}`);
    console.log();
  }
  console.log(`  (${nameCount} unique name pairs, ${nameMM.length} total rows)\n`);

  // ── GENDER MISMATCHES ──
  if (genderMM.length > 0) {
    console.log("═══════════════════════════════════════════════════");
    console.log("  GENDER MISMATCHES");
    console.log("═══════════════════════════════════════════════════");
    const seenG = new Set<string>();
    for (const m of genderMM) {
      const key = `${m.dbName}|${m.zukanName}`;
      if (seenG.has(key)) continue;
      seenG.add(key);
      console.log(
        `  "${m.dbName}" [${m.dbPos}/${m.dbElem}] db_gender=${m.dbGender} zukan_gender=${m.zukanGender} | ${m.zukanName} (${m.zukanGame})`,
      );
    }
    console.log();
  }

  // ── POSITION MISMATCHES ──
  const posMM = attrMM.filter(m => m.reasons.some(r => r.startsWith("POS")));
  if (posMM.length > 0) {
    console.log("═══════════════════════════════════════════════════");
    console.log("  POSITION MISMATCHES — Same person, wrong position");
    console.log("═══════════════════════════════════════════════════");
    const seenP = new Set<string>();
    for (const m of posMM) {
      const key = `${m.dbName}|${m.dbPos}|${m.zukanPos}`;
      if (seenP.has(key)) continue;
      seenP.add(key);
      console.log(
        `  "${m.dbName}" db=${m.dbPos}/${m.dbElem} → zukan=${m.zukanPos}/${m.zukanElem} (${m.zukanGame}) series=${m.dbSeries}`,
      );
    }
    console.log(`  (${seenP.size} unique, ${posMM.length} total rows)\n`);
  }

  // ── ELEMENT MISMATCHES ──
  const elemMM = attrMM.filter(
    m => m.reasons.some(r => r.startsWith("ELEM")) && !m.reasons.some(r => r.startsWith("POS")),
  );
  if (elemMM.length > 0) {
    console.log("═══════════════════════════════════════════════════");
    console.log("  ELEMENT MISMATCHES — Same person+pos, wrong element");
    console.log("═══════════════════════════════════════════════════");
    const seenE = new Set<string>();
    for (const m of elemMM) {
      const key = `${m.dbName}|${m.dbElem}|${m.zukanElem}`;
      if (seenE.has(key)) continue;
      seenE.add(key);
      console.log(
        `  "${m.dbName}" [${m.dbPos}] db=${m.dbElem} → zukan=${m.zukanElem} (${m.zukanGame}) series=${m.dbSeries}`,
      );
    }
    console.log(`  (${seenE.size} unique, ${elemMM.length} total rows)\n`);
  }

  // ── ERA MISMATCHES ──
  const eraOnly = attrMM.filter(
    m => m.reasons.some(r => r.startsWith("ERA")) && !m.reasons.some(r => r.startsWith("POS") || r.startsWith("ELEM")),
  );
  if (eraOnly.length > 0) {
    console.log("═══════════════════════════════════════════════════");
    console.log("  ERA MISMATCHES — Same person+pos+elem, wrong era");
    console.log("═══════════════════════════════════════════════════");
    const seenEra = new Set<string>();
    for (const m of eraOnly) {
      const key = `${m.dbName}|${m.dbSeries}|${m.zukanGame}`;
      if (seenEra.has(key)) continue;
      seenEra.add(key);
      console.log(`  "${m.dbName}" [${m.dbPos}/${m.dbElem}] db_series=${m.dbSeries} → zukan_game=${m.zukanGame}`);
    }
    console.log(`  (${seenEra.size} unique, ${eraOnly.length} total rows)\n`);
  }

  // ── LOW STAT CORRELATION (additional signal) ──
  const lowStats = mismatches.filter(m => m.statCorrelation !== undefined && m.statCorrelation < 0.3);
  if (lowStats.length > 0) {
    console.log("═══════════════════════════════════════════════════");
    console.log("  LOW STAT CORRELATION (< 0.3) — Suspicious matches");
    console.log("═══════════════════════════════════════════════════");
    const seenS = new Set<string>();
    for (const m of lowStats) {
      const key = `${m.dbName}|${m.zukanName}`;
      if (seenS.has(key)) continue;
      seenS.add(key);
      console.log(
        `  "${m.dbName}" → "${m.zukanName}" corr=${m.statCorrelation!.toFixed(2)} [${m.dbPos}/${m.dbElem}] ${m.reasons.join(" | ")}`,
      );
    }
    console.log(`  (${seenS.size} unique)\n`);
  }

  // ── Write JSON audit file for dashboard ──
  interface AuditIssue {
    code: string;
    hash: string;
    dbNameEn: string;
    dbNameFr: string;
    dbNameJa: string;
    dbPosition: string;
    dbElement: string;
    dbGender: string | null;
    dbSeries: string | null;
    dbRarity: string;
    dbStats: number[];
    zukanNameEn: string;
    zukanNameJa: string;
    zukanPosition: string;
    zukanElement: string;
    zukanGender: string;
    zukanGame: string;
    zukanStats: number[];
    statsCorrelation: number;
    severity: "high" | "medium";
    category: string;
    problems: string[];
    imageUrl: string;
  }

  const jsonIssues: AuditIssue[] = [];

  for (const m of mismatches) {
    const z = zukanByHash.get(m.hash)?.[0];
    const zJa = zukanJaByHash.get(m.hash);

    const dbStats = [
      rows.find(r => r.id === m.dbId)?.stat_frappe ?? 0,
      rows.find(r => r.id === m.dbId)?.stat_controle ?? 0,
      rows.find(r => r.id === m.dbId)?.stat_technique ?? 0,
      rows.find(r => r.id === m.dbId)?.stat_pression ?? 0,
      rows.find(r => r.id === m.dbId)?.stat_physique ?? 0,
      rows.find(r => r.id === m.dbId)?.stat_agilite ?? 0,
      rows.find(r => r.id === m.dbId)?.stat_intelligence ?? 0,
    ];
    const zukanStats = z?.stats
      ? [
          z.stats.kick ?? 0,
          z.stats.control ?? 0,
          z.stats.technique ?? 0,
          z.stats.pressure ?? 0,
          z.stats.physical ?? 0,
          z.stats.agility ?? 0,
          z.stats.intelligence ?? 0,
        ]
      : [0, 0, 0, 0, 0, 0, 0];

    const isStatsInverted = m.statCorrelation !== undefined && m.statCorrelation < 0;
    const problems: string[] = [];
    if (isStatsInverted)
      problems.push(`Stats inversées (corr=${m.statCorrelation!.toFixed(2)}): DB=[${dbStats}] zukan=[${zukanStats}]`);
    if (m.reasons.some(r => r.startsWith("ERA"))) {
      const eraR = m.reasons.find(r => r.startsWith("ERA"));
      if (eraR)
        problems.push(
          `Ère: DB=${m.dbSeries}(${ERAS[m.dbSeries!]}) image=${zukanGameToSeries(m.zukanGame)}(${ERAS[zukanGameToSeries(m.zukanGame) || ""]})`,
        );
    }
    if (m.reasons.some(r => r.startsWith("NAME"))) problems.push(`Nom: DB="${m.dbName}" image="${m.zukanName}"`);
    if (m.reasons.some(r => r.startsWith("POS"))) problems.push(`Position: DB=${m.dbPos} image=${m.zukanPos}`);
    if (m.reasons.some(r => r.startsWith("ELEM"))) problems.push(`Élément: DB=${m.dbElem} image=${m.zukanElem}`);

    const category = isStatsInverted
      ? "stats_inverted"
      : m.reasons.some(r => r.startsWith("ERA"))
        ? "era_mismatch"
        : m.reasons.some(r => r.startsWith("NAME"))
          ? "name_mismatch"
          : "attribute_mismatch";
    const severity = isStatsInverted ? ("high" as const) : ("medium" as const);

    // Check for duplicate hash (same hash used by multiple different characters)
    const sameHashRows = rows.filter(r => r.zukan_hash === m.hash && r.name_en !== m.dbName);
    if (sameHashRows.length > 0) {
      problems.push(`Hash partagé avec: ${[...new Set(sameHashRows.map(r => r.name_en))].join(", ")}`);
    }

    jsonIssues.push({
      code: m.dbId,
      hash: m.hash,
      dbNameEn: m.dbName,
      dbNameFr: m.dbFr,
      dbNameJa: rows.find(r => r.id === m.dbId)?.name_ja || "",
      dbPosition: m.dbPos,
      dbElement: m.dbElem,
      dbGender: m.dbGender,
      dbSeries: m.dbSeries,
      dbRarity: m.dbRarity,
      dbStats,
      zukanNameEn: z?.name || m.zukanName,
      zukanNameJa: zJa?.name || "",
      zukanPosition: m.zukanPos,
      zukanElement: m.zukanElem,
      zukanGender: m.zukanGender,
      zukanGame: m.zukanGame,
      zukanStats,
      statsCorrelation: m.statCorrelation ?? 1,
      severity,
      category,
      problems,
      imageUrl: `https://dxi4wb638ujep.cloudfront.net/1/${m.hash}.png`,
    });
  }

  // Also detect duplicate hashes (same hash assigned to different names)
  const hashToNames = new Map<string, Set<string>>();
  for (const r of rows) {
    if (!r.zukan_hash) continue;
    if (!hashToNames.has(r.zukan_hash)) hashToNames.set(r.zukan_hash, new Set());
    hashToNames.get(r.zukan_hash)!.add(r.name_en || r.name_ja);
  }
  for (const [hash, names] of hashToNames) {
    if (names.size <= 1) continue;
    const z = zukanByHash.get(hash)?.[0];
    const zJa = zukanJaByHash.get(hash);
    // Only add if not already in issues
    const alreadyReported = jsonIssues.some(i => i.hash === hash && i.category === "duplicate_hash");
    if (!alreadyReported) {
      jsonIssues.push({
        code: rows.find(r => r.zukan_hash === hash)?.id || "",
        hash,
        dbNameEn: [...names].join(" / "),
        dbNameFr: "",
        dbNameJa: "",
        dbPosition: z?.position || "",
        dbElement: z?.element || "",
        dbGender: null,
        dbSeries: null,
        dbRarity: "",
        dbStats: [0, 0, 0, 0, 0, 0, 0],
        zukanNameEn: z?.name || "",
        zukanNameJa: zJa?.name || "",
        zukanPosition: z?.position || "",
        zukanElement: z?.element || "",
        zukanGender: z?.gender || "",
        zukanGame: z?.game || "",
        zukanStats: [0, 0, 0, 0, 0, 0, 0],
        statsCorrelation: 1,
        severity: "medium",
        category: "duplicate_hash",
        problems: [`Hash partagé entre: ${[...names].join(", ")}`],
        imageUrl: `https://dxi4wb638ujep.cloudfront.net/1/${hash}.png`,
      });
    }
  }

  const highCount = jsonIssues.filter(i => i.severity === "high").length;
  const mediumCount = jsonIssues.filter(i => i.severity === "medium").length;
  const auditJson = {
    metadata: {
      date: new Date().toISOString(),
      totalAudited: rows.length,
      totalIssues: jsonIssues.length,
      bySeverity: { high: highCount, medium: mediumCount },
    },
    issues: jsonIssues,
  };

  const auditPath = process.env.DATA_PATH
    ? path.resolve(process.env.DATA_PATH, "zukan-audit.json")
    : path.resolve(__dirname, "../../../data/zukan-audit.json");
  await Bun.write(auditPath, JSON.stringify(auditJson, null, 2));
  console.log(`\nJSON audit written to ${auditPath} (${jsonIssues.length} issues)`);

  await client.end();
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
