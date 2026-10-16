/**
 * Fix des image_url des auras dans Supabase.
 * Corrige les chemins qui pointent vers telop_waza ou emblem.
 *
 * Patterns réels dans le bucket "menu" :
 *  aura_fs   : 200_icon/10_icon_chr/aura_fs/k{6}_l_{5}_l00.webp
 *  aura_soul : 200_icon/10_icon_chr/aura_soul/a{6}_l_{5}_l00.webp
 *  aura_armed (miximax icon) : 200_icon/10_icon_chr/aura_armed/c{code}_5000_l_{int}_5000_l00.webp
 */

const SUPABASE_URL = "http://127.0.0.1:8000";
const SERVICE_KEY = "***REMOVED***";

const HEADERS = {
  apikey: SERVICE_KEY,
  Authorization: `Bearer ${SERVICE_KEY}`,
  "Content-Type": "application/json",
};

async function fetchAll(table: string, select = "id,asset_code,image_url") {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?select=${select}&limit=1000`, {
    headers: HEADERS,
  });
  return res.json() as Promise<any[]>;
}

async function patchRow(table: string, id: string, image_url: string) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?id=eq.${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { ...HEADERS, Prefer: "return=minimal" },
    body: JSON.stringify({ image_url }),
  });
  if (!res.ok) console.error(`PATCH ${table} ${id} →`, res.status, await res.text());
}

/** asset_code like wko00820 → num=820 → left=k000820, right=00820 */
function buildFsImage(assetCode: string): string | null {
  const m = assetCode.match(/(\d+)$/);
  if (!m) return null;
  const num = parseInt(m[1], 10);
  const left = `k${num.toString().padStart(6, "0")}`;
  const right = num.toString().padStart(5, "0");
  return `200_icon/10_icon_chr/aura_fs/${left}_l_${right}_l00.webp`;
}

/** asset_code like wss000210 → num=210 → left=a000210, right=00210 */
function buildSoulImage(assetCode: string): string | null {
  const m = assetCode.match(/(\d+)$/);
  if (!m) return null;
  const num = parseInt(m[1], 10);
  const left = `a${num.toString().padStart(6, "0")}`;
  const right = num.toString().padStart(5, "0");
  return `200_icon/10_icon_chr/aura_soul/${left}_l_${right}_l00.webp`;
}

/** icon_code like c05028210 → c05028210_5000_l_5028210_5000_l00.webp */
function buildArmedImageFromIconCode(iconCode: string): string | null {
  const numPart = iconCode.replace(/^c/, "");
  const rightPart = parseInt(numPart, 10).toString();
  return `200_icon/10_icon_chr/aura_armed/${iconCode}_5000_l_${rightPart}_5000_l00.webp`;
}

function deriveIconCode(assetCode: string): string | null {
  if (!assetCode?.startsWith("wmm")) return null;
  const numStr = assetCode.replace(/^wmm/, "").replace(/_.*$/, "");
  const num = parseInt(numStr, 10);
  if (Number.isNaN(num)) return null;
  if (numStr.length > 5) return `c${numStr}`;
  if (num <= 999) return `c05028${String(num).padStart(3, "0")}`;
  return null;
}

// Charger les fichiers disponibles dans le bucket pour valider
async function loadBucketFiles(folder: string): Promise<Set<string>> {
  const res = await fetch(`${SUPABASE_URL}/storage/v1/object/list/menu`, {
    method: "POST",
    headers: HEADERS,
    body: JSON.stringify({ prefix: `200_icon/10_icon_chr/${folder}`, limit: 1000 }),
  });
  const files: { name: string }[] = await res.json();
  return new Set(files.map(f => f.name));
}

async function fixTable(table: string, buildImage: (row: any) => string | null, bucketFiles: Map<string, Set<string>>) {
  const cols = table === "inagle_miximax" ? "id,asset_code,image_url,icon_code" : "id,asset_code,image_url";
  const rows = await fetchAll(table, cols);
  let fixed = 0;
  let skipped = 0;
  let noFile = 0;

  for (const row of rows) {
    const newImg = buildImage(row);
    if (!newImg) {
      skipped++;
      continue;
    }

    // Vérifier si le fichier existe dans le bucket
    const parts = newImg.split("/");
    const folder = parts[parts.length - 2];
    const filename = parts[parts.length - 1];
    const files = bucketFiles.get(folder);
    if (files && !files.has(filename)) {
      noFile++;
      continue; // fichier absent du bucket, ne pas écraser
    }

    if (row.image_url !== newImg) {
      await patchRow(table, row.id, newImg);
      fixed++;
    }
  }

  console.log(`${table}: ${fixed} fixés, ${skipped} ignorés, ${noFile} fichiers manquants`);
}

async function main() {
  console.log("Chargement des fichiers bucket...");
  const bucketFiles = new Map([
    ["aura_fs", await loadBucketFiles("aura_fs")],
    ["aura_soul", await loadBucketFiles("aura_soul")],
    ["aura_armed", await loadBucketFiles("aura_armed")],
    ["aura_mixi", await loadBucketFiles("aura_mixi")],
  ]);

  console.log(
    `Bucket: aura_fs=${bucketFiles.get("aura_fs")!.size}, ` +
      `aura_soul=${bucketFiles.get("aura_soul")!.size}, ` +
      `aura_armed=${bucketFiles.get("aura_armed")!.size}, ` +
      `aura_mixi=${bucketFiles.get("aura_mixi")!.size}`,
  );

  // Keshins standard (wko, wkk, wkd, wkt)
  await fixTable(
    "inagle_keshins",
    row => {
      const ac = row.asset_code;
      if (!ac) return null;
      if (/^wk[okdt]/i.test(ac)) return buildFsImage(ac);
      return null; // keshins armés (was) ignorés pour l'instant
    },
    bucketFiles,
  );

  // Souls
  await fixTable(
    "inagle_souls",
    row => {
      const ac = row.asset_code;
      if (!ac) return null;
      return buildSoulImage(ac);
    },
    bucketFiles,
  );

  // Miximax (via icon_code)
  await fixTable(
    "inagle_miximax",
    row => {
      const ic = row.icon_code || deriveIconCode(row.asset_code);
      if (!ic) return null;
      return buildArmedImageFromIconCode(ic);
    },
    bucketFiles,
  );

  console.log("Terminé.");
}

main().catch(console.error);
