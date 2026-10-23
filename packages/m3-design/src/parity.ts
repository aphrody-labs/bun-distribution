// SPDX-License-Identifier: MIT
// Bun port of Replica's replica-diff/parity.py (Copyright (c) 2026 Jake Schincariol, MIT;
// see LICENSES/replica-skill-MIT.txt). The Python file stays in packages/replica-skills as reference.
//
// Feature parity score from the feature matrix replica-recon wrote.
//
//   m3-design parity replica/features.csv
//   m3-design parity replica/features.csv --visual diffs/*.json
//   m3-design parity replica/features.csv --markdown > replica/parity.md
//   m3-design parity replica/features.csv --fail-under 80
//
// Columns: feature, area, priority (must|should|could, P0|P1|P2), original (yes|no),
// clone (yes|partial|no|skip), notes. Weights: must 3, should 2, could 1. yes counts 1,
// partial 0.5, no 0. skip and rows where original is "no" are listed but not scored.
// With --visual, imgdiff --json layout scores are averaged and the overall score is
// 80% features + 20% layout.

import { parseCsv } from "../intelligence/ui-ux-pro-max/scripts/csv.ts";

const WEIGHT: Record<string, number> = { must: 3, should: 2, could: 1, p0: 3, p1: 2, p2: 1 };
const CREDIT: Record<string, number> = { yes: 1, done: 1, partial: 0.5, no: 0, "": 0, todo: 0 };
const PRIORITY_NAME: Record<number, string> = { 3: "must", 2: "should", 1: "could" };

export class MatrixError extends Error {}

export type MatrixRow = Record<string, string> & { line: string };

interface Counted {
  row: MatrixRow;
  weight: number;
  credit: number;
}

export interface FeatureBrief {
  feature: string;
  area: string;
  priority: string;
  clone: string;
  notes: string;
}

export interface VisualScore {
  file: string;
  score: number;
  mode: string;
}

export interface ParityScore {
  feature_score: number;
  counted: number;
  must_have_done: number;
  must_have_total: number;
  by_area: { area: string; score: number; features: number }[];
  missing: FeatureBrief[];
  skipped: FeatureBrief[];
  extras: FeatureBrief[];
  problems: string[];
}

export interface ParityResult extends ParityScore {
  visual?: VisualScore[];
  layout_score?: number;
  overall: number;
}

const round1 = (n: number) => Math.round(n * 10) / 10;
const byCodePoint = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** Parse the feature matrix text (UTF-8, optional BOM). */
export function loadMatrix(text: string, path = "matrix"): MatrixRow[] {
  const records = parseCsv(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text).filter(record => record.length > 0);
  const header = records[0];
  if (!header || header.every(cell => cell.trim() === "")) throw new MatrixError(`${path} is empty`);
  const fields = header.map(f => f.trim().toLowerCase());
  for (const need of ["feature", "priority", "clone"]) {
    if (!fields.includes(need))
      throw new MatrixError(
        `${path} has no '${need}' column. Columns needed: feature, area, priority, original, clone, notes`,
      );
  }
  const rows: MatrixRow[] = [];
  records.slice(1).forEach((record, index) => {
    const row: Record<string, string> = {};
    fields.forEach((field, i) => (row[field] = (record[i] ?? "").trim()));
    if (!row.feature) return;
    rows.push({ ...row, line: String(index + 2) });
  });
  return rows;
}

function brief({ row, weight }: { row: MatrixRow; weight?: number }): FeatureBrief {
  const w = weight ?? WEIGHT[(row.priority ?? "").toLowerCase()] ?? 1;
  return {
    feature: row.feature!,
    area: row.area ?? "",
    priority: PRIORITY_NAME[w] ?? "could",
    clone: row.clone || "no",
    notes: row.notes ?? "",
  };
}

export function scoreMatrix(rows: readonly MatrixRow[]): ParityScore {
  const counted: Counted[] = [];
  const skipped: MatrixRow[] = [];
  const extras: MatrixRow[] = [];
  const problems: string[] = [];
  for (const row of rows) {
    const original = (row.original ?? "yes").toLowerCase() || "yes";
    const clone = (row.clone ?? "").toLowerCase();
    const priority = (row.priority ?? "").toLowerCase();
    if (["no", "n", "false"].includes(original)) {
      extras.push(row);
      continue;
    }
    if (clone === "skip") {
      skipped.push(row);
      continue;
    }
    if (!(priority in WEIGHT))
      problems.push(`line ${row.line}: priority '${row.priority ?? ""}' is not must/should/could, counted as could`);
    if (!(clone in CREDIT))
      problems.push(`line ${row.line}: clone '${row.clone ?? ""}' is not yes/partial/no/skip, counted as no`);
    counted.push({ row, weight: WEIGHT[priority] ?? 1, credit: CREDIT[clone] ?? 0 });
  }

  const total = counted.reduce((sum, r) => sum + r.weight, 0);
  const got = counted.reduce((sum, r) => sum + r.weight * r.credit, 0);
  const areas = new Map<string, [number, number, number]>();
  for (const r of counted) {
    const area = r.row.area || "(no area)";
    const t = areas.get(area) ?? [0, 0, 0];
    t[0] += r.weight * r.credit;
    t[1] += r.weight;
    t[2] += 1;
    areas.set(area, t);
  }
  const byArea = [...areas].map(([area, [g, t, n]]) => ({ area, score: t ? round1((100 * g) / t) : 0, features: n }));
  byArea.sort((a, b) => a.score - b.score);

  const missing = counted.filter(r => r.credit < 1);
  missing.sort(
    (a, b) =>
      b.weight - a.weight ||
      a.credit - b.credit ||
      byCodePoint(a.row.area ?? "", b.row.area ?? "") ||
      byCodePoint(a.row.feature!, b.row.feature!),
  );
  const musts = counted.filter(r => r.weight === 3);
  return {
    feature_score: round1(total ? (100 * got) / total : 0),
    counted: counted.length,
    must_have_done: musts.filter(r => r.credit === 1).length,
    must_have_total: musts.length,
    by_area: byArea,
    missing: missing.map(brief),
    skipped: skipped.map(row => brief({ row })),
    extras: extras.map(row => brief({ row })),
    problems,
  };
}

export async function visualScores(paths: readonly string[]): Promise<VisualScore[]> {
  const scores: VisualScore[] = [];
  for (const path of paths) {
    const data = (await Bun.file(path).json()) as { score?: unknown; mode?: string; files?: { clone?: string } };
    if (data.score === undefined) throw new MatrixError(`${path} is not imgdiff --json output`);
    scores.push({ file: data.files?.clone ?? path, score: Number(data.score), mode: data.mode ?? "layout" });
  }
  return scores;
}

export function combineParity(score: ParityScore, visuals: readonly VisualScore[]): ParityResult {
  if (visuals.length === 0) return { ...score, overall: score.feature_score };
  const layout = visuals.reduce((sum, v) => sum + v.score, 0) / visuals.length;
  return {
    ...score,
    visual: [...visuals],
    layout_score: round1(layout),
    overall: round1(0.8 * score.feature_score + 0.2 * layout),
  };
}

export function renderParity(result: ParityResult, markdown = false): string {
  const h = markdown ? "## " : "";
  const out: string[] = [`${h}Parity: ${result.overall.toFixed(1)} / 100`, ""];
  out.push(
    `features ${result.feature_score.toFixed(1)}  (${result.counted} counted, must-haves ${result.must_have_done} of ${result.must_have_total} done)`,
  );
  if (result.layout_score !== undefined)
    out.push(`layout   ${result.layout_score.toFixed(1)}  (${result.visual?.length ?? 0} screens compared)`);
  if (result.must_have_done < result.must_have_total)
    out.push(
      "",
      `Not shippable yet: ${result.must_have_total - result.must_have_done} must-have features are not done.`,
    );
  out.push("", `${h}By area, weakest first`);
  for (const a of result.by_area)
    out.push(`- ${a.area.padEnd(28)} ${a.score.toFixed(1).padStart(5)}  (${a.features} features)`);
  out.push("", `${h}Missing, in build order`);
  if (result.missing.length === 0) out.push("- nothing. Every counted feature is done.");
  for (const m of result.missing)
    out.push(`- [${m.priority}] ${m.area || "-"}: ${m.feature}, ${m.clone}${m.notes ? `  (${m.notes})` : ""}`);
  if (result.skipped.length > 0) {
    out.push("", `${h}Left out on purpose (not scored)`);
    for (const m of result.skipped) out.push(`- ${m.feature}: ${m.notes || "no reason given, add one"}`);
  }
  if (result.extras.length > 0) {
    out.push("", `${h}Yours, not in the original (not scored)`);
    for (const m of result.extras) out.push(`- ${m.feature}`);
  }
  if (result.visual?.length) {
    out.push("", `${h}Screens`);
    for (const v of [...result.visual].sort((a, b) => a.score - b.score))
      out.push(`- ${v.file.padEnd(40)} ${v.score.toFixed(1).padStart(5)}`);
  }
  if (result.problems.length > 0) {
    out.push("", `${h}Fix in the matrix`);
    for (const p of result.problems) out.push(`- ${p}`);
  }
  return out.join("\n");
}

const USAGE =
  "Usage: m3-design parity <features.csv> [--visual <imgdiff.json>...] [--json] [--markdown] [--fail-under <score>]";

export async function parityMain(argv: readonly string[]): Promise<number> {
  let matrix: string | undefined;
  const visual: string[] = [];
  let json = false;
  let markdown = false;
  let failUnder: number | undefined;
  let inVisual = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "-h" || arg === "--help") {
      console.log(USAGE);
      return 0;
    }
    if (arg === "--json") json = true;
    else if (arg === "--markdown") markdown = true;
    else if (arg === "--visual") inVisual = true;
    else if (arg === "--fail-under") {
      failUnder = Number(argv[++i]);
      if (!Number.isFinite(failUnder)) {
        console.error(`${USAGE}\nparity: --fail-under needs a number`);
        return 2;
      }
    } else if (arg.startsWith("--")) {
      console.error(`${USAGE}\nparity: unknown option ${arg}`);
      return 2;
    } else if (inVisual) visual.push(arg);
    else if (matrix === undefined) matrix = arg;
    else {
      console.error(`${USAGE}\nparity: unrecognized argument ${arg}`);
      return 2;
    }
  }
  if (matrix === undefined) {
    console.error(USAGE);
    return 2;
  }
  let result: ParityResult;
  try {
    const rows = loadMatrix(await Bun.file(matrix).text(), matrix);
    result = combineParity(scoreMatrix(rows), await visualScores(visual));
  } catch (error) {
    console.error(`parity: ${error instanceof Error ? error.message : String(error)}`);
    return 2;
  }
  console.log(json ? JSON.stringify(result, null, 2) : renderParity(result, markdown));
  return failUnder !== undefined && result.overall < failUnder ? 1 : 0;
}

if (import.meta.main) process.exitCode = await parityMain(Bun.argv.slice(2));
