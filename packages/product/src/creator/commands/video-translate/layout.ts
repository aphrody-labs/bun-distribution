/** Subtitle layout: line wrapping, reading-speed (cps) fixes by extend / merge / split, no overlap. */
import type { Cue } from "./subtitles.ts";

export interface LayoutOptions {
  /** Max characters per line (default 42). */
  maxLine: number;
  /** Max lines per cue (default 2). */
  maxLines: number;
  /** Max reading speed in characters per second (default 17). */
  maxCps: number;
  /** Minimum on-screen time in ms (default 800). */
  minDuration: number;
  /** Maximum on-screen time in ms (default 7000). */
  maxDuration: number;
  /** Largest silence (ms) across which two cues may still be merged (default 400). */
  mergeGap: number;
}

export const DEFAULT_LAYOUT: LayoutOptions = {
  maxLine: 42,
  maxLines: 2,
  maxCps: 17,
  minDuration: 800,
  maxDuration: 7000,
  mergeGap: 400,
};

export interface LayoutStats {
  merged: number;
  split: number;
  extended: number;
  /** Source-ordered ids (post-layout numbering) whose reading speed still exceeds the limit. */
  overCps: number[];
  dropped: number;
}

export const visibleLength = (text: string): number => text.replaceAll("\n", "").length;

export function cps(cue: Pick<Cue, "start" | "end" | "text">): number {
  const seconds = Math.max(cue.end - cue.start, 1) / 1000;
  return visibleLength(cue.text) / seconds;
}

const clean = (text: string): string => text.replace(/\s+/g, " ").trim();

const BREAK_AFTER = /[,;:.!?…—–)]$/;

/** Balanced wrap into at most `maxLines` lines of `maxLine` characters (greedy fallback beyond that). */
export function wrapLines(input: string, maxLine: number, maxLines = 2): string[] {
  const text = clean(input);
  if (text.length <= maxLine) return [text];
  const words = text.split(" ");
  if (maxLines >= 2 && words.length > 1) {
    let best: { score: number; at: number } | undefined;
    for (let at = 1; at < words.length; at += 1) {
      const first = words.slice(0, at).join(" ");
      const second = words.slice(at).join(" ");
      if (first.length > maxLine || second.length > maxLine) continue;
      const bonus = BREAK_AFTER.test(first) ? -4 : 0;
      const score = Math.max(first.length, second.length) + Math.abs(first.length - second.length) * 0.25 + bonus;
      if (!best || score < best.score) best = { score, at };
    }
    if (best) return [words.slice(0, best.at).join(" "), words.slice(best.at).join(" ")];
  }
  const out: string[] = [];
  let line = "";
  for (const word of words) {
    if (line && line.length + 1 + word.length > maxLine) {
      out.push(line);
      line = word;
    } else {
      line = line ? `${line} ${word}` : word;
    }
  }
  if (line) out.push(line);
  return out;
}

const SENTENCE_END = /(?<=[.!?…])\s+/;
const CLAUSE_END = /(?<=[,;:—–])\s+/;

/** Splits text into pieces of at most `limit` characters, preferring sentence then clause then word breaks. */
export function splitText(input: string, limit: number): string[] {
  const text = clean(input);
  if (text.length <= limit) return [text];
  for (const rule of [SENTENCE_END, CLAUSE_END]) {
    const parts = text.split(rule).filter(Boolean);
    if (parts.length > 1) return pack(parts, limit);
  }
  return pack(text.split(" "), limit);
}

function pack(parts: string[], limit: number): string[] {
  const out: string[] = [];
  let current = "";
  for (const part of parts) {
    if (part.length > limit) {
      if (current) out.push(current);
      current = "";
      out.push(...splitText(part, limit));
      continue;
    }
    const joined = current ? `${current} ${part}` : part;
    if (joined.length > limit && current) {
      out.push(current);
      current = part;
    } else {
      current = joined;
    }
  }
  if (current) out.push(current);
  return out;
}

/** Orders cues, trims overlaps and removes empties. Empty cues extend the previous contiguous cue. */
function sanitize(input: Cue[], options: LayoutOptions, stats: LayoutStats): Cue[] {
  const sorted = input.map(cue => ({ ...cue })).toSorted((a, b) => a.start - b.start || a.end - b.end);
  const out: Cue[] = [];
  for (const cue of sorted) {
    cue.text = clean(cue.text);
    if (cue.end < cue.start) cue.end = cue.start;
    if (!cue.text) {
      const previous = out[out.length - 1];
      if (previous && cue.start - previous.end <= 800 && cue.end > previous.end) previous.end = cue.end;
      stats.dropped += 1;
      continue;
    }
    out.push(cue);
  }
  for (let i = 1; i < out.length; i += 1) {
    const previous = out[i - 1];
    const cue = out[i];
    if (!previous || !cue || cue.start >= previous.end) continue;
    if (cue.start - previous.start >= 300) {
      previous.end = cue.start;
    } else {
      cue.start = previous.end;
      cue.end = Math.max(cue.end, cue.start + options.minDuration);
    }
  }
  return out;
}

function neededMs(text: string, options: LayoutOptions): number {
  return Math.max(options.minDuration, Math.ceil((visibleLength(text) / options.maxCps) * 1000));
}

function shouldMerge(a: Cue, b: Cue, options: LayoutOptions): boolean {
  const gap = b.start - a.end;
  if (gap > options.mergeGap) return false;
  const text = `${a.text} ${b.text}`;
  if (text.length > options.maxLine * options.maxLines) return false;
  if (b.end - a.start > options.maxDuration) return false;
  const startsLate = a.end - a.start < 900;
  // Only merge when `a` is starved of time and the merged cue is readable.
  const starved = a.end - a.start < neededMs(a.text, options);
  const mergedOk = b.end - a.start >= (visibleLength(text) / options.maxCps) * 1000;
  return (starved || startsLate) && mergedOk;
}

/** True when the text wraps into at most maxLines lines of maxLine characters. */
function fits(text: string, options: LayoutOptions): boolean {
  const lines = wrapLines(text, options.maxLine, options.maxLines);
  return lines.length <= options.maxLines && lines.every(line => line.length <= options.maxLine);
}

/** Splits a piece in two at the word boundary nearest to its middle until every part fits. */
function ensureFit(text: string, options: LayoutOptions): string[] {
  if (fits(text, options)) return [text];
  const words = text.split(" ");
  if (words.length < 2) return [text];
  const middle = text.length / 2;
  let best = 1;
  let distance = Number.POSITIVE_INFINITY;
  let length = 0;
  for (let i = 1; i < words.length; i += 1) {
    length += (words[i - 1]?.length ?? 0) + 1;
    const gap = Math.abs(length - middle);
    if (gap < distance) {
      distance = gap;
      best = i;
    }
  }
  return [...ensureFit(words.slice(0, best).join(" "), options), ...ensureFit(words.slice(best).join(" "), options)];
}

/** Words longer than a line (URLs, ASR noise) are cut so wrapping can always succeed. */
function breakLongWords(text: string, max: number): string {
  return text
    .split(" ")
    .flatMap(word => (word.length > max ? (word.match(new RegExp(`.{1,${max}}`, "gu")) ?? [word]) : [word]))
    .join(" ");
}

function splitCue(cue: Cue, options: LayoutOptions): Cue[] {
  const limit = options.maxLine * options.maxLines;
  const pieces = splitText(breakLongWords(cue.text, options.maxLine), limit).flatMap(piece =>
    ensureFit(piece, options),
  );
  if (pieces.length <= 1) return [cue];
  const total = pieces.reduce((sum, piece) => sum + piece.length, 0);
  const span = cue.end - cue.start;
  let cursor = cue.start;
  return pieces.map((piece, index) => {
    const last = index === pieces.length - 1;
    const end = last ? cue.end : cursor + Math.round((span * piece.length) / total);
    const part: Cue = Object.assign({}, cue, {
      text: piece,
      start: cursor,
      end,
    });
    if (index > 0) delete part.orig;
    cursor = end;
    return part;
  });
}

/** Applies all subtitle constraints; the original timing is kept unless a cue needs more time and has room. */
export function layoutCues(input: Cue[], partial: Partial<LayoutOptions> = {}): { cues: Cue[]; stats: LayoutStats } {
  const options = { ...DEFAULT_LAYOUT, ...partial };
  const stats: LayoutStats = {
    merged: 0,
    split: 0,
    extended: 0,
    overCps: [],
    dropped: 0,
  };
  const base = sanitize(input, options, stats);

  // 1. merge starved fragments
  const merged: Cue[] = [];
  for (const cue of base) {
    const previous = merged[merged.length - 1];
    if (previous && shouldMerge(previous, cue, options)) {
      previous.text = `${previous.text} ${cue.text}`;
      previous.end = Math.max(previous.end, cue.end);
      if (previous.orig || cue.orig) previous.orig = [previous.orig, cue.orig].filter(Boolean).join(" ");
      stats.merged += 1;
    } else {
      merged.push({ ...cue });
    }
  }

  // 2. split cues that do not fit in maxLines x maxLine
  const split: Cue[] = [];
  for (const cue of merged) {
    const parts = splitCue(cue, options);
    stats.split += parts.length - 1;
    split.push(...parts);
  }

  // 3. extend into silence for reading speed / minimum duration, never past the next cue
  for (let i = 0; i < split.length; i += 1) {
    const cue = split[i];
    if (!cue) continue;
    const next = split[i + 1];
    const wanted = Math.min(cue.start + neededMs(cue.text, options), cue.start + options.maxDuration);
    const ceiling = next ? next.start : Number.POSITIVE_INFINITY;
    const target = Math.min(wanted, ceiling);
    if (target > cue.end) {
      cue.end = target;
      stats.extended += 1;
    }
    if (next && cue.end > next.start) cue.end = next.start;
  }

  // 4. wrap, renumber, report what could not be fixed
  const out = split.map((cue, index) => {
    const wrapped = wrapLines(cue.text, options.maxLine, options.maxLines).join("\n");
    return Object.assign({}, cue, { id: index + 1, text: wrapped });
  });
  for (const cue of out) if (cps(cue) > options.maxCps + 0.01) stats.overCps.push(cue.id);
  return { cues: out, stats };
}
