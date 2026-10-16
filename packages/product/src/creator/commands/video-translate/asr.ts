/** Speech recognition: backend detection, chunked extraction, per-backend runners, overlap merge and cleanup. */
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { type Cache, keyOf, sha256 } from "./cache.ts";
import { FASTER_WHISPER_SCRIPT } from "./fw-script.ts";
import {
  type Env,
  ToolError,
  exec,
  extractWav,
  failure,
  probeDuration,
  which,
} from "./media.ts";
import { type Cue, parseSubtitles } from "./subtitles.ts";

export type AsrBackend = "whisper-cli" | "faster-whisper" | "endpoint";

export interface AsrWord {
  start: number;
  end: number;
  word: string;
}

export interface AsrSegment {
  /** Milliseconds. */
  start: number;
  end: number;
  text: string;
  words?: AsrWord[];
}

export interface AsrOptions {
  backend: "auto" | AsrBackend;
  /** ISO code or "auto". */
  language: string;
  whisperModel?: string;
  whisperArgs: string[];
  fwModel: string;
  fwDevice: string;
  fwCompute: string;
  url?: string;
  urlModel: string;
  apiKey?: string;
  chunkSeconds: number;
  overlapSeconds: number;
}

export const DEFAULT_ASR: AsrOptions = {
  backend: "auto",
  language: "auto",
  whisperArgs: [],
  fwModel: "large-v3",
  fwDevice: "auto",
  fwCompute: "default",
  urlModel: "whisper-1",
  chunkSeconds: 600,
  overlapSeconds: 5,
};

export interface AsrSelection {
  backend: AsrBackend;
  /** Human readable: binary path, model, URL. */
  detail: string;
  /** Resolved executable (whisper-cli, uv). */
  program?: string;
  model?: string;
}

export interface Detection {
  selected?: AsrSelection;
  /** Why each candidate was or was not usable, in detection order. */
  notes: string[];
}

const MODEL_PREFERENCE = [
  "large-v3-turbo",
  "large-v3",
  "large-v2",
  "medium",
  "small",
  "base",
  "tiny",
];

const rank = (path: string): number => {
  const index = MODEL_PREFERENCE.findIndex((label) =>
    path.includes(`ggml-${label}`),
  );
  return index < 0 ? MODEL_PREFERENCE.length : index;
};

/** Looks for a ggml model in the usual whisper.cpp locations. */
export async function findWhisperModel(env: Env): Promise<string | undefined> {
  const home = env.HOME ?? env.USERPROFILE ?? homedir();
  const dirs = [
    env.WHISPER_MODEL_DIR,
    join(home, ".cache", "whisper"),
    join(home, ".local", "share", "whisper"),
    join(home, "whisper.cpp", "models"),
    join(process.cwd(), "models"),
  ].filter((dir): dir is string => Boolean(dir));
  const listed = await Promise.all(
    dirs.map(async (dir) => {
      try {
        return (await readdir(dir))
          .filter((name) => /^ggml-.*\.bin$/.test(name))
          .map((name) => join(dir, name));
      } catch {
        // directory missing
        return [];
      }
    }),
  );
  const found = listed.flat();
  return found.toSorted((a, b) => rank(a) - rank(b))[0];
}

/**
 * Picks the ASR backend. `--asr <name>` forces one; otherwise an explicit `--asr-url` wins, then:
 * whisper-cli (needs a model), faster-whisper through `uv run`, then nothing.
 */
export async function detectAsr(
  options: AsrOptions,
  env: Env = process.env,
): Promise<Detection> {
  const notes: string[] = [];
  const candidates: AsrBackend[] =
    options.backend !== "auto"
      ? [options.backend]
      : options.url
        ? ["endpoint", "whisper-cli", "faster-whisper"]
        : ["whisper-cli", "faster-whisper", "endpoint"];
  for (const backend of candidates) {
    if (backend === "whisper-cli") {
      const program = which("whisper-cli", env) ?? which("whisper-cpp", env);
      if (!program) {
        notes.push("whisper-cli : introuvable dans le PATH");
        continue;
      }
      const model =
        options.whisperModel ??
        env.WHISPER_MODEL ??
        env.APHRODY_WHISPER_MODEL ??
        // oxlint-disable-next-line no-await-in-loop -- candidates are probed in preference order and the first usable backend returns early
        (await findWhisperModel(env));
      if (!model) {
        notes.push(
          `whisper-cli : trouvé (${program}) mais aucun modèle ggml (--whisper-model ou WHISPER_MODEL)`,
        );
        continue;
      }
      // oxlint-disable-next-line no-await-in-loop -- candidates are probed in preference order and the first usable backend returns early
      if (!(await Bun.file(model).exists())) {
        notes.push(`whisper-cli : modèle introuvable (${model})`);
        continue;
      }
      return {
        selected: { backend, program, model, detail: `${program} -m ${model}` },
        notes,
      };
    }
    if (backend === "faster-whisper") {
      const program = which("uv", env);
      if (!program) {
        notes.push("faster-whisper : uv introuvable dans le PATH");
        continue;
      }
      return {
        selected: {
          backend,
          program,
          model: options.fwModel,
          detail: `uv run --script fw_transcribe.py ${options.language} ${options.fwModel} ${options.fwDevice} ${options.fwCompute} <wav>`,
        },
        notes,
      };
    }
    if (!options.url) {
      notes.push("endpoint : --asr-url non fourni");
      continue;
    }
    return {
      selected: {
        backend,
        model: options.urlModel,
        detail: `${endpointUrl(options.url)} (modèle ${options.urlModel})`,
      },
      notes,
    };
  }
  return { notes };
}

export function endpointUrl(base: string): string {
  const url = base.replace(/\/+$/, "");
  if (url.endsWith("/audio/transcriptions")) return url;
  return /^https?:\/\/[^/]+$/.test(url)
    ? `${url}/v1/audio/transcriptions`
    : `${url}/audio/transcriptions`;
}

// ---------------------------------------------------------------------------------------------
// chunking
// ---------------------------------------------------------------------------------------------

export interface Chunk {
  index: number;
  start: number;
  length: number;
  /** Segments whose midpoint is in [coreStart, coreEnd) are kept when chunks overlap. */
  coreStart: number;
  coreEnd: number;
}

/** Overlapping windows over [0, durationMs). Chunk k starts at k * (chunk - overlap). */
export function planChunks(
  durationMs: number,
  chunkSeconds: number,
  overlapSeconds: number,
): Chunk[] {
  const chunk = Math.max(30, chunkSeconds) * 1000;
  const overlap = Math.min(Math.max(0, overlapSeconds) * 1000, chunk / 2);
  if (durationMs <= chunk)
    return [
      {
        index: 0,
        start: 0,
        length: durationMs,
        coreStart: 0,
        coreEnd: Number.POSITIVE_INFINITY,
      },
    ];
  const chunks: Chunk[] = [];
  for (let start = 0; ; start += chunk - overlap) {
    const length = Math.min(chunk, durationMs - start);
    const last = start + length >= durationMs;
    chunks.push({
      index: chunks.length,
      start,
      length,
      coreStart: chunks.length === 0 ? 0 : start + overlap / 2,
      coreEnd: last ? Number.POSITIVE_INFINITY : start + length - overlap / 2,
    });
    if (last) break;
  }
  return chunks;
}

const normalize = (text: string): string =>
  text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]+/gu, "");

const JUNK = /^[\s♪♫~〜…・.\-–—]*$/u;
const TAG = /^\s*[[(（【][^\])）】]{0,30}[\])）】]\s*$/u;

/** Overlap merge: keep each chunk's core, then drop junk, hallucinated loops and duplicates. */
export function mergeChunks(
  results: { chunk: Chunk; segments: AsrSegment[] }[],
): AsrSegment[] {
  const kept: AsrSegment[] = [];
  for (const { chunk, segments } of results) {
    for (const segment of segments) {
      const middle = (segment.start + segment.end) / 2;
      if (middle >= chunk.coreStart && middle < chunk.coreEnd)
        kept.push(segment);
    }
  }
  kept.sort((a, b) => a.start - b.start || a.end - b.end);
  const out: AsrSegment[] = [];
  let run = 0;
  for (const segment of kept) {
    const text = segment.text.trim();
    if (!text || JUNK.test(text) || TAG.test(text)) continue;
    const previous = out[out.length - 1];
    if (previous && normalize(previous.text) === normalize(text)) {
      run += 1;
      // a boundary duplicate (overlap) or a repetition loop: keep one, stretch its end
      if (segment.start - previous.end < 1500 || run >= 2) {
        previous.end = Math.max(previous.end, segment.end);
        continue;
      }
    } else {
      run = 0;
    }
    out.push({ ...segment, text });
  }
  return out;
}

const CJK_CHARS =
  /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;

/** Splits segments longer than `maxChars` at the biggest word gap near the middle (needs word timestamps). */
const joinWords = (list: AsrWord[]): string =>
  list
    .map((word) => word.word)
    .join("")
    .trim();

export function splitLongSegments(
  segments: AsrSegment[],
  maxChars = 90,
  maxCjk = 48,
): AsrSegment[] {
  const out: AsrSegment[] = [];
  const visit = (segment: AsrSegment): void => {
    const limit = CJK_CHARS.test(segment.text) ? maxCjk : maxChars;
    const words = segment.words;
    if (segment.text.trim().length <= limit || !words || words.length < 2) {
      out.push(segment);
      return;
    }
    const middle = words.length / 2;
    let best = 1;
    let score = Number.NEGATIVE_INFINITY;
    for (let i = 1; i < words.length; i += 1) {
      const current = words[i];
      const previous = words[i - 1];
      if (!current || !previous) continue;
      const gap = current.start - previous.end;
      const punctuation = /[,.!?、。！？…]$/.test(previous.word.trim())
        ? 400
        : 0;
      const value = gap + punctuation - Math.abs(i - middle) * 20;
      if (value > score) {
        score = value;
        best = i;
      }
    }
    const left = words.slice(0, best);
    const right = words.slice(best);
    const first = left[0];
    const lastLeft = left[left.length - 1];
    const firstRight = right[0];
    const last = right[right.length - 1];
    if (!first || !lastLeft || !firstRight || !last) {
      out.push(segment);
      return;
    }
    visit({
      start: segment.start,
      end: lastLeft.end,
      text: joinWords(left),
      words: left,
    });
    visit({
      start: firstRight.start,
      end: segment.end,
      text: joinWords(right),
      words: right,
    });
  };
  for (const segment of segments) visit(segment);
  return out;
}

// ---------------------------------------------------------------------------------------------
// backends
// ---------------------------------------------------------------------------------------------

interface ChunkResult {
  segments: AsrSegment[];
  language?: string;
}

async function runWhisperCli(
  selection: AsrSelection,
  options: AsrOptions,
  wav: string,
  env: Env,
): Promise<ChunkResult> {
  const prefix = wav.replace(/\.wav$/i, "");
  const program = selection.program ?? "whisper-cli";
  const result = await exec(
    [
      program,
      "-m",
      selection.model ?? "",
      "-f",
      wav,
      "-l",
      options.language,
      "-osrt",
      "-of",
      prefix,
      ...options.whisperArgs,
    ],
    { env },
  );
  if (result.code !== 0) throw failure("whisper-cli", result);
  const srt = Bun.file(`${prefix}.srt`);
  if (!(await srt.exists()))
    throw new ToolError("whisper-cli n'a produit aucun fichier .srt");
  const segments = parseSubtitles(await srt.text(), "srt").map((cue) => ({
    start: cue.start,
    end: cue.end,
    text: cue.text,
  }));
  const detected = /auto-detected language:\s*([a-z]{2,3})/i.exec(
    `${result.stderr}\n${result.stdout}`,
  )?.[1];
  return {
    segments,
    language:
      detected?.toLowerCase() ??
      (options.language === "auto" ? undefined : options.language),
  };
}

async function runFasterWhisper(
  selection: AsrSelection,
  options: AsrOptions,
  wav: string,
  env: Env,
): Promise<ChunkResult> {
  const script = join(dirname(wav), "fw_transcribe.py");
  await Bun.write(script, FASTER_WHISPER_SCRIPT);
  const result = await exec(
    [
      selection.program ?? "uv",
      "run",
      "--script",
      script,
      options.language,
      options.fwModel,
      options.fwDevice,
      options.fwCompute,
      wav,
    ],
    { env },
  );
  if (result.code !== 0) throw failure("faster-whisper (uv run)", result);
  const file = Bun.file(`${wav}.fw.json`);
  if (!(await file.exists()))
    throw new ToolError("faster-whisper n'a produit aucun fichier .fw.json");
  const json = (await file.json()) as {
    language?: string;
    segments: {
      start: number;
      end: number;
      text: string;
      words?: { start: number; end: number; word: string }[];
    }[];
  };
  return {
    language: json.language,
    segments: json.segments.map((segment) => ({
      start: Math.round(segment.start * 1000),
      end: Math.round(segment.end * 1000),
      text: segment.text,
      words: segment.words?.map((word) => ({
        start: Math.round(word.start * 1000),
        end: Math.round(word.end * 1000),
        word: word.word,
      })),
    })),
  };
}

interface VerboseJson {
  language?: string;
  segments?: { start: number; end: number; text: string }[];
  words?: { word: string; start: number; end: number }[];
}

/** multipart/form-data built by hand: independent of the FormData/Blob implementation of the host (test DOMs replace them). */
export function multipart(
  fields: [string, string][],
  file: { field: string; filename: string; type: string; bytes: Uint8Array },
): { body: Uint8Array<ArrayBuffer>; contentType: string } {
  const boundary = `----creator-kit-${crypto.randomUUID()}`;
  const encoder = new TextEncoder();
  const parts: Uint8Array[] = [];
  for (const [name, value] of fields) {
    parts.push(
      encoder.encode(
        `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`,
      ),
    );
  }
  parts.push(
    encoder.encode(
      `--${boundary}\r\nContent-Disposition: form-data; name="${file.field}"; filename="${file.filename}"\r\nContent-Type: ${file.type}\r\n\r\n`,
    ),
    file.bytes,
    encoder.encode(`\r\n--${boundary}--\r\n`),
  );
  const body = new Uint8Array(
    new ArrayBuffer(parts.reduce((sum, part) => sum + part.length, 0)),
  );
  let offset = 0;
  for (const part of parts) {
    body.set(part, offset);
    offset += part.length;
  }
  return { body, contentType: `multipart/form-data; boundary=${boundary}` };
}

async function runEndpoint(
  options: AsrOptions,
  wav: string,
): Promise<ChunkResult> {
  const url = endpointUrl(options.url ?? "");
  const bytes = new Uint8Array(await Bun.file(wav).arrayBuffer());
  const send = async (granularities: boolean): Promise<Response> => {
    const fields: [string, string][] = [
      ["model", options.urlModel],
      ["response_format", "verbose_json"],
    ];
    if (options.language !== "auto")
      fields.push(["language", options.language]);
    if (granularities) {
      fields.push(
        ["timestamp_granularities[]", "segment"],
        ["timestamp_granularities[]", "word"],
      );
    }
    const { body, contentType } = multipart(fields, {
      field: "file",
      filename: "chunk.wav",
      type: "audio/wav",
      bytes,
    });
    const headers: Record<string, string> = { "content-type": contentType };
    if (options.apiKey) headers.authorization = `Bearer ${options.apiKey}`;
    return fetch(url, {
      method: "POST",
      headers,
      body,
      signal: AbortSignal.timeout(30 * 60 * 1000),
    });
  };
  let response = await send(true);
  if (response.status === 400) response = await send(false);
  if (!response.ok)
    throw new ToolError(
      `endpoint ASR HTTP ${response.status} : ${(await response.text()).slice(0, 300)}`,
    );
  const json = (await response.json()) as VerboseJson;
  if (!json.segments?.length)
    throw new ToolError(
      "l'endpoint ASR n'a renvoyé aucun segment horodaté (verbose_json requis)",
    );
  const words = (json.words ?? []).map((word) => ({
    word: word.word,
    start: Math.round(word.start * 1000),
    end: Math.round(word.end * 1000),
  }));
  return {
    language: json.language,
    segments: json.segments.map((segment) => {
      const start = Math.round(segment.start * 1000);
      const end = Math.round(segment.end * 1000);
      const inside = words.filter(
        (word) => word.start >= start - 50 && word.end <= end + 50,
      );
      return {
        start,
        end,
        text: segment.text,
        words: inside.length ? inside : undefined,
      };
    }),
  };
}

// ---------------------------------------------------------------------------------------------
// orchestration
// ---------------------------------------------------------------------------------------------

export interface AsrResult {
  cues: Cue[];
  language?: string;
  backend: AsrBackend;
  chunks: number;
  cachedChunks: number;
  durationMs: number;
}

function majority(values: (string | undefined)[]): string | undefined {
  const counts = new Map<string, number>();
  for (const value of values)
    if (value) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts.entries()].toSorted((a, b) => b[1] - a[1])[0]?.[0];
}

export async function transcribeMedia(
  input: string,
  selection: AsrSelection,
  options: AsrOptions,
  deps: { cache: Cache; env: Env; log: (line: string) => void },
): Promise<AsrResult> {
  const { cache, env, log } = deps;
  const durationMs = await probeDuration(input, env);
  const chunks = planChunks(
    durationMs,
    options.chunkSeconds,
    options.overlapSeconds,
  );
  const work = await mkdtemp(join(tmpdir(), "vt-asr-"));
  const results: { chunk: Chunk; segments: AsrSegment[] }[] = [];
  const languages: (string | undefined)[] = [];
  let cached = 0;
  try {
    for (const chunk of chunks) {
      const wav = join(
        work,
        `chunk-${String(chunk.index + 1).padStart(4, "0")}.wav`,
      );
      // oxlint-disable-next-line no-await-in-loop -- chunks run in order, one ASR process at a time, each result cached before the next chunk
      await extractWav(
        input,
        wav,
        chunk.start,
        chunks.length === 1 ? undefined : chunk.length,
        env,
      );
      // oxlint-disable-next-line no-await-in-loop -- chunks run in order, one ASR process at a time, each result cached before the next chunk
      const hash = sha256(new Uint8Array(await Bun.file(wav).arrayBuffer()));
      const key = keyOf(
        "asr",
        selection.backend,
        selection.model ?? "",
        options.url ?? "",
        options.language,
        options.whisperArgs,
        options.fwDevice,
        options.fwCompute,
        hash,
      );
      // oxlint-disable-next-line no-await-in-loop -- chunks run in order, one ASR process at a time, each result cached before the next chunk
      let result = await cache.get<ChunkResult>("asr", key);
      if (result) {
        cached += 1;
        log(`ASR [${chunk.index + 1}/${chunks.length}] (cache)`);
      } else {
        log(`ASR [${chunk.index + 1}/${chunks.length}] ${selection.backend}`);
        result =
          selection.backend === "whisper-cli"
            ? // oxlint-disable-next-line no-await-in-loop -- chunks run in order, one ASR process at a time, each result cached before the next chunk
              await runWhisperCli(selection, options, wav, env)
            : selection.backend === "faster-whisper"
              ? // oxlint-disable-next-line no-await-in-loop -- chunks run in order, one ASR process at a time, each result cached before the next chunk
                await runFasterWhisper(selection, options, wav, env)
              : // oxlint-disable-next-line no-await-in-loop -- chunks run in order, one ASR process at a time, each result cached before the next chunk
                await runEndpoint(options, wav);
        // oxlint-disable-next-line no-await-in-loop -- chunks run in order, one ASR process at a time, each result cached before the next chunk
        await cache.set("asr", key, result);
      }
      languages.push(result.language);
      results.push({
        chunk,
        segments: result.segments.map((segment) =>
          Object.assign({}, segment, {
            start: segment.start + chunk.start,
            end: segment.end + chunk.start,
            words: segment.words?.map((word) =>
              Object.assign({}, word, {
                start: word.start + chunk.start,
                end: word.end + chunk.start,
              }),
            ),
          }),
        ),
      });
      // oxlint-disable-next-line no-await-in-loop -- chunks run in order, one ASR process at a time, each result cached before the next chunk
      await rm(wav, { force: true });
    }
  } finally {
    await rm(work, { recursive: true, force: true });
  }
  const segments = splitLongSegments(mergeChunks(results));
  if (!segments.length)
    throw new ToolError(
      "aucune parole détectée (vérifier la piste audio et la langue --from)",
    );
  const cues = segments.map((segment, index) => ({
    id: index + 1,
    start: segment.start,
    end: segment.end,
    text: segment.text.replace(/\s+/g, " ").trim(),
  }));
  return {
    cues,
    language: majority(languages),
    backend: selection.backend,
    chunks: chunks.length,
    cachedChunks: cached,
    durationMs,
  };
}
