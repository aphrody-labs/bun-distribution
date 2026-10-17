// SPDX-License-Identifier: Apache-2.0
/** Theme files on disk (JSON, TOML, CSS) for Bun hosts: baseline + selected theme + plugin themes. */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { extname, join } from "node:path";
import { platformPaths, readSettings } from "../paths";
import { mergeTheme, type ThemeFile, themeFromCss } from "./resolve";

export * from "./resolve";

/** Themes contributed by plugins (`themes` permission), by id. */
const contributed = new Map<string, ThemeFile>();
export function contributeTheme(file: ThemeFile): void {
  if (!file.id) throw new TypeError("a contributed theme needs an id");
  contributed.set(file.id, file);
}

export function parseThemeFile(text: string, ext: string): ThemeFile {
  const e = ext.replace(/^\./, "").toLowerCase();
  if (e === "toml") return Bun.TOML.parse(text) as ThemeFile;
  if (e === "css") return themeFromCss(text);
  return JSON.parse(text) as ThemeFile;
}

export function readThemeFile(path: string): ThemeFile {
  return parseThemeFile(readFileSync(path, "utf8"), extname(path));
}

function themeDirs(): string[] {
  const p = platformPaths();
  return [p.baseThemes, p.themes];
}

/** Every installed theme (id -> file), base directory first. */
export function listThemes(): Map<string, ThemeFile> {
  const out = new Map<string, ThemeFile>();
  for (const dir of themeDirs()) {
    if (!existsSync(dir)) continue;
    for (const f of readdirSync(dir).sort()) {
      if (
        !/\.(json|toml|css)$/.test(f) ||
        f === "m3-tables.json" ||
        f.endsWith(".schema.json")
      )
        continue;
      try {
        const file = readThemeFile(join(dir, f));
        out.set(file.id ?? f.replace(/\.[^.]+$/, ""), file);
      } catch {
        /* skip unreadable theme files; `bun-os-platform check` reports them */
      }
    }
  }
  // Themes of trusted plugins (`themes` permission), without running plugin code.
  const { trustedPluginDirsSync } =
    require("../plugins") as typeof import("../plugins");
  for (const { dir, manifest } of trustedPluginDirsSync()) {
    if (
      !manifest.permissions.includes("themes") ||
      !existsSync(join(dir, "themes"))
    )
      continue;
    for (const f of readdirSync(join(dir, "themes"))
      .sort()
      .filter((f) => /\.(json|toml|css)$/.test(f))) {
      try {
        const file = readThemeFile(join(dir, "themes", f));
        out.set(
          file.id ?? `${manifest.name}/${f.replace(/\.[^.]+$/, "")}`,
          file,
        );
      } catch {
        /* reported by `bun-os-platform check` */
      }
    }
  }
  for (const [id, file] of contributed) out.set(id, file);
  return out;
}

export function baselineTheme(): ThemeFile {
  return readThemeFile(join(platformPaths().baseThemes, "baseline.json"));
}

/** Baseline layered with `idOrPath` (a theme id, a file path or inline file). */
export function loadTheme(idOrPath?: string | ThemeFile | null): ThemeFile {
  const base = baselineTheme();
  if (!idOrPath || idOrPath === "baseline") return base;
  if (typeof idOrPath === "object") return mergeTheme(base, idOrPath);
  if (existsSync(idOrPath)) return mergeTheme(base, readThemeFile(idOrPath));
  const found = listThemes().get(idOrPath);
  if (!found) throw new Error(`theme ${idOrPath} not found`);
  return mergeTheme(base, found);
}

/** The user's theme (`BUN_OS_THEME`, then settings.json). */
export async function currentTheme(): Promise<ThemeFile> {
  const settings = await readSettings();
  return loadTheme(Bun.env.BUN_OS_THEME ?? settings.theme);
}
