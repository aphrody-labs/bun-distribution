/**
 * Match les auras du Google Sheet avec la DB Supabase.
 * Enrichit sheet_data avec : passive, hissatsu (name/type/element/power), buff.
 */

const SUPABASE_URL = "http://127.0.0.1:8000";
const SERVICE_KEY = "***REMOVED***";

const HEADERS = {
  apikey: SERVICE_KEY,
  Authorization: `Bearer ${SERVICE_KEY}`,
  "Content-Type": "application/json",
};

const TABLES = [
  "inagle_keshins",
  "inagle_souls",
  "inagle_awakenings",
  "inagle_miximax",
  "inagle_mode_changes",
];

async function fetchAll(table: string) {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/${table}?select=id,name_fr,name_en,sheet_data&limit=1000`,
    { headers: HEADERS },
  );
  return (await res.json()) as any[];
}

async function patchSheetData(table: string, id: string, sheet_data: any) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?id=eq.${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { ...HEADERS, Prefer: "return=minimal" },
    body: JSON.stringify({ sheet_data }),
  });
  if (!res.ok) console.error(`PATCH ${table} ${id}:`, res.status, await res.text());
}

function clean(s: string | undefined): string {
  return (s ?? "")
    .toLowerCase()
    .replace(/mix 'n' match: /g, "")
    .replace(/miximax trans\.: /g, "")
    .replace(/transfo\. miximax : /g, "")
    .replace(/totem /g, "")
    .replace(/soul /g, "")
    .replace(/fighting spirit /g, "")
    .replace(/keshin /g, "")
    .replace(/esprit guerrier /g, "")
    .replace(/[^a-z0-9]/g, "");
}

import path from "node:path";

async function main() {
  // Charger le sheet
  const sheetPath = path.resolve(import.meta.dir, "../../data/sheet_export.json");
  const sheetFile = Bun.file(sheetPath);
  if (!(await sheetFile.exists())) {
    console.error(`Sheet export introuvable: ${sheetPath}`);
    return;
  }
  const sheetRaw = await sheetFile.json();
  const rows: string[][] = sheetRaw.sheets["Hyper Moves"];
  const dataRows = rows.slice(2).filter((r) => r[0]?.trim());

  console.log(`Sheet: ${dataRows.length} lignes`);

  // Charger toutes les auras depuis la DB
  const allEntries: Array<{ table: string; row: any }> = [];
  for (const table of TABLES) {
    const rows = await fetchAll(table);
    for (const row of rows) allEntries.push({ table, row });
  }
  console.log(`DB: ${allEntries.length} auras`);

  let matched = 0;
  let updated = 0;

  for (const sheetRow of dataRows) {
    const sheetName = sheetRow[0]?.trim();
    const sheetType = sheetRow[1]?.trim();
    const sheetElement = sheetRow[2]?.trim();
    const passive = sheetRow[3]?.trim() || undefined;
    const hissatsuName = sheetRow[4]?.trim() || undefined;
    const hissatsuType = sheetRow[5]?.trim() || undefined;
    const hissatsuElement = sheetRow[6]?.trim() || undefined;
    const hissatsuPower = sheetRow[7] ? Number(sheetRow[7]) : undefined;
    const buffContext = sheetRow[8]?.trim() || undefined; // ex: "Totems/Souls", "Miximax Buff (20s)"
    const buffEffect = sheetRow[9]?.trim() || sheetRow[10]?.trim() || undefined;

    if (!sheetName) continue;

    const searchClean = clean(sheetName);

    // Chercher dans la DB
    const found = allEntries.find(({ row }) => {
      const en = clean(row.name_en);
      const fr = clean(row.name_fr);
      return (
        en === searchClean ||
        fr === searchClean ||
        (en.length > 3 && (en.includes(searchClean) || searchClean.includes(en))) ||
        (fr.length > 3 && (fr.includes(searchClean) || searchClean.includes(fr)))
      );
    });

    if (!found) continue;
    matched++;

    const existingSheetData = found.row.sheet_data ?? {};
    const newSheetData = {
      ...existingSheetData,
      sheetName,
      sheetType,
      sheetElement: sheetElement || undefined,
      passive: passive || undefined,
      hissatsu: hissatsuName
        ? {
            name: hissatsuName,
            type: hissatsuType,
            element: hissatsuElement,
            power: hissatsuPower,
          }
        : existingSheetData.hissatsu,
      buff: buffEffect
        ? {
            context: buffContext,
            effect: buffEffect,
          }
        : existingSheetData.buff,
    };

    // Nettoyer les undefined
    for (const k of Object.keys(newSheetData)) {
      if (newSheetData[k] === undefined) delete newSheetData[k];
    }

    await patchSheetData(found.table, found.row.id, newSheetData);
    updated++;
  }

  console.log(`Matchés: ${matched}/${dataRows.length} lignes du sheet`);
  console.log(`Mis à jour: ${updated} auras en DB`);
}

main().catch(console.error);
