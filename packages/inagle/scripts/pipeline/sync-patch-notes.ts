import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createPgPool } from "@rosegriffon/db/pg";
import dotenv from "dotenv";
import { iecodeDataPath, iecodeRoot } from "../../src/core/roots.ts";

const root = iecodeRoot();
dotenv.config({ path: resolve(root, ".env.local") });

interface PatchNoteEntry {
  title_fr: string;
  content_html_fr: string;
}

const PLATFORM_MAP: Record<string, string[]> = {
  xbox: ["xbox"],
  switch: ["switch"],
  "ps-steam": ["ps4", "ps5", "steam"],
};

const DATE_MAP: Record<string, string> = {
  "1_4_2": "2026.05.20",
  "1_4_1": "2026.05.10",
  "1_4_0": "2026.05.01",
};

async function syncPatchNotes() {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    console.error("❌ DATABASE_URL not found in environment.");
    process.exit(1);
  }

  const pool = createPgPool(dbUrl, { applicationName: "inagle-patch-notes" });
  const jsonPath =
    process.env.PATCH_NOTES_JSON || iecodeDataPath("translations", "patch-notes-fr.json");

  console.log(`📖 Reading patch notes from: ${jsonPath}`);
  try {
    const rawJson = readFileSync(jsonPath, "utf-8");
    const data: Record<string, PatchNoteEntry> = JSON.parse(rawJson);

    console.log(`  Found ${Object.keys(data).length} translation keys.`);

    let insertedCount = 0;
    let updatedCount = 0;

    for (const [key, entry] of Object.entries(data)) {
      // Determine platform
      let platform: string[] = [];
      for (const prefix of Object.keys(PLATFORM_MAP)) {
        if (key.startsWith(prefix)) {
          platform = PLATFORM_MAP[prefix];
          break;
        }
      }

      // Determine date
      let date = "2026.05.01";
      for (const version of Object.keys(DATE_MAP)) {
        if (key.includes(version)) {
          date = DATE_MAP[version];
          break;
        }
      }

      const url = `https://www.inazuma.jp/victory-road/en/patchnote/`;

      // Check if row already exists
      const { rows: existing } = await pool.query("SELECT id FROM patch_notes WHERE id = $1", [
        key,
      ]);

      if (existing.length > 0) {
        // Update existing
        await pool.query(
          `UPDATE patch_notes 
					 SET title_fr = $2, content_html_fr = $3, updated_at = NOW() 
					 WHERE id = $1`,
          [key, entry.title_fr, entry.content_html_fr],
        );
        updatedCount++;
      } else {
        // Insert new
        await pool.query(
          `INSERT INTO patch_notes 
					 (id, title, date, platform, url, title_fr, content_html_fr, content_html, created_at, updated_at) 
					 VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7, $7, NOW(), NOW())`,
          [
            key,
            entry.title_fr,
            date,
            JSON.stringify(platform),
            url,
            entry.title_fr,
            entry.content_html_fr,
          ],
        );
        insertedCount++;
      }
    }

    console.log(`✅ Patch notes synchronized successfully!`);
    console.log(`  - Inserted: ${insertedCount}`);
    console.log(`  - Updated: ${updatedCount}`);
  } catch (e) {
    console.error("❌ Sync patch notes failed:", e);
  } finally {
    await pool.end();
  }
}

syncPatchNotes().catch(console.error);
