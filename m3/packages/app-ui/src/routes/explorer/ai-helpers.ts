// SPDX-License-Identifier: Apache-2.0
import type { File } from "@aphrody/drive-client";
import { getContentKind } from "@aphrody/drive-client";

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
  const targetPaths = targets.map((f) => getFilePhysicalPath(f) || f.name).filter(Boolean);

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
