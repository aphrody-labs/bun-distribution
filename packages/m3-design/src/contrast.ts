// SPDX-License-Identifier: MIT
// Bun port of Replica's replica-design/contrast.py (Copyright (c) 2026 Jake Schincariol, MIT;
// see LICENSES/replica-skill-MIT.txt). The Python file stays in packages/replica-skills as reference.
//
// WCAG 2 contrast check for design tokens. Every text colour in a token file is checked
// against the backgrounds it sits on.
//
//   m3-design contrast replica/design/tokens.json
//   m3-design contrast tokens.json --json
//   m3-design contrast "#6b7280" "#ffffff"        # one pair
//
// Pairs come from the token file's "pairs" list: [["text", "bg"], ...], or
// [["text-muted", "surface", "large"], ...] for text 24px and up (or 18.66px bold), which
// only needs 3:1. "ui" as the third item (UI parts, focus rings) needs 3:1. Without a pairs
// list, every colour whose name has text, fg or on- in it is checked against every colour
// whose name has bg, background or surface in it.
//
// Thresholds (WCAG 2.2): normal text AA 4.5, AAA 7. Large text AA 3, AAA 4.5.
// Exit code 1 when any pair fails AA, 2 on a usage or input error.

const HEX = /^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
const NEEDS = { normal: [4.5, 7], large: [3, 4.5], ui: [3, 3] } as const;

export type PairSize = keyof typeof NEEDS;
/** [fg, bg] or [fg, bg, "normal" | "large" | "ui"], as listed in a token file's "pairs". */
export type ContrastPair = string[];

export type ContrastRow =
  | { fg: string; bg: string; size: PairSize; error: string }
  | {
      fg: string;
      bg: string;
      size: PairSize;
      ratio: number;
      aa: boolean;
      aaa: boolean;
      fg_hex: string;
      bg_hex: string;
    };

const isHex = (value: string) => HEX.test(value.trim());

export function parseHex(value: string): [number, number, number] {
  const match = HEX.exec(value.trim());
  if (!match) throw new Error(`not a hex colour: ${JSON.stringify(value)}`);
  let hex = match[1]!;
  if (hex.length === 3) hex = [...hex].map(c => c + c).join("");
  return [0, 2, 4].map(i => Number.parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];
}

/** WCAG relative luminance of an sRGB colour. */
export function luminance([r, g, b]: [number, number, number]): number {
  const channel = (c: number) => {
    const v = c / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** WCAG contrast ratio of two hex colours, from 1 to 21. */
export function contrastRatio(fg: string, bg: string): number {
  const a = luminance(parseHex(fg));
  const b = luminance(parseHex(bg));
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

/** {"color": {"text": {"muted": "#..."}}} -> {"text-muted": "#..."}; W3C `$value` and `value` leaves. */
export function flattenTokens(value: unknown, prefix = ""): Record<string, string> {
  const out: Record<string, string> = {};
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    for (const leaf of ["value", "$value"]) {
      if (typeof record[leaf] === "string") {
        out[prefix] = record[leaf];
        return out;
      }
    }
    for (const [key, child] of Object.entries(record)) {
      if (key.startsWith("$") || key.startsWith("_")) continue;
      Object.assign(out, flattenTokens(child, prefix ? `${prefix}-${key}` : key));
    }
  } else if (typeof value === "string" && isHex(value)) {
    out[prefix] = value.trim();
  }
  return out;
}

export function tokenColours(tokens: Record<string, unknown>): Record<string, string> {
  const source = tokens.color ?? tokens.colors ?? tokens.colour ?? {};
  return Object.fromEntries(Object.entries(flattenTokens(source)).filter(([, v]) => HEX.test(v)));
}

export function defaultPairs(colours: Record<string, string>): ContrastPair[] {
  const names = Object.keys(colours);
  const fg = names.filter(k => /(^|-)(text|fg|on)(-|$)/.test(k));
  const bg = names.filter(k => /(^|-)(bg|background|surface)(-|$)/.test(k));
  return fg.flatMap(f => bg.map((b): ContrastPair => [f, b]));
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export function checkContrast(colours: Record<string, string>, pairs: readonly ContrastPair[]): ContrastRow[] {
  const rows: ContrastRow[] = [];
  for (const pair of pairs) {
    if (pair.length < 2) continue;
    const [fg, bg] = pair as [string, string];
    const size: PairSize = pair[2] !== undefined && pair[2] in NEEDS ? (pair[2] as PairSize) : "normal";
    const fgHex = colours[fg];
    const bgHex = colours[bg];
    if (fgHex === undefined || bgHex === undefined) {
      rows.push({ fg, bg, size, error: "unknown token" });
      continue;
    }
    const ratio = contrastRatio(fgHex, bgHex);
    const [aa, aaa] = NEEDS[size];
    rows.push({ fg, bg, size, ratio: round2(ratio), aa: ratio >= aa, aaa: ratio >= aaa, fg_hex: fgHex, bg_hex: bgHex });
  }
  return rows;
}

export const contrastFails = (rows: readonly ContrastRow[]) => rows.filter(r => "error" in r || !r.aa).length;

export function renderContrast(rows: readonly ContrastRow[]): string {
  const out = rows.map(r => {
    if ("error" in r) return `  ??    ${r.fg.padEnd(24)} on ${r.bg.padEnd(20)} ${r.error}`;
    const grade = r.size === "ui" ? (r.aa ? "PASS" : "FAIL") : r.aaa ? "AAA" : r.aa ? "AA" : "FAIL";
    return `  ${grade.padEnd(5)} ${r.ratio.toFixed(2).padStart(5)}:1  ${r.fg.padEnd(24)} on ${r.bg.padEnd(20)} ${r.size === "normal" ? "" : r.size}`;
  });
  out.push("", `  ${rows.length} pairs, ${contrastFails(rows)} failing AA`);
  return out.join("\n");
}

const USAGE = "Usage: m3-design contrast <tokens.json | fg-hex bg-hex> [--json]";

export async function contrastMain(argv: readonly string[]): Promise<number> {
  const json = argv.includes("--json");
  if (argv.includes("-h") || argv.includes("--help")) {
    console.log(USAGE);
    return 0;
  }
  const args = argv.filter(a => a !== "--json");
  if (args.length === 0) {
    console.error(USAGE);
    return 2;
  }
  let colours: Record<string, string>;
  let pairs: ContrastPair[];
  try {
    if (args.length === 2 && args.every(isHex)) {
      colours = { fg: args[0]!, bg: args[1]! };
      pairs = [["fg", "bg"]];
    } else {
      const tokens = (await Bun.file(args[0]!).json()) as Record<string, unknown>;
      colours = tokenColours(tokens);
      const listed = tokens.pairs;
      pairs = Array.isArray(listed) && listed.length > 0 ? (listed as ContrastPair[]) : defaultPairs(colours);
    }
  } catch (error) {
    console.error(`contrast: ${error instanceof Error ? error.message : String(error)}`);
    return 2;
  }
  if (pairs.length === 0) {
    console.error('contrast: no pairs to check. Add a "pairs" list to the token file.');
    return 2;
  }
  const rows = checkContrast(colours, pairs);
  console.log(json ? JSON.stringify(rows, null, 2) : renderContrast(rows));
  return contrastFails(rows) > 0 ? 1 : 0;
}

if (import.meta.main) process.exitCode = await contrastMain(Bun.argv.slice(2));
