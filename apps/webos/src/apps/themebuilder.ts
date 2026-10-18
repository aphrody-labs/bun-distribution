// SPDX-License-Identifier: Apache-2.0
// Material Theme Builder: seed colour (picker, hex, image), scheme variant, contrast, live light/dark preview of the
// real md-* elements, tonal palettes, role swatches with WCAG ratios, exports, and "apply to the whole OS".
// Colour maths: @material/material-color-utilities through @aphrody/m3-tokens (schemeFromSeed, cssFromSeed, exporters).
import {
  Hct,
  SchemeContent,
  SchemeExpressive,
  SchemeFidelity,
  SchemeMonochrome,
  SchemeNeutral,
  SchemeTonalSpot,
  SchemeVibrant,
  argbFromHex,
  hexFromArgb,
  sourceColorFromImage,
  type DynamicScheme,
} from "@material/material-color-utilities";
import {
  ROLES,
  cssFromSeed,
  exportFusionCss,
  normalizeSeedHex,
  schemeFromSeed,
  type SchemeVariant,
} from "@aphrody/m3-tokens/dynamic-color";
import { parseNativeThemeExport } from "@aphrody/m3-tokens/native-theme";
import { h, icon } from "../dom";
import css from "./themebuilder.css" with { type: "text" };
import "@aphrody/material-web/button/elevated-button.js";
import "@aphrody/material-web/button/outlined-button.js";
import "@aphrody/material-web/checkbox/checkbox.js";
import "@aphrody/material-web/chips/chip-set.js";
import "@aphrody/material-web/chips/filter-chip.js";
import "@aphrody/material-web/chips/assist-chip.js";
import "@aphrody/material-web/fab/fab.js";
import "@aphrody/material-web/iconbutton/icon-button.js";
import "@aphrody/material-web/iconbutton/filled-icon-button.js";
import "@aphrody/material-web/progress/circular-progress.js";
import "@aphrody/material-web/radio/radio.js";
import "@aphrody/material-web/slider/slider.js";
import "@aphrody/material-web/switch/switch.js";
import "@aphrody/material-web/tabs/secondary-tab.js";

export type ThemeMode = "auto" | "light" | "dark";
export interface ThemePrefs {
  seed: string;
  mode: ThemeMode;
  variant: SchemeVariant;
  contrast: number;
}

export const DEFAULT_THEME: ThemePrefs = { seed: "#6750a4", mode: "auto", variant: "expressive", contrast: 0 };
export const VARIANTS: [SchemeVariant, string][] = [
  ["tonalSpot", "Tonal spot"],
  ["vibrant", "Vibrant"],
  ["expressive", "Expressive"],
  ["content", "Content"],
  ["fidelity", "Fidelity"],
  ["neutral", "Neutral"],
  ["monochrome", "Monochrome"],
];
const KEBAB: Record<SchemeVariant, string> = {
  tonalSpot: "tonal-spot",
  vibrant: "vibrant",
  expressive: "expressive",
  content: "content",
  fidelity: "fidelity",
  neutral: "neutral",
  monochrome: "monochrome",
};

/** Persisted preferences (localStorage aph.seed / aph.mode / aph.variant / aph.contrast). */
export function readTheme(): ThemePrefs {
  let seed = DEFAULT_THEME.seed;
  try {
    seed = normalizeSeedHex(localStorage.getItem("aph.seed") ?? seed);
  } catch {}
  const m = localStorage.getItem("aph.mode");
  const v = localStorage.getItem("aph.variant") as SchemeVariant | null;
  const c = Number(localStorage.getItem("aph.contrast") ?? 0);
  return {
    seed,
    mode: m === "light" || m === "dark" ? m : "auto",
    variant: v && v in KEBAB ? v : DEFAULT_THEME.variant,
    contrast: Number.isFinite(c) ? Math.max(-1, Math.min(1, c)) : 0,
  };
}

export function saveTheme(p: ThemePrefs) {
  localStorage.setItem("aph.seed", p.seed);
  localStorage.setItem("aph.mode", p.mode);
  localStorage.setItem("aph.variant", p.variant);
  localStorage.setItem("aph.contrast", String(p.contrast));
}

/** Apply the persisted theme to the whole document: data-theme plus the `#seed-css` stylesheet. */
export function applyTheme(p: ThemePrefs = readTheme()): void {
  const root = document.documentElement;
  if (p.mode === "auto") root.removeAttribute("data-theme");
  else root.dataset.theme = p.mode;
  let style = document.getElementById("seed-css");
  const baked =
    p.seed === DEFAULT_THEME.seed && p.variant === DEFAULT_THEME.variant && p.contrast === DEFAULT_THEME.contrast;
  if (baked) style?.remove();
  else {
    style ??= document.head.appendChild(h("style", { id: "seed-css" }));
    style.textContent = cssFromSeed(p.seed, { variant: p.variant, contrastLevel: p.contrast });
  }
}

// ---------------------------------------------------------------- colour helpers
const SCHEMES = {
  tonalSpot: SchemeTonalSpot,
  vibrant: SchemeVibrant,
  expressive: SchemeExpressive,
  content: SchemeContent,
  fidelity: SchemeFidelity,
  neutral: SchemeNeutral,
  monochrome: SchemeMonochrome,
};
function scheme(p: ThemePrefs, dark: boolean): DynamicScheme {
  return new SCHEMES[p.variant](Hct.fromInt(argbFromHex(p.seed)), dark, p.contrast);
}
const lum = (hex: string) => {
  const n = parseInt(hex.slice(1), 16);
  const f = (c: number) => ((c /= 255) <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * f((n >> 16) & 255) + 0.7152 * f((n >> 8) & 255) + 0.0722 * f(n & 255);
};
export function contrastRatio(a: string, b: string): number {
  const [x, y] = [lum(a), lum(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}
const kebab = (r: string) => r.replace(/([A-Z])/g, "-$1").toLowerCase();
const roleVar = (r: string) => `--md-sys-color-${kebab(r)}`;
const TONES = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 95, 99, 100];
const PALETTES = [
  ["Primary", "primaryPalette"],
  ["Secondary", "secondaryPalette"],
  ["Tertiary", "tertiaryPalette"],
  ["Neutral", "neutralPalette"],
  ["Neutral variant", "neutralVariantPalette"],
  ["Error", "errorPalette"],
] as const;
const GROUPS: [string, [string, string][]][] = [
  [
    "Accent",
    [
      ["primary", "onPrimary"],
      ["primaryContainer", "onPrimaryContainer"],
      ["secondary", "onSecondary"],
      ["secondaryContainer", "onSecondaryContainer"],
      ["tertiary", "onTertiary"],
      ["tertiaryContainer", "onTertiaryContainer"],
      ["error", "onError"],
      ["errorContainer", "onErrorContainer"],
    ],
  ],
  [
    "Surface",
    [
      ["surface", "onSurface"],
      ["surfaceVariant", "onSurfaceVariant"],
      ["surfaceContainerLowest", "onSurface"],
      ["surfaceContainerLow", "onSurface"],
      ["surfaceContainer", "onSurface"],
      ["surfaceContainerHigh", "onSurface"],
      ["surfaceContainerHighest", "onSurface"],
      ["inverseSurface", "inverseOnSurface"],
    ],
  ],
  [
    "Fixed and other",
    [
      ["primaryFixed", "onPrimaryFixed"],
      ["primaryFixedDim", "onPrimaryFixedVariant"],
      ["secondaryFixed", "onSecondaryFixed"],
      ["tertiaryFixed", "onTertiaryFixed"],
      ["inversePrimary", "inverseSurface"],
      ["outline", "surface"],
      ["outlineVariant", "surface"],
      ["scrim", "surface"],
    ],
  ],
];

// ---------------------------------------------------------------- exports
function exportJson(p: ThemePrefs): string {
  const toRoles = (dark: boolean) => {
    const vars = schemeFromSeed(p.seed, { dark, variant: p.variant, contrastLevel: p.contrast });
    return Object.fromEntries(ROLES.map(r => [r, vars[roleVar(r)]]));
  };
  const theme = {
    schema_version: 1,
    spec_version: "2021",
    seed: p.seed,
    variant: KEBAB[p.variant],
    contrast_level: p.contrast,
    light: toRoles(false),
    dark: toRoles(true),
  };
  return JSON.stringify(parseNativeThemeExport(theme), null, 2);
}
function exportAndroid(p: ThemePrefs): string {
  const snake = (r: string) => kebab(r).replace(/-/g, "_");
  const block = (dark: boolean) => {
    const vars = schemeFromSeed(p.seed, { dark, variant: p.variant, contrastLevel: p.contrast });
    return ROLES.map(r => `    <color name="md_theme_${dark ? "dark" : "light"}_${snake(r)}">${vars[roleVar(r)]}</color>`);
  };
  const kt = (dark: boolean) => {
    const vars = schemeFromSeed(p.seed, { dark, variant: p.variant, contrastLevel: p.contrast });
    return ROLES.map(r => {
      const v = vars[roleVar(r)]!.slice(1).toUpperCase();
      return `val md_theme_${dark ? "dark" : "light"}_${r} = Color(0xFF${v})`;
    });
  };
  return [
    "<!-- res/values/colors.xml -->",
    '<?xml version="1.0" encoding="utf-8"?>',
    "<resources>",
    ...block(false),
    ...block(true),
    "</resources>",
    "",
    "// ui/theme/Color.kt (Jetpack Compose)",
    "import androidx.compose.ui.graphics.Color",
    ...kt(false),
    ...kt(true),
  ].join("\n");
}
function exportTailwind(p: ThemePrefs): string {
  return `/* Tailwind v4 + shadcn: M3 roles, shadcn aliases, @theme inline */\n${exportFusionCss(p.seed, { variant: p.variant, contrastLevel: p.contrast })}`;
}
const EXPORTS: [string, string, (p: ThemePrefs) => string, string][] = [
  [
    "CSS",
    "theme.css",
    p => cssFromSeed(p.seed, { variant: p.variant, contrastLevel: p.contrast }),
    "text/css",
  ],
  ["JSON", "theme.json", exportJson, "application/json"],
  ["Android", "colors.xml", exportAndroid, "text/plain"],
  ["Tailwind", "theme.tailwind.css", exportTailwind, "text/css"],
];

// ---------------------------------------------------------------- app
let cssInjected = false;
export function themeBuilderApp(root: HTMLElement) {
  if (!cssInjected) {
    cssInjected = true;
    document.head.append(h("style", { id: "themebuilder-css" }, css));
  }
  const state: ThemePrefs = readTheme();
  let swatchDark = matchMedia("(prefers-color-scheme: dark)").matches;
  let exportTab = 0;
  let queued = false;

  const picker = h("input", { type: "color", class: "tb-picker", "aria-label": "Seed colour" });
  const hex = document.createElement("md-outlined-text-field") as HTMLElement & { value: string; error: boolean };
  hex.setAttribute("label", "Seed hex");
  hex.className = "tb-hex";
  const contrastSlider = document.createElement("md-slider") as HTMLElement & { value: number };
  for (const [k, v] of Object.entries({ min: "-1", max: "1", step: "0.25", labeled: "", ticks: "" }))
    contrastSlider.setAttribute(k, v);
  const contrastLabel = h("span", { class: "tb-val" });
  const variantRow = h("div", { class: "tb-seg", role: "radiogroup", "aria-label": "Scheme variant" });
  const modeRow = h("div", { class: "tb-seg", role: "radiogroup", "aria-label": "OS mode" });
  const presetRow = h("div", { class: "tb-presets" });
  const imageInfo = h("div", { class: "tb-image muted" }, "Drop an image here or choose a file to extract a seed.");
  const file = h("input", { type: "file", accept: "image/*", hidden: true });
  const lightPanel = h("section", { class: "tb-panel", "aria-label": "Light preview" });
  const darkPanel = h("section", { class: "tb-panel", "aria-label": "Dark preview" });
  const palettes = h("div", { class: "tb-palettes" });
  const roles = h("div", { class: "tb-roles" });
  const swatchSeg = h("div", { class: "tb-seg" });
  const exportSeg = h("div", { class: "tb-seg" });
  const exportOut = h("textarea", { class: "tb-out", readonly: true, spellcheck: "false", "aria-label": "Export" });
  const status = h("span", { class: "tb-status muted", role: "status" });

  const flash = (t: string) => {
    status.textContent = t;
    setTimeout(() => status.textContent === t && (status.textContent = ""), 2200);
  };
  const schedule = () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      render();
    });
  };
  const setSeed = (v: string) => {
    try {
      state.seed = normalizeSeedHex(v);
      hex.error = false;
      schedule();
    } catch {
      hex.error = true;
    }
  };

  picker.addEventListener("input", () => setSeed(picker.value));
  hex.addEventListener("input", () => setSeed(hex.value));
  contrastSlider.addEventListener("input", () => {
    state.contrast = contrastSlider.value;
    schedule();
  });

  const seg = <T extends string>(
    host: HTMLElement,
    items: [T, string][],
    get: () => T,
    set: (v: T) => void,
  ) => {
    host.replaceChildren(
      ...items.map(([v, label]) =>
        h(
          "button",
          { class: "tb-seg-btn", role: "radio", "aria-checked": String(get() === v), onclick: () => set(v) },
          label,
        ),
      ),
    );
  };

  for (const [name, color] of [
    ["Violet", "#6750a4"],
    ["Ocean", "#0b6bcb"],
    ["Forest", "#2e7d32"],
    ["Sunset", "#d84315"],
    ["Rose", "#c2185b"],
    ["Gold", "#f9a825"],
    ["Teal", "#00796b"],
    ["Slate", "#455a64"],
  ] as const)
    presetRow.append(
      h("button", {
        class: "tb-dot",
        title: name,
        "aria-label": name,
        style: `background:${color}`,
        onclick: () => setSeed(color),
      }),
    );

  async function fromImage(f: File | undefined) {
    if (!f || !f.type.startsWith("image/")) return;
    const url = URL.createObjectURL(f);
    try {
      const img = h("img", { src: url, alt: f.name });
      await img.decode();
      const argb = await sourceColorFromImage(img);
      const color = hexFromArgb(argb);
      imageInfo.replaceChildren(
        h("img", { src: url, alt: "", class: "tb-thumb" }),
        h("span", {}, `${f.name}: ${color}`),
      );
      setSeed(color);
    } catch {
      URL.revokeObjectURL(url);
      imageInfo.textContent = "That image could not be read.";
    }
  }
  file.addEventListener("change", () => void fromImage(file.files?.[0]));
  const dropZone = h(
    "div",
    { class: "tb-drop" },
    imageInfo,
    h("button", { class: "btn tonal", onclick: () => file.click() }, "Choose image"),
    file,
  );
  dropZone.addEventListener("dragover", e => {
    e.preventDefault();
    dropZone.classList.add("over");
  });
  dropZone.addEventListener("dragleave", () => dropZone.classList.remove("over"));
  dropZone.addEventListener("drop", e => {
    e.preventDefault();
    dropZone.classList.remove("over");
    void fromImage((e as DragEvent).dataTransfer?.files[0]);
  });

  // ---- preview content: real md-* elements, themed by inline role variables
  function preview(panel: HTMLElement, dark: boolean) {
    const vars = schemeFromSeed(state.seed, { dark, variant: state.variant, contrastLevel: state.contrast });
    panel.style.cssText = Object.entries(vars)
      .map(([k, v]) => `${k}:${v}`)
      .join(";");
    panel.style.colorScheme = dark ? "dark" : "light";
    if (panel.childElementCount) return;
    const el = (tag: string, attrs: Record<string, string> = {}, text = "") => {
      const e = document.createElement(tag);
      for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
      if (text) e.textContent = text;
      return e;
    };
    const sym = (n: string) => {
      const s = icon("app");
      s.textContent = n;
      return s;
    };
    const lead = (n: string) => {
      const s = sym(n);
      s.slot = "icon";
      return s;
    };
    const fab = el("md-fab", { "aria-label": "Add" });
    fab.append(lead("add"));
    const ib = el("md-filled-icon-button", { "aria-label": "Favorite" });
    ib.append(sym("favorite"));
    const ib2 = el("md-icon-button", { "aria-label": "Share" });
    ib2.append(sym("share"));
    const chips = el("md-chip-set");
    chips.append(el("md-filter-chip", { label: "Filter", selected: "" }), el("md-assist-chip", { label: "Assist" }));
    const tabs = el("md-tabs");
    tabs.append(el("md-secondary-tab", {}, "Flights"), el("md-secondary-tab", {}, "Trips"));
    const sw = el("md-switch", { selected: "", "aria-label": "Switch" });
    const cb = el("md-checkbox", { checked: "", "aria-label": "Checkbox" });
    const rd = el("md-radio", { checked: "", name: `r${dark}`, "aria-label": "Radio" });
    const sl = el("md-slider", { value: "40", "aria-label": "Slider" });
    const tf = el("md-outlined-text-field", { label: "Label", value: "Text field" });
    panel.append(
      h("h3", {}, dark ? "Dark" : "Light"),
      h("div", { class: "tb-card" }, h("strong", {}, "Surface container"), h("span", {}, "On surface variant text")),
      h(
        "div",
        { class: "tb-row" },
        el("md-filled-button", {}, "Filled"),
        el("md-filled-tonal-button", {}, "Tonal"),
        el("md-outlined-button", {}, "Outlined"),
        el("md-elevated-button", {}, "Elevated"),
        el("md-text-button", {}, "Text"),
      ),
      h("div", { class: "tb-row" }, fab, ib, ib2, chips),
      tabs,
      tf,
      h("div", { class: "tb-row" }, sw, cb, rd, el("md-circular-progress", { value: "0.6" }), sl),
      h(
        "div",
        { class: "tb-row" },
        h("span", { class: "tb-pill", style: "background:var(--md-sys-color-primary-container);color:var(--md-sys-color-on-primary-container)" }, "primaryContainer"),
        h("span", { class: "tb-pill", style: "background:var(--md-sys-color-tertiary-container);color:var(--md-sys-color-on-tertiary-container)" }, "tertiaryContainer"),
        h("span", { class: "tb-pill", style: "background:var(--md-sys-color-error-container);color:var(--md-sys-color-on-error-container)" }, "errorContainer"),
      ),
    );
  }

  function render() {
    picker.value = state.seed;
    if (hex.value !== state.seed && !hex.matches(":focus-within")) hex.value = state.seed;
    contrastSlider.value = state.contrast;
    contrastLabel.textContent = ["Reduced", "Reduced", "Standard", "Medium", "High"][Math.round(state.contrast * 2) + 2] ?? "";
    seg(variantRow, VARIANTS, () => state.variant, v => ((state.variant = v), schedule()));
    seg(
      modeRow,
      [["auto", "Auto"], ["light", "Light"], ["dark", "Dark"]],
      () => state.mode,
      v => ((state.mode = v), schedule()),
    );
    seg(
      swatchSeg,
      [["light", "Light"], ["dark", "Dark"]],
      () => (swatchDark ? "dark" : "light"),
      v => ((swatchDark = v === "dark"), schedule()),
    );
    seg(
      exportSeg,
      EXPORTS.map((e, i) => [String(i), e[0]] as [string, string]),
      () => String(exportTab),
      v => ((exportTab = Number(v)), schedule()),
    );
    preview(lightPanel, false);
    preview(darkPanel, true);

    const sch = scheme(state, swatchDark);
    palettes.replaceChildren(
      ...PALETTES.map(([label, key]) => {
        const pal = sch[key];
        return h(
          "div",
          { class: "tb-pal" },
          h("div", { class: "tb-pal-name" }, label),
          h(
            "div",
            { class: "tb-tones" },
            ...TONES.map(t => {
              const c = hexFromArgb(pal.tone(t));
              return h(
                "button",
                {
                  class: "tb-tone",
                  title: `${label} ${t}: ${c}`,
                  style: `background:${c};color:${t < 55 ? "#fff" : "#000"}`,
                  onclick: () => void navigator.clipboard?.writeText(c).then(() => flash(`Copied ${c}`)),
                },
                String(t),
              );
            }),
          ),
        );
      }),
    );

    const vars = schemeFromSeed(state.seed, { dark: swatchDark, variant: state.variant, contrastLevel: state.contrast });
    roles.replaceChildren(
      ...GROUPS.map(([title, pairs]) =>
        h(
          "div",
          { class: "tb-group" },
          h("h4", {}, title),
          h(
            "div",
            { class: "tb-swatches" },
            ...pairs.map(([bg, fg]) => {
              const b = vars[roleVar(bg)]!;
              const f = vars[roleVar(fg)]!;
              const r = contrastRatio(b, f);
              return h(
                "button",
                {
                  class: "tb-swatch",
                  style: `background:${b};color:${f}`,
                  title: `${bg} ${b} on ${fg} ${f}`,
                  onclick: () => void navigator.clipboard?.writeText(b).then(() => flash(`Copied ${b}`)),
                },
                h("span", { class: "tb-sw-name" }, bg),
                h("span", { class: "tb-sw-hex" }, b),
                h("span", { class: "tb-sw-ratio" }, `${r.toFixed(2)}:1 ${r >= 7 ? "AAA" : r >= 4.5 ? "AA" : r >= 3 ? "AA large" : "fail"}`),
              );
            }),
          ),
        ),
      ),
    );
    exportOut.value = EXPORTS[exportTab]![2](state);
  }

  const applyOs = () => {
    saveTheme(state);
    applyTheme(state);
    flash("Applied to the OS");
  };
  const reset = () => {
    Object.assign(state, DEFAULT_THEME);
    saveTheme(state);
    applyTheme(state);
    schedule();
    flash("Reset to default");
  };
  const copy = () => void navigator.clipboard?.writeText(exportOut.value).then(() => flash("Copied"));
  const download = () => {
    const [, name, , mime] = EXPORTS[exportTab]!;
    const a = h("a", { href: URL.createObjectURL(new Blob([exportOut.value], { type: mime })), download: name });
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };

  root.classList.add("tb");
  root.append(
    h(
      "div",
      { class: "tb-controls" },
      h("div", { class: "tb-field" }, h("label", {}, "Seed colour"), h("div", { class: "tb-row" }, picker, hex)),
      presetRow,
      dropZone,
      h("div", { class: "tb-field" }, h("label", {}, "Scheme variant"), variantRow),
      h(
        "div",
        { class: "tb-field" },
        h("label", {}, "Contrast level ", contrastLabel),
        contrastSlider,
      ),
      h("div", { class: "tb-field" }, h("label", {}, "OS mode"), modeRow),
      h(
        "div",
        { class: "tb-row" },
        h("button", { class: "btn", onclick: applyOs }, "Apply to OS"),
        h("button", { class: "btn tonal", onclick: reset }, "Reset"),
      ),
      status,
    ),
    h(
      "div",
      { class: "tb-main" },
      h("div", { class: "tb-previews" }, lightPanel, darkPanel),
      h("div", { class: "tb-head" }, h("h3", {}, "Tonal palettes and roles"), swatchSeg),
      palettes,
      roles,
      h(
        "div",
        { class: "tb-head" },
        h("h3", {}, "Export"),
        exportSeg,
        h("button", { class: "btn tonal", onclick: copy }, "Copy"),
        h("button", { class: "btn tonal", onclick: download }, "Download"),
      ),
      exportOut,
    ),
  );
  customElements.whenDefined("md-slider").then(render);
  render();
}
