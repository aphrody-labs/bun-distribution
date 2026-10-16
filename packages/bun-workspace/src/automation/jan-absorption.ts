// SPDX-License-Identifier: Apache-2.0
/** Pinned source evidence for Jan absorption. Declaration candidates are not parity proof. */
import { spawnSync } from "@aphrody/update/process";
import { lstat, mkdir, readFile } from "node:fs/promises";
import { extname, isAbsolute, join, relative, resolve, sep } from "node:path";

export const JAN_REVISION = "14a720628f9592c8e60f7e081ef733076db8a6a9";
const languages: Record<string, string> = {
  ".rs": "rust",
  ".py": "python",
  ".ts": "typescript",
  ".tsx": "tsx",
  ".js": "javascript",
  ".mjs": "javascript",
  ".c": "c",
  ".cpp": "cpp",
  ".h": "c-header",
};
const manifests = new Set(["package.json", "Cargo.toml", "pyproject.toml"]);

function git(root: string, args: string[]): string {
  const result = spawnSync("git", ["-C", root, ...args], {
    timeout: 15_000,
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.status !== 0 || result.signal || result.error) throw new Error(`Git evidence unavailable: ${args[0]}`);
  return result.stdout;
}

export function sourcePath(path: string, prefixes: string[]): boolean {
  if (isAbsolute(path) || path.split("/").some(part => part === ".." || part === ".git")) return false;
  const selected = prefixes.some(prefix => prefix === "." || path.startsWith(`${prefix}/`));
  return selected && (Boolean(languages[extname(path)]) || manifests.has(path.split("/").at(-1)!));
}

/** Lexical candidate extraction only; comments/strings can resemble declarations. */
export function declarationCandidates(text: string, language: string) {
  const rules: Record<string, RegExp> = {
    rust: /^\s*(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?(?:unsafe\s+)?(fn|struct|enum|trait|mod)\s+([A-Za-z_][A-Za-z0-9_]*)/,
    python: /^\s*(?:async\s+)?(def|class)\s+([A-Za-z_][A-Za-z0-9_]*)/,
    typescript:
      /^\s*export\s+(?:default\s+)?(?:declare\s+)?(?:async\s+)?(function|class|interface|type|const|enum)\s+([A-Za-z_$][A-Za-z0-9_$]*)/,
  };
  const rule = rules[language === "tsx" || language === "javascript" ? "typescript" : language];
  if (!rule) return [];
  return text.split("\n").flatMap((line, index) => {
    const match = line.match(rule);
    return match ? [{ kind: match[1]!, name: match[2]!, line: index + 1 }] : [];
  });
}

export async function inventorySources(root: string, prefixes: string[]) {
  const revision = git(root, ["rev-parse", "HEAD"]).trim();
  const dirty = Boolean(git(root, ["status", "--porcelain", "--untracked-files=no"]).trim());
  const tracked = git(root, ["ls-files", "-z"]).split("\0").filter(Boolean).toSorted();
  const paths = tracked.filter(path => sourcePath(path, prefixes));
  const files: Array<{
    path: string;
    language: string;
    bytes: number;
    sha256: string;
    test: boolean;
    declarations: ReturnType<typeof declarationCandidates>;
    license?: string;
  }> = [];
  const skipped: Array<{ path: string; reason: string }> = [];
  let next = 0;
  // Bounded independent reads; no source body is copied into the report.
  await Promise.all(
    Array.from({ length: 8 }, async () => {
      for (;;) {
        const path = paths[next++];
        if (!path) return;
        const absolute = join(root, path);
        // Each worker processes one file at a time to enforce the eight-reader bound.
        // eslint-disable-next-line no-await-in-loop
        const stat = await lstat(absolute);
        if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 4 * 1024 * 1024) {
          skipped.push({ path, reason: "not_regular_or_over_4_mib" });
          continue;
        }
        // eslint-disable-next-line no-await-in-loop -- sequential within each bounded worker
        const bytes = await readFile(absolute);
        const language = languages[extname(path)] ?? "manifest";
        const text = bytes.toString("utf8");
        let license: string | undefined;
        if (path.endsWith("package.json")) {
          const parsed = JSON.parse(text) as { license?: unknown };
          if (typeof parsed.license === "string") license = parsed.license;
        } else if (language === "manifest") {
          const parsed = Bun.TOML.parse(text) as {
            package?: { license?: unknown };
            project?: { license?: unknown };
          };
          const value = parsed.package?.license ?? parsed.project?.license;
          if (typeof value === "string") license = value;
          else if (value && typeof value === "object" && "text" in value && typeof value.text === "string")
            license = value.text;
        }
        files.push({
          path,
          language,
          bytes: bytes.length,
          sha256: new Bun.CryptoHasher("sha256").update(bytes).digest("hex"),
          test: /(?:^|\/)(?:__tests__|tests?|fixtures)(?:\/|$)|(?:\.test\.|_test\.|^test_)/.test(path),
          declarations: declarationCandidates(text, language),
          ...(license ? { license } : {}),
        });
      }
    }),
  );
  files.sort((a, b) => a.path.localeCompare(b.path));
  skipped.sort((a, b) => a.path.localeCompare(b.path));
  const endRevision = git(root, ["rev-parse", "HEAD"]).trim();
  if (endRevision !== revision) throw new Error("HEAD changed during inventory; repeat the snapshot");
  return {
    revision,
    dirty,
    trackedFiles: tracked.length,
    selectedFiles: paths.length,
    files,
    skipped,
  };
}

export async function runJanAbsorption(args: string[]): Promise<number> {
  const options = {
    root: process.cwd(),
    pythonRoot: "",
    janRoot: "",
    out: "",
    summary: false,
  };
  for (let index = 0; index < args.length; index++) {
    const flag = args[index];
    if (flag === "--help" || flag === "-h") {
      console.log(
        JSON.stringify({
          schema: "aphrody.jan-absorption/1",
          usage:
            "jan-absorption.ts [--root aphrody] [--python-root aphrody-py] [--jan-root vendor/jan] [--out root-relative-directory] [--summary]",
          scope:
            "Tracked source hashes, lexical declarations and explicit comparison queue; no semantic parity inferred",
        }),
      );
      return 0;
    }
    if (flag === "--summary") {
      options.summary = true;
      continue;
    }
    const value = args[++index];
    if (!value || value.startsWith("--")) throw new Error("Missing option value");
    if (flag === "--root") options.root = value;
    else if (flag === "--python-root") options.pythonRoot = value;
    else if (flag === "--jan-root") options.janRoot = value;
    else if (flag === "--out") options.out = value;
    else throw new Error(`Unknown option: ${flag}`);
  }
  const root = resolve(options.root);
  const pythonRoot = resolve(options.pythonRoot || join(root, "../aphrody-py"));
  const janRoot = resolve(options.janRoot || join(pythonRoot, "vendor/jan"));
  if (git(janRoot, ["rev-parse", "HEAD"]).trim() !== JAN_REVISION)
    throw new Error("Jan checkout differs from the comparison pin");
  const start = performance.now();
  const [jan, aphrody, python] = await Promise.all([
    inventorySources(janRoot, ["."]),
    inventorySources(root, ["crates", "packages", "apps"]),
    inventorySources(pythonRoot, ["packages", "apps", "tools"]),
  ]);
  const comparisons = JSON.parse(await readFile(join(root, "tools/config/jan-absorption.json"), "utf8")) as {
    upstreamRevision: string;
    comparisons: Array<{
      id: string;
      upstream: string[];
      aphrody: string[];
      python?: string[];
      status: string;
    }>;
  };
  if (comparisons.upstreamRevision !== JAN_REVISION) throw new Error("Comparison manifest pin differs");
  const roots = { jan, aphrody, python };
  const findings = comparisons.comparisons.flatMap(comparison => {
    return Object.entries({
      jan: comparison.upstream,
      aphrody: comparison.aphrody,
      python: comparison.python ?? [],
    }).flatMap(([name, paths]) =>
      paths
        .filter(path => !roots[name as keyof typeof roots].files.some(file => file.path === path))
        .map(path => ({
          id: comparison.id,
          repository: name,
          path,
          reason: "evidence_path_missing",
        })),
    );
  });
  const summary = {
    schema: "aphrody.jan-absorption/1",
    generatedAt: new Date().toISOString(),
    durationMs: performance.now() - start,
    sourceFiles: {
      jan: jan.files.length,
      aphrody: aphrody.files.length,
      python: python.files.length,
    },
    declarationCandidates: Object.fromEntries(
      Object.entries(roots).map(([name, inventory]) => [
        name,
        inventory.files.reduce((count, file) => count + file.declarations.length, 0),
      ]),
    ),
    comparisonGroups: comparisons.comparisons.length,
    findings,
    fullyAbsorbed: false,
    success: findings.length === 0,
    limits: [
      "Lexical declarations can include comments and omit macros/dynamic registration",
      "Source presence is not behavioral parity",
      "Submodules and non-source assets are not recursively inventoried",
      "Worktree bytes are individually hashed; concurrent uncommitted writes are not an atomic snapshot",
    ],
  };
  if (options.out) {
    const destination = resolve(root, options.out);
    const path = relative(root, destination);
    if (
      path.startsWith(`..${sep}`) ||
      path === ".." ||
      isAbsolute(path) ||
      !path.startsWith(`docs${sep}migration${sep}jan-absorption`)
    )
      throw new Error("Output must stay in docs/migration/jan-absorption");
    await mkdir(destination, { recursive: true });
    await Bun.write(
      join(destination, "sources.json"),
      JSON.stringify(
        {
          ...summary,
          repositories: roots,
          comparisons: comparisons.comparisons,
        },
        null,
        2,
      ) + "\n",
    );
    await Bun.write(
      join(destination, "README.md"),
      `<!-- SPDX-License-Identifier: Apache-2.0 -->\n# Jan absorption evidence\n\nPinned upstream: \`${JAN_REVISION}\`. Source hashes and declaration candidates are in [sources.json](sources.json).\n\n| Repository | Sources | Declaration candidates |\n| --- | ---: | ---: |\n${Object.entries(
        roots,
      )
        .map(
          ([name, inventory]) =>
            `| ${name} | ${inventory.files.length} | ${inventory.files.reduce((count, file) => count + file.declarations.length, 0)} |`,
        )
        .join(
          "\n",
        )}\n\n${comparisons.comparisons.length} comparison groups; ${findings.length} missing evidence paths. Full absorption is **unproven**. Presence in a catalog is not a parity test. Macro/dynamic entrypoints and non-source assets require further review.\n`,
    );
    console.log(JSON.stringify(summary, null, 2));
  } else if (options.summary) console.log(JSON.stringify(summary, null, 2));
  else
    console.log(
      JSON.stringify(
        {
          ...summary,
          repositories: roots,
          comparisons: comparisons.comparisons,
        },
        null,
        2,
      ),
    );
  return summary.success ? 0 : 1;
}

if (import.meta.main) {
  try {
    process.exitCode = await runJanAbsorption(process.argv.slice(2));
  } catch (error) {
    console.log(
      JSON.stringify({
        schema: "aphrody.jan-absorption/1",
        success: false,
        error: error instanceof Error ? error.message : "Inventory failed",
      }),
    );
    process.exitCode = 1;
  }
}
