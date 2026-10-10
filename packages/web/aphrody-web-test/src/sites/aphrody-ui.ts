// SPDX-License-Identifier: Apache-2.0

/**
 * @module @aphrody/web-test/sites/aphrody-ui
 *
 * Test presets and helpers for Aphrody UI & Next.js:
 * - Material 3 (M3) design token compliance audit (color, shape, elevation, motion).
 * - RSC / Next.js hydration error detection (React 18/19 hydration mismatch signatures, fallback comments).
 * - Instant navigation performance benchmark over the CDP cookie protocol.
 */

import { instant, type PlaywrightPage, type WebPageLike } from "../next/index.ts";

/** Canonical M3 token families. */
export const M3_REQUIRED_COLOR_TOKENS = [
  "--md-sys-color-primary",
  "--md-sys-color-surface",
  "--md-sys-color-on-surface",
  "--md-sys-color-secondary",
  "--md-sys-color-outline",
] as const;

export const M3_REQUIRED_SHAPE_TOKENS = [
  "--md-sys-shape-corner-none",
  "--md-sys-shape-corner-small",
  "--md-sys-shape-corner-medium",
  "--md-sys-shape-corner-large",
] as const;

export const M3_ALLOWED_SHAPE_RADII = new Set([
  "0px",
  "4px",
  "8px",
  "12px",
  "16px",
  "20px",
  "28px",
  "32px",
  "48px",
  "9999px",
]);

export interface M3TokenAuditResult {
  compliant: boolean;
  score: number; // 0 to 100
  categories: {
    color: boolean;
    shape: boolean;
    elevation: boolean;
    motion: boolean;
    typescale: boolean;
  };
  foundTokens: string[];
  missingTokens: string[];
  violations: string[];
}

/**
 * Audits CSS or DOM styles for Material 3 (M3) design token compliance.
 */
export async function auditM3DesignTokens(
  input: string | Record<string, string> | { content(): Promise<string> },
): Promise<M3TokenAuditResult> {
  let stylesMap: Record<string, string> = {};

  if (
    typeof input === "object" &&
    input !== null &&
    "content" in input &&
    typeof input.content === "function"
  ) {
    const html = await input.content();
    stylesMap = extractCssVariables(html);
  } else if (typeof input === "string") {
    stylesMap = extractCssVariables(input);
  } else if (typeof input === "object" && input !== null) {
    stylesMap = input as Record<string, string>;
  }

  const tokenNames = Object.keys(stylesMap);
  const violations: string[] = [];

  const categories = {
    color: tokenNames.some((t) => t.startsWith("--md-sys-color-")),
    shape: tokenNames.some((t) => t.startsWith("--md-sys-shape-")),
    elevation: tokenNames.some((t) => t.startsWith("--md-sys-elevation-")),
    motion: tokenNames.some((t) => t.startsWith("--md-sys-motion-")),
    typescale: tokenNames.some((t) => t.startsWith("--md-sys-typescale-")),
  };

  const missingTokens: string[] = [];
  for (const reqColor of M3_REQUIRED_COLOR_TOKENS) {
    if (!tokenNames.includes(reqColor)) {
      missingTokens.push(reqColor);
    }
  }
  for (const reqShape of M3_REQUIRED_SHAPE_TOKENS) {
    if (!tokenNames.includes(reqShape)) {
      missingTokens.push(reqShape);
    }
  }

  // Validate shape radius values
  for (const [prop, val] of Object.entries(stylesMap)) {
    if (prop.startsWith("--md-sys-shape-corner-")) {
      const cleanVal = val.trim();
      if (!M3_ALLOWED_SHAPE_RADII.has(cleanVal) && !cleanVal.includes("var(")) {
        violations.push(
          `Non-standard M3 shape radius for ${prop}: "${cleanVal}" (expected standard M3 scale)`,
        );
      }
    }
  }

  const totalCategories = 5;
  const activeCategories = Object.values(categories).filter(Boolean).length;
  const baseScore = Math.round((activeCategories / totalCategories) * 80);
  const penalty = Math.min(30, violations.length * 10);
  const bonus = missingTokens.length === 0 ? 20 : 0;
  const score = Math.max(0, Math.min(100, baseScore + bonus - penalty));

  const compliant = categories.color && categories.shape && violations.length === 0 && score >= 70;

  return {
    compliant,
    score,
    categories,
    foundTokens: tokenNames.filter((t) => t.startsWith("--md-sys-")),
    missingTokens,
    violations,
  };
}

function extractCssVariables(text: string): Record<string, string> {
  const map: Record<string, string> = {};
  const matches = text.matchAll(/(--md-sys-[\w-]+)\s*:\s*([^;}\n]+)/g);
  for (const match of matches) {
    map[match[1]] = match[2].trim();
  }
  return map;
}

export interface HydrationCheckResult {
  hasHydrationError: boolean;
  errorCount: number;
  errors: string[];
  details: Array<{ type: string; message: string }>;
}

const HYDRATION_ERROR_PATTERNS = [
  {
    type: "minified_react_hydration",
    regex: /(?:minified react error|react-error)\s*#(?:418|421|422|423|425)/i,
  },
  {
    type: "text_mismatch",
    regex: /text content does not match server-rendered html/i,
  },
  {
    type: "hydration_mismatch",
    regex: /hydration failed because the initial UI does not match/i,
  },
  {
    type: "hydration_error",
    regex: /there was an error while hydrating/i,
  },
  {
    type: "tag_mismatch",
    regex: /expected server html to contain a matching/i,
  },
  {
    type: "unexpected_server_tag",
    regex: /did not expect server html to contain/i,
  },
  {
    type: "prop_mismatch",
    regex: /prop `.*` did not match/i,
  },
  {
    type: "rsc_error_fallback",
    regex: /<!--\$!-->/,
  },
  {
    type: "next_prerender_error",
    regex: /next-prerender-error/i,
  },
];

/**
 * Scans page logs, diagnostics, or HTML content for Next.js / React hydration errors.
 */
export async function detectHydrationErrors(
  input:
    | string
    | string[]
    | { content(): Promise<string> }
    | { jsErrors?: string[]; consoleErrors?: string[] },
): Promise<HydrationCheckResult> {
  const textSnippets: string[] = [];

  if (Array.isArray(input)) {
    textSnippets.push(...input);
  } else if (typeof input === "string") {
    textSnippets.push(input);
  } else if (typeof input === "object" && input !== null) {
    if ("content" in input && typeof input.content === "function") {
      textSnippets.push(await input.content());
    }
    if ("jsErrors" in input && Array.isArray(input.jsErrors)) {
      textSnippets.push(...input.jsErrors);
    }
    if ("consoleErrors" in input && Array.isArray(input.consoleErrors)) {
      textSnippets.push(...input.consoleErrors);
    }
  }

  const errors: string[] = [];
  const details: Array<{ type: string; message: string }> = [];

  for (const snippet of textSnippets) {
    for (const pattern of HYDRATION_ERROR_PATTERNS) {
      if (pattern.regex.test(snippet)) {
        errors.push(snippet);
        details.push({
          type: pattern.type,
          message: snippet,
        });
        break;
      }
    }
  }

  return {
    hasHydrationError: errors.length > 0,
    errorCount: errors.length,
    errors,
    details,
  };
}

export interface InstantBenchmarkOptions {
  runs?: number;
  baseURL?: string;
}

export interface InstantBenchmarkResult {
  durationMs: number;
  runs: number;
  averageMs: number;
  minMs: number;
  maxMs: number;
  cachedRendered: boolean;
  timings: number[];
}

/**
 * Benchmarks instant navigation actions, measuring response latency within
 * the `next-instant-navigation-testing` cookie lock.
 */
export async function benchmarkInstantNavigation(
  page: PlaywrightPage | WebPageLike,
  navigationAction: () => Promise<void>,
  opts: InstantBenchmarkOptions = {},
): Promise<InstantBenchmarkResult> {
  const runs = Math.max(1, opts.runs ?? 3);
  const timings: number[] = [];

  for (let i = 0; i < runs; i++) {
    const start = performance.now();
    // oxlint-disable-next-line no-await-in-loop -- benchmark runs are timed one after another so each run measures alone
    await instant(
      page,
      async () => {
        await navigationAction();
      },
      { baseURL: opts.baseURL },
    );
    const duration = performance.now() - start;
    timings.push(duration);
  }

  const total = timings.reduce((acc, t) => acc + t, 0);
  const minMs = Math.round(Math.min(...timings) * 100) / 100;
  const maxMs = Math.round(Math.max(...timings) * 100) / 100;
  const averageMs = Math.round((total / timings.length) * 100) / 100;

  return {
    durationMs: Math.round(total * 100) / 100,
    runs,
    averageMs,
    minMs,
    maxMs,
    cachedRendered: true,
    timings: timings.map((t) => Math.round(t * 100) / 100),
  };
}
