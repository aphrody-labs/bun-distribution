import { AnimesamaScraper } from '@aphrody/animesama';
import { Database } from 'bun:sqlite';
import { join } from 'node:path';
import { mkdir } from 'node:fs/promises';

await mkdir('data/inazuma', { recursive: true });
const dbPath = join('data', 'inazuma', 'inazuma.sqlite');
const db = new Database(dbPath, { create: true });

db.run(`
  CREATE TABLE IF NOT EXISTS episodes (
    id TEXT PRIMARY KEY,
    anime_slug TEXT,
    saison TEXT,
    langue TEXT,
    numero INTEGER,
    nom TEXT,
    lecteurs_json TEXT,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS idx_episodes_anime ON episodes(anime_slug, saison);
`);

const scraper = new AnimesamaScraper({ profile: 'static' });
const seasons = ['saison1', 'saison2', 'saison3', 'saison4', 'saison5', 'saison6', 'saison7'];
let totalEpisodes = 0;

for (const s of seasons) {
  try {
    const data = await scraper.getSaison('inazuma-eleven', s, 'vf');
    if (!data || !data.episodes) continue;
    for (const ep of data.episodes) {
      const id = `inazuma-eleven:${s}:vf:${ep.numero}`;
      db.run(
        `INSERT OR REPLACE INTO episodes (id, anime_slug, saison, langue, numero, nom, lecteurs_json) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [id, 'inazuma-eleven', s, 'vf', ep.numero, ep.nom, JSON.stringify(ep.lecteurs)]
      );
      totalEpisodes++;
    }
    console.log(`Ingested ${s} VF: ${data.episodes.length} episodes`);
  } catch (e: any) {
    console.log(`Could not load ${s}: ${e.message}`);
  }
}
console.log(`Total Inazuma Eleven VF episodes ingested into ${dbPath}: ${totalEpisodes}`);
await scraper.close().catch(() => {});
