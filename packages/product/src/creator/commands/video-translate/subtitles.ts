/** Subtitle cues (times in integer milliseconds) with SRT / VTT / ASS readers and writers. */

export interface Cue {
  id: number;
  start: number;
  end: number;
  /** Subtitle text. Newlines are display line breaks. */
  text: string;
  /** Original-language text, kept for bilingual output. */
  orig?: string;
}

export type SubtitleFormat = "srt" | "vtt" | "ass";

const pad = (value: number, width: number): string =>
  String(value).padStart(width, "0");

export function formatTimestamp(ms: number, format: SubtitleFormat): string {
  const total = Math.max(0, Math.round(ms));
  const hours = Math.floor(total / 3_600_000);
  const minutes = Math.floor((total % 3_600_000) / 60_000);
  const seconds = Math.floor((total % 60_000) / 1000);
  const millis = total % 1000;
  if (format === "ass") {
    return `${hours}:${pad(minutes, 2)}:${pad(seconds, 2)}.${pad(Math.floor(millis / 10), 2)}`;
  }
  const sep = format === "srt" ? "," : ".";
  return `${pad(hours, 2)}:${pad(minutes, 2)}:${pad(seconds, 2)}${sep}${pad(millis, 3)}`;
}

const TIME = /(?:(\d+):)?(\d{1,2}):(\d{2})(?:[.,](\d{1,3}))?/;

/** Parses `HH:MM:SS,mmm`, `HH:MM:SS.mmm`, `MM:SS.mmm` and ASS `H:MM:SS.cc`. */
export function parseTimestamp(text: string): number | undefined {
  const match = TIME.exec(text.trim());
  if (!match) return undefined;
  const [, h, m, s, frac] = match;
  const millis = frac ? Number(frac.padEnd(3, "0")) : 0;
  return (Number(h ?? 0) * 3600 + Number(m) * 60 + Number(s)) * 1000 + millis;
}

/** Removes HTML-like tags and ASS override blocks, keeps the visible text. */
export function stripMarkup(text: string): string {
  return text
    .replace(/\{[^}]*\}/g, "")
    .replace(/<[^>]+>/g, "")
    .replace(/\\[Nn]/g, "\n")
    .replace(/\\h/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

export function normalizeText(text: string): string {
  return text
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join(" ");
}

export function detectFormat(text: string): SubtitleFormat {
  const head = text.replace(/^﻿/, "").trimStart();
  if (head.startsWith("WEBVTT")) return "vtt";
  if (/^\[Script Info\]/im.test(head) || /^Dialogue:/m.test(head)) return "ass";
  return "srt";
}

function parseBlocks(text: string, skip: (block: string) => boolean): Cue[] {
  const cues: Cue[] = [];
  for (const block of text.split(/\n{2,}/)) {
    if (skip(block)) continue;
    const rows = block.split("\n");
    const at = rows.findIndex((row) => row.includes("-->"));
    if (at < 0) continue;
    const [from, to] = (rows[at] ?? "").split("-->");
    const start = parseTimestamp(from ?? "");
    const end = parseTimestamp((to ?? "").trim().split(/\s+/)[0] ?? "");
    if (start === undefined || end === undefined) continue;
    const body = normalizeText(stripMarkup(rows.slice(at + 1).join("\n")));
    if (!body) continue;
    cues.push({
      id: cues.length + 1,
      start,
      end: Math.max(end, start),
      text: body,
    });
  }
  return cues;
}

function parseAss(text: string): Cue[] {
  let columns: string[] = [];
  let inEvents = false;
  const cues: Cue[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (/^\[.*\]$/.test(line)) inEvents = /^\[Events\]$/i.test(line);
    if (!inEvents) continue;
    if (/^Format:/i.test(line)) {
      columns = line
        .slice(7)
        .split(",")
        .map((name) => name.trim().toLowerCase());
      continue;
    }
    if (!/^Dialogue:/i.test(line)) continue;
    const names = columns.length
      ? columns
      : [
          "layer",
          "start",
          "end",
          "style",
          "name",
          "marginl",
          "marginr",
          "marginv",
          "effect",
          "text",
        ];
    const parts = line.slice(9).split(",");
    const fields = parts.slice(0, names.length - 1);
    fields.push(parts.slice(names.length - 1).join(","));
    const at = (name: string): string => fields[names.indexOf(name)] ?? "";
    const start = parseTimestamp(at("start"));
    const end = parseTimestamp(at("end"));
    if (start === undefined || end === undefined) continue;
    const body = normalizeText(stripMarkup(at("text")));
    if (!body) continue;
    cues.push({ id: 0, start, end: Math.max(end, start), text: body });
  }
  cues.sort((a, b) => a.start - b.start || a.end - b.end);
  for (const [index, cue] of cues.entries()) cue.id = index + 1;
  return cues;
}

/** Reads SRT, WebVTT or ASS/SSA text (format auto-detected unless `hint` is given). */
export function parseSubtitles(input: string, hint?: SubtitleFormat): Cue[] {
  const text = input.replace(/^﻿/, "").replace(/\r\n?/g, "\n");
  const format = hint ?? detectFormat(text);
  if (format === "ass") return parseAss(text);
  if (format === "vtt") {
    return parseBlocks(text, (block) =>
      /^(WEBVTT|NOTE|STYLE|REGION)\b/.test(block.trimStart()),
    );
  }
  return parseBlocks(text, () => false);
}

export interface WriteOptions {
  /** Original above English when `cue.orig` is set. */
  bilingual?: boolean;
  /** ASS only: output height used for font scaling (default 1080). */
  height?: number;
}

function lines(cue: Cue, bilingual: boolean): string[] {
  const english = cue.text.split("\n");
  return bilingual && cue.orig ? [cue.orig, ...english] : english;
}

export function toSrt(cues: Cue[], options: WriteOptions = {}): string {
  const body = cues.map((cue, index) => {
    const text = lines(cue, options.bilingual ?? false)
      .join("\n")
      .replaceAll("-->", "->");
    return `${index + 1}\n${formatTimestamp(cue.start, "srt")} --> ${formatTimestamp(cue.end, "srt")}\n${text}\n`;
  });
  return body.join("\n");
}

const escapeVtt = (text: string): string =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;");

export function toVtt(cues: Cue[], options: WriteOptions = {}): string {
  const body = cues.map((cue, index) => {
    const text = escapeVtt(
      lines(cue, options.bilingual ?? false).join("\n"),
    ).replaceAll("-->", "->");
    return `${index + 1}\n${formatTimestamp(cue.start, "vtt")} --> ${formatTimestamp(cue.end, "vtt")}\n${text}\n`;
  });
  return `WEBVTT\n\n${body.join("\n")}`;
}

const escapeAss = (text: string): string =>
  text.replace(/[{}]/g, (c) => (c === "{" ? "(" : ")"));

export function toAss(cues: Cue[], options: WriteOptions = {}): string {
  const height = options.height ?? 1080;
  const size = Math.round(height / 17);
  const small = Math.round(size * 0.7);
  const header = [
    "[Script Info]",
    "; Generated by creator-kit video-translate",
    "ScriptType: v4.00+",
    "WrapStyle: 0",
    "ScaledBorderAndShadow: yes",
    `PlayResX: ${Math.round((height * 16) / 9)}`,
    `PlayResY: ${height}`,
    "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    `Style: Default,Arial,${size},&H00FFFFFF,&H000000FF,&H00000000,&H64000000,0,0,0,0,100,100,0,0,1,2.5,0.5,2,60,60,${Math.round(height / 18)},1`,
    `Style: Orig,Arial,${small},&H00D0D0D0,&H000000FF,&H00000000,&H64000000,0,0,0,0,100,100,0,0,1,2,0.5,2,60,60,${Math.round(height / 18)},1`,
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
  ];
  const events = cues.map((cue) => {
    const english = escapeAss(cue.text).split("\n").join("\\N");
    const text =
      options.bilingual && cue.orig
        ? `{\\rOrig}${escapeAss(cue.orig).split("\n").join("\\N")}\\N{\\rDefault}${english}`
        : english;
    return `Dialogue: 0,${formatTimestamp(cue.start, "ass")},${formatTimestamp(cue.end, "ass")},Default,,0,0,0,,${text}`;
  });
  return `${[...header, ...events].join("\n")}\n`;
}

export function serialize(
  cues: Cue[],
  format: SubtitleFormat,
  options: WriteOptions = {},
): string {
  if (format === "vtt") return toVtt(cues, options);
  if (format === "ass") return toAss(cues, options);
  return toSrt(cues, options);
}
