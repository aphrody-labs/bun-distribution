// SPDX-License-Identifier: Apache-2.0
import { loadNativeLibrary } from "./library";
import { cString, envelope, ownedJson } from "./native-response";

function run(
  operation: "format" | "minify" | "lint",
  source: string,
  filename: string,
): Record<string, unknown> {
  const input = cString(source);
  const path = cString(filename);
  const { symbols } = loadNativeLibrary();
  const result = symbols[`aphrody_oxc_${operation}`](input, path);
  return envelope(
    ownedJson(result, symbols.aphrody_oxc_free, `Oxc ${operation}`),
    `Oxc ${operation}`,
  );
}

/** Format JS/TS synchronously using the pinned Aphrody Oxc fork. */
export function formatSource(source: string, filename = "input.js"): string {
  const result = run("format", source, filename);
  if (typeof result.code !== "string") throw new Error("Oxc format: native response omitted code");
  return result.code;
}

/** Minify JS/TS synchronously using the filename to select syntax. */
export function minifySource(source: string, filename = "input.js"): string {
  const result = run("minify", source, filename);
  if (typeof result.code !== "string") throw new Error("Oxc minify: native response omitted code");
  return result.code;
}

/** Return diagnostic messages from the pinned fork's default lint rule set. */
export function lintSource(source: string, filename = "input.js"): string[] {
  const result = run("lint", source, filename);
  if (
    !Array.isArray(result.diagnostics) ||
    !result.diagnostics.every((item) => typeof item === "string")
  ) {
    throw new Error("Oxc lint: native response omitted diagnostics");
  }
  return result.diagnostics;
}
