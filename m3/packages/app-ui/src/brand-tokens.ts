// SPDX-License-Identifier: Apache-2.0
// Aphrody brand constants shared by the generated sheet and the webview (no generator deps).
// The seed and accents are the colours of the Aphrody pet (m3/packages/identity, PET_COLORS).
// Mirrors crates/ui/m3-tokens/src/gemini_brand.rs and
// docs/research/ui/m3-expressive-gemini-2026.md section 5.

/** Aphrody pet sock mauve (PET_COLORS.seed in @aphrody/identity). */
export const BRAND_SEED = "#8c6c88";

/** Exact pet colours kept as accents next to the derived roles. */
export const PET_ACCENTS = { hair: "#dcd894", skin: "#fce0b4", tunic: "#f4f4f4" } as const;

/** Gemini app surfaces (reference section 5: surface-container-low light, surface dark). */
export const GEMINI_SURFACE = { light: "#f8fafd", dark: "#131314" } as const;

/** Served `bard` title gradient (`GEMINI_TITLE_BLUE/PURPLE/PINK`). Greeting and sparkle only. */
export const TITLE_GRADIENT_STOPS = ["#4285f4", "#9b72cb", "#d96570"] as const;

/** Prompt bar and chip corners (gemini_brand.rs, reference section 5). */
export const SHAPE = {
  promptEmpty: "40px",
  promptContent: "32px",
  promptDocked: "24px 24px 0 0",
  chip: "16px",
} as const;

/** Reading column of the conversation, in px. */
export const READING_COLUMN = 760;

/** Google Sans Flex variable weights (reference section 5). */
export const WEIGHTS = { display: 280, headline: 350, body: 400, bodyStrong: 500 } as const;
