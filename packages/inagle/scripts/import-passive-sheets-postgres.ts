import { readFile } from "node:fs/promises";
import { createInagleSql } from "@rosegriffon/db/inagle-sql";
import type { Database } from "@rosegriffon/db/schema";

const input = process.env.INAGLE_PASSIVE_SHEETS_JSON;
if (!input) {
  throw new Error(
    "INAGLE_PASSIVE_SHEETS_JSON est obligatoire : l'import lit une extraction explicite.",
  );
}

type Kind = "player" | "custom" | "coordinator";
const db = createInagleSql<Database>();
const source = JSON.parse(await readFile(input, "utf8")) as Record<string, unknown>;
const groups: Array<{ kind: Kind; value: unknown }> = [
  { kind: "player", value: source.playerPassives },
  { kind: "custom", value: source.customPassives },
  { kind: "coordinator", value: source.coordinatorPassives },
];

const rows = groups.flatMap(({ kind, value }) => {
  if (!Array.isArray(value)) return [];
  return value.map((data, index) => ({
    id: `${kind}:${String((data as { no?: unknown }).no ?? index)}`,
    kind,
    data: JSON.stringify(data),
    updated_at: new Date().toISOString(),
  }));
});

for (let offset = 0; offset < rows.length; offset += 200) {
  const batch = rows.slice(offset, offset + 200);
  await db
    .insertInto("inagle_passive_sheets")
    .values(batch)
    .onConflict((oc) =>
      oc.columns(["kind", "id"]).doUpdateSet({
        data: (eb) => eb.ref("excluded.data"),
        updated_at: new Date().toISOString(),
      }),
    )
    .execute();
}

console.log(`Imported ${rows.length} passive sheets from ${input}`);
await db.destroy();
