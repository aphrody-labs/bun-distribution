// SPDX-License-Identifier: Apache-2.0
/**
 * cdn-harvest-worker.ts
 *
 * Worker Bun parallèle pour le téléchargement et la conversion WebP/JPG
 * des planches Dragon Ball / DragonBallCN via BXC curl-impersonate.
 */
import { existsSync } from "node:fs";
import { mkdir, rename, writeFile, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import sharp from "sharp";

const bxcRoot = process.env.BXC_ROOT?.trim() || resolve(import.meta.dir, "..", "..", "..", "aphrody-web", "apps", "bxc");
const { ImpersonatedClient } = await import(join(bxcRoot, "src", "ffi", "curl-impersonate.ts"));

let client: InstanceType<typeof ImpersonatedClient> | null = null;

function getClient(): InstanceType<typeof ImpersonatedClient> {
	if (!client) {
		client = new ImpersonatedClient({
			profile: "chrome131",
			httpVersion: "1.1",
			followRedirects: false,
			timeoutMs: 60_000,
		});
	}
	return client;
}

export interface HarvestTask {
	id: string;
	url: string;
	destPath: string;
	format: "jpg" | "webp";
	quality?: number;
	retries?: number;
}

export interface HarvestResult {
	type: "success" | "skipped" | "error";
	id: string;
	destPath: string;
	bytes?: number;
	width?: number;
	height?: number;
	elapsedMs?: number;
	error?: string;
}

declare const self: {
	onmessage: ((event: MessageEvent<HarvestTask>) => void) | null;
	postMessage: (message: HarvestResult) => void;
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function isExistingValid(path: string): Promise<boolean> {
	if (!existsSync(path)) return false;
	try {
		const s = await stat(path);
		return s.size > 2048;
	} catch {
		return false;
	}
}

self.onmessage = async (event: MessageEvent<HarvestTask>) => {
	const task = event.data;
	const startTime = performance.now();

	// 1. Vérification si le fichier existe déjà
	if (await isExistingValid(task.destPath)) {
		try {
			const s = await stat(task.destPath);
			self.postMessage({
				type: "skipped",
				id: task.id,
				destPath: task.destPath,
				bytes: s.size,
				elapsedMs: Math.round(performance.now() - startTime),
			}, self.location.origin);
			return;
		} catch {
			// Continuer le téléchargement si erreur stat
		}
	}

	const maxRetries = task.retries ?? 3;
	let lastError: Error | null = null;

	for (let attempt = 1; attempt <= maxRetries; attempt++) {
		try {
			const c = getClient();
			const targetUrl = task.url.replace(/^http:\/\//i, "https://");
			const response = await c.fetch(targetUrl, {
				headers: {
					Referer: "https://comic.dragonballcn.com/",
					Accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
					"Accept-Language": "zh-CN,zh;q=0.9,ja;q=0.8,en;q=0.7",
				},
				httpVersion: "1.1",
				followRedirects: true,
				timeoutMs: 60_000,
			});

			if (!response.ok) {
				throw new Error(`HTTP ${response.status} ${response.statusText}`);
			}

			const rawBuffer = new Uint8Array(await response.arrayBuffer());
			if (rawBuffer.byteLength < 1024) {
				throw new Error(`Réponse trop petite (${rawBuffer.byteLength} octets)`);
			}

			let finalBuffer: Uint8Array;
			let width: number | undefined;
			let height: number | undefined;

			if (task.format === "webp") {
				const image = sharp(rawBuffer, { failOn: "none", limitInputPixels: false });
				const meta = await image.metadata();
				width = meta.width;
				height = meta.height;
				finalBuffer = new Uint8Array(
					await image.webp({ quality: task.quality ?? 75 }).toBuffer()
				);
			} else {
				finalBuffer = rawBuffer;
				try {
					const meta = await sharp(rawBuffer, { failOn: "none", limitInputPixels: false }).metadata();
					width = meta.width;
					height = meta.height;
				} catch {
					// Ignorer pour format jpg natif si métadonnées illisibles
				}
			}

			await mkdir(dirname(task.destPath), { recursive: true });
			const tmpPath = `${task.destPath}.part-${process.pid}-${randomUUID().slice(0, 8)}`;
			await writeFile(tmpPath, finalBuffer);
			await rename(tmpPath, task.destPath);

			self.postMessage({
				type: "success",
				id: task.id,
				destPath: task.destPath,
				bytes: finalBuffer.byteLength,
				width,
				height,
				elapsedMs: Math.round(performance.now() - startTime),
			}, self.location.origin);
			return;
		} catch (err) {
			lastError = err instanceof Error ? err : new Error(String(err));
			if (attempt < maxRetries) {
				await sleep(500 * Math.pow(2, attempt - 1) + Math.floor(Math.random() * 250));
			}
		}
	}

	self.postMessage({
		type: "error",
		id: task.id,
		destPath: task.destPath,
		error: lastError?.message ?? "Échec inconnu après retries",
		elapsedMs: Math.round(performance.now() - startTime),
	}, self.location.origin);
};
