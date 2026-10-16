// SPDX-License-Identifier: Apache-2.0

import { CString } from "bun:ffi";
import { nativeSymbols as lib } from "./library";

export const ROLES = [
  "background",
  "on-background",
  "surface",
  "surface-dim",
  "surface-bright",
  "surface-container-lowest",
  "surface-container-low",
  "surface-container",
  "surface-container-high",
  "surface-container-highest",
  "on-surface",
  "surface-variant",
  "on-surface-variant",
  "inverse-surface",
  "inverse-on-surface",
  "outline",
  "outline-variant",
  "shadow",
  "scrim",
  "surface-tint",
  "primary",
  "on-primary",
  "primary-container",
  "on-primary-container",
  "inverse-primary",
  "secondary",
  "on-secondary",
  "secondary-container",
  "on-secondary-container",
  "tertiary",
  "on-tertiary",
  "tertiary-container",
  "on-tertiary-container",
  "error",
  "on-error",
  "error-container",
  "on-error-container",
  "primary-fixed",
  "primary-fixed-dim",
  "on-primary-fixed",
  "on-primary-fixed-variant",
  "secondary-fixed",
  "secondary-fixed-dim",
  "on-secondary-fixed",
  "on-secondary-fixed-variant",
  "tertiary-fixed",
  "tertiary-fixed-dim",
  "on-tertiary-fixed",
  "on-tertiary-fixed-variant",
] as const;

export type ColorRoleMap = Record<string, string>;

/** Get the native library version. */
function pub_fn_version(): string {
  const version = lib.bun_rs_version();
  if (!version) throw new Error("aphrody-bun returned a null version pointer");
  return version.toString();
}
export { pub_fn_version as version };

/** Run native addition to test round-trip FFI overhead. */
function pub_fn_add(a: number, b: number): number {
  return lib.bun_rs_add(a, b);
}
export { pub_fn_add as add };

/** SIMD count char using memchr. */
function pub_fn_countChar(text: string, char: string): number {
  const buf = Buffer.from(text);
  return Number(lib.bun_rs_count_char(buf, buf.length, char.charCodeAt(0)));
}
export { pub_fn_countChar as countChar };

/** SIMD substring search using memchr. */
function pub_fn_findBytes(haystack: string, needle: string): number {
  const hBuf = Buffer.from(haystack);
  const nBuf = Buffer.from(needle);
  return Number(lib.bun_rs_find_bytes(hBuf, hBuf.length, nBuf, nBuf.length));
}
export { pub_fn_findBytes as findBytes };

/** Convert HCT to packed ARGB u32. */
function pub_fn_hctToArgb(h: number, c: number, t: number): number {
  return lib.bun_rs_hct_to_argb(h, c, t);
}
export { pub_fn_hctToArgb as hctToArgb };

/** Convert ARGB to HCT coordinates. */
function pub_fn_argbToHct(argb: number): {
  hue: number;
  chroma: number;
  tone: number;
} {
  const h = new Float32Array(1);
  const c = new Float32Array(1);
  const t = new Float32Array(1);
  lib.bun_rs_argb_to_hct(argb, h, c, t);
  return {
    hue: h[0]!,
    chroma: c[0]!,
    tone: t[0]!,
  };
}
export { pub_fn_argbToHct as argbToHct };

/** Generate the 13-stop tonal palette from HCT. */
function pub_fn_hctTones(h: number, c: number, t: number): Uint32Array {
  const p = new Uint32Array(13);
  lib.bun_rs_hct_tones(h, c, t, p);
  return p;
}
export { pub_fn_hctTones as hctTones };

/** Derive all 49 M3 color roles from HCT seed. */
function pub_fn_deriveScheme(
  h: number,
  c: number,
  isDark: boolean,
): ColorRoleMap {
  const colors = new Uint32Array(49);
  lib.bun_rs_derive_scheme(h, c, isDark, colors);

  const out: ColorRoleMap = {};
  for (let i = 0; i < 49; i++) {
    const argb = colors[i]!;
    const r = (argb >> 16) & 0xff;
    const g = (argb >> 8) & 0xff;
    const b = argb & 0xff;
    const hex = `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
    out[`--md-sys-color-${ROLES[i]}`] = hex;
  }
  return out;
}
export { pub_fn_deriveScheme as deriveScheme };

/** Compile SCSS/Sass source to CSS using the grass Rust compiler. */
function pub_fn_compileSass(
  source: string,
  loadPaths: string[] = [],
  style?: "expanded" | "compressed",
  quiet: boolean = false,
): string {
  const buf = Buffer.from(source);
  const loadPathsStr = loadPaths.join(";");
  const loadPathsBuf = Buffer.from(loadPathsStr);
  const styleVal = style === "compressed" ? 1 : 0;
  const err = new Uint8Array(1);
  const ptr = lib.bun_rs_compile_sass(
    buf,
    buf.length,
    loadPathsBuf,
    loadPathsBuf.length,
    styleVal,
    quiet,
    err,
  );
  if (!ptr) {
    throw new Error("Sass compilation returned a null pointer");
  }
  let css: string;
  try {
    css = new CString(ptr).toString();
  } finally {
    lib.bun_rs_free_string(ptr);
  }
  if (err[0]) {
    throw new Error(css);
  }
  return css;
}
export { pub_fn_compileSass as compileSass };

/** Compile SCSS/Sass file to CSS using the grass Rust compiler. */
function pub_fn_compileSassFile(
  path: string,
  loadPaths: string[] = [],
  style?: "expanded" | "compressed",
  quiet: boolean = false,
): string {
  const buf = Buffer.from(path);
  const loadPathsStr = loadPaths.join(";");
  const loadPathsBuf = Buffer.from(loadPathsStr);
  const styleVal = style === "compressed" ? 1 : 0;
  const err = new Uint8Array(1);
  const ptr = lib.bun_rs_compile_sass_file(
    buf,
    buf.length,
    loadPathsBuf,
    loadPathsBuf.length,
    styleVal,
    quiet,
    err,
  );
  if (!ptr) {
    throw new Error("Sass compilation returned a null pointer");
  }
  let css: string;
  try {
    css = new CString(ptr).toString();
  } finally {
    lib.bun_rs_free_string(ptr);
  }
  if (err[0]) {
    throw new Error(css);
  }
  return css;
}
export { pub_fn_compileSassFile as compileSassFile };

export interface ValidationIssue {
  level: "error" | "warning";
  rule: string;
  message: string;
  line: number;
  matched: string;
}

export interface ValidationResult {
  score: number;
  issues: ValidationIssue[];
}

/** Validate source code against M3 specification rules. */
function pub_fn_validateSpec(code: string): ValidationResult {
  const buf = Buffer.from(code);
  const ptr = lib.bun_rs_validate_spec(buf, buf.length);
  if (!ptr) {
    throw new Error("bun_rs_validate_spec returned a null pointer");
  }
  try {
    return JSON.parse(new CString(ptr).toString()) as ValidationResult;
  } finally {
    lib.bun_rs_free_string(ptr);
  }
}
export { pub_fn_validateSpec as validateSpec };

function escapeForTemplate(css: string): string {
  return css
    .replace(/\\/g, "\\\\")
    .replace(/`/g, "\\`")
    .replace(/\$\{/g, "\\${");
}

export interface SassPluginOptions {
  loadPaths?: string[];
  style?: "expanded" | "compressed";
  quiet?: boolean;
}

/** Bun compiler plugin to load .scss files at native speed using Rust grass. */
export function sassRustPlugin(options: SassPluginOptions = {}) {
  return {
    name: "sass-rust-loader",
    setup(build: any) {
      build.onLoad({ filter: /\.scss$/ }, async (args: any) => {
        try {
          const quietVal = options.quiet ?? true;
          const css = pub_fn_compileSassFile(
            args.path,
            options.loadPaths,
            options.style,
            quietVal,
          );
          const styles = escapeForTemplate(css);
          return {
            contents:
              `import { css } from "lit";\n` +
              `export const styles = css\`${styles}\`;\n` +
              `export default styles;\n`,
            loader: "js",
          };
        } catch (e: any) {
          return {
            contents:
              `import { css } from "lit";\n` +
              `export const styles = css\`/* Sass compilation error: ${escapeForTemplate(e.message)} */\`;\n` +
              `export default styles;\n`,
            loader: "js",
          };
        }
      });
    },
  };
}

export type { M3CssRequest } from "../bindings/M3CssRequest";
import type { M3CssRequest } from "../bindings/M3CssRequest";

/**
 * Render an M3 CSS sheet in Rust (crates/aphrody-m3-tokens/src/sheets.rs): `tokens` (fusion
 * palette, light + dark), `tailwind` (Tailwind v4 utilities), `spaceui` (SpaceUI themes) or
 * `scheme` (one scheme, one mode). Colours are bit-identical to material-color-utilities.
 */
export function m3Css(request: M3CssRequest): string {
  const buf = Buffer.from(JSON.stringify(request));
  const ptr = lib.bun_rs_m3_css(buf, buf.length);
  if (!ptr) throw new Error("bun_rs_m3_css returned a null pointer");
  let envelope: { ok: boolean; css?: string; error?: string };
  try {
    envelope = JSON.parse(new CString(ptr).toString()) as typeof envelope;
  } finally {
    lib.bun_rs_free_string(ptr);
  }
  if (!envelope.ok) throw new Error(`m3Css: ${envelope.error}`);
  if (typeof envelope.css !== "string")
    throw new Error("m3Css: native response omitted CSS");
  return envelope.css;
}

export * from "./cli";
export * from "./icons";
export * from "./reproduce";
export * from "./render";
export * from "./svg";
export * from "./inference";
export * from "./http";
