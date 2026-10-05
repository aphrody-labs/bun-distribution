import { describe, expect, it } from "bun:test";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import {
  generateBunCatalog,
  inspectPackages,
  parseTsSource,
  readWorkspaceCargo,
} from "../src/index";

const rootDir = resolve(import.meta.dir, "../../../..");
// These tests read the Bun fork submodule (`git submodule update --init vendor/bun`); the public CI
// checkout has no access to the private fork and skips them.
const haveBunFork = existsSync(resolve(rootDir, "vendor/bun/LATEST"));
const cliPkgPath = resolve(rootDir, "apps/yolo/cli/package.json");
const cliEntryPath = resolve(rootDir, "apps/yolo/cli/src/index.ts");
const generatedCatalogPath = resolve(rootDir, "apps/yolo/web/src/generated/bun-catalog.ts");

describe("YOLO apps/cli Suite (Zero External Dependencies, 100% Native Bun)", () => {
  it("should have apps/cli package.json with zero external runtime dependencies", async () => {
    expect(existsSync(cliPkgPath)).toBe(true);
    const pkg = await Bun.file(cliPkgPath).json();
    expect(pkg.name).toBe("@aphrody/yolo-cli");
    expect(pkg.dependencies).toEqual({});
  });

  it("should inspect local fork packages programmatically via Bun file checks", async () => {
    const statuses = await inspectPackages();
    expect(statuses.length).toBe(8);

    const names = statuses.map((s) => s.name).sort();
    expect(names).toEqual([
      "bun",
      "create-tauri-app",
      "next",
      "obscura",
      "plugins-workspace",
      "tauri",
    ]);

    for (const status of statuses) {
      expect(status.exists).toBe(true);
      expect(existsSync(status.path)).toBe(true);
    }
  });

  it("should parse TypeScript source files programmatically using wyhash and zero external dependencies", async () => {
    const parsed = await parseTsSource(cliEntryPath);
    expect(parsed).toBeDefined();
    expect(parsed.path).toBe(cliEntryPath);
    expect(parsed.lines).toBeGreaterThan(50);
    expect(parsed.bytes).toBeGreaterThan(1000);
    expect(parsed.checksum).toBeDefined();
    expect(parsed.checksum.length).toBeGreaterThan(0);
    expect(parsed.exports).toContain("inspectPackages");
    expect(parsed.exports).toContain("parseTsSource");
    expect(parsed.exports).toContain("readWorkspaceCargo");
    expect(parsed.exports).toContain("generateBunCatalog");
    expect(parsed.exports).toContain("printHelp");
  });

  it("should read root Cargo.toml using native Bun.TOML parser", async () => {
    const cargo = await readWorkspaceCargo();
    expect(cargo).not.toBeNull();
    expect(cargo?.resolver).toBe("3");
    expect(cargo?.members.some((m) => m.startsWith("crates/"))).toBe(true);
  });

  it.skipIf(!haveBunFork)(
    "should autonomously scan upstream Bun and generate capability catalog",
    async () => {
      const report = await generateBunCatalog();
      expect(report).toBeDefined();
      expect(report.domains.length).toBe(7);
      expect(report.totalDocFilesIndexed).toBeGreaterThan(100);
      expect(report.totalTypeFilesIndexed).toBeGreaterThan(10);
      expect(existsSync(generatedCatalogPath)).toBe(true);

      const generatedContent = await Bun.file(generatedCatalogPath).text();
      expect(generatedContent).toContain("MONOREPO_BUN_CATALOG");
      expect(generatedContent).toContain("web_api");
      expect(generatedContent).toContain("server");
      expect(generatedContent).toContain("react");
      expect(generatedContent).toContain("css");
      expect(generatedContent).toContain("img");
      expect(generatedContent).toContain("json");
      expect(generatedContent).toContain("markdown");
    },
  );

  it.skipIf(!haveBunFork)(
    "should execute the CLI binary via Bun.spawn with status, parse, bench, docs, and generate commands",
    async () => {
      const procStatus = Bun.spawn(["bun", cliEntryPath, "status"], {
        cwd: rootDir,
        stdout: "pipe",
        stderr: "pipe",
      });
      const stdoutStatus = await new Response(procStatus.stdout).text();
      const exitCodeStatus = await procStatus.exited;

      expect(exitCodeStatus).toBe(0);
      expect(stdoutStatus).toContain("=== YOLO Monorepo Status");
      expect(stdoutStatus).toContain("vendor/bun");
      expect(stdoutStatus).toContain("vendor/obscura");

      const procBench = Bun.spawn(["bun", cliEntryPath, "bench"], {
        cwd: rootDir,
        stdout: "pipe",
        stderr: "pipe",
      });
      const stdoutBench = await new Response(procBench.stdout).text();
      const exitCodeBench = await procBench.exited;
      expect(exitCodeBench).toBe(0);
      expect(stdoutBench).toContain("Bun.hash.wyhash");
      expect(stdoutBench).toContain("Bun.stringWidth");

      const procDocs = Bun.spawn(["bun", cliEntryPath, "docs", "server"], {
        cwd: rootDir,
        stdout: "pipe",
        stderr: "pipe",
      });
      const stdoutDocs = await new Response(procDocs.stdout).text();
      const exitCodeDocs = await procDocs.exited;

      expect(exitCodeDocs).toBe(0);
      expect(stdoutDocs).toContain("=== Bun Docs Corpus");
      expect(stdoutDocs).toContain("Found");

      const procGen = Bun.spawn(["bun", cliEntryPath, "generate"], {
        cwd: rootDir,
        stdout: "pipe",
        stderr: "pipe",
      });
      const stdoutGen = await new Response(procGen.stdout).text();
      const exitCodeGen = await procGen.exited;

      expect(exitCodeGen).toBe(0);
      expect(stdoutGen).toContain("=== Autonomous Bun Upstream Generator ===");
    },
  );

  it("should support --json and --md across commands for Agent-First auditing", async () => {
    // 1. status --json
    const procStatusJson = Bun.spawn(["bun", cliEntryPath, "status", "--json"], {
      cwd: rootDir,
      stdout: "pipe",
      stderr: "pipe",
    });
    const statusJson = JSON.parse(await new Response(procStatusJson.stdout).text());
    expect(await procStatusJson.exited).toBe(0);
    expect(statusJson.schema).toBe("yolo.status/1");
    expect(statusJson.packages.length).toBeGreaterThan(0);

    // 2. parse --json
    const procParseJson = Bun.spawn(["bun", cliEntryPath, "parse", cliEntryPath, "--json"], {
      cwd: rootDir,
      stdout: "pipe",
      stderr: "pipe",
    });
    const parseJson = JSON.parse(await new Response(procParseJson.stdout).text());
    expect(await procParseJson.exited).toBe(0);
    expect(parseJson.schema).toBe("yolo.parse/1");
    expect(parseJson.lines).toBeGreaterThan(50);

    // 3. bench --json
    const procBenchJson = Bun.spawn(["bun", cliEntryPath, "bench", "--json"], {
      cwd: rootDir,
      stdout: "pipe",
      stderr: "pipe",
    });
    const benchJson = JSON.parse(await new Response(procBenchJson.stdout).text());
    expect(await procBenchJson.exited).toBe(0);
    expect(benchJson.schema).toBe("yolo.bench/1");
    expect(benchJson.wyhash.opsPerSec).toBeGreaterThan(0);

    // 4. doctor --json
    const procDocJson = Bun.spawn(["bun", cliEntryPath, "doctor", "--json"], {
      cwd: rootDir,
      stdout: "pipe",
      stderr: "pipe",
    });
    const docJson = JSON.parse(await new Response(procDocJson.stdout).text());
    expect(await procDocJson.exited).toBe(0);
    expect(docJson.schema).toBe("yolo.doctor/1");
    expect(docJson.stack.bun.version).toBeDefined();

    // 5. version --json
    const procVerJson = Bun.spawn(["bun", cliEntryPath, "version", "--json"], {
      cwd: rootDir,
      stdout: "pipe",
      stderr: "pipe",
    });
    const verJson = JSON.parse(await new Response(procVerJson.stdout).text());
    expect(await procVerJson.exited).toBe(0);
    expect(verJson.schema).toBe("yolo.version/1");
    expect(verJson.bunVersion).toBeDefined();

    // 6. status --md
    const procStatusMd = Bun.spawn(["bun", cliEntryPath, "status", "--md"], {
      cwd: rootDir,
      stdout: "pipe",
      stderr: "pipe",
    });
    const statusMd = await new Response(procStatusMd.stdout).text();
    expect(await procStatusMd.exited).toBe(0);
    expect(statusMd).toContain("# yolo status");
    expect(statusMd).toContain("| Submodule |");

    // 7. py status --json
    const procPy = Bun.spawn(["bun", cliEntryPath, "py", "status", "--json"], {
      cwd: rootDir,
      stdout: "pipe",
      stderr: "pipe",
    });
    const pyText = await new Response(procPy.stdout).text();
    expect(await procPy.exited).toBe(0);
    const pyReport = JSON.parse(pyText);
    expect(pyReport.schema).toBe("yolo.python/1");
    expect(pyReport.packageConfigured).toBe(true);
  });
});

describe("YOLO vendoring", () => {
  it("keeps vendor.lock consistent with crates/ and vendor.toml", async () => {
    const lock = (await Bun.file(resolve(rootDir, "vendor.lock")).json()) as {
      sources: { name: string; sha: string }[];
      crates: { name: string; package: string; dir: string; version: string }[];
    };
    const config = Bun.TOML.parse(await Bun.file(resolve(rootDir, "vendor.toml")).text()) as {
      prefix: string;
      source: { name: string }[];
    };
    expect(lock.sources.map((s) => s.name).sort()).toEqual(config.source.map((s) => s.name).sort());
    for (const crate of lock.crates) {
      expect(crate.package.startsWith(config.prefix)).toBe(true);
      const manifest = Bun.TOML.parse(
        await Bun.file(resolve(rootDir, crate.dir, "Cargo.toml")).text(),
      ) as {
        package: { name: string };
        lib?: { name?: string };
      };
      expect(manifest.package.name).toBe(crate.package);
      // library names stay unchanged so `use tauri::...` keeps compiling
      if (manifest.lib?.name !== undefined) {
        expect(manifest.lib.name).not.toContain(config.prefix.replace("-", "_"));
      }
    }
  });

  it("reports vendored sources against the submodule HEADs", async () => {
    const { readVendorStatus } = await import("../src/index");
    const status = await readVendorStatus();
    expect(status?.crates).toBeGreaterThan(40);
    expect(status?.sources.length).toBe(6);
  });
});

describe("YOLO rename engine", () => {
  it("renames npm scopes only on identifier boundaries", async () => {
    const { applyRules, PRESETS } = await import("../src/rename");
    const input = `import "@tauri-apps/api"; "x@tauri-apps/api"; github.com/tauri-apps/tauri`;
    const { output, count } = applyRules(input, PRESETS.aphrody!);
    expect(count).toBe(1);
    expect(output).toBe(`import "@aphrody/api"; "x@tauri-apps/api"; github.com/tauri-apps/tauri`);
  });
});

describe("YOLO awesome", () => {
  const readme = `# Awesome Bun

## Contents

- [Tools](#tools)

## Tools

- [Bun Types](https://github.com/oven-sh/bun/tree/main/packages/bun-types) - Type definitions.
- [Docs](https://bun.com/docs)

## Courses & Books

- [Security](https://www.bunsecurity.dev) – A course

\`\`\`md
- [Not an entry](https://example.com)
\`\`\`

## License

- [MIT](https://example.com/license)
`;

  it("parses sections and entries, skipping contents, license and fenced code", async () => {
    const { parseAwesome } = await import("../src/awesome");
    const sections = parseAwesome(readme);
    expect(sections.map((s) => s.slug)).toEqual(["tools", "courses-books"]);
    expect(sections[0]?.entries).toHaveLength(2);
    expect(sections[0]?.entries[0]).toMatchObject({
      name: "Bun Types",
      description: "Type definitions.",
      github: "oven-sh/bun",
    });
    expect(sections[0]?.entries[1]?.github).toBeUndefined();
    expect(sections[1]?.entries[0]?.description).toBe("A course");
  });

  it("finds sections by prefix and searches every word", async () => {
    const { parseAwesome, findSection, searchEntries } = await import("../src/awesome");
    const sections = parseAwesome(readme);
    expect(findSection(sections, "course")?.title).toBe("Courses & Books");
    expect(searchEntries(sections, "bun types").map((e) => e.name)).toEqual(["Bun Types"]);
    expect(searchEntries(sections, "bun nothing")).toEqual([]);
  });

  it("runs the command on a local README without network", async () => {
    const path = resolve(rootDir, ".cache/awesome-test-readme.md");
    await Bun.write(path, readme);
    const proc = Bun.spawn(
      ["bun", cliEntryPath, "awesome", "search", "docs", "--file", path, "--json"],
      { stdout: "pipe" },
    );
    const out = JSON.parse(await new Response(proc.stdout).text());
    expect(await proc.exited).toBe(0);
    expect(out.map((e: { name: string }) => e.name)).toEqual(["Docs"]);
  });
});

describe("YOLO awesome curation (Rust-based Bun)", () => {
  const entry = (over: Record<string, unknown> = {}) => ({
    name: "Thing",
    url: "https://github.com/acme/thing",
    description: "A thing",
    section: "Tools",
    github: "acme/thing",
    ...over,
  });
  const facts = (over: Record<string, unknown> = {}) => ({
    repo: "acme/thing",
    archived: false,
    disabled: false,
    pushedAt: "2026-09-01T00:00:00Z",
    stars: 1,
    language: "TypeScript",
    topics: [],
    description: "",
    license: "MIT",
    ...over,
  });
  const since = "2026-05-14";

  it("keeps active repositories and drops archived, stale, missing and Zig ones", async () => {
    const { judge } = await import("../src/awesome");
    expect(judge(entry(), facts(), undefined, since).verdict).toBe("keep");
    expect(judge(entry(), facts({ archived: true }), undefined, since).reason).toMatch(/archived/);
    expect(
      judge(entry(), facts({ pushedAt: "2026-01-01T00:00:00Z" }), undefined, since).reason,
    ).toMatch(/no activity since 2026-05-14/);
    expect(judge(entry(), "missing", undefined, since).verdict).toBe("drop");
    expect(judge(entry(), "error", undefined, since).reason).toMatch(/could not be verified/);
    expect(judge(entry(), facts({ language: "Zig" }), undefined, since).reason).toMatch(/Zig/);
    expect(judge(entry({ description: "Zig bindings" }), facts(), undefined, since).verdict).toBe(
      "drop",
    );
  });

  it("verifies links inside repositories and external pages", async () => {
    const { judge } = await import("../src/awesome");
    const tree = entry({ url: "https://github.com/acme/thing/tree/main/examples" });
    expect(judge(tree, facts(), 404, since).reason).toMatch(/404/);
    expect(judge(tree, facts(), 200, since).verdict).toBe("keep");
    const site = entry({ url: "https://bun.com/docs", github: undefined });
    expect(judge(site, undefined, 200, since).verdict).toBe("keep");
    expect(judge(site, undefined, "error", since).verdict).toBe("drop");
    const blog = entry({ url: "https://blog.example/post", github: undefined });
    expect(judge(blog, undefined, 200, since).reason).toMatch(/cannot be verified/);
    const article = entry({ section: "Articles", github: undefined, url: "https://bun.com/blog" });
    expect(judge(article, undefined, 200, since).reason).toMatch(/before the Rust rewrite/);
  });

  it("renders a cleaned README with only the kept sections", async () => {
    const { judge, renderCleanReadme, parseAwesome } = await import("../src/awesome");
    const readme = `<p>header</p>\n\n## Contents\n\n- [Tools](#tools)\n\n## Tools\n\n- [A](https://github.com/acme/a) - good\n- [B](https://github.com/acme/b)\n\n## Videos\n\n- [V](https://example.com/v)\n`;
    const entries = parseAwesome(readme).flatMap((s) => s.entries);
    const curated = entries.map((e) =>
      judge(
        e,
        e.name === "A" ? facts() : e.github ? facts({ archived: true }) : undefined,
        200,
        since,
      ),
    );
    const out = renderCleanReadme(readme, curated, since);
    expect(out).toContain("<p>header</p>");
    expect(out).toContain("- [A](https://github.com/acme/a) - good");
    expect(out).not.toContain("[B]");
    expect(out).not.toContain("## Videos");
    expect(out).toContain("- [Tools](#tools)");
  });

  it("makes the header's relative images absolute against the source list", async () => {
    const { renderCleanReadme } = await import("../src/awesome");
    const readme = `<img src="./logo.png"> [doc](docs/a.md) [web](https://bun.sh) [top](#top)\n\n## Contents\n`;
    const out = renderCleanReadme(
      readme,
      [],
      since,
      "https://raw.githubusercontent.com/oven-sh/awesome-bun/main/",
    );
    expect(out).toContain(
      'src="https://raw.githubusercontent.com/oven-sh/awesome-bun/main/logo.png"',
    );
    expect(out).toContain(
      "[doc](https://raw.githubusercontent.com/oven-sh/awesome-bun/main/docs/a.md)",
    );
    expect(out).toContain("[web](https://bun.sh)");
    expect(out).toContain("[top](#top)");
  });
});
