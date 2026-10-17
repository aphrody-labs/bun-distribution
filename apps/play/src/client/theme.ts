// SPDX-License-Identifier: Apache-2.0
/**
 * Per-game M3 dynamic color (design-system/bun-os-play/DIRECTION.md): the seed is the source
 * color of the focused game's real art (material-color-utilities' image scoring), the scheme
 * comes from the M3 owner's `applyDynamicColor` (@aphrody/m3-tokens), in the light or dark mode
 * the player picked. With no art, the baseline seed of MASTER.md applies.
 */
import {
  applyDynamicColor,
  hexFromArgb,
} from "@aphrody/m3-tokens/dynamic-color";
import { sourceColorFromImageBytes } from "@material/material-color-utilities";

export type ThemeMode = "system" | "light" | "dark";

const STORAGE_KEY = "play-theme";
const BASELINE_SEED =
  getComputedStyle(document.documentElement)
    .getPropertyValue("--play-seed")
    .trim() || "#6750a4";
const media = matchMedia("(prefers-color-scheme: dark)");
const seeds = new Map<string, string>();
let seed = BASELINE_SEED;

export function themeMode(): ThemeMode {
  const stored = localStorage.getItem(STORAGE_KEY);
  return stored === "light" || stored === "dark" ? stored : "system";
}

function isDark(): boolean {
  const mode = themeMode();
  return mode === "dark" || (mode === "system" && media.matches);
}

function apply(): void {
  const dark = isDark();
  const root = document.documentElement;
  applyDynamicColor(seed, { dark, variant: "tonalSpot" });
  root.style.colorScheme = dark ? "dark" : "light";
  root.dataset.theme = dark ? "dark" : "light";
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute(
      "content",
      getComputedStyle(root).getPropertyValue("--md-sys-color-surface").trim(),
    );
}

export function setThemeMode(mode: ThemeMode): void {
  if (mode === "system") localStorage.removeItem(STORAGE_KEY);
  else localStorage.setItem(STORAGE_KEY, mode);
  apply();
}

/** RGBA of the image scaled into 64x64: enough for the M3 image scorer, cheap on the main thread. */
function sample(image: HTMLImageElement): Uint8ClampedArray {
  const side = 64;
  const canvas = new OffscreenCanvas(side, side);
  const context = canvas.getContext("2d", { willReadFrequently: true })!;
  context.drawImage(image, 0, 0, side, side);
  return context.getImageData(0, 0, side, side).data;
}

/** Re-tints the whole scheme from a loaded, same-origin image (cached by URL). */
export async function tintFromImage(
  image: HTMLImageElement | null,
): Promise<void> {
  if (!image) {
    seed = BASELINE_SEED;
    apply();
    return;
  }
  const key = image.currentSrc || image.src;
  let next = seeds.get(key);
  if (!next) {
    if (!image.complete) await image.decode().catch(() => undefined);
    next = image.naturalWidth
      ? hexFromArgb(sourceColorFromImageBytes(sample(image)))
      : BASELINE_SEED;
    seeds.set(key, next);
  }
  seed = next;
  apply();
}

media.addEventListener("change", () => themeMode() === "system" && apply());
apply();
