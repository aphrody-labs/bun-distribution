// SPDX-License-Identifier: Apache-2.0
// Aphrody brand constants shared by the generated sheet and the webview (no generator deps).
// The seed and accents are the colours of the Aphrody pet (m3/packages/identity, PET_COLORS).
import { PET_COLORS } from "@aphrody/identity/pet";

/** Aphrody pet sock mauve (PET_COLORS.seed in @aphrody/identity). */
export const BRAND_SEED = PET_COLORS.seed;

/** Exact pet colours kept as accents next to the derived roles. */
export const PET_ACCENTS = {
  hair: PET_COLORS.hair,
  skin: PET_COLORS.skin,
  tunic: PET_COLORS.tunic,
} as const;

/** Greeting and sparkle follow the pet's generated roles in either colour scheme. */
export const TITLE_GRADIENT_STOPS = [
  "var(--md-sys-color-primary)",
  "var(--md-sys-color-secondary)",
  "var(--md-sys-color-tertiary)",
] as const;

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
