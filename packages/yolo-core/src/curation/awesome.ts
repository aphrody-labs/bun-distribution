/**
 * `yolo awesome`: browse awesome-bun (oven-sh/awesome-bun, the upstream list; the former Aphrody fork was
 * deleted) from the CLI. `--repo`/`--ref` select another copy of the list.
 *
 * The README is read from GitHub raw (no clone, no token) and cached under `.cache/awesome/`;
 * `--offline` uses the cache only and `--file` reads a local README (tests, drafts).
 * Zero dependencies, native Bun only.
 */
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

export const DEFAULT_REPO = "oven-sh/awesome-bun";
export const DEFAULT_REF = "main";

export interface AwesomeEntry {
  readonly name: string;
  readonly url: string;
  readonly description: string;
  readonly section: string;
  /** `owner/repo` when the link points to a GitHub repository. */
  readonly github?: string | undefined;
}

export interface AwesomeSection {
  readonly title: string;
  readonly slug: string;
  readonly entries: readonly AwesomeEntry[];
}

const SKIPPED_SECTIONS = new Set(["contents", "contributing", "license"]);
const ENTRY = /^\s*[-*]\s+\[([^\]]+)\]\(([^)\s]+)\)\s*(?:[-–—:]\s*(.*))?$/;

export function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/&/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function githubRepo(url: string): string | undefined {
  const match =
    /^https?:\/\/(?:www\.)?github\.com\/([^/#?\s]+)\/([^/#?\s]+)/.exec(url);
  if (match === null) return undefined;
  return `${match[1]}/${(match[2] as string).replace(/\.git$/, "")}`;
}

/** Parses an awesome-list README: `##` headings are sections, `- [name](url) - text` are entries. */
export function parseAwesome(markdown: string): AwesomeSection[] {
  const sections: { title: string; entries: AwesomeEntry[] }[] = [];
  let current: { title: string; entries: AwesomeEntry[] } | undefined;
  let inFence = false;
  for (const line of markdown.split("\n")) {
    if (/^\s*```/.test(line)) inFence = !inFence;
    if (inFence) continue;
    const heading = /^##\s+(.+?)\s*#*\s*$/.exec(line);
    if (heading !== null) {
      const title = (heading[1] as string).trim();
      current = SKIPPED_SECTIONS.has(title.toLowerCase())
        ? undefined
        : { title, entries: [] };
      if (current !== undefined) sections.push(current);
      continue;
    }
    if (/^#\s/.test(line)) {
      current = undefined;
      continue;
    }
    if (current === undefined) continue;
    const entry = ENTRY.exec(line);
    if (entry === null) continue;
    const url = entry[2] as string;
    if (url.startsWith("#")) continue;
    current.entries.push({
      name: (entry[1] as string).trim(),
      url,
      description: (entry[3] ?? "").trim(),
      section: current.title,
      github: githubRepo(url),
    });
  }
  return sections.map((s) => ({
    title: s.title,
    slug: slugify(s.title),
    entries: s.entries,
  }));
}

export function findSection(
  sections: readonly AwesomeSection[],
  query: string,
): AwesomeSection | undefined {
  const wanted = slugify(query);
  return (
    sections.find((s) => s.slug === wanted) ??
    sections.find((s) => s.slug.startsWith(wanted)) ??
    sections.find((s) => s.title.toLowerCase().includes(query.toLowerCase()))
  );
}

export function searchEntries(
  sections: readonly AwesomeSection[],
  query: string,
): AwesomeEntry[] {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  return sections
    .flatMap((s) => s.entries)
    .filter((entry) => {
      const haystack =
        `${entry.name} ${entry.url} ${entry.description} ${entry.section}`.toLowerCase();
      return terms.every((term) => haystack.includes(term));
    });
}

// ---------------------------------------------------------------------------------------------
// Source (GitHub raw + cache)
// ---------------------------------------------------------------------------------------------

export interface SourceOptions {
  readonly repo: string;
  readonly ref: string;
  readonly refresh: boolean;
  readonly offline: boolean;
  readonly file?: string | undefined;
  readonly cacheDir: string;
}

export async function loadReadme(
  options: SourceOptions,
): Promise<{ text: string; origin: string }> {
  if (options.file !== undefined) {
    return { text: await Bun.file(options.file).text(), origin: options.file };
  }
  const cachePath = resolve(
    options.cacheDir,
    options.repo,
    options.ref,
    "README.md",
  );
  const cached = Bun.file(cachePath);
  if (!options.refresh && (await cached.exists())) {
    return { text: await cached.text(), origin: `cache ${cachePath}` };
  }
  if (options.offline) {
    throw new Error(
      `No cached README for ${options.repo}@${options.ref}; run without --offline first`,
    );
  }
  const url = `https://raw.githubusercontent.com/${options.repo}/${options.ref}/README.md`;
  const response = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  if (!response.ok)
    throw new Error(`GET ${url} failed: HTTP ${response.status}`);
  const text = await response.text();
  mkdirSync(dirname(cachePath), { recursive: true });
  await Bun.write(cachePath, text);
  return { text, origin: url };
}

// ---------------------------------------------------------------------------------------------
// Link check
// ---------------------------------------------------------------------------------------------

export interface LinkResult {
  readonly entry: AwesomeEntry;
  readonly status: number | "error";
  readonly detail?: string | undefined;
}

export async function checkLinks(
  entries: readonly AwesomeEntry[],
  options: { concurrency: number; timeoutMs: number },
): Promise<LinkResult[]> {
  const results: LinkResult[] = Array.from({ length: entries.length });
  let next = 0;
  const probe = async (entry: AwesomeEntry): Promise<LinkResult> => {
    for (const method of ["HEAD", "GET"] as const) {
      try {
        // oxlint-disable-next-line no-await-in-loop -- HEAD puis GET : le second essai ne se lance que si le premier échoue
        const response = await fetch(entry.url, {
          method,
          redirect: "follow",
          signal: AbortSignal.timeout(options.timeoutMs),
          headers: { "user-agent": "yolo-awesome/1" },
        });
        // Some servers reject HEAD: retry once with GET before calling the link dead.
        if (method === "HEAD" && response.status >= 400) continue;
        return { entry, status: response.status };
      } catch (error) {
        if (method === "GET") {
          return {
            entry,
            status: "error",
            detail: error instanceof Error ? error.message : String(error),
          };
        }
      }
    }
    return { entry, status: "error" };
  };
  const workers = Array.from(
    { length: Math.max(1, options.concurrency) },
    async () => {
      while (next < entries.length) {
        const index = next++;
        // oxlint-disable-next-line no-await-in-loop -- file de travail à concurrence bornée : chaque worker enchaîne ses sondes
        results[index] = await probe(entries[index] as AwesomeEntry);
      }
    },
  );
  await Promise.all(workers);
  return results;
}

// ---------------------------------------------------------------------------------------------
// Audit and curation against the Rust-based Bun
// ---------------------------------------------------------------------------------------------

/**
 * Bun was rewritten in Rust on 2026-05-14 (commit 23427dbc12 "Rewrite Bun in Rust (#30412)" in the
 * Bun fork). An entry is only kept when there is evidence it lives in that era.
 */
export const RUST_BUN_SINCE = "2026-05-14";

export interface RepoFacts {
  readonly repo: string;
  readonly archived: boolean;
  readonly disabled: boolean;
  readonly pushedAt: string;
  readonly stars: number;
  readonly language: string | null;
  readonly topics: readonly string[];
  readonly description: string;
  readonly license: string | null;
}

export type Verdict = "keep" | "drop";

export interface CuratedEntry extends AwesomeEntry {
  readonly verdict: Verdict;
  readonly reason: string;
  readonly facts?: RepoFacts | undefined;
  readonly httpStatus?: number | "error" | undefined;
}

const OFFICIAL_HOSTS = new Set([
  "bun.sh",
  "bun.com",
  "www.bun.sh",
  "www.bun.com",
]);
/** Sections made of undated posts and videos: they predate the Rust rewrite and cannot be verified. */
const DATED_SECTIONS = new Set(["articles", "videos"]);

async function githubToken(): Promise<string | undefined> {
  const fromEnv = process.env["GITHUB_TOKEN"] ?? process.env["GH_TOKEN"];
  if (fromEnv) return fromEnv;
  try {
    const proc = Bun.spawn(["gh", "auth", "token"], {
      windowsHide: true,
      stdout: "pipe",
      stderr: "ignore",
    });
    const out = (await new Response(proc.stdout).text()).trim();
    return (await proc.exited) === 0 && out !== "" ? out : undefined;
  } catch {
    return undefined;
  }
}

export async function fetchRepoFacts(
  repo: string,
  token: string | undefined,
): Promise<RepoFacts | "missing" | "error"> {
  try {
    const response = await fetch(`https://api.github.com/repos/${repo}`, {
      headers: {
        accept: "application/vnd.github+json",
        "user-agent": "yolo-awesome/1",
        ...(token === undefined ? {} : { authorization: `Bearer ${token}` }),
      },
      signal: AbortSignal.timeout(15_000),
    });
    if (response.status === 404 || response.status === 410) return "missing";
    if (!response.ok) return "error";
    const json = (await response.json()) as Record<string, any>;
    return {
      repo: String(json["full_name"] ?? repo),
      archived: json["archived"] === true,
      disabled: json["disabled"] === true,
      pushedAt: String(json["pushed_at"] ?? ""),
      stars: Number(json["stargazers_count"] ?? 0),
      language: (json["language"] as string | null) ?? null,
      topics: (json["topics"] as string[] | undefined) ?? [],
      description: String(json["description"] ?? ""),
      license: (json["license"]?.["spdx_id"] as string | undefined) ?? null,
    };
  } catch {
    return "error";
  }
}

/** Pure decision rule, so it can be tested without network. */
export function judge(
  entry: AwesomeEntry,
  facts: RepoFacts | "missing" | "error" | undefined,
  httpStatus: number | "error" | undefined,
  since: string,
): CuratedEntry {
  const drop = (reason: string): CuratedEntry => ({
    ...entry,
    verdict: "drop",
    reason,
    facts: typeof facts === "object" ? facts : undefined,
    httpStatus,
  });
  const keep = (reason: string): CuratedEntry => ({
    ...entry,
    verdict: "keep",
    reason,
    facts: typeof facts === "object" ? facts : undefined,
    httpStatus,
  });

  if (DATED_SECTIONS.has(slugify(entry.section)))
    return drop("undated content from before the Rust rewrite");
  const text = `${entry.name} ${entry.description}`.toLowerCase();
  if (/\bzig\b/.test(text)) return drop("depends on Zig-era internals");

  if (entry.github !== undefined) {
    if (facts === "missing") return drop("repository not found");
    if (facts === "error" || facts === undefined)
      return drop("repository state could not be verified");
    if (facts.archived || facts.disabled)
      return drop("archived or disabled repository");
    if (
      httpStatus === "error" ||
      (httpStatus !== undefined && httpStatus >= 400)
    )
      return drop(`link answers ${String(httpStatus)}`);
    if (
      /\bzig\b/i.test(`${facts.description} ${facts.topics.join(" ")}`) ||
      facts.language === "Zig"
    )
      return drop("Zig project");
    if (facts.pushedAt.slice(0, 10) < since)
      return drop(`no activity since ${since}`);
    return keep(
      `active since the Rust rewrite (last push ${facts.pushedAt.slice(0, 10)})`,
    );
  }

  let host = "";
  try {
    host = new URL(entry.url).hostname;
  } catch {
    return drop("invalid URL");
  }
  if (httpStatus === "error" || (httpStatus !== undefined && httpStatus >= 400))
    return drop(`link answers ${String(httpStatus)}`);
  if (OFFICIAL_HOSTS.has(host)) return keep("official Bun site");
  return drop("external page that cannot be verified against the Rust Bun");
}

export async function auditEntries(
  entries: readonly AwesomeEntry[],
  options: { since: string; concurrency: number; timeoutMs: number },
): Promise<CuratedEntry[]> {
  const token = await githubToken();
  // Links outside GitHub, and GitHub links that point inside a repository (tree/blob paths).
  const linkChecked = entries.filter(
    (e) =>
      !DATED_SECTIONS.has(slugify(e.section)) &&
      (e.github === undefined || /\/(?:tree|blob)\//.test(e.url)),
  );
  const links = new Map(
    (await checkLinks(linkChecked, options)).map(
      (r) => [r.entry.url, r.status] as const,
    ),
  );
  const facts = new Map<string, RepoFacts | "missing" | "error">();
  const repos = [
    ...new Set(
      entries.flatMap((e) => (e.github === undefined ? [] : [e.github])),
    ),
  ];
  let next = 0;
  await Promise.all(
    Array.from(
      { length: Math.max(1, Math.min(options.concurrency, 6)) },
      async () => {
        while (next < repos.length) {
          const repo = repos[next++] as string;
          // oxlint-disable-next-line no-await-in-loop -- file de travail à concurrence bornée (6 max) : chaque worker enchaîne ses dépôts
          facts.set(repo, await fetchRepoFacts(repo, token));
        }
      },
    ),
  );
  return entries.map((entry) =>
    judge(
      entry,
      entry.github === undefined ? undefined : facts.get(entry.github),
      links.get(entry.url),
      options.since,
    ),
  );
}

/**
 * README of the cleaned list: same shape as upstream (header block + sections), kept entries only.
 * `base` (raw URL of the source list) makes the header's relative images and links absolute, since the
 * cleaned README is written outside the list's repository.
 */
export function renderCleanReadme(
  original: string,
  curated: readonly CuratedEntry[],
  since: string,
  base?: string,
): string {
  const kept = new Map<string, CuratedEntry[]>();
  for (const entry of curated) {
    if (entry.verdict !== "keep") continue;
    kept.set(entry.section, [...(kept.get(entry.section) ?? []), entry]);
  }
  const headerEnd = original.search(/^## Contents/m);
  const rawHeader =
    headerEnd > 0 ? original.slice(0, headerEnd).trimEnd() : "# Awesome Bun";
  const header =
    base === undefined
      ? rawHeader
      : rawHeader
          .replace(
            /(\s(?:src|href)=["'])\.?\/?(?![a-z][a-z0-9+.-]*:|#|\/)([^"']+)/gi,
            `$1${base}$2`,
          )
          .replace(
            /(\]\()\.?\/?(?![a-z][a-z0-9+.-]*:|#|\/)([^)\s]+)/gi,
            `$1${base}$2`,
          );
  const sectionTitles = [...kept.keys()];
  const contents = sectionTitles
    .map((t) => `- [${t}](#${slugify(t)})`)
    .join("\n");
  const body = sectionTitles
    .map((title) => {
      const lines = (kept.get(title) ?? []).map((e) =>
        e.description
          ? `- [${e.name}](${e.url}) - ${e.description}`
          : `- [${e.name}](${e.url})`,
      );
      return `## ${title}\n\n${lines.join("\n")}`;
    })
    .join("\n\n");
  return `${header}

> Curated for the Rust-based Bun (rewritten ${RUST_BUN_SINCE}): only entries verified alive, not archived and
> active since ${since} are listed. Generated by \`yolo awesome curate\`; the audit lives in the yolo repository.

## Contents

${contents}

${body}
`;
}

// ---------------------------------------------------------------------------------------------
// Command
// ---------------------------------------------------------------------------------------------

const HELP = `\x1b[1myolo awesome\x1b[0m — browse ${DEFAULT_REPO}

  awesome [stats]            Sections and entry counts
  awesome sections           Section titles
  awesome list [section]     Entries (all sections, or one)
  awesome search <words..>   Entries matching every word (name, url, description, section)
  awesome github             GitHub repositories referenced by the list
  awesome check [section]    HTTP check of the links (network; --concurrency N, --timeout MS)
  awesome audit              Judge every entry for the Rust-based Bun (network, GitHub API);
                             writes tools/config/yolo/awesome-audit.json
  awesome curate [--out f]   audit + tools/config/yolo/awesome.curated.json + cleaned README (default
                             docs/reference/yolo/AWESOME.md); --since YYYY-MM-DD (default ${RUST_BUN_SINCE})

Options: --repo owner/name  --ref branch (default ${DEFAULT_REF})  --refresh  --offline
         --file README.md   --json`;

const line = (e: AwesomeEntry): string =>
  `  ${e.name}  \x1b[2m${e.url}\x1b[0m${e.description ? `\n    ${e.description}` : ""}`;

export async function runAwesomeCommand(
  args: readonly string[],
  rootDir: string = process.cwd(),
): Promise<number> {
  const positional: string[] = [];
  let repo = DEFAULT_REPO;
  let ref = DEFAULT_REF;
  let refresh = false;
  let offline = false;
  let json = false;
  let file: string | undefined;
  let concurrency = 8;
  let timeoutMs = 8000;
  let since = RUST_BUN_SINCE;
  let out: string | undefined;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i] as string;
    const value = (): string => {
      const v = args[++i];
      if (v === undefined) throw new Error(`${arg} requires a value`);
      return v;
    };
    if (arg === "--repo") repo = value();
    else if (arg === "--ref") ref = value();
    else if (arg === "--refresh") refresh = true;
    else if (arg === "--offline") offline = true;
    else if (arg === "--json") json = true;
    else if (arg === "--file") file = resolve(rootDir, value());
    else if (arg === "--concurrency") concurrency = Number(value());
    else if (arg === "--timeout") timeoutMs = Number(value());
    else if (arg === "--since") since = value();
    else if (arg === "--out") out = resolve(rootDir, value());
    else if (arg === "--help" || arg === "-h") {
      console.log(HELP);
      return 0;
    } else if (arg.startsWith("--")) throw new Error(`Unknown option ${arg}`);
    else positional.push(arg);
  }

  const { text, origin } = await loadReadme({
    repo,
    ref,
    refresh,
    offline,
    file,
    cacheDir: resolve(rootDir, ".cache/awesome"),
  });
  const sections = parseAwesome(text);
  const [command = "stats", ...rest] = positional;
  const print = (value: unknown, human: () => void): void => {
    if (json) console.log(JSON.stringify(value, null, 2));
    else human();
  };
  switch (command) {
    case "stats": {
      const total = sections.reduce((n, s) => n + s.entries.length, 0);
      const github = sections
        .flatMap((s) => s.entries)
        .filter((e) => e.github !== undefined).length;
      print(
        {
          source: origin,
          sections: sections.map((s) => ({
            title: s.title,
            entries: s.entries.length,
          })),
          total,
          github,
        },
        () => {
          console.log(`\x1b[1m${repo}@${ref}\x1b[0m  (${origin})`);
          for (const s of sections)
            console.log(`  ${s.title.padEnd(24)} ${s.entries.length}`);
          console.log(`  ${"total".padEnd(24)} ${total} (${github} on GitHub)`);
        },
      );
      return 0;
    }
    case "sections":
      print(
        sections.map((s) => s.title),
        () => sections.forEach((s) => console.log(s.title)),
      );
      return 0;
    case "list": {
      const query = rest.join(" ");
      const chosen =
        query === ""
          ? sections
          : [findSection(sections, query)].filter((s) => s !== undefined);
      if (chosen.length === 0) {
        console.error(
          `No section matches "${query}". Sections: ${sections.map((s) => s.title).join(", ")}`,
        );
        return 1;
      }
      print(chosen, () => {
        for (const s of chosen) {
          console.log(`\x1b[1m${s.title}\x1b[0m (${s.entries.length})`);
          s.entries.forEach((e) => console.log(line(e)));
        }
      });
      return 0;
    }
    case "search": {
      if (rest.length === 0) throw new Error("search needs at least one word");
      const found = searchEntries(sections, rest.join(" "));
      print(found, () => {
        found.forEach((e) =>
          console.log(`\x1b[2m${e.section}\x1b[0m\n${line(e)}`),
        );
        console.log(`${found.length} match(es)`);
      });
      return found.length > 0 ? 0 : 1;
    }
    case "github": {
      const repos = sections
        .flatMap((s) => s.entries)
        .flatMap((e) =>
          e.github === undefined
            ? []
            : [{ repo: e.github, section: e.section, name: e.name }],
        );
      print(repos, () =>
        repos.forEach((r) => console.log(`${r.repo.padEnd(48)} ${r.section}`)),
      );
      return 0;
    }
    case "check": {
      const query = rest.join(" ");
      const scope =
        query === ""
          ? sections
          : [findSection(sections, query)].filter((s) => s !== undefined);
      const entries = scope.flatMap((s) => s.entries);
      const results = await checkLinks(entries, { concurrency, timeoutMs });
      const broken = results.filter(
        (r) => r.status === "error" || r.status >= 400,
      );
      print({ checked: results.length, broken }, () => {
        for (const r of broken) {
          console.log(
            `  ${String(r.status).padEnd(5)} ${r.entry.name}  ${r.entry.url}${r.detail ? `  (${r.detail})` : ""}`,
          );
        }
        console.log(`${results.length} checked, ${broken.length} broken`);
      });
      return broken.length === 0 ? 0 : 1;
    }
    case "audit":
    case "curate": {
      const all = sections.flatMap((s) => s.entries);
      const curated = await auditEntries(all, {
        since,
        concurrency,
        timeoutMs,
      });
      const kept = curated.filter((e) => e.verdict === "keep");
      const record = {
        source: `${repo}@${ref}`,
        rustBunSince: since,
        evidence: "23427dbc12 Rewrite Bun in Rust (#30412), 2026-05-14",
        total: curated.length,
        kept: kept.length,
        dropped: curated.length - kept.length,
        entries: curated,
      };
      await Bun.write(
        resolve(rootDir, "tools/config/yolo/awesome-audit.json"),
        `${JSON.stringify(record, null, 2)}\n`,
      );
      if (command === "curate") {
        await Bun.write(
          resolve(rootDir, "tools/config/yolo/awesome.curated.json"),
          `${JSON.stringify(
            kept.map(({ facts: _facts, ...e }) => e),
            null,
            2,
          )}\n`,
        );
        await Bun.write(
          out ?? resolve(rootDir, "docs/reference/yolo/AWESOME.md"),
          renderCleanReadme(
            text,
            curated,
            since,
            `https://raw.githubusercontent.com/${repo}/${ref}/`,
          ),
        );
      }
      print(
        { total: record.total, kept: record.kept, dropped: record.dropped },
        () => {
          const reasons = new Map<string, number>();
          for (const e of curated)
            if (e.verdict === "drop")
              reasons.set(e.reason, (reasons.get(e.reason) ?? 0) + 1);
          console.log(`${record.kept}/${record.total} kept (since ${since})`);
          for (const [reason, count] of [...reasons].toSorted(
            (a, b) => b[1] - a[1],
          )) {
            console.log(
              `  dropped ${String(count).padStart(3)}  ${reason.replace(/\(last push.*\)/, "")}`,
            );
          }
        },
      );
      return 0;
    }
    default:
      console.error(`Unknown awesome command: ${command}`);
      console.log(HELP);
      return 1;
  }
}
