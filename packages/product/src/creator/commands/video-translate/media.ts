/** External tools: process runner, ffmpeg/ffprobe helpers, yt-dlp download, hard-sub and soft-sub output. */
import { copyFile, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, join, resolve } from "node:path";

export class ToolError extends Error {}

export type Env = Record<string, string | undefined>;

export interface ExecResult {
  code: number;
  stdout: string;
  stderr: string;
}

/** Resolves an executable on `env.PATH` (Bun.which, so `.exe` and PATHEXT work on Windows). */
export function which(
  name: string,
  env: Env = process.env,
): string | undefined {
  return Bun.which(name, { PATH: env.PATH ?? "" }) ?? undefined;
}

export async function exec(
  cmd: string[],
  options: { cwd?: string; env?: Env } = {},
): Promise<ExecResult> {
  const [program, ...args] = cmd;
  if (!program) throw new ToolError("commande vide");
  let proc: ReturnType<typeof Bun.spawn>;
  try {
    proc = Bun.spawn([program, ...args], {
      windowsHide: true,
      cwd: options.cwd,
      env: { ...process.env, ...options.env } as Record<string, string>,
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    });
  } catch (error) {
    throw new ToolError(
      `impossible de lancer ${program} : ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout as ReadableStream).text(),
    new Response(proc.stderr as ReadableStream).text(),
  ]);
  const code = await proc.exited;
  return { code, stdout, stderr };
}

export function requireTool(name: string, env: Env, hint: string): string {
  const path = which(name, env);
  if (!path)
    throw new ToolError(`${name} est introuvable dans le PATH. ${hint}`);
  return path;
}

const lastLines = (text: string, count = 6): string =>
  text.trim().split(/\r?\n/).slice(-count).join("\n");

export function failure(label: string, result: ExecResult): ToolError {
  return new ToolError(
    `${label} a échoué (code ${result.code})\n${lastLines(result.stderr || result.stdout)}`,
  );
}

export const isUrl = (value: string): boolean => /^https?:\/\//i.test(value);

/** Media duration in milliseconds (ffprobe, then the `Duration:` line of ffmpeg). */
export async function probeDuration(
  file: string,
  env: Env = process.env,
): Promise<number> {
  const ffprobe = which("ffprobe", env);
  if (ffprobe) {
    const result = await exec(
      [
        ffprobe,
        "-v",
        "error",
        "-show_entries",
        "format=duration",
        "-of",
        "csv=p=0",
        file,
      ],
      { env },
    );
    const seconds = Number.parseFloat(result.stdout.trim());
    if (result.code === 0 && Number.isFinite(seconds))
      return Math.round(seconds * 1000);
  }
  const ffmpeg = requireTool(
    "ffmpeg",
    env,
    "Installer ffmpeg (https://ffmpeg.org).",
  );
  const result = await exec([ffmpeg, "-hide_banner", "-i", file], { env });
  const match = /Duration:\s*(\d+):(\d{2}):(\d{2}(?:\.\d+)?)/.exec(
    result.stderr,
  );
  if (!match) throw new ToolError(`durée illisible pour ${file}`);
  return Math.round(
    (Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3])) * 1000,
  );
}

/** Extracts 16 kHz mono PCM wav for [startMs, startMs + lengthMs). */
export async function extractWav(
  input: string,
  output: string,
  startMs: number,
  lengthMs: number | undefined,
  env: Env = process.env,
): Promise<void> {
  const ffmpeg = requireTool(
    "ffmpeg",
    env,
    "Installer ffmpeg (https://ffmpeg.org).",
  );
  const seek = startMs > 0 ? ["-ss", (startMs / 1000).toFixed(3)] : [];
  const length =
    lengthMs === undefined ? [] : ["-t", (lengthMs / 1000).toFixed(3)];
  const result = await exec(
    [
      ffmpeg,
      "-hide_banner",
      "-loglevel",
      "error",
      "-nostdin",
      "-y",
      ...seek,
      ...length,
      "-i",
      input,
      "-vn",
      "-ac",
      "1",
      "-ar",
      "16000",
      "-c:a",
      "pcm_s16le",
      output,
    ],
    { env },
  );
  if (result.code !== 0) throw failure("ffmpeg (extraction audio)", result);
}

/** Downloads `url` with yt-dlp into `dir` and returns the final file path. */
export async function download(
  url: string,
  dir: string,
  wantVideo: boolean,
  env: Env = process.env,
): Promise<string> {
  const ytdlp = requireTool(
    "yt-dlp",
    env,
    "Installer yt-dlp (https://github.com/yt-dlp/yt-dlp) ou fournir un fichier local.",
  );
  await mkdir(dir, { recursive: true });
  const format = wantVideo
    ? [
        "-f",
        "bv*[height<=1080]+ba/b[height<=1080]/bv*+ba/b",
        "--merge-output-format",
        "mkv",
      ]
    : ["-f", "ba/b"];
  const result = await exec(
    [
      ytdlp,
      "--no-playlist",
      "--no-progress",
      "--no-simulate",
      ...format,
      "-o",
      join(dir, "%(id)s.%(ext)s"),
      "--print",
      "after_move:filepath",
      url,
    ],
    { env },
  );
  if (result.code !== 0) throw failure("yt-dlp", result);
  const path = result.stdout
    .trim()
    .split(/\r?\n/)
    .findLast((line) => line.trim() !== "");
  if (!path || !(await Bun.file(path).exists()))
    throw new ToolError(`yt-dlp n'a produit aucun fichier pour ${url}`);
  return resolve(path);
}

const STYLE =
  "force_style='FontName=Arial,FontSize=22,Outline=2,Shadow=0,MarginV=24'";

/**
 * Hard-sub burn. The subtitle file is copied to a temp dir under a fixed safe name and ffmpeg runs with that dir
 * as cwd, so the `subtitles=` filter only ever sees a plain relative name: nothing needs filtergraph escaping,
 * whatever the OS (Windows drive letters and backslashes, quotes, colons, commas) or the real paths are.
 */
export async function burnSubtitles(options: {
  input: string;
  subtitles: string;
  output: string;
  env?: Env;
}): Promise<void> {
  const env = options.env ?? process.env;
  const ffmpeg = requireTool(
    "ffmpeg",
    env,
    "Installer ffmpeg avec libass (https://ffmpeg.org).",
  );
  const dir = await mkdtemp(join(tmpdir(), "vt-burn-"));
  try {
    const ext = extname(options.subtitles).toLowerCase() || ".srt";
    const name = `vt-subs${ext}`;
    await copyFile(options.subtitles, join(dir, name));
    const filter =
      ext === ".ass" ? `subtitles=${name}` : `subtitles=${name}:${STYLE}`;
    const mp4 = extname(options.output).toLowerCase() === ".mp4";
    const result = await exec(
      [
        ffmpeg,
        "-hide_banner",
        "-loglevel",
        "error",
        "-nostdin",
        "-y",
        "-i",
        resolve(options.input),
        "-vf",
        filter,
        "-c:v",
        "libx264",
        "-crf",
        "18",
        "-preset",
        "medium",
        "-c:a",
        "copy",
        ...(mp4 ? ["-movflags", "+faststart"] : []),
        resolve(options.output),
      ],
      { cwd: dir, env },
    );
    if (result.code !== 0)
      throw failure("ffmpeg (incrustation des sous-titres)", result);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** Soft-sub mux: video and audio are copied, the subtitle track is added as English. */
export async function muxSubtitles(options: {
  input: string;
  subtitles: string;
  output: string;
  env?: Env;
}): Promise<void> {
  const env = options.env ?? process.env;
  const ffmpeg = requireTool(
    "ffmpeg",
    env,
    "Installer ffmpeg (https://ffmpeg.org).",
  );
  const container = extname(options.output).toLowerCase();
  const ext = extname(options.subtitles).toLowerCase();
  const codec =
    container === ".mp4"
      ? "mov_text"
      : ext === ".ass"
        ? "ass"
        : ext === ".vtt"
          ? "webvtt"
          : "srt";
  const result = await exec(
    [
      ffmpeg,
      "-hide_banner",
      "-loglevel",
      "error",
      "-nostdin",
      "-y",
      "-i",
      resolve(options.input),
      "-i",
      resolve(options.subtitles),
      "-map",
      "0:v?",
      "-map",
      "0:a?",
      "-map",
      "1:0",
      "-c:v",
      "copy",
      "-c:a",
      "copy",
      "-c:s",
      codec,
      "-metadata:s:s:0",
      "language=eng",
      "-metadata:s:s:0",
      "title=English",
      "-disposition:s:0",
      "default",
      resolve(options.output),
    ],
    { env },
  );
  if (result.code !== 0)
    throw failure("ffmpeg (ajout de la piste de sous-titres)", result);
}
