/** One-shot preservation import. The JSON file is an extraction input only;
 * runtime reads `inagle_passives` and never this file. */
import { readFile } from "node:fs/promises";
import { createInagleSql } from "@rosegriffon/db/inagle-sql";
import type { Database } from "@rosegriffon/db/schema";

const input = process.env.INAGLE_PASSIVES_JSON;
if (!input) {
  throw new Error(
    "INAGLE_PASSIVES_JSON est obligatoire : l'import lit une extraction explicite, jamais une copie embarquée.",
  );
}
const payload = JSON.parse(await readFile(input, "utf8")) as {
  player?: Array<Record<string, unknown>>;
};
const rows = payload.player ?? [];
const db = createInagleSql<Database>();

for (let offset = 0; offset < rows.length; offset += 200) {
  const batch = rows.slice(offset, offset + 200).map((row) => {
    const name = (row.name ?? {}) as Record<string, string | null>;
    const description = (row.description ?? {}) as Record<string, string | null>;
    return {
      id: String(row.passive_id ?? row.string_id),
      name_fr: name.fr ?? null,
      name_en: name.en ?? null,
      name_ja: name.ja ?? null,
      description_fr: description.fr ?? null,
      description_en: description.en ?? null,
      description_ja: description.ja ?? null,
      type: String(row.string_id ?? ""),
      image_url: null,
      data: JSON.stringify(row),
      category: null,
      boost_type: null,
      stat_boost: null,
      effect_value: row.main_value == null ? null : String(row.main_value),
    };
  });
  await db
    .insertInto("inagle_passives")
    .values(batch)
    .onConflict((oc) =>
      oc.column("id").doUpdateSet(({ ref }) => ({
        name_fr: ref("excluded.name_fr"),
        name_en: ref("excluded.name_en"),
        name_ja: ref("excluded.name_ja"),
        description_fr: ref("excluded.description_fr"),
        description_en: ref("excluded.description_en"),
        description_ja: ref("excluded.description_ja"),
        data: ref("excluded.data"),
        type: ref("excluded.type"),
        effect_value: ref("excluded.effect_value"),
      })),
    )
    .execute();
  console.log(`passives import: ${Math.min(offset + batch.length, rows.length)}/${rows.length}`);
}
