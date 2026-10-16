import { copyFile, mkdir, readdir, stat, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join, resolve } from "node:path";

import { parse, UsageError } from "../../shared/args.ts";
import { formatBytes } from "../../shared/format.ts";
import type { Command } from "./types.ts";

const HELP = `creator-kit img-compress <fichiers|dossiers…> [options]

Compresse des images en local (aucun envoi sur Internet). Par défaut les originaux ne sont jamais modifiés :
les résultats vont dans un dossier "compressed" à côté des sources, et un fichier n'est gardé que s'il est
plus petit que l'original.

Options :
  --out <dossier>       dossier de sortie (défaut : <source>/compressed)
  --in-place            remplace l'original, seulement si le résultat est plus petit
  --format <f>          keep (défaut) | webp | jpeg | png
  --quality <1-100>     qualité JPEG/WebP (défaut 80)
  --png-colors <2-256>  PNG : nombre de couleurs de la palette (défaut 256, perte quasi invisible)
  --png-lossless        PNG : sans perte (palette désactivée)
  --max-width <px>      réduit si plus large (ratio conservé)
  --max-height <px>     réduit si plus haut
  --recursive           descend dans les sous-dossiers
  --min-gain <%>        ignore un résultat qui économise moins que ça (défaut 3)
  --dry-run             liste ce qui serait traité
  -h, --help

Formats lus : PNG, JPEG, WebP. Les métadonnées (EXIF, GPS) ne sont pas recopiées.
Nécessite un Bun avec Bun.Image ; sinon utilise la page web/image-compressor/index.html.`;

const READABLE = new Set([".png", ".jpg", ".jpeg", ".webp"]);
type Format = "png" | "jpeg" | "webp";

export interface Options {
  format: "keep" | Format;
  quality: number;
  pngColors: number;
  pngLossless: boolean;
  maxWidth?: number;
  maxHeight?: number;
  minGain: number;
}

export function targetFormat(path: string, wanted: Options["format"]): Format {
  if (wanted !== "keep") return wanted;
  const ext = extname(path).toLowerCase();
  return ext === ".png" ? "png" : ext === ".webp" ? "webp" : "jpeg";
}

const EXT: Record<Format, string> = { png: ".png", jpeg: ".jpg", webp: ".webp" };

/** Encode one image; returns the compressed bytes. */
export async function encode(
  input: Uint8Array,
  format: Format,
  options: Options,
): Promise<Uint8Array> {
  const Image = (Bun as unknown as { Image?: new (data: Uint8Array) => BunImage }).Image;
  if (!Image)
    throw new Error("Bun.Image indisponible dans ce Bun : utilise web/image-compressor/index.html");
  let image = new Image(input);
  const { width, height } = await new Image(input).metadata();
  const ratio = Math.min(
    options.maxWidth && width > options.maxWidth ? options.maxWidth / width : 1,
    options.maxHeight && height > options.maxHeight ? options.maxHeight / height : 1,
  );
  if (ratio < 1)
    image = image.resize(
      Math.max(1, Math.round(width * ratio)),
      Math.max(1, Math.round(height * ratio)),
    );
  switch (format) {
    case "png":
      return image
        .png(
          options.pngLossless
            ? { compressionLevel: 9 }
            : { palette: true, colors: options.pngColors },
        )
        .toBuffer();
    case "webp":
      return image.webp({ quality: options.quality }).toBuffer();
    case "jpeg":
      return image.jpeg({ quality: options.quality }).toBuffer();
  }
}

interface BunImage {
  metadata(): Promise<{ width: number; height: number }>;
  resize(width: number, height?: number): BunImage;
  png(options?: Record<string, unknown>): BunImage;
  webp(options?: Record<string, unknown>): BunImage;
  jpeg(options?: Record<string, unknown>): BunImage;
  toBuffer(): Promise<Uint8Array>;
}

async function collect(paths: string[], recursive: boolean): Promise<string[]> {
  const out: string[] = [];
  async function visit(path: string, top: boolean): Promise<void> {
    const info = await stat(path);
    if (info.isFile()) {
      if (READABLE.has(extname(path).toLowerCase())) out.push(path);
      return;
    }
    if (!info.isDirectory() || (!top && !recursive)) return;
    for (const entry of await readdir(path, { withFileTypes: true })) {
      if (entry.isSymbolicLink() || entry.name === "compressed") continue;
      if (entry.isDirectory() && !recursive) continue;
      // oxlint-disable-next-line no-await-in-loop -- parcours récursif séquentiel : l'ordre de la liste de fichiers doit rester déterministe
      await visit(join(path, entry.name), false);
    }
  }
  for (const path of paths) {
    // oxlint-disable-next-line no-await-in-loop -- racines parcourues dans l'ordre fourni pour une liste de fichiers déterministe
    await visit(resolve(path), true);
  }
  return out;
}

export interface Outcome {
  source: string;
  dest?: string;
  before: number;
  after: number;
  status: "written" | "kept-original" | "skipped" | "error";
  detail?: string;
}

export async function compressFile(
  source: string,
  options: Options,
  place: (source: string, format: Format) => string,
  inPlace: boolean,
): Promise<Outcome> {
  const input = new Uint8Array(await Bun.file(source).arrayBuffer());
  const before = input.byteLength;
  const format = targetFormat(source, options.format);
  try {
    const output = await encode(input, format, options);
    const gain = ((before - output.byteLength) / before) * 100;
    const sameFormat = format === targetFormat(source, "keep");
    if (output.byteLength >= before || (sameFormat && gain < options.minGain)) {
      if (!inPlace) {
        const dest = place(source, format).replace(/\.[^.]+$/, extname(source));
        await mkdir(dirname(dest), { recursive: true });
        await copyFile(source, dest);
        return {
          source,
          dest,
          before,
          after: before,
          status: "kept-original",
          detail: "pas de gain, original copié",
        };
      }
      return { source, before, after: before, status: "kept-original", detail: "pas de gain" };
    }
    const dest = inPlace && sameFormat ? source : place(source, format);
    await mkdir(dirname(dest), { recursive: true });
    await writeFile(dest, output);
    return { source, dest, before, after: output.byteLength, status: "written" };
  } catch (error) {
    return { source, before, after: before, status: "error", detail: (error as Error).message };
  }
}

export async function run(argv: string[]): Promise<number> {
  const { values, positionals } = parse(argv, {
    out: { type: "string" },
    "in-place": { type: "boolean" },
    format: { type: "string" },
    quality: { type: "string" },
    "png-colors": { type: "string" },
    "png-lossless": { type: "boolean" },
    "max-width": { type: "string" },
    "max-height": { type: "string" },
    recursive: { type: "boolean" },
    "min-gain": { type: "string" },
    "dry-run": { type: "boolean" },
    help: { type: "boolean", short: "h" },
  });
  if (values.help) {
    console.log(HELP);
    return 0;
  }
  if (positionals.length === 0) throw new UsageError("Donne au moins un fichier ou un dossier");
  const format = (values.format ?? "keep") as Options["format"];
  if (!["keep", "png", "jpeg", "webp"].includes(format))
    throw new UsageError(`Format inconnu : ${format}`);
  const options: Options = {
    format,
    quality: Math.min(100, Math.max(1, Number(values.quality ?? 80))),
    pngColors: Math.min(256, Math.max(2, Number(values["png-colors"] ?? 256))),
    pngLossless: values["png-lossless"] === true,
    maxWidth: values["max-width"] ? Number(values["max-width"]) : undefined,
    maxHeight: values["max-height"] ? Number(values["max-height"]) : undefined,
    minGain: Number(values["min-gain"] ?? 3),
  };
  const files = await collect(positionals, values.recursive === true);
  if (files.length === 0) {
    console.log("Aucune image PNG/JPEG/WebP trouvée.");
    return 0;
  }
  const inPlace = values["in-place"] === true;
  const place = (source: string, target: Format): string => {
    const name = basename(source, extname(source)) + EXT[target];
    return values.out ? join(resolve(values.out), name) : join(dirname(source), "compressed", name);
  };
  if (values["dry-run"]) {
    for (const file of files) console.log(`${file} -> ${targetFormat(file, options.format)}`);
    console.log(`${files.length} image(s)`);
    return 0;
  }
  let before = 0;
  let after = 0;
  let errors = 0;
  const queue = [...files];
  const results: Outcome[] = [];
  await Promise.all(
    Array.from({ length: Math.min(4, queue.length) }, async () => {
      for (let file = queue.shift(); file; file = queue.shift()) {
        // oxlint-disable-next-line no-await-in-loop -- file de travail à concurrence bornée (4) : chaque worker traite ses fichiers séquentiellement
        const outcome = await compressFile(file, options, place, inPlace);
        results.push(outcome);
        const pct = outcome.before ? Math.round((1 - outcome.after / outcome.before) * 100) : 0;
        console.log(
          `${outcome.status === "error" ? "ERREUR" : outcome.status === "written" ? `-${pct}%` : "  =  "}  ${formatBytes(outcome.before)} -> ${formatBytes(outcome.after)}  ${basename(file)}${outcome.detail ? `  (${outcome.detail})` : ""}`,
        );
      }
    }),
  );
  for (const r of results) {
    before += r.before;
    after += r.after;
    if (r.status === "error") errors += 1;
  }
  console.log(
    `\n${results.length} image(s) : ${formatBytes(before)} -> ${formatBytes(after)} (${formatBytes(before - after)} économisés)`,
  );
  return errors === 0 ? 0 : 1;
}

const command: Command = {
  name: "img-compress",
  summary: "Compresser des images en local (JPEG, PNG, WebP)",
  run,
};

export default command;
