/** Imports the generated CPK projections into the durable SQL source. */
import { createAchilleaSql } from "@rosegriffon/db/achillea-sql";
import type { Database } from "@rosegriffon/db/schema";
import { ASSET_MANIFEST } from "../src/data/asset-manifest.generated";

const db = createAchilleaSql<Database>();
const now = new Date();
await db.transaction().execute(async (tx) => {
	for (const [name, data] of Object.entries(ASSET_MANIFEST)) {
		const jsonData = JSON.stringify(data) as unknown as Database["inagle_asset_manifests"]["data"];
		await tx.insertInto("inagle_asset_manifests").values({ name, data: jsonData, updated_at: now })
			.onConflict((oc) => oc.column("name").doUpdateSet({ data: jsonData, updated_at: now }))
			.execute();
	}
});
console.log(`Imported ${Object.keys(ASSET_MANIFEST).length} asset manifests into PostgreSQL.`);
await db.destroy();
