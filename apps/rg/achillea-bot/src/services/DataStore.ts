import { createAchilleaSql } from "@rosegriffon/db/achillea-sql";

import { Service } from "@/decorators";
import { defaultData } from "./data-defaults";

export { defaultData } from "./data-defaults";

type DataKey = keyof typeof defaultData;
type DataValue<Key extends DataKey> = (typeof defaultData)[Key];

interface DataDatabase {
	data: {
		key: string;
		created_at: Date;
		updated_at: Date;
		value: string;
	};
}

const sql = createAchilleaSql<DataDatabase>();

/** SQL-only replacement for the legacy MikroORM EAV repository. */
@Service()
export class DataStore {
	async get<Key extends DataKey>(key: Key): Promise<DataValue<Key>> {
		const row = await sql.selectFrom("data").select("value").where("key", "=", key).executeTakeFirst();
		if (!row) throw new Error(`Data key not initialized: ${key}`);
		return JSON.parse(row.value) as DataValue<Key>;
	}

	async getOrDefault<Key extends DataKey>(key: Key, fallback: DataValue<Key>): Promise<DataValue<Key>> {
		const row = await sql.selectFrom("data").select("value").where("key", "=", key).executeTakeFirst();
		if (!row) {
			await this.add(key, fallback);
			return fallback;
		}
		return JSON.parse(row.value) as DataValue<Key>;
	}

	async set<Key extends DataKey>(key: Key, value: DataValue<Key>): Promise<void> {
		const now = new Date();
		await sql
			.insertInto("data")
			.values({ key, created_at: now, updated_at: now, value: JSON.stringify(value) })
			.onConflict((oc) =>
				oc.column("key").doUpdateSet({ updated_at: now, value: JSON.stringify(value) })
			)
			.execute();
	}

	async add<Key extends DataKey>(key: Key, value: DataValue<Key>): Promise<void> {
		const now = new Date();
		await sql
			.insertInto("data")
			.values({ key, created_at: now, updated_at: now, value: JSON.stringify(value) })
			.onConflict((oc) => oc.column("key").doNothing())
			.execute();
	}
}
