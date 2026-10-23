// SPDX-License-Identifier: Apache-2.0
// Applies the appearance preferences to the document, live: the M3 colour scheme (#seed-css, from a built-in,
// seed or custom theme, run in the browser through cssFromSeed), light/dark mode, and CSS custom properties and
// data attributes that styles.css reads for type, shape, density, motion, transparency, focus ring and layout.
// It also stores the boot snapshot that src/boot.ts replays before first paint, so a reload never flashes.
import { prefs, type PrefKey } from "./prefs";
import { themeCss } from "./themes";

const FONTS: Record<string, string> = {
  "google-sans-flex":
    '"Google Sans Flex", "Roboto Flex", system-ui, sans-serif',
  "roboto-flex": '"Roboto Flex", "Google Sans Flex", system-ui, sans-serif',
  "google-sans-code":
    '"Google Sans Code", "Roboto Mono", ui-monospace, monospace',
  "roboto-mono": '"Roboto Mono", "Google Sans Code", ui-monospace, monospace',
  system: "system-ui, sans-serif",
};
const DENSITY = { compact: -1, standard: 0, comfortable: 1 } as const;

const systemReduced = matchMedia("(prefers-reduced-motion: reduce)");
const systemMore = matchMedia("(prefers-contrast: more)");

/** True when motion should be reduced, from the preference or the system setting. */
export function motionReduced(): boolean {
  const mode = prefs.get("motion.mode");
  return mode === "reduced" || (mode === "system" && systemReduced.matches);
}

/** Effective M3 contrast level: high contrast forces the maximum. */
export const contrastLevel = () =>
  prefs.get("a11y.highContrast") || systemMore.matches
    ? 1
    : prefs.get("theme.contrast");

export const BOOT_KEY = "aph.boot";
export interface BootSnapshot {
  mode: string;
  css: string;
  vars: Record<string, string>;
  attrs: Record<string, string>;
}

function themeStylesheet() {
  return themeCss(prefs.get("theme.id"), {
    seed: prefs.get("theme.seed"),
    variant: prefs.get("theme.variant"),
    contrast: contrastLevel(),
    custom: prefs.get("theme.custom"),
  });
}

/** CSS custom properties driven by preferences. */
function cssVars(): Record<string, string> {
  const step = DENSITY[prefs.get("layout.density")];
  const large = prefs.get("a11y.largeTargets");
  const transparency = prefs.get("surface.transparency");
  const blur = prefs.get("surface.blur");
  const font = FONTS[prefs.get("type.family")] ?? FONTS["google-sans-flex"]!;
  const dock = prefs.get("dock.size");
  const ctl = Math.max(large ? 44 : 0, 32 + step * 4);
  return {
    "--font-sans": font,
    "--md-ref-typeface-brand": font,
    "--md-ref-typeface-plain": font,
    "--fs": String(prefs.get("type.scale")),
    "--shape": String(prefs.get("shape.radius")),
    "--density": String(step),
    "--ctl": `${ctl}px`,
    "--ws-dot": `${large ? 32 : 24 + step * 2}px`,
    "--bar-h": `${Math.max(large ? 52 : 0, 40 + step * 6)}px`,
    "--pad": String(1 + step * 0.25),
    "--glass-a": `${Math.round((1 - transparency) * 100)}%`,
    "--glass-strong-a": `${Math.round((1 - transparency * 0.5) * 100)}%`,
    "--blur": `${blur}px`,
    "--focus-w": `${prefs.get("a11y.focusRing")}px`,
    "--gap": `${prefs.get("windows.gap")}px`,
    "--win-border": `${prefs.get("windows.border")}px`,
    "--dock-icon": `${dock}px`,
  };
}

/** Data attributes on <html> for rules that switch layout or behaviour. */
function dataAttrs(): Record<string, string> {
  return {
    motion: motionReduced() ? "reduced" : "normal",
    contrast: prefs.get("a11y.highContrast") ? "high" : "standard",
    targets: prefs.get("a11y.largeTargets") ? "large" : "standard",
    bar: prefs.get("bar.position"),
    dock: prefs.get("dock.position"),
    dockHide: prefs.get("dock.autohide") ? "auto" : "never",
  };
}

const THEME_KEYS = new Set<PrefKey>([
  "theme.mode",
  "theme.id",
  "theme.seed",
  "theme.variant",
  "theme.contrast",
  "theme.custom",
  "a11y.highContrast",
]);
const VAR_KEYS = new Set<PrefKey>([
  "type.family",
  "type.scale",
  "shape.radius",
  "layout.density",
  "motion.mode",
  "surface.transparency",
  "surface.blur",
  "a11y.focusRing",
  "a11y.highContrast",
  "a11y.largeTargets",
  "windows.gap",
  "windows.border",
  "dock.size",
  "dock.position",
  "dock.autohide",
  "bar.position",
]);

const themeListeners = new Set<() => void>();
/** Run after the colour scheme changed (the wallpaper repaints from the new roles). */
export const onThemeChange = (fn: () => void) => themeListeners.add(fn);

let lastCss = "";
function applyTheme(animate: boolean) {
  const run = () => {
    const root = document.documentElement;
    const mode = prefs.get("theme.mode");
    if (mode === "auto") root.removeAttribute("data-theme");
    else root.dataset.theme = mode;
    const css = themeStylesheet();
    if (css !== lastCss) {
      const style =
        document.getElementById("seed-css") ??
        document.head.appendChild(
          Object.assign(document.createElement("style"), { id: "seed-css" }),
        );
      style.textContent = css;
      lastCss = css;
    }
    for (const fn of themeListeners) fn();
  };
  // One cross-fade at a time: a change during a running transition (dragging a slider) applies directly.
  if (
    animate &&
    document.startViewTransition &&
    !motionReduced() &&
    !transition
  ) {
    transition = document.startViewTransition(run);
    const done = () => (transition = undefined);
    transition.ready.catch(() => {});
    transition.finished.then(done, done);
  } else run();
}
let transition: ViewTransition | undefined;

function applyVars() {
  const root = document.documentElement;
  for (const [k, v] of Object.entries(cssVars())) root.style.setProperty(k, v);
  for (const [k, v] of Object.entries(dataAttrs())) root.dataset[k] = v;
}

let snapshotTimer: ReturnType<typeof setTimeout> | undefined;
function saveSnapshot() {
  clearTimeout(snapshotTimer);
  snapshotTimer = setTimeout(() => {
    const snapshot: BootSnapshot = {
      mode: prefs.get("theme.mode"),
      css: lastCss,
      vars: cssVars(),
      attrs: dataAttrs(),
    };
    try {
      localStorage.setItem(BOOT_KEY, JSON.stringify(snapshot));
    } catch {
      // Storage full or blocked: the next visit paints the default theme first.
    }
  }, 200);
}

/** Apply every appearance preference now and whenever one changes (this tab or another). */
export function installAppearance() {
  applyTheme(false);
  applyVars();
  saveSnapshot();
  prefs.subscribe("*", (_, key) => {
    if (THEME_KEYS.has(key)) applyTheme(true);
    if (VAR_KEYS.has(key)) applyVars();
    if (THEME_KEYS.has(key) || VAR_KEYS.has(key)) saveSnapshot();
  });
  systemReduced.addEventListener("change", applyVars);
  systemMore.addEventListener("change", () => applyTheme(false));
}

// Language and region ------------------------------------------------------------------------------
/** Locale for dates and numbers: the preference, else the browser language. */
export const locale = () => {
  const l = prefs.get("region.locale");
  return l === "auto" ? navigator.language : l;
};
const zone = () => {
  const z = prefs.get("region.timeZone");
  return z === "auto" ? undefined : z;
};

/** Time of day in the clock format of the preferences. */
export function formatTime(
  d: Date,
  seconds = prefs.get("clock.seconds"),
): string {
  const cycle = prefs.get("clock.hourCycle");
  return new Intl.DateTimeFormat(locale(), {
    hour: "numeric",
    minute: "2-digit",
    second: seconds ? "2-digit" : undefined,
    hourCycle: cycle === "auto" ? undefined : cycle,
    timeZone: zone(),
  }).format(d);
}

/** Date in a preference style: the bar (short or long) or the region date style. */
export function formatDate(
  d: Date,
  style: "short" | "long" | "region" = "region",
): string {
  if (style === "short")
    return new Intl.DateTimeFormat(locale(), {
      weekday: "short",
      day: "numeric",
      month: "short",
      timeZone: zone(),
    }).format(d);
  if (style === "long")
    return new Intl.DateTimeFormat(locale(), {
      weekday: "long",
      day: "numeric",
      month: "long",
      timeZone: zone(),
    }).format(d);
  return new Intl.DateTimeFormat(locale(), {
    dateStyle: prefs.get("region.dateStyle"),
    timeZone: zone(),
  }).format(d);
}

/** Numbers and byte sizes in the chosen locale. */
export function formatBytes(n: number): string {
  const units = [
    "byte",
    "kilobyte",
    "megabyte",
    "gigabyte",
    "terabyte",
  ] as const;
  let i = 0;
  while (n >= 1000 && i < units.length - 1) {
    n /= 1000;
    i++;
  }
  return new Intl.NumberFormat(locale(), {
    style: "unit",
    unit: units[i],
    unitDisplay: "short",
    maximumFractionDigits: n < 10 && i > 0 ? 1 : 0,
  }).format(n);
}
