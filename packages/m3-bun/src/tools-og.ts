// SPDX-License-Identifier: Apache-2.0
// `m3-bun og`: the Open Graph image of an app (1200 x 630), drawn with the native Skia canvas of `@aphrody/canvas`
// in the colour roles of the app's theme and the Google Sans Flex face of `@aphrody/m3-fonts`.
import { cssRequest } from "@aphrody/m3";
import { join, resolve } from "node:path";
import { loadApp, type M3App } from "./config.ts";
import { m3CssFor, type M3CssEngine } from "./theme-css.ts";
import { loadTool } from "./tools-load.ts";

export interface OgOptions {
  dir?: string;
  configFile?: string;
  app?: M3App;
  /** Headline (default: the app name). */
  title?: string;
  /** Second line (default: `v<version>`). */
  subtitle?: string;
  /** Dark colour scheme. */
  dark?: boolean;
  /** Theme generator (default `native`: the Rust ThemeExport or `m3Css`); `mcu` asks for the TypeScript one. */
  engine?: M3CssEngine;
  /** Output file (default `<outdir>/og.png`); `.webp` writes WebP. */
  out?: string;
  width?: number;
  height?: number;
}

export interface OgReport {
  file: string;
  bytes: number;
  width: number;
  height: number;
  /** The colour roles the image uses, `#rrggbb`. */
  colors: Record<
    | "surface"
    | "onSurface"
    | "onSurfaceVariant"
    | "primary"
    | "primaryContainer",
    string
  >;
}

/** `--md-sys-color-<role>: #rrggbb` declarations of a sheet, first occurrence wins, keyed by camelCase role. */
export function colorRoles(css: string): Record<string, string> {
  const roles: Record<string, string> = {};
  for (const [, role, value] of css.matchAll(
    /--md-sys-color-([a-z-]+)\s*:\s*(#[0-9a-f]{6})\b/gi,
  )) {
    const key = role!.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
    roles[key] ??= value!.toLowerCase();
  }
  return roles;
}

const FACE = "Google Sans Flex";

/** Draw and write the Open Graph image of an app. */
export async function ogImage(options: OgOptions = {}): Promise<OgReport> {
  const app =
    options.app ??
    (await loadApp(resolve(options.dir ?? process.cwd()), options.configFile));
  const canvasModule = await loadTool(
    "@aphrody/canvas",
    () => import("@aphrody/canvas"),
  );
  if (!canvasModule.isNativeCanvasAvailable()) {
    throw new Error(
      "m3-bun og: the native Skia addon of @aphrody/canvas is not installed for this platform",
    );
  }
  const theme = app.m3.theme ?? {};
  const generate = await m3CssFor(options.engine ?? "native", app.dir);
  const roles = colorRoles(
    generate(cssRequest("scheme", { ...theme, dark: options.dark ?? false })),
  );
  const pick = (role: keyof OgReport["colors"]): string => {
    const value = roles[role];
    if (!value)
      throw new Error(
        `m3-bun og: the theme sheet has no --md-sys-color role ${role}`,
      );
    return value;
  };
  const colors: OgReport["colors"] = {
    surface: pick("surface"),
    onSurface: pick("onSurface"),
    onSurfaceVariant: pick("onSurfaceVariant"),
    primary: pick("primary"),
    primaryContainer: pick("primaryContainer"),
  };

  if (!canvasModule.GlobalFonts.has(FACE)) {
    canvasModule.GlobalFonts.registerFromPath(
      Bun.resolveSync(
        "@aphrody/m3-fonts/fonts/web/GoogleSansFlex-latin.woff2",
        import.meta.dir,
      ),
      FACE,
    );
  }
  const width = options.width ?? 1200;
  const height = options.height ?? 630;
  const canvas = await canvasModule.createNativeCanvas(width, height);
  const ctx = canvas.getContext("2d");
  const pad = Math.round(width / 15);
  ctx.fillStyle = colors.surface;
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = colors.primaryContainer;
  ctx.beginPath();
  ctx.roundRect(width - pad * 4, -pad, pad * 5, height + pad * 2, pad * 1.5);
  ctx.fill();
  ctx.fillStyle = colors.primary;
  ctx.fillRect(pad, pad, pad * 1.2, Math.round(pad / 5));
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = colors.onSurface;
  ctx.font = `${Math.round(height / 6.5)}px "${FACE}"`;
  ctx.fillText(options.title ?? app.name, pad, height * 0.55, width - pad * 6);
  ctx.fillStyle = colors.onSurfaceVariant;
  ctx.font = `${Math.round(height / 16)}px "${FACE}"`;
  ctx.fillText(
    options.subtitle ?? `v${app.version}`,
    pad,
    height * 0.55 + height / 8,
    width - pad * 6,
  );

  const file = resolve(options.out ?? join(app.outdir, "og.png"));
  const bytes = file.endsWith(".webp")
    ? await canvas.encode("webp")
    : await canvas.encode("png");
  await Bun.write(file, bytes);
  return { file, bytes: bytes.length, width, height, colors };
}
