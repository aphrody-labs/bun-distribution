#!/usr/bin/env bun
/**
 * dump-dragonballcn.ts — Dumper parallèle haute performance pour DragonBallCN (364+ tomes)
 *
 * Exploite les Workers natifs de Bun et le client FFI curl-impersonate de BXC
 * pour dumper l'intégralité de comic.dragonballcn.com, archiver les planches HD
 * en local et les importer directement dans PostgreSQL (Neon/local) et SQLite (bot.db).
 *
 * Usage:
 *   bun scripts/ops/dump-dragonballcn.ts [--concurrency 6] [--category full_color] [--limit 10] [--force]
 *   bun scripts/ops/dump-dragonballcn.ts --db-only  # réimporte les dumps existants sans requête réseau
 */
import { existsSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import postgres from "postgres";

const ROOTS = {
  data: join(import.meta.dir, "../../data/dragonballcn"),
  volumes: join(import.meta.dir, "../../data/dragonballcn/volumes"),
  catalog: join(import.meta.dir, "../../data/dragonballcn/catalog.json"),
  manifest: join(import.meta.dir, "../../data/dragonballcn/manifest.json"),
  botDb: join(import.meta.dir, "../../apps/bot/data/bot.db"),
};

// ---------------------------------------------------------------------------
// 1. Parsing des Arguments CLI
// ---------------------------------------------------------------------------
const args = process.argv.slice(2);

function getArg(flag: string, defaultValue?: string): string | undefined {
  const idx = args.indexOf(flag);
  return idx !== -1 && idx + 1 < args.length ? args[idx + 1] : defaultValue;
}

const CONCURRENCY = Number.parseInt(getArg("--concurrency", "6")!, 10);
const CATEGORY_FILTER = getArg("--category");
const LIMIT = getArg("--limit") ? Number.parseInt(getArg("--limit")!, 10) : undefined;
const FORCE = args.includes("--force");
const DB_ONLY = args.includes("--db-only");

// ---------------------------------------------------------------------------
// 2. Connexions Bases de Données
// ---------------------------------------------------------------------------
function getPgUrl(): string | null {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const envPath = process.env.SHENRON_PG_ENV || join(homedir(), ".shenron-neon.env");
  if (existsSync(envPath)) {
    try {
      const content = readFileSync(envPath, "utf8");
      const lines = content.split("\n").filter((l) => l.startsWith("DATABASE_URL="));
      const last = lines.at(-1);
      if (last) {
        return last.slice("DATABASE_URL=".length).trim().replace(/^["']|["']$/g, "");
      }
    } catch {}
  }
  return null;
}

const pgUrl = getPgUrl();
const pg = pgUrl ? postgres(pgUrl, { max: 10, prepare: false }) : null;
const sqlite = new Database(ROOTS.botDb);

async function initDatabases() {
  // SQLite
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS dragonballcn_volumes (
      did TEXT PRIMARY KEY,
      category TEXT NOT NULL,
      title TEXT NOT NULL,
      category_title TEXT,
      arc TEXT,
      cover_url TEXT,
      url TEXT,
      date TEXT,
      total_pages INTEGER NOT NULL DEFAULT 0,
      pages TEXT NOT NULL DEFAULT '[]',
      scraped_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    );
    CREATE INDEX IF NOT EXISTS idx_dbcn_vol_cat ON dragonballcn_volumes(category);
  `);

  // PostgreSQL
  if (pg) {
    await pg`
      CREATE TABLE IF NOT EXISTS bot.dragonballcn_volumes (
        did TEXT PRIMARY KEY,
        category TEXT NOT NULL,
        title TEXT NOT NULL,
        category_title TEXT,
        arc TEXT,
        cover_url TEXT,
        url TEXT,
        date TEXT,
        total_pages INTEGER NOT NULL DEFAULT 0,
        pages JSONB NOT NULL DEFAULT '[]'::jsonb,
        scraped_at BIGINT NOT NULL DEFAULT (EXTRACT(EPOCH FROM NOW()) * 1000)::bigint,
        updated_at BIGINT NOT NULL DEFAULT (EXTRACT(EPOCH FROM NOW()) * 1000)::bigint
      )
    `;
    await pg`
      CREATE INDEX IF NOT EXISTS idx_dbcn_volumes_cat ON bot.dragonballcn_volumes(category)
    `;
  }
}

// ---------------------------------------------------------------------------
// 3. Types et Helpers
// ---------------------------------------------------------------------------
export interface CatalogItem {
  id: string;
  title: string;
  category: string;
  categoryTitle?: string;
  arc?: string;
  coverUrl?: string;
  url?: string;
  date?: string;
}

export interface VolumeDetailPayload extends CatalogItem {
  did: string;
  totalPages: number;
  pages: Array<{
    pageNumber: number;
    name: string;
    size?: string;
    thumbUrl: string;
    imageUrl: string;
    pageUrl: string;
  }>;
}

async function upsertVolumeInDatabases(vol: VolumeDetailPayload) {
  const pagesJson = JSON.stringify(vol.pages);
  const nowMs = Date.now();

  // SQLite
  const stmt = sqlite.prepare(`
    INSERT INTO dragonballcn_volumes (
      did, category, title, category_title, arc, cover_url, url, date, total_pages, pages, scraped_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(did) DO UPDATE SET
      title = excluded.title,
      category = excluded.category,
      category_title = excluded.category_title,
      arc = excluded.arc,
      cover_url = excluded.cover_url,
      total_pages = excluded.total_pages,
      pages = excluded.pages,
      updated_at = excluded.updated_at
  `);
  stmt.run(
    vol.did,
    vol.category,
    vol.title,
    vol.categoryTitle || null,
    vol.arc || null,
    vol.coverUrl || null,
    vol.url || null,
    vol.date || null,
    vol.totalPages,
    pagesJson,
    nowMs,
    nowMs
  );

  // PostgreSQL
  if (pg) {
    await pg`
      INSERT INTO bot.dragonballcn_volumes (
        did, category, title, category_title, arc, cover_url, url, date, total_pages, pages, scraped_at, updated_at
      ) VALUES (
        ${vol.did},
        ${vol.category},
        ${vol.title},
        ${vol.categoryTitle || null},
        ${vol.arc || null},
        ${vol.coverUrl || null},
        ${vol.url || null},
        ${vol.date || null},
        ${vol.totalPages},
        ${pg.json(vol.pages)},
        ${nowMs},
        ${nowMs}
      )
      ON CONFLICT(did) DO UPDATE SET
        title = EXCLUDED.title,
        category = EXCLUDED.category,
        category_title = EXCLUDED.category_title,
        arc = EXCLUDED.arc,
        cover_url = EXCLUDED.cover_url,
        total_pages = EXCLUDED.total_pages,
        pages = EXCLUDED.pages,
        updated_at = EXCLUDED.updated_at
    `;

    // Si Full Color (42 tomes) : synchronise aussi les planches dans bot.db_manga_chapters (série DB)
    if (vol.category === "full_color" && vol.did.startsWith("0-10-")) {
      const volNumStr = vol.did.replace("0-10-", "");
      const volNum = Number.parseInt(volNumStr, 10);
      if (volNum >= 1 && volNum <= 42) {
        const imageUrls = vol.pages.map((p) => p.imageUrl).filter(Boolean);

        await pg`
          UPDATE bot.db_manga_chapters
          SET pages = ${pg.json(imageUrls)}
          WHERE series = 'DB' AND chapter_number = ${volNum}
        `;
      }
    }
  }
}

// ---------------------------------------------------------------------------
// 4. Orchestrateur Multi-Workers
// ---------------------------------------------------------------------------
async function main() {
  console.log("🐉 === DUMPER PARALLÈLE DRAGONBALLCN & IMPORT DATABASE ===");
  console.log(`⚡ Concurrence : ${CONCURRENCY} workers Bun`);
  console.log(`📁 Répertoire de stockage : ${ROOTS.volumes}`);
  console.log(`🗄️  SQLite : ${ROOTS.botDb}`);
  console.log(`🐘 PostgreSQL : ${pgUrl ? "connecté" : "non configuré"}`);

  await mkdir(ROOTS.volumes, { recursive: true });
  await initDatabases();

  // Chargement du catalogue
  if (!existsSync(ROOTS.catalog)) {
    throw new Error(`Catalogue introuvable : ${ROOTS.catalog}. Lancez d'abord crawl.`);
  }

  const rawCatalog: CatalogItem[] = JSON.parse(readFileSync(ROOTS.catalog, "utf8"));
  let catalog = rawCatalog;
  if (CATEGORY_FILTER) {
    catalog = catalog.filter((c) => c.category === CATEGORY_FILTER);
    console.log(`🎯 Filtrage catégorie '${CATEGORY_FILTER}' : ${catalog.length} tomes`);
  }
  if (LIMIT && LIMIT > 0) {
    catalog = catalog.slice(0, LIMIT);
    console.log(`⏱️ Limite fixée à ${LIMIT} tomes`);
  }

  console.log(`📚 ${catalog.length} tomes à traiter au total.\n`);

  let alreadyCached = 0;
  let newlyScraped = 0;
  let totalPagesArchived = 0;
  const queue: CatalogItem[] = [];

  // Vérification de la reprise sur disque
  for (const item of catalog) {
    const did = item.id;
    const volPath = join(ROOTS.volumes, `${did}.json`);

    if (!FORCE && existsSync(volPath)) {
      try {
        const vol: VolumeDetailPayload = JSON.parse(readFileSync(volPath, "utf8"));
        if (vol.totalPages > 0 && Array.isArray(vol.pages)) {
          await upsertVolumeInDatabases(vol);
          alreadyCached++;
          totalPagesArchived += vol.totalPages;
          continue;
        }
      } catch {}
    }

    if (!DB_ONLY) {
      queue.push(item);
    }
  }

  console.log(`💾 Tomes déjà en cache local : ${alreadyCached}/${catalog.length}`);
  console.log(`📥 Tomes à scraper en parallèle : ${queue.length}\n`);

  if (queue.length > 0) {
    const startTime = Date.now();
    const workerScript = join(import.meta.dir, "dragonballcn-worker.ts");
    const numWorkers = Math.min(CONCURRENCY, queue.length);
    const workers: Worker[] = [];

    let completed = alreadyCached;
    let nextIdx = 0;

    await new Promise<void>((resolve, reject) => {
      let activeWorkers = numWorkers;

      for (let wId = 0; wId < numWorkers; wId++) {
        const worker = new Worker(new URL(workerScript, import.meta.url).href);
        workers.push(worker);

        const dispatchNext = () => {
          if (nextIdx >= queue.length) {
            worker.terminate();
            activeWorkers--;
            if (activeWorkers === 0) resolve();
            return;
          }

          const task = queue[nextIdx++];
          worker.postMessage(task, worker.location.origin);
        };

        worker.onmessage = async (e: MessageEvent) => {
          const msg = e.data;
          if (msg.type === "success") {
            const vol: VolumeDetailPayload = msg.volume;
            const volPath = join(ROOTS.volumes, `${vol.did}.json`);
            await writeFile(volPath, JSON.stringify(vol, null, 2), "utf8");
            await upsertVolumeInDatabases(vol);

            completed++;
            newlyScraped++;
            totalPagesArchived += vol.totalPages;

            const pct = ((completed / catalog.length) * 100).toFixed(1);
            console.log(
              `[✓ ${completed}/${catalog.length}] (${pct}%) DID: ${vol.did} — ${vol.title} (${vol.totalPages} planches HD) [W#${wId}]`
            );
          } else {
            console.error(`[✗] Erreur volume ${msg.did}:`, msg.error);
          }

          dispatchNext();
        };

        worker.onerror = (err) => {
          console.error(`[Worker #${wId} error]:`, err);
          dispatchNext();
        };

        // Lancement de la première tâche
        dispatchNext();
      }
    });

    const elapsedSec = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`\n⚡ Scraping terminé en ${elapsedSec}s pour ${newlyScraped} nouveaux tomes.`);
  }

  // Écriture du manifest global
  const manifest = {
    generatedAt: new Date().toISOString(),
    totalVolumes: catalog.length,
    scrapedVolumes: alreadyCached + newlyScraped,
    totalPages: totalPagesArchived,
  };
  await writeFile(ROOTS.manifest, JSON.stringify(manifest, null, 2), "utf8");

  if (pg) await pg.end();
  sqlite.close();

  console.log("\n=======================================================");
  console.log(`🎉 Bilan Dump DragonBallCN & Import DB :`);
  console.log(`   - Volumes catalogués : ${catalog.length}`);
  console.log(`   - Volumes archivés   : ${alreadyCached + newlyScraped}`);
  console.log(`   - Planches HD totales: ${totalPagesArchived.toLocaleString()} pages`);
  console.log(`   - Manifeste écrit    : ${ROOTS.manifest}`);
  console.log("=======================================================");
}

main().catch((err) => {
  console.error("❌ Échec dump DragonBallCN:", err);
  process.exit(1);
});
