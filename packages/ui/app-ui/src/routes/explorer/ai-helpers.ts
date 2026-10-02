// SPDX-License-Identifier: Apache-2.0
import type { File } from "@aphrody/drive-client";
import { getContentKind } from "@aphrody/drive-client";
import { toast } from "@aphrody/m3-primitives";
import { runOcr, runTranscribe, runRagIndex } from "../../tauri-bridge";
import { useAphrodyJobStore } from "../../stores/aphrodyJobStore";

export const OCR_EXTENSIONS = new Set([
	"pdf",
	"png",
	"jpg",
	"jpeg",
	"webp",
	"gif",
	"bmp",
	"tiff",
	"svg",
	"heic",
	"avif",
]);

export const AUDIO_VIDEO_EXTENSIONS = new Set([
	"mp3",
	"wav",
	"ogg",
	"m4a",
	"flac",
	"aac",
	"wma",
	"mp4",
	"mkv",
	"mov",
	"webm",
	"avi",
	"wmv",
	"m4v",
]);

/**
 * Returns true if a file is eligible for OCR text extraction (images and PDFs).
 */
export function isOcrEligible(file: File): boolean {
	const kind = getContentKind(file);
	if (kind === "image") return true;
	const ext = (file.extension || "").toLowerCase();
	return OCR_EXTENSIONS.has(ext);
}

/**
 * Returns true if a file is eligible for audio or video speech transcription.
 */
export function isAudioVideoEligible(file: File): boolean {
	const kind = getContentKind(file);
	if (kind === "audio" || kind === "video") return true;
	const ext = (file.extension || "").toLowerCase();
	return AUDIO_VIDEO_EXTENSIONS.has(ext);
}

/**
 * Classifies an attachment into image, text/code, audio/video, or link.
 */
export type AttachmentKind = "image" | "audio_video" | "link" | "file";

export interface TurnInputItem {
	type: "text" | "file" | "image" | "link";
	text?: string;
	path?: string;
	url?: string;
	mediaType?: string;
}

export function classifyAttachment(pathOrUrl: string): {
	kind: AttachmentKind;
	extension?: string;
	isUrl: boolean;
} {
	const trimmed = pathOrUrl.trim();
	if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
		return { kind: "link", isUrl: true };
	}

	const ext = trimmed.split(".").pop()?.toLowerCase() || "";
	if (["png", "jpg", "jpeg", "webp", "gif", "bmp", "svg", "avif", "heic"].includes(ext)) {
		return { kind: "image", extension: ext, isUrl: false };
	}
	if (AUDIO_VIDEO_EXTENSIONS.has(ext)) {
		return { kind: "audio_video", extension: ext, isUrl: false };
	}
	return { kind: "file", extension: ext, isUrl: false };
}

/**
 * Transforms user text and raw attachment paths/URLs into typed turn input items
 * compatible with the broker, local models (vision / audio / files), and JSON-RPC app-server.
 */
export function buildTurnInputItems(text: string, attachments: string[] = []): TurnInputItem[] {
	const items: TurnInputItem[] = [];

	if (text.trim()) {
		items.push({ type: "text", text: text.trim() });
	}

	for (const att of attachments) {
		const classified = classifyAttachment(att);
		if (classified.isUrl) {
			items.push({ type: "link", url: att.trim() });
		} else if (classified.kind === "image") {
			items.push({
				type: "image",
				path: att,
				mediaType: `image/${classified.extension === "jpg" ? "jpeg" : classified.extension}`,
			});
		} else {
			items.push({ type: "file", path: att });
		}
	}

	return items;
}

/**
 * Extract physical path from a File's sd_path.
 */
export function getFilePhysicalPath(file: File): string | null {
	if (file.sd_path && "Physical" in file.sd_path) {
		return (file.sd_path as { Physical: { path: string } }).Physical.path;
	}
	return null;
}

/**
 * Prepares the prompt and context paths for "Demander à Aphrody".
 */
export function buildAskAphrodyPrompt(targets: File[]): {
	prompt: string;
	parentDir?: string;
	targetPaths: string[];
} {
	const targetPaths = targets
		.map((f) => getFilePhysicalPath(f) || f.name)
		.filter(Boolean);

	let prompt = "";
	let parentDir: string | undefined;

	if (targets.length === 1) {
		const target = targets[0];
		const path = getFilePhysicalPath(target) || target.name;
		if (target.kind === "Directory") {
			prompt = `À propos du dossier "${target.name}" (${path}) :\n`;
			parentDir = path;
		} else {
			prompt = `À propos du fichier "${target.name}" (${path}) :\n`;
			const lastSlash = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
			if (lastSlash > 0) parentDir = path.slice(0, lastSlash);
		}
	} else {
		prompt = `À propos des fichiers sélectionnés :\n${targetPaths.map((p) => `- ${p}`).join("\n")}\n\n`;
		if (targetPaths.length > 0) {
			const first = targetPaths[0];
			const lastSlash = Math.max(first.lastIndexOf("/"), first.lastIndexOf("\\"));
			if (lastSlash > 0) parentDir = first.slice(0, lastSlash);
		}
	}

	return { prompt, parentDir, targetPaths };
}

/**
 * Executes OCR on eligible files via the Tauri bridge and tracks jobs in the JobManager.
 */
export async function executeOcr(targets: File[]): Promise<number> {
	const eligible = targets.filter(isOcrEligible);
	if (eligible.length === 0) return 0;

	toast.info(
		`Extraction de texte (OCR) lancée pour ${
			eligible.length === 1 ? eligible[0].name : `${eligible.length} fichiers`
		}...`,
	);
	let successCount = 0;

	for (const f of eligible) {
		const path = getFilePhysicalPath(f);
		if (!path) continue;

		const jobId = useAphrodyJobStore.getState().addJob({
			name: "ocr",
			displayName: "Extraction de texte",
			target: f.name,
			targetPath: path,
			status: "running",
			progress: 0.15,
			status_message: "Reconnaissance de caractères...",
			resultAction: {
				label: "Ouvrir",
				action: () => {
					// Dispatched open action
				},
			},
		});

		try {
			useAphrodyJobStore.getState().updateProgress(jobId, 0.5, "Traitement de la page...");
			const result = await runOcr({ path });
			if (typeof result.code === "number" && result.code !== 0) {
				throw new Error(typeof result.stderr === "string" ? result.stderr : "OCR backend failed");
			}
			const output = typeof result.output === "string" ? result.output : "";
			if (!output.trim()) throw new Error("OCR backend returned no text");
			(f as any).extracted_text = output;
			successCount++;

			useAphrodyJobStore.getState().completeJob(jobId, {
				label: "Ouvrir",
				action: () => {
					// Available in inspector
				},
			});
		} catch (err) {
			console.error(`OCR failed for ${f.name}:`, err);
			useAphrodyJobStore.getState().failJob(jobId, String(err));
		}
	}

	if (successCount > 0) {
		toast.success(
			eligible.length === 1
				? `Extraction de texte terminée pour ${eligible[0].name}`
				: `Extraction de texte terminée (${successCount}/${eligible.length} fichiers)`,
		);
	} else {
		toast.error("Échec de l'extraction de texte (OCR)");
	}

	return successCount;
}

/**
 * Executes audio/video transcription on eligible files via the Tauri bridge and tracks jobs in the JobManager.
 */
export async function executeTranscription(targets: File[]): Promise<number> {
	const eligible = targets.filter(isAudioVideoEligible);
	if (eligible.length === 0) return 0;

	toast.info(
		`Transcription audio lancée pour ${
			eligible.length === 1 ? eligible[0].name : `${eligible.length} fichiers`
		}...`,
	);
	let successCount = 0;

	for (const f of eligible) {
		const path = getFilePhysicalPath(f);
		if (!path) continue;

		const jobId = useAphrodyJobStore.getState().addJob({
			name: "transcription",
			displayName: "Transcription audio",
			target: f.name,
			targetPath: path,
			status: "running",
			progress: 0.1,
			status_message: "Whisper speech-to-text...",
			resultAction: {
				label: "Ouvrir",
				action: () => {
					// Available in transcript tab
				},
			},
		});

		try {
			useAphrodyJobStore.getState().updateProgress(jobId, 0.45, "Génération des sous-titres...");
			const result = await runTranscribe({ path, model: "whisper-base" });
			if (typeof result.code === "number" && result.code !== 0) {
				throw new Error(typeof result.stderr === "string" ? result.stderr : "Transcription backend failed");
			}
			const transcriptText = typeof result.output === "string" ? result.output : "";
			if (!transcriptText.trim()) throw new Error("Transcription backend returned no transcript");

			(f as any).transcript_text = transcriptText;
			successCount++;

			useAphrodyJobStore.getState().completeJob(jobId, {
				label: "Ouvrir",
				action: () => {
					// Action will be handled by UI
				},
			});
		} catch (err) {
			console.error(`Transcription failed for ${f.name}:`, err);
			useAphrodyJobStore.getState().failJob(jobId, String(err));
		}
	}

	if (successCount > 0) {
		toast.success(
			eligible.length === 1
				? `Transcription terminée pour ${eligible[0].name}`
				: `Transcription terminée (${successCount}/${eligible.length} fichiers)`,
		);
	} else {
		toast.error("Échec de la transcription audio");
	}

	return successCount;
}

/**
 * Executes vector RAG indexing on targets (files or directories) and tracks jobs in the JobManager.
 */
export async function executeRagIndex(targets: File[]): Promise<number> {
	if (targets.length === 0) return 0;

	toast.info(
		`Indexation RAG lancée pour ${
			targets.length === 1 ? targets[0].name : `${targets.length} éléments`
		}...`,
	);
	let successCount = 0;

	for (const f of targets) {
		const path = getFilePhysicalPath(f);
		if (!path) continue;

		const jobId = useAphrodyJobStore.getState().addJob({
			name: "rag_index",
			displayName: "Indexation RAG",
			target: f.name,
			targetPath: path,
			status: "running",
			progress: 0.1,
			status_message: "Vectorisation des fragments...",
			resultAction: {
				label: "Afficher dans fichiers",
				action: () => {
					// Reveal file
				},
			},
		});

		try {
			useAphrodyJobStore.getState().updateProgress(jobId, 0.6, "Calcul des embeddings...");
			const result = await runRagIndex({
				path,
				recursive: f.kind === "Directory",
			});
			if (typeof result.code === "number" && result.code !== 0) {
				throw new Error(typeof result.stderr === "string" ? result.stderr : "RAG indexing failed");
			}
			successCount++;

			useAphrodyJobStore.getState().completeJob(jobId, {
				label: "Afficher dans fichiers",
				action: () => {
					// Reveal file
				},
			});
		} catch (err) {
			console.error(`RAG index failed for ${f.name}:`, err);
			useAphrodyJobStore.getState().failJob(jobId, String(err));
		}
	}

	if (successCount > 0) {
		toast.success(
			targets.length === 1
				? `Indexation RAG effectuée pour ${targets[0].name}`
				: `Indexation RAG effectuée pour ${successCount} éléments`,
		);
	} else {
		toast.error("Échec de l'indexation RAG");
	}

	return successCount;
}
