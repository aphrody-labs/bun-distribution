import { DataStore } from "@/services/DataStore";
import { resolveDependency } from "@/utils/functions";

/**
 * Get the maintenance state of the bot.
 */
export async function isInMaintenance(): Promise<boolean> {
	const store = await resolveDependency(DataStore);
	const maintenance = await store.get("maintenance");

	return maintenance;
}

/**
 * Set the maintenance state of the bot.
 */
export async function setMaintenance(maintenance: boolean) {
	const store = await resolveDependency(DataStore);
	await store.set("maintenance", maintenance);
}
