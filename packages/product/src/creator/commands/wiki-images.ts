import { mkdir, rename, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { parse, UsageError } from "../../shared/args.ts";
import { formatBytes } from "../../shared/format.ts";
import {
  fetchWithRetry,
  filesOfCategory,
  filesOfPages,
  filesOfPrefix,
  resolveTarget,
  safeName,
  type Fetch,
  type WikiFile,
} from "./wiki-images/mediawiki.ts";
import type { Command } from "./types.ts";

const HELP = `creator-kit wiki-images <url-wiki> [options]

Télécharge toutes les images d'une page (galerie incluse), d'une catégorie ou d'un préfixe de fichiers
d'un wiki MediaWiki (Fandom, Dustloop, Wikipédia…), en un seul appel.

Exemples :
  creator-kit wiki-images https://guilty-gear.fandom.com/wiki/Sol_Badguy/Gallery
  creator-kit wiki-images https://www.dustloop.com/w/GGST/Sol_Badguy --category "GGST Sol Badguy images" --depth 1
  creator-kit wiki-images https://guilty-gear.fandom.com/wiki/Special:Random --prefix "Sol_" --dry-run

Options :
  --page <titre>       page(s) à lire en plus de celle de l'URL (répétable)
  --category <nom>     catégorie de fichiers (répétable) ; --depth <n> descend dans les sous-catégories
  --prefix <préfixe>   tous les fichiers dont le nom commence par ce préfixe
  --api <url>          URL de api.php (sinon détectée depuis l'URL du wiki)
  --out <dossier>      destination (défaut : ./wiki-images/<hôte>)
  --ext <liste>        extensions gardées, ex. png,jpg,webp,gif (défaut : images)
  --min-size <Ko>      ignore les fichiers plus petits
  --concurrency <n>    téléchargements parallèles (défaut 4, max 8)
  --dry-run            liste sans télécharger
  -h, --help`;

const IMAGE_EXT = new Set(["png", "jpg", "jpeg", "gif", "webp", "avif", "bmp", "svg"]);

async function exists(path: string, size: number): Promise<boolean> {
  try {
    return (await stat(path)).size === size;
  } catch {
    return false;
  }
}

async function download(file: WikiFile, dest: string, fetchImpl: Fetch): Promise<void> {
  const res = await fetchWithRetry(file.url, fetchImpl);
  const part = `${dest}.part`;
  await Bun.write(part, res);
  await rename(part, dest);
}

async function pool<T>(items: T[], limit: number, work: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const item = items[next++] as T;
      // oxlint-disable-next-line no-await-in-loop -- each pool worker drains its queue one item at a time; the worker count is the concurrency limit
      await work(item);
    }
  });
  await Promise.all(workers);
}

export async function run(argv: string[], fetchImpl: Fetch = fetch): Promise<number> {
  const { values, positionals } = parse(argv, {
    page: { type: "string", multiple: true },
    category: { type: "string", multiple: true },
    prefix: { type: "string" },
    api: { type: "string" },
    out: { type: "string" },
    ext: { type: "string" },
    "min-size": { type: "string" },
    depth: { type: "string" },
    concurrency: { type: "string" },
    "dry-run": { type: "boolean" },
    help: { type: "boolean", short: "h" },
  });
  if (values.help) {
    console.log(HELP);
    return 0;
  }
  const input = positionals[0];
  if (!input && !values.api) throw new UsageError("URL du wiki manquante");
  const target = values.api
    ? { apiUrl: values.api, title: undefined }
    : await resolveTarget(input as string, fetchImpl);

  const titles = [...(target.title ? [target.title] : []), ...(values.page ?? [])];
  const categories = values.category ?? [];
  if (titles.length === 0 && categories.length === 0 && !values.prefix) {
    throw new UsageError("Rien à lire : donne une URL de page, --page, --category ou --prefix");
  }

  const depth = Number(values.depth ?? 0);
  const found: WikiFile[] = [];
  if (titles.length > 0) found.push(...(await filesOfPages(target.apiUrl, titles, fetchImpl)));
  for (const category of categories)
    // oxlint-disable-next-line no-await-in-loop -- categories are queried one at a time, as the MediaWiki API asks clients to avoid parallel requests
    found.push(...(await filesOfCategory(target.apiUrl, category, fetchImpl, depth)));
  if (values.prefix) found.push(...(await filesOfPrefix(target.apiUrl, values.prefix, fetchImpl)));

  const allowed = values.ext
    ? new Set(
        values.ext
          .toLowerCase()
          .split(",")
          .map(e => e.trim()),
      )
    : IMAGE_EXT;
  const minBytes = Number(values["min-size"] ?? 0) * 1024;
  const unique = new Map<string, WikiFile>();
  for (const file of found) {
    const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
    if (allowed.has(ext) && file.size >= minBytes) unique.set(file.url, file);
  }
  const files = [...unique.values()];
  const total = files.reduce((sum, file) => sum + file.size, 0);
  console.log(`${files.length} fichier(s), ${formatBytes(total)} (${new URL(target.apiUrl).host})`);
  if (values["dry-run"]) {
    for (const file of files) console.log(`  ${file.name}  ${file.width}x${file.height}  ${formatBytes(file.size)}`);
    return 0;
  }

  const outDir = resolve(values.out ?? join("wiki-images", new URL(target.apiUrl).host));
  await mkdir(outDir, { recursive: true });
  const used = new Set<string>();
  let done = 0;
  let skipped = 0;
  const failed: string[] = [];
  const plan = files.map(file => {
    let name = safeName(file.name);
    for (let n = 2; used.has(name.toLowerCase()); n += 1) name = safeName(`${n}_${file.name}`);
    used.add(name.toLowerCase());
    return { file, name, dest: join(outDir, name) };
  });
  await pool(plan, Math.min(Math.max(Number(values.concurrency ?? 4), 1), 8), async ({ file, dest }) => {
    if (await exists(dest, file.size)) {
      skipped += 1;
      return;
    }
    try {
      await download(file, dest, fetchImpl);
      done += 1;
      if (process.stdout.isTTY) process.stdout.write(`\r${done + skipped}/${files.length}`);
    } catch (error) {
      failed.push(`${file.name}: ${(error as Error).message}`);
    }
  });
  await writeFile(
    join(outDir, "manifest.json"),
    JSON.stringify(
      plan.map(({ file, name }) => ({
        name,
        source: file.descriptionUrl,
        url: file.url,
        size: file.size,
      })),
      null,
      2,
    ),
  );
  console.log(`\nTéléchargés : ${done}, déjà présents : ${skipped}, échecs : ${failed.length} -> ${outDir}`);
  for (const line of failed) console.error(`  ${line}`);
  return failed.length === 0 ? 0 : 1;
}

const command: Command = {
  name: "wiki-images",
  summary: "Télécharger les images d'une page, galerie ou catégorie de wiki",
  run: argv => run(argv),
};

export default command;
