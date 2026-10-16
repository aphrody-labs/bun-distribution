/** Imports the generated CPK projections into the durable SQL source. */
import { createInagleSql } from "@rosegriffon/db/inagle-sql";
import type { Database } from "@rosegriffon/db/schema";
import { ASSET_MANIFEST } from "../src/data/asset-manifest.generated";

const db = createInagleSql<Database>();
const now = new Date().toISOString();
await db.transaction().execute(async tx => {
  for (const [name, data] of Object.entries(ASSET_MANIFEST)) {
    const jsonData = JSON.stringify(data);
    await tx
      .insertInto("inagle_asset_manifests")
      .values({ name, data: jsonData, updated_at: now })
      .onConflict(oc => oc.column("name").doUpdateSet({ data: jsonData, updated_at: now }))
      .execute();
  }
});
console.log(`Imported ${Object.keys(ASSET_MANIFEST).length} asset manifests into PostgreSQL.`);
await db.destroy();
