import { DataStore, defaultData } from "@/services/DataStore";
import { resolveDependency } from "@/utils/functions";

type DataType = keyof typeof defaultData;

/**
 * Initiate the EAV Data table if properties defined in the `defaultData` doesn't exist in it yet.
 */
export async function initDataTable() {
	const store = await resolveDependency(DataStore);

	for (const key of Object.keys(defaultData)) {
		await store.add(key as DataType, defaultData[key as DataType]);
	}
}
