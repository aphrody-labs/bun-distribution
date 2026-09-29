/**
 * Helpers pour consommer les assets statiques du bot Shenron.
 *
 * Le bot sert `GET /assets/<sub>` (Bun.serve, cache immutable 30j, CORS public).
 * La base est résolue par `@/lib/config` (source unique des URL).
 */
import { ASSET_BASE } from "@/lib/config";

/**
 * `botAsset("dbz/goku.png")` → `https://bot.dragonballfr.com/assets/dbz/goku.png`
 * Accepte aussi les paths DB stockés `./assets/dbz/x.png` ou `/assets/dbz/x.png`.
 */
export function botAsset(path: string): string {
	const sub = path.replace(/^\.?\/?(assets\/)?/, "").replace(/^\/+/, "");
	return `${ASSET_BASE}/assets/${sub}`;
}

const BOT_ASSETS_BASE = ASSET_BASE;
