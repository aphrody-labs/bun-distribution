import { Buffer } from "node:buffer";
import { singleton } from "tsyringe";
import { loadImage, type Image } from "@napi-rs/canvas";
import { botFile } from "~/lib/asset-files";
import { logger } from "~/lib/logger";

/**
 * Cache mémoire singleton des backgrounds NASA utilisés par les canvases.
 *
 * Avant : chaque service (`Card`/`Fusion`/`Leaderboard`) avait son propre
 * `private bg: Image | null` chargé via `loadBg()`. Sur 3 services × ~3 MB
 * d'image décodée en mémoire = ~9 MB de doublon.
 *
 * Après : un seul cache partagé, chaque path d'asset chargé une fois et
 * partagé entre tous les services. Charge à la demande (lazy) pour ne pas
 * payer le coût au boot si jamais utilisé.
 *
 * Pas d'éviction : les backgrounds NASA changent rarement et sont peu
 * nombreux (~5-10 fichiers max). RAM constante après warm-up.
 */
@singleton()
export class BackgroundCacheService {
	private cache = new Map<string, Image | null>();
	private inflight = new Map<string, Promise<Image | null>>();

	async get(relativePath: string): Promise<Image | null> {
		// Cache hit (même null négatif pour éviter de re-tenter)
		if (this.cache.has(relativePath)) return this.cache.get(relativePath) ?? null;

		// Évite la double-charge si plusieurs services demandent en parallèle
		const pending = this.inflight.get(relativePath);
		if (pending) return pending;

		const promise = this.load(relativePath);
		this.inflight.set(relativePath, promise);
		const result = await promise;
		this.inflight.delete(relativePath);
		this.cache.set(relativePath, result);
		return result;
	}

	private async load(relativePath: string): Promise<Image | null> {
		const absolute = botFile(relativePath);
		try {
			const file = Bun.file(absolute);
			if (!(await file.exists())) {
				logger.warn({ path: relativePath }, "background missing on disk");
				return null;
			}
			const buf = Buffer.from(await file.arrayBuffer());
			const img = await loadImage(buf);
			logger.debug({ path: relativePath, w: img.width, h: img.height }, "background loaded");
			return img;
		} catch (err) {
			logger.warn({ err, path: relativePath }, "background load failed");
			return null;
		}
	}

	stats(): { count: number; paths: string[] } {
		return {
			count: this.cache.size,
			paths: [...this.cache.keys()],
		};
	}
}
