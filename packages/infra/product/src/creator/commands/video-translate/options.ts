/** Command-line options of `video-translate`: spec, validation and help text. */
import { UsageError, parse } from "../../../shared/args.ts";
import { type AsrOptions, DEFAULT_ASR } from "./asr.ts";
import { DEFAULT_LAYOUT, type LayoutOptions } from "./layout.ts";
import { DEFAULT_TRANSLATE, type TranslateOptions } from "./translate.ts";
import type { SubtitleFormat } from "./subtitles.ts";

export const SPEC = {
  help: { type: "boolean", short: "h" },
  out: { type: "string", short: "o" },
  format: { type: "string" },
  from: { type: "string" },
  "subs-from": { type: "string" },
  asr: { type: "string" },
  "whisper-model": { type: "string" },
  "whisper-args": { type: "string" },
  "fw-model": { type: "string" },
  "fw-device": { type: "string" },
  "fw-compute": { type: "string" },
  "asr-url": { type: "string" },
  "asr-model": { type: "string" },
  "asr-key-env": { type: "string" },
  "chunk-seconds": { type: "string" },
  "overlap-seconds": { type: "string" },
  "llm-url": { type: "string" },
  "llm-model": { type: "string" },
  "llm-key-env": { type: "string" },
  "llm-timeout": { type: "string" },
  "llm-extra": { type: "string" },
  temperature: { type: "string" },
  seed: { type: "string" },
  glossary: { type: "string", multiple: true },
  "no-glossary": { type: "boolean" },
  context: { type: "string" },
  window: { type: "string" },
  "context-before": { type: "string" },
  "context-after": { type: "string" },
  retries: { type: "string" },
  review: { type: "boolean" },
  "review-apply": { type: "boolean" },
  "max-cps": { type: "string" },
  "max-line": { type: "string" },
  bilingual: { type: "boolean" },
  burn: { type: "boolean" },
  mux: { type: "boolean" },
  "video-out": { type: "string" },
  "dry-run": { type: "boolean" },
  resume: { type: "boolean" },
  "cache-dir": { type: "string" },
  "keep-download": { type: "boolean" },
} as const;

export interface Config {
  /** Positional media file or URL (may be a subtitle file, then it is `subsFrom`). */
  input?: string;
  subsFrom?: string;
  out?: string;
  format: SubtitleFormat;
  bilingual: boolean;
  burn: boolean;
  mux: boolean;
  videoOut?: string;
  dryRun: boolean;
  resume: boolean;
  cacheDir?: string;
  keepDownload: boolean;
  /** ISO code or "auto". */
  from: string;
  asr: AsrOptions;
  asrKeyEnv?: string;
  llmUrl?: string;
  llmModel?: string;
  llmKeyEnv?: string;
  llmTimeoutMs: number;
  llmExtra?: Record<string, unknown>;
  temperature: number;
  seed: number | undefined;
  glossaries: string[];
  translate: TranslateOptions;
  layout: LayoutOptions;
}

function number(
  name: string,
  value: string | undefined,
  fallback: number,
  min: number,
  max: number,
  integer = false,
): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (
    !Number.isFinite(parsed) ||
    parsed < min ||
    parsed > max ||
    (integer && !Number.isInteger(parsed))
  ) {
    throw new UsageError(
      `--${name} doit être ${integer ? "un entier" : "un nombre"} entre ${min} et ${max} (reçu : ${value})`,
    );
  }
  return parsed;
}

const SUBTITLE_FILE = /\.(srt|vtt|ass|ssa)$/i;

export function parseConfig(argv: string[]): { config?: Config; help: boolean } {
  const { values, positionals } = parse(argv, SPEC);
  if (values.help) return { help: true };
  if (positionals.length > 1)
    throw new UsageError(`un seul fichier ou lien attendu (reçu : ${positionals.join(", ")})`);
  let input = positionals[0];
  let subsFrom = values["subs-from"];
  if (input && SUBTITLE_FILE.test(input) && !/^https?:\/\//i.test(input)) {
    if (subsFrom)
      throw new UsageError("fichier de sous-titres donné deux fois (positionnel et --subs-from)");
    subsFrom = input;
    input = undefined;
  }
  if (!input && !subsFrom)
    throw new UsageError("indiquer un fichier vidéo/audio, un lien, ou --subs-from <fichier>");

  const format = (values.format ?? "srt").toLowerCase();
  if (format !== "srt" && format !== "vtt" && format !== "ass")
    throw new UsageError(`--format : srt, vtt ou ass (reçu : ${format})`);
  const from = (values.from ?? "auto").toLowerCase();
  if (from !== "auto" && !/^[a-z]{2,3}(-[a-z0-9]+)?$/.test(from))
    throw new UsageError(`--from : auto ou un code langue (ja, fr, ko, es...) (reçu : ${from})`);
  if (from === "en")
    throw new UsageError("--from en : la source est déjà en anglais, rien à traduire");

  const backend = (values.asr ?? "auto") as AsrOptions["backend"];
  if (!["auto", "whisper-cli", "faster-whisper", "endpoint"].includes(backend)) {
    throw new UsageError(
      `--asr : auto, whisper-cli, faster-whisper ou endpoint (reçu : ${backend})`,
    );
  }
  if (backend === "endpoint" && !values["asr-url"])
    throw new UsageError("--asr endpoint demande --asr-url <url>");

  let llmExtra: Record<string, unknown> | undefined;
  if (values["llm-extra"]) {
    try {
      const parsed: unknown = JSON.parse(values["llm-extra"]);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
        throw new Error("not an object");
      llmExtra = parsed as Record<string, unknown>;
    } catch {
      throw new UsageError(
        '--llm-extra doit être un objet JSON, par exemple \'{"chat_template_kwargs":{"enable_thinking":false}}\'',
      );
    }
  }

  const maxLine = number("max-line", values["max-line"], DEFAULT_LAYOUT.maxLine, 20, 80, true);
  const maxCps = number("max-cps", values["max-cps"], DEFAULT_LAYOUT.maxCps, 8, 40);
  const burn = values.burn ?? false;
  const mux = values.mux ?? false;
  if (burn && mux && values["video-out"])
    throw new UsageError(
      "--video-out ne s'applique qu'à un seul de --burn / --mux : les lancer séparément",
    );
  if ((burn || mux) && !input)
    throw new UsageError(
      "--burn et --mux demandent la vidéo source (fichier ou lien) en plus des sous-titres",
    );

  const translate: TranslateOptions = {
    ...DEFAULT_TRANSLATE,
    sourceLang: from,
    userContext: values.context,
    windowSize: number("window", values.window, DEFAULT_TRANSLATE.windowSize, 3, 60, true),
    before: number(
      "context-before",
      values["context-before"],
      DEFAULT_TRANSLATE.before,
      0,
      20,
      true,
    ),
    after: number("context-after", values["context-after"], DEFAULT_TRANSLATE.after, 0, 20, true),
    retries: number("retries", values.retries, DEFAULT_TRANSLATE.retries, 0, 5, true),
    maxCps,
    maxLine,
    review: (values.review ?? false) || (values["review-apply"] ?? false),
    reviewApply: values["review-apply"] ?? false,
  };

  const asr: AsrOptions = {
    ...DEFAULT_ASR,
    backend,
    language: from,
    whisperModel: values["whisper-model"],
    whisperArgs: values["whisper-args"]?.split(/\s+/).filter(Boolean) ?? [],
    fwModel: values["fw-model"] ?? DEFAULT_ASR.fwModel,
    fwDevice: values["fw-device"] ?? DEFAULT_ASR.fwDevice,
    fwCompute: values["fw-compute"] ?? DEFAULT_ASR.fwCompute,
    url: values["asr-url"],
    urlModel: values["asr-model"] ?? DEFAULT_ASR.urlModel,
    chunkSeconds: number(
      "chunk-seconds",
      values["chunk-seconds"],
      DEFAULT_ASR.chunkSeconds,
      30,
      3600,
    ),
    overlapSeconds: number(
      "overlap-seconds",
      values["overlap-seconds"],
      DEFAULT_ASR.overlapSeconds,
      0,
      60,
    ),
  };

  const seed =
    values.seed === undefined
      ? 7
      : number("seed", values.seed, 7, -2_147_483_648, 2_147_483_647, true);
  const config: Config = {
    input,
    subsFrom,
    out: values.out,
    format,
    bilingual: values.bilingual ?? false,
    burn,
    mux,
    videoOut: values["video-out"],
    dryRun: values["dry-run"] ?? false,
    resume: values.resume ?? false,
    cacheDir: values["cache-dir"],
    keepDownload: values["keep-download"] ?? false,
    from,
    asr,
    asrKeyEnv: values["asr-key-env"],
    llmUrl: values["llm-url"],
    llmModel: values["llm-model"],
    llmKeyEnv: values["llm-key-env"],
    llmTimeoutMs: number("llm-timeout", values["llm-timeout"], 300, 5, 3600) * 1000,
    llmExtra,
    temperature: number("temperature", values.temperature, 0.2, 0, 2),
    seed,
    glossaries: values["no-glossary"]
      ? []
      : values.glossary?.length
        ? values.glossary
        : ["fgc-common", "guilty-gear", "art-streams"],
    translate,
    layout: { ...DEFAULT_LAYOUT, maxLine, maxCps },
  };
  return { config, help: false };
}

export const HELP = `creator-kit video-translate <vidéo|audio|lien> [options]
creator-kit video-translate --subs-from <fichier.srt|vtt|ass> [options]

Sous-titres anglais naturels (pas littéraux) pour des vidéos de jeux de combat ou de dessin.
Tout est local par défaut : seuls l'endpoint LLM, l'endpoint ASR et yt-dlp que tu configures sont contactés.

Entrée
  <fichier|lien>           vidéo ou audio local, ou lien (télécharge avec yt-dlp s'il est dans le PATH)
  --subs-from <fichier>    saute la reconnaissance vocale : traduit ces sous-titres (srt, vtt, ass)
  --from <langue>          auto (défaut), ja, fr, ko, es, ...

Reconnaissance vocale (ASR), détectée dans cet ordre et affichée :
  1. whisper-cli (whisper.cpp)   --whisper-model <ggml.bin>  --whisper-args "<options>"
  2. faster-whisper via uv       uv run --script fw_transcribe.py <langue> <modèle> <device> <compute> <wav>
                                 --fw-model large-v3  --fw-device auto  --fw-compute default
  3. endpoint OpenAI /v1/audio/transcriptions   --asr-url <url>  --asr-model whisper-1  --asr-key-env <VAR>
  --asr auto|whisper-cli|faster-whisper|endpoint force un moteur ; --asr-url donné seul passe en premier.
  --chunk-seconds 600  --overlap-seconds 5    découpage des longs fichiers avec recouvrement

Traduction (endpoint compatible OpenAI /chat/completions)
  --llm-url <url>          défaut : CREATOR_KIT_LLM_URL, sinon http://127.0.0.1:8795/v1 (passerelle aphrody),
                           sinon http://127.0.0.1:8080/v1 (llama-server)
  --llm-model <nom>        défaut : CREATOR_KIT_LLM_MODEL, sinon le premier modèle chargé de /models
  --llm-key-env <VAR>      variable d'environnement qui contient la clé API (jamais en argument)
  --llm-timeout 300        secondes par requête     --llm-extra '<json>'  champs ajoutés au corps
  --temperature 0.2  --seed 7
  --glossary <nom|fichier.json>   répétable ; défaut : fgc-common, guilty-gear, art-streams ; --no-glossary
  --context "<texte>"      contexte libre (jeu, événement, qui parle)
  --window 20  --context-before 5  --context-after 3  --retries 2
  --review                 2e passe : signale les contresens (écrit <sortie>.review.json) ; --review-apply
                           applique les corrections de gravité « error »

Sortie
  -o, --out <fichier>      défaut : <nom>.en.<format> à côté de la source (la source n'est jamais écrasée)
  --format srt|vtt|ass     défaut srt
  --max-cps 17  --max-line 42   2 lignes max ; fusion/découpe auto, jamais de chevauchement
  --bilingual              texte d'origine au-dessus de l'anglais
  --burn                   incruste (sous-titres durs) dans <nom>.en.hardsub.mp4 via ffmpeg
  --mux                    ajoute une piste de sous-titres dans <nom>.en.softsub.mkv via ffmpeg
  --video-out <fichier>    nom de la vidéo produite par --burn / --mux (.mp4 ou .mkv)

Contrôle
  --dry-run                affiche le plan (outils, moteur ASR, endpoint, glossaires, fichiers) sans rien faire
  --resume                 réutilise l'ASR et les traductions déjà calculés (.vt-cache/ à côté de la sortie)
  --cache-dir <dossier>    autre dossier de cache     --keep-download  garde le fichier téléchargé`;
