import { join } from "node:path";

/** Données générées par le cron, hors des releases immuables. */
export const CRON_SHARED_ROOT = process.env.RG_CRON_SHARED_ROOT ?? "/srv/rg/shared/cron";

export function cronSharedPath(...segments: string[]): string {
	return join(CRON_SHARED_ROOT, ...segments);
}
