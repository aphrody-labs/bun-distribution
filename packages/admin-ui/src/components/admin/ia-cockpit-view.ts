// SPDX-License-Identifier: Apache-2.0
// Pure view helpers of the IA cockpit. They hold no React so `bun test` covers them directly;
// UnifiedIaCockpit.tsx and NativeAiPanel.tsx stay thin renderers on top of them.

export const IA_COCKPIT_TABS = ["overview", "training", "canon", "corpus", "agents"] as const;
export type IaCockpitTab = (typeof IA_COCKPIT_TABS)[number];

/** `?tab=` is user-controlled: anything unknown falls back instead of rendering an empty cockpit. */
export function parseCockpitTab(value: string | null | undefined, fallback: IaCockpitTab = "overview"): IaCockpitTab {
  return (IA_COCKPIT_TABS as readonly string[]).includes(value ?? "") ? (value as IaCockpitTab) : fallback;
}

export type CockpitFailureKind = "unauthenticated" | "forbidden" | "server" | "network";

export interface CockpitFailure {
  kind: CockpitFailureKind;
  text: string;
}

/** Turns a non-2xx admin API answer into a state the page can render without guessing from text. */
export function describeHttpFailure(status: number, serverMessage?: string | null): CockpitFailure {
  const detail = serverMessage?.trim();
  if (status === 401) {
    return {
      kind: "unauthenticated",
      text: "Session expirée : reconnectez-vous pour actualiser le cockpit.",
    };
  }
  if (status === 403) {
    // The API reports missing sessions as 401 and non-admin accounts as 403.
    return {
      kind: "forbidden",
      text: detail || "Accès réservé aux administrateurs.",
    };
  }
  return {
    kind: "server",
    text: `HTTP ${status} : ${detail || "réponse illisible"}`,
  };
}

export function describeNetworkFailure(error: unknown): CockpitFailure {
  return {
    kind: "network",
    text: error instanceof Error ? error.message : String(error),
  };
}

export interface ExcerptSegment {
  text: string;
  marked: boolean;
}

/**
 * Splits an excerpt on its `<mark>` highlights. Every other character, including any other tag,
 * stays literal text: OCR output is untrusted and must never reach `dangerouslySetInnerHTML`.
 */
export function splitMarkedExcerpt(excerpt: string): ExcerptSegment[] {
  const segments: ExcerptSegment[] = [];
  let marked = false;
  for (const part of excerpt.split(/(<mark>|<\/mark>)/i)) {
    if (/^<mark>$/i.test(part)) marked = true;
    else if (/^<\/mark>$/i.test(part)) marked = false;
    else if (part) segments.push({ text: part, marked });
  }
  return segments;
}

export const OCR_PROBE_MAX_BYTES = 6_000_000;
export const OCR_PROBE_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;

/** Returns a user-facing reason when the planche cannot be sent to the OCR probe, else null. */
export function ocrProbeFileError(file: { size: number; type: string }): string | null {
  if (!(OCR_PROBE_TYPES as readonly string[]).includes(file.type)) {
    return "Format non pris en charge : PNG, JPEG ou WebP uniquement.";
  }
  if (file.size > OCR_PROBE_MAX_BYTES) {
    return `Image trop lourde (${(file.size / 1_000_000).toFixed(1)} Mo) : ${OCR_PROBE_MAX_BYTES / 1_000_000} Mo maximum.`;
  }
  return null;
}

/** Base64 without one string concatenation per byte (a 6 MB planche froze the tab). */
export function bytesToBase64(bytes: Uint8Array): string {
  const chunk = 0x8000;
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += chunk) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunk));
  }
  return btoa(binary);
}

export interface LocalRagHit {
  title?: string;
  snippet?: string;
}

/** Passage list handed to the local model; numbering matches the `[n]` citations it must emit. */
export function formatRagContext(hits: readonly LocalRagHit[]): string {
  return hits.map((hit, index) => `[${index + 1}] ${hit.title ?? "Sans titre"} — ${hit.snippet ?? ""}`).join("\n");
}

export const EMPTY_RETRIEVAL_NOTICE =
  "Aucun passage retourné par le RAG : l'index est vide, non ingéré ou ne couvre pas cette question. Le modèle n'a pas été sollicité.";
