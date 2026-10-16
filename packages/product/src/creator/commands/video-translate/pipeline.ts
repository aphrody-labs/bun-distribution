/** Orchestration: plan (--dry-run), input resolution, ASR, translation, layout, output files, burn / mux. */
import { mkdir, readdir, realpath, rm } from "node:fs/promises";
import { basename, dirname, extname, join, resolve } from "node:path";
import { UsageError } from "../../../shared/args.ts";
import {
  type AsrResult,
  type Detection,
  detectAsr,
  planChunks,
  transcribeMedia,
} from "./asr.ts";
import { Cache } from "./cache.ts";
import { type Glossary, loadGlossaries } from "./glossary.ts";
import { layoutCues } from "./layout.ts";
import {
  LlmClient,
  type ModelInfo,
  isLocalHost,
  listModels,
  normalizeBaseUrl,
  pickModel,
  probeEndpoints,
} from "./llm.ts";
import {
  type Env,
  ToolError,
  burnSubtitles,
  download,
  isUrl,
  muxSubtitles,
  probeDuration,
  which,
} from "./media.ts";
import type { Config } from "./options.ts";
import { type Cue, parseSubtitles, serialize } from "./subtitles.ts";
import { type TranslateResult, translateCues } from "./translate.ts";

export interface Io {
  /** Progress and diagnostics (stderr). */
  log(line: string): void;
  /** Results (stdout). */
  out(line: string): void;
}

export interface Deps {
  env: Env;
  io: Io;
}

export const DEFAULT_LLM_URLS = [
  "http://127.0.0.1:8795/v1",
  "http://127.0.0.1:8080/v1",
];

export interface LlmResolution {
  baseUrl: string;
  model?: string;
  models: ModelInfo[];
  /** undefined when the endpoint was given explicitly but does not list models. */
  reachable: boolean | undefined;
  apiKey?: string;
  explicit: boolean;
}

export async function resolveLlm(
  config: Config,
  env: Env,
): Promise<LlmResolution> {
  const apiKey = config.llmKeyEnv ? env[config.llmKeyEnv] : undefined;
  if (config.llmKeyEnv && !apiKey)
    throw new UsageError(
      `la variable d'environnement ${config.llmKeyEnv} (--llm-key-env) est vide ou absente`,
    );
  const given = config.llmUrl ?? env.CREATOR_KIT_LLM_URL;
  let baseUrl: string;
  let models: ModelInfo[] = [];
  let reachable: boolean | undefined;
  if (given) {
    try {
      baseUrl = normalizeBaseUrl(given);
    } catch {
      throw new UsageError(`--llm-url invalide : ${given}`);
    }
    try {
      models = await listModels(baseUrl, apiKey);
      reachable = true;
    } catch {
      reachable =
        (config.llmModel ?? env.CREATOR_KIT_LLM_MODEL) ? undefined : false;
    }
  } else {
    const found = await probeEndpoints(DEFAULT_LLM_URLS, apiKey);
    baseUrl = found?.baseUrl ?? (DEFAULT_LLM_URLS[0] as string);
    models = found?.models ?? [];
    reachable = Boolean(found);
  }
  const model =
    config.llmModel ?? env.CREATOR_KIT_LLM_MODEL ?? pickModel(models);
  return {
    baseUrl,
    model,
    models,
    reachable,
    apiKey,
    explicit: Boolean(given),
  };
}

const LLM_HINT =
  "Démarrer un serveur local, par exemple `aphrody gateway serve` (http://127.0.0.1:8795/v1) ou " +
  "`llama-server -m <modèle.gguf> --port 8080`, ou donner --llm-url / --llm-model.";

const fmtDuration = (ms: number): string => {
  const total = Math.round(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h
    ? `${h} h ${String(m).padStart(2, "0")} min`
    : m
      ? `${m} min ${String(s).padStart(2, "0")} s`
      : `${s} s`;
};

async function real(path: string): Promise<string> {
  try {
    return await realpath(path);
  } catch {
    return resolve(path);
  }
}

async function same(a: string, b: string): Promise<boolean> {
  const [x, y] = await Promise.all([real(a), real(b)]);
  return process.platform === "win32"
    ? x.toLowerCase() === y.toLowerCase()
    : x === y;
}

interface Paths {
  outPath: string;
  videoPath?: string;
  reviewPath: string;
  cacheDir: string;
}

function derivePaths(
  config: Config,
  sourceBase: string,
  baseDir: string,
): Paths {
  const outPath = resolve(
    config.out ?? join(baseDir, `${sourceBase}.en.${config.format}`),
  );
  const stem = outPath.replace(/\.(srt|vtt|ass)$/i, "");
  const videoPath = config.videoOut
    ? resolve(config.videoOut)
    : config.burn
      ? `${stem}.hardsub.mp4`
      : config.mux
        ? `${stem}.softsub.mkv`
        : undefined;
  return {
    outPath,
    videoPath,
    reviewPath: `${stem}.review.json`,
    cacheDir: resolve(config.cacheDir ?? join(dirname(outPath), ".vt-cache")),
  };
}

const stripExt = (path: string): string => basename(path, extname(path));

async function assertNotSource(
  paths: (string | undefined)[],
  sources: (string | undefined)[],
): Promise<void> {
  const pairs: [string, string][] = [];
  for (const target of paths) {
    if (!target) continue;
    for (const source of sources) {
      if (source) pairs.push([target, source]);
    }
  }
  // Comparaisons indépendantes (lectures seules) : exécution parallèle, première correspondance dans l'ordre conservé.
  const matches = await Promise.all(
    pairs.map(([target, source]) => same(target, source)),
  );
  const match = pairs[matches.indexOf(true)];
  if (match) {
    const [target] = match;
    throw new UsageError(
      `${target} est le fichier source : la source n'est jamais écrasée (choisir une autre sortie avec --out / --video-out)`,
    );
  }
}

async function requireFile(path: string, label: string): Promise<string> {
  const resolved = resolve(path);
  if (!(await Bun.file(resolved).exists()))
    throw new UsageError(`${label} introuvable : ${path}`);
  return resolved;
}

// ---------------------------------------------------------------------------------------------
// plan
// ---------------------------------------------------------------------------------------------

function toolLine(name: string, env: Env): string {
  const path = which(name, env);
  return `${name} ${path ? `✓ ${path}` : "✗ introuvable"}`;
}

async function planLines(
  config: Config,
  deps: Deps,
  paths: Paths,
  glossary: { names: string[]; counts: string; total: number },
): Promise<string[]> {
  const { env } = deps;
  const lines: string[] = [];
  const url = config.input && isUrl(config.input);
  const needMedia = !config.subsFrom || config.burn || config.mux;
  lines.push(
    "Plan (--dry-run : rien n'est téléchargé, transcrit, traduit ni écrit)",
  );
  lines.push(
    `  Entrée         : ${config.input ?? "(aucune)"}${config.subsFrom ? `  ·  sous-titres source : ${config.subsFrom}` : ""}`,
  );
  lines.push(`  Langue source  : ${config.from}`);
  lines.push(
    `  Outils         : ${["ffmpeg", "ffprobe", "yt-dlp", "uv", "whisper-cli"].map((name) => toolLine(name, env)).join(" · ")}`,
  );
  if (url && needMedia)
    lines.push(
      `  Téléchargement : yt-dlp → ${join(paths.cacheDir, "download")}${config.keepDownload ? "" : " (supprimé à la fin)"}`,
    );
  let cueCount: number | undefined;
  if (config.subsFrom) {
    const file = await requireFile(config.subsFrom, "fichier de sous-titres");
    cueCount = parseSubtitles(await Bun.file(file).text()).length;
    lines.push(`  ASR            : ignoré (--subs-from, ${cueCount} cues)`);
  } else if (config.input && !url) {
    const file = await requireFile(config.input, "fichier");
    const detection: Detection = await detectAsr(config.asr, env);
    lines.push(
      detection.selected
        ? `  ASR            : ${detection.selected.backend} (${detection.selected.detail})`
        : "  ASR            : AUCUN moteur utilisable : installer whisper.cpp (whisper-cli + modèle ggml), uv, ou donner --asr-url",
    );
    for (const note of detection.notes)
      lines.push(`                   - ${note}`);
    try {
      const duration = await probeDuration(file, env);
      const chunks = planChunks(
        duration,
        config.asr.chunkSeconds,
        config.asr.overlapSeconds,
      );
      lines.push(
        `  Durée          : ${fmtDuration(duration)} → ${chunks.length} tronçon(s) audio (${config.asr.chunkSeconds} s, recouvrement ${config.asr.overlapSeconds} s)`,
      );
    } catch (error) {
      lines.push(
        `  Durée          : illisible (${error instanceof Error ? error.message : String(error)})`,
      );
    }
  } else {
    const detection = await detectAsr(config.asr, env);
    lines.push(
      detection.selected
        ? `  ASR            : ${detection.selected.backend} (${detection.selected.detail}) après téléchargement`
        : "  ASR            : AUCUN moteur utilisable (voir --asr / --asr-url)",
    );
    for (const note of detection.notes)
      lines.push(`                   - ${note}`);
  }
  const llm = await resolveLlm(config, env);
  const reach =
    llm.reachable === true
      ? "joignable"
      : llm.reachable === false
        ? "NON joignable"
        : "non vérifié";
  lines.push(
    `  Traduction     : ${llm.baseUrl} · modèle ${llm.model ?? "(aucun : --llm-model)"} · ${reach}${isLocalHost(llm.baseUrl) ? " (local)" : " (DISTANT : le texte des sous-titres y sera envoyé)"}`,
  );
  if (llm.reachable === false) lines.push(`                   ${LLM_HINT}`);
  const t = config.translate;
  const windows =
    cueCount === undefined ? undefined : Math.ceil(cueCount / t.windowSize);
  lines.push(
    `  Méthode        : résumé global, puis fenêtres de ${t.windowSize} cues (contexte : ${t.before} traduites avant, ${t.after} sources après)${windows === undefined ? "" : ` → ${windows} fenêtre(s)`}, ${t.retries} réparation(s) puis repli cue par cue${t.review ? ", relecture" : ""}`,
  );
  lines.push(
    `  Glossaires     : ${glossary.names.join(", ") || "aucun"} (${glossary.counts}; ${glossary.total} entrées)`,
  );
  lines.push(
    `  Mise en page   : ${config.layout.maxLines} lignes de ${config.layout.maxLine} car. max, ${config.layout.maxCps} car./s max, sans chevauchement`,
  );
  lines.push(
    `  Sorties        : ${paths.outPath}${config.bilingual ? " (bilingue)" : ""}${paths.videoPath ? ` · ${paths.videoPath}` : ""}${t.review ? ` · ${paths.reviewPath}` : ""}`,
  );
  let existing = 0;
  try {
    existing = (await readdir(paths.cacheDir)).filter((name) =>
      name.endsWith(".json"),
    ).length;
  } catch {
    // no cache yet
  }
  lines.push(
    `  Cache          : ${paths.cacheDir} (${existing} fichier(s); lecture ${config.resume ? "activée" : "désactivée, ajouter --resume"})`,
  );
  return lines;
}

// ---------------------------------------------------------------------------------------------
// run
// ---------------------------------------------------------------------------------------------

export async function runPipeline(config: Config, deps: Deps): Promise<number> {
  const { env, io } = deps;
  const started = Date.now();
  const cwd = process.cwd();
  const url = config.input !== undefined && isUrl(config.input);
  const needMedia = !config.subsFrom || config.burn || config.mux;
  const localInput =
    config.input && !url
      ? await requireFile(config.input, "fichier")
      : undefined;
  const subsPath = config.subsFrom
    ? await requireFile(config.subsFrom, "fichier de sous-titres")
    : undefined;
  const local = localInput ?? subsPath;
  const sourceBase = local
    ? stripExt(local)
    : stripExt(
        new URL(config.input ?? "").pathname.split("/").pop() || "video",
      );
  const baseDir = local ? dirname(local) : cwd;
  let paths = derivePaths(config, sourceBase, baseDir);

  const { glossary, files } = await loadGlossaries(config.glossaries);
  const summary = {
    names: files.map((file) => file.name),
    counts: files
      .map((file) => `${file.name}: ${file.entries.length}`)
      .join(", "),
    total: glossary.size,
  };

  if (config.dryRun) {
    await assertNotSource(
      [paths.outPath, paths.videoPath],
      [localInput, subsPath],
    );
    for (const line of await planLines(config, deps, paths, summary))
      io.out(line);
    return 0;
  }

  // Early checks, before any long work.
  await assertNotSource(
    [paths.outPath, paths.videoPath],
    [localInput, subsPath],
  );
  const llm = await resolveLlm(config, env);
  if (!llm.model)
    throw new ToolError(
      `aucun modèle LLM : ${llm.reachable === false ? `endpoint ${llm.baseUrl} injoignable. ${LLM_HINT}` : "/models ne liste rien, donner --llm-model."}`,
    );
  if (llm.reachable === false)
    throw new ToolError(
      `endpoint LLM injoignable (${llm.baseUrl}). ${LLM_HINT}`,
    );
  if (!isLocalHost(llm.baseUrl))
    io.log(
      `attention : le texte des sous-titres sera envoyé à ${new URL(llm.baseUrl).host} (endpoint distant)`,
    );
  io.log(`LLM : ${llm.baseUrl} · modèle ${llm.model}`);

  const cache = new Cache(paths.cacheDir, config.resume);
  let media = localInput;
  let downloaded: string | undefined;
  let language: string | undefined;
  let asrInfo: AsrResult | undefined;
  let cues: Cue[];
  try {
    if (url && needMedia) {
      io.log(`téléchargement : ${config.input}`);
      downloaded = await download(
        config.input as string,
        join(paths.cacheDir, "download"),
        config.burn || config.mux,
        env,
      );
      media = downloaded;
      if (!config.out) paths = derivePaths(config, stripExt(downloaded), cwd);
      await assertNotSource([paths.outPath, paths.videoPath], [downloaded]);
    }

    if (subsPath) {
      cues = parseSubtitles(await Bun.file(subsPath).text());
      if (!cues.length)
        throw new ToolError(`aucune cue lisible dans ${subsPath}`);
      io.log(
        `sous-titres source : ${subsPath} (${cues.length} cues), ASR ignoré`,
      );
    } else {
      const detection = await detectAsr(config.asr, env);
      if (!detection.selected) {
        throw new ToolError(
          `aucun moteur de reconnaissance vocale utilisable :\n  - ${detection.notes.join("\n  - ")}\n` +
            "Installer whisper.cpp (whisper-cli + modèle ggml, --whisper-model), uv (faster-whisper), ou donner --asr-url, ou fournir --subs-from.",
        );
      }
      io.log(
        `ASR : ${detection.selected.backend} (${detection.selected.detail})`,
      );
      const asrKey = config.asrKeyEnv ? env[config.asrKeyEnv] : undefined;
      if (config.asrKeyEnv && !asrKey)
        throw new UsageError(
          `la variable d'environnement ${config.asrKeyEnv} (--asr-key-env) est vide ou absente`,
        );
      asrInfo = await transcribeMedia(
        media as string,
        detection.selected,
        { ...config.asr, apiKey: asrKey },
        { cache, env, log: io.log },
      );
      cues = asrInfo.cues;
      language = asrInfo.language;
      io.log(
        `ASR terminée : ${cues.length} segments${language ? `, langue ${language}` : ""}${asrInfo.cachedChunks ? `, ${asrInfo.cachedChunks}/${asrInfo.chunks} tronçons en cache` : ""}`,
      );
    }

    const client = new LlmClient({
      baseUrl: llm.baseUrl,
      model: llm.model,
      apiKey: llm.apiKey,
      temperature: config.temperature,
      seed: config.seed,
      timeoutMs: config.llmTimeoutMs,
      extra: config.llmExtra,
    });
    const llmKey = JSON.stringify([
      llm.model,
      config.temperature,
      config.seed ?? null,
      config.llmExtra ?? null,
    ]);
    const sourceLang =
      config.from === "auto" && language
        ? (language.split("-")[0] ?? "auto")
        : config.from;
    const result: TranslateResult = await translateCues(
      cues,
      { llm: client, llmKey, glossary, cache, log: io.log },
      { ...config.translate, sourceLang },
    );

    const laidOut = layoutCues(result.cues, config.layout);
    await mkdir(dirname(paths.outPath), { recursive: true });
    await Bun.write(
      paths.outPath,
      serialize(laidOut.cues, config.format, { bilingual: config.bilingual }),
    );
    if (config.translate.review)
      await Bun.write(
        paths.reviewPath,
        `${JSON.stringify(result.review, null, 2)}\n`,
      );

    report(
      io,
      config,
      result,
      laidOut.stats,
      llm.model,
      client.calls,
      cache,
      glossary,
    );
    io.out(
      `sous-titres : ${paths.outPath} (${laidOut.cues.length} cues, ${config.format})`,
    );

    if (paths.videoPath && media) {
      await mkdir(dirname(paths.videoPath), { recursive: true });
      await assertNotSource([paths.videoPath], [media, localInput]);
      if (config.burn) {
        io.log(`incrustation (ffmpeg) → ${paths.videoPath}`);
        await burnSubtitles({
          input: media,
          subtitles: paths.outPath,
          output: paths.videoPath,
          env,
        });
      } else {
        io.log(
          `ajout de la piste de sous-titres (ffmpeg) → ${paths.videoPath}`,
        );
        await muxSubtitles({
          input: media,
          subtitles: paths.outPath,
          output: paths.videoPath,
          env,
        });
      }
      io.out(`vidéo : ${paths.videoPath}`);
    }
    io.log(`terminé en ${fmtDuration(Date.now() - started)}`);
    return 0;
  } finally {
    if (downloaded && !config.keepDownload)
      await rm(downloaded, { force: true });
  }
}

function report(
  io: Io,
  config: Config,
  result: TranslateResult,
  layout: ReturnType<typeof layoutCues>["stats"],
  model: string,
  calls: number,
  cache: Cache,
  glossary: Glossary,
): void {
  const s = result.stats;
  io.log(
    `bilan : ${result.cues.length} cues, ${s.windows} fenêtre(s) (${s.cachedWindows} en cache), ${calls} appel(s) au modèle ${model}`,
  );
  io.log(
    `  réparations JSON : ${s.repairs} · repli cue par cue : ${s.fallbackCues} · non traduites : ${s.untranslated.length}`,
  );
  if (s.untranslated.length)
    io.log(
      `  cues restées dans la langue source : ${s.untranslated.slice(0, 12).join(", ")}${s.untranslated.length > 12 ? "…" : ""}`,
    );
  for (const warning of s.softWarnings.slice(0, 5))
    io.log(`  avertissement : ${warning}`);
  if (s.glossaryViolations.length) {
    const open = s.glossaryViolations.filter((v) => !v.fixed);
    io.log(
      `  glossaire : ${s.glossaryFixed} rendu(s) littéral(aux) corrigé(s), ${open.length} restant(s)${
        open.length
          ? ` (${open
              .slice(0, 5)
              .map((v) => `#${v.id} ${v.term}≠"${v.bad}"`)
              .join(", ")})`
          : ""
      }`,
    );
  }
  if (result.consistency.length) {
    io.log(
      `  cohérence des termes (${glossary.size} entrées) : ${result.consistency
        .slice(0, 5)
        .map((row) => `${row.src}→${row.term} ${row.used}/${row.total}`)
        .join(" · ")}`,
    );
  }
  io.log(
    `  mise en page : ${layout.merged} fusion(s), ${layout.split} découpe(s), ${layout.extended} cue(s) allongée(s), ${layout.overCps.length} au-dessus de ${config.layout.maxCps} car./s${layout.overCps.length ? ` (cues ${layout.overCps.slice(0, 8).join(", ")})` : ""}`,
  );
  if (config.translate.review) {
    const errors = result.review.filter(
      (issue) => issue.severity === "error",
    ).length;
    io.log(
      `  relecture : ${result.review.length} remarque(s) dont ${errors} erreur(s)${config.translate.reviewApply ? `, ${result.review.filter((i) => i.applied).length} appliquée(s)` : ""}`,
    );
  }
  if (cache.writes) io.log(`  cache : ${cache.dir}`);
}
