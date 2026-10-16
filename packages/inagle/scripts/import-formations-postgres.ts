/** One-way import of the extracted formation dump into the canonical SQL table. */
import { resolve } from "node:path";
import { createInagleSql } from "@rosegriffon/db/inagle-sql";
import type { Database } from "@rosegriffon/db/schema";

const source = process.env.INAGLE_FORMATIONS_JSON;
if (!source) {
  throw new Error("INAGLE_FORMATIONS_JSON is required; refusing an implicit source.");
}

const input = JSON.parse(await Bun.file(resolve(source)).text()) as {
  formations?: Array<Record<string, unknown>>;
};
const formations = (input.formations ?? []).filter((formation) => formation.valid !== false);
if (formations.length === 0) throw new Error("No valid formations found in the explicit source.");

const db = createInagleSql<Database>();
const now = new Date().toISOString();
for (let offset = 0; offset < formations.length; offset += 100) {
  const batch = formations.slice(offset, offset + 100);
  await db.transaction().execute(async (tx) => {
    for (const formation of batch) {
      const id = String(formation.form_id ?? "");
      if (!id) continue;
      const label = typeof formation.label === "string" ? formation.label : null;
      await tx
        .insertInto("inagle_formations")
        .values({
          id,
          name_fr: label,
          name_en: label,
          name_ja: label,
          description_fr: null,
          description_en: null,
          description_ja: null,
          type: "game",
          image_url: null,
          data: JSON.stringify(formation),
          updated_at: now,
          emblem_url: null,
        })
        .onConflict((oc) =>
          oc.column("id").doUpdateSet({
            name_fr: label,
            name_en: label,
            name_ja: label,
            type: "game",
            data: JSON.stringify(formation),
            updated_at: now,
          }),
        )
        .execute();
    }
  });
}

console.log(`Imported ${formations.length} canonical formations into PostgreSQL.`);
await db.destroy();
