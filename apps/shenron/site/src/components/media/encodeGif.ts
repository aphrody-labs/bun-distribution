/**
 * encodeGif — encodage frames → GIF animé, basé sur `modern-gif`.
 *
 * Pourquoi `modern-gif` (vs `gifenc` / `gif.js`) :
 *   - activement maintenu (2026), typé TS de série, decode + encode ;
 *   - encode multi-thread via Web Worker WASM (`workerUrl`), quantization +
 *     dithering (floyd-steinberg/atkinson/stucki) modernes — sortie nette ;
 *   - `gifenc` (2022, sans types) et `gif.js` (2022, worker script séparé,
 *     sans types) sont plus bas niveau et figés.
 *
 * Browser-only : `modern-gif` manipule canvas/ImageData/OffscreenCanvas et un
 * worker — appeler depuis un Client Component (ex. un éditeur de scène, un
 * outil d'export). NE PAS importer côté serveur (RSC).
 *
 * Worker : `modern-gif` embarque son worker inline et l'instancie tout seul
 * quand `workerUrl` est omis — c'est ce qu'on fait ici. On évite ainsi
 * l'import `modern-gif/worker?url` (suffixe Vite, non résolu par Turbopack et
 * sans déclaration TS). L'encodage reste donc off-main-thread sans config
 * bundler ni asset copié dans `public/`.
 *
 * Usage :
 * ```ts
 * "use client";
 * import { encodeFramesToGif } from "@/components/media/encodeGif";
 *
 * const blob = await encodeFramesToGif({
 *   width: 320,
 *   height: 180,
 *   frames: [
 *     { data: canvas1, delay: 80 }, // CanvasImageSource
 *     { data: canvas2, delay: 80 },
 *   ],
 * });
 * const url = URL.createObjectURL(blob);
 * ```
 */

import { encode } from "modern-gif";

/** Une frame à encoder. `data` peut être un canvas, une ImageBitmap, des
 *  pixels (Uint8ClampedArray RGBA via BufferSource) ou une URL d'image. */
interface GifFrameInput {
	/** Source de pixels du frame. */
	data: CanvasImageSource | BufferSource | string;
	/** Durée d'affichage du frame en millisecondes (défaut: 100). */
	delay?: number;
}

export interface EncodeGifOptions {
	/** Largeur du GIF en pixels. */
	width: number;
	/** Hauteur du GIF en pixels. */
	height: number;
	/** Frames dans l'ordre de lecture. */
	frames: GifFrameInput[];
	/** Nombre max de couleurs de la palette (2-255, défaut: 256 → 255). */
	maxColors?: number;
	/** Méthode de dithering pour des dégradés plus doux. */
	dither?: "floyd-steinberg" | "atkinson" | "stucki";
	/** 0 = boucle infinie (défaut), N = nombre de boucles. */
	loopCount?: number;
}

/**
 * Encode une séquence de frames en GIF animé et renvoie un `Blob` (image/gif).
 * Lève si appelé hors navigateur ou sans frame.
 */
export async function encodeFramesToGif(options: EncodeGifOptions): Promise<Blob> {
	if (typeof window === "undefined") {
		throw new Error("encodeFramesToGif() est browser-only (worker + canvas).");
	}
	const { width, height, frames, maxColors, dither, loopCount } = options;
	if (frames.length === 0) {
		throw new Error("encodeFramesToGif(): au moins un frame est requis.");
	}

	return encode({
		format: "blob",
		width,
		height,
		maxColors,
		dither,
		looped: true,
		loopCount: loopCount ?? 0,
		frames: frames.map((f) => ({
			data: f.data,
			delay: f.delay ?? 100,
		})),
	});
}

/**
 * Helper pratique : encode une suite de canvases (même dimension) en GIF.
 */
async function encodeCanvasesToGif(
	canvases: HTMLCanvasElement[],
	opts?: { delay?: number; maxColors?: number; dither?: EncodeGifOptions["dither"] }
): Promise<Blob> {
	const first = canvases[0];
	if (!first) {
		throw new Error("encodeCanvasesToGif(): liste de canvases vide.");
	}
	return encodeFramesToGif({
		width: first.width,
		height: first.height,
		maxColors: opts?.maxColors,
		dither: opts?.dither,
		frames: canvases.map((c) => ({ data: c, delay: opts?.delay ?? 100 })),
	});
}
