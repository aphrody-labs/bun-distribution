/**
 * Audits whether a requested number of distinct Dragon Ball Xenoverse 2
 * portraits can be satisfied by the locally proven XV2 extraction.
 *
 * This script deliberately does not download, generate, or assign images. A
 * portrait is counted only when its three-character XV2 code has both a PNG
 * in the extracted `CHARA01.emb` inventory and a manifest entry. This avoids
 * treating generic Dragon Ball artwork as a Xenoverse 2 portrait.
 *
 * Usage:
 *   bun scripts/ops/audit-xv2-portrait-feasibility.ts
 *   bun scripts/ops/audit-xv2-portrait-feasibility.ts --database path/to/bot.db
 */
import { Database } from "bun:sqlite";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const REQUIRED_PORTRAITS = 1242;
const REQUIRED_ROSTER = 1323;
const DEFAULT_DATABASE = "apps/bot/data/bot.db";
const PORTRAIT_DIRECTORY = "apps/bot/assets/dbz/xv2-portraits";
const MANIFEST_PATH = `${PORTRAIT_DIRECTORY}/xv2-portraits.json`;
const CATALOG_PATH = "apps/bot/assets/dbz/xv2-catalog.json";

type PortraitManifest = {
  source: string;
  count: number;
  characters: Array<{ code: string; portrait: string }>;
};

type Catalog = { characters: Record<string, string> };

const databaseOption = process.argv.indexOf("--database");
const databaseArgument =
  databaseOption >= 0
    ? process.argv[databaseOption + 1]
    : process.argv
        .find((argument) => argument.startsWith("--database="))
        ?.slice("--database=".length);
const databasePath = resolve(databaseArgument ?? DEFAULT_DATABASE);
const portraitDirectory = resolve(PORTRAIT_DIRECTORY);
const manifest = JSON.parse(
  readFileSync(MANIFEST_PATH, "utf8"),
) as PortraitManifest;
const catalog = JSON.parse(readFileSync(CATALOG_PATH, "utf8")) as Catalog;

const diskCodes = new Set(
  readdirSync(portraitDirectory)
    .filter((file) => /^[A-Z0-9]{3}\.png$/.test(file))
    .map((file) => file.slice(0, -4)),
);
const manifestCodes = new Set(manifest.characters.map(({ code }) => code));
const catalogCodes = new Set(Object.keys(catalog.characters));
const validCodes = [...manifestCodes].filter(
  (code) => diskCodes.has(code) && catalogCodes.has(code),
);
const invalidManifestCodes = [...manifestCodes].filter(
  (code) => !diskCodes.has(code) || !catalogCodes.has(code),
);

let roster: number | null = null;
let assigned: number | null = null;
let distinctAssigned: number | null = null;
if (existsSync(databasePath)) {
  const database = new Database(databasePath, { readonly: true });
  const row = database
    .query<
      {
        roster: number;
        assigned: number;
        distinctAssigned: number;
      },
      []
    >(
      `SELECT
				COUNT(*) AS roster,
				SUM(CASE WHEN portrait_xv2 IS NOT NULL AND trim(portrait_xv2) <> '' THEN 1 ELSE 0 END) AS assigned,
				COUNT(DISTINCT CASE WHEN portrait_xv2 IS NOT NULL AND trim(portrait_xv2) <> '' THEN portrait_xv2 END) AS distinctAssigned
			 FROM db_characters`,
    )
    .get();
  database.close();
  roster = row?.roster ?? 0;
  assigned = row?.assigned ?? 0;
  distinctAssigned = row?.distinctAssigned ?? 0;
}

const report = {
  audit: "xv2-portrait-feasibility",
  requirement: {
    portraits: REQUIRED_PORTRAITS,
    roster: REQUIRED_ROSTER,
  },
  source: manifest.source,
  assetEvidence: {
    manifestDeclared: manifest.count,
    manifestCodes: manifestCodes.size,
    diskPortraitCodes: diskCodes.size,
    catalogCharacterCodes: catalogCodes.size,
    verifiedPortraitCodes: validCodes.length,
    invalidManifestCodes,
  },
  localRoster: existsSync(databasePath)
    ? {
        databasePath,
        characters: roster,
        assignedPortraits: assigned,
        distinctAssignedPortraits: distinctAssigned,
      }
    : null,
  result: {
    feasible: REQUIRED_PORTRAITS <= validCodes.length,
    maximumDistinctXV2Portraits: validCodes.length,
    shortfall: Math.max(0, REQUIRED_PORTRAITS - validCodes.length),
    reason:
      REQUIRED_PORTRAITS <= validCodes.length
        ? "The requested count does not exceed the verified local XV2 portrait inventory."
        : "The requested count exceeds the complete verified local XV2 portrait inventory; fulfilling it would require a different licensed source, not reassignment or fabrication.",
  },
};

console.log(JSON.stringify(report, null, 2));
