import { describe, expect, it } from "bun:test";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { bunCheckout } from "../../core/src/vendor/catalog";
import {
  generateBunCatalog,
  inspectPackages,
  parseTsSource,
  readWorkspaceCargo,
} from "../src/index";

const rootDir = resolve(import.meta.dir, "../../../docs/aphrody");
// These tests read the configured or workspace-sibling Bun fork checkout; skipped when absent.
const haveBunFork = bunCheckout() !== undefined;
const cliPkgPath = resolve(rootDir, "packages/engine/yolo/package.json");
const cliEntryPath = resolve(rootDir, "packages/engine/yolo/src/index.ts");
const generatedCatalogPath = resolve(
  rootDir,
  "m3/packages/app-ui/src/generated/bun-catalog.ts",
);

describe("direct native Python tool CLI", () => {
  it.each(["uv", "ruff"])(
    "forwards %s arguments and process context outside a checkout",
    async (tool) => {
      const work = mkdtempSync(join(tmpdir(), "aphrody-python-tool-cli-"));
      try {
        const tools = join(work, "bin");
        const project = join(work, "project");
        mkdirSync(tools);
        mkdirSync(project);
        const executable = join(
          tools,
          `${tool}${process.platform === "win32" ? ".exe" : ""}`,
        );
        copyFileSync(process.execPath, executable);
        chmodSync(executable, 0o755);
        const forwarded = [
          "two words",
          "--json",
          "--vu",
          "native directory",
          "apostrophe'quote",
        ];
        const program = `
        const stdin = await new Response(Bun.stdin).text();
        console.log(JSON.stringify({
          argv: process.argv.slice(1), cwd: process.cwd(), stdin,
          environment: process.env.APHRODY_NATIVE_TOOL_TEST,
        }));
        console.error("native tool stderr");
        process.exit(7);
      `;
        const proc = Bun.spawn(
          [
            process.execPath,
            cliEntryPath,
            tool,
            "-e",
            program,
            "--",
            ...forwarded,
          ],
          {
            windowsHide: true,
            cwd: project,
            env: {
              ...process.env,
              PATH: tools,
              VU_HOME: join(work, "no-artifact"),
              YOLO_HOME: "",
              APHRODY_ROOT: "",
              APHRODY_WORKSPACE: "",
              APHRODY_NATIVE_TOOL_TEST: "retained",
              BUN_BE_BUN: "1",
            },
            stdin: Buffer.from("input retained\n"),
            stdout: "pipe",
            stderr: "pipe",
          },
        );
        const [stdout, stderr, code] = await Promise.all([
          proc.stdout.text(),
          proc.stderr.text(),
          proc.exited,
        ]);
        expect(JSON.parse(stdout)).toEqual({
          argv: forwarded,
          cwd: project,
          stdin: "input retained\n",
          environment: "retained",
        });
        expect(stderr).toBe("native tool stderr\n");
        expect(code).toBe(7);
      } finally {
        rmSync(work, { recursive: true, force: true });
      }
    },
  );

  it("returns the native missing-tool status without requiring a checkout", async () => {
    const work = mkdtempSync(join(tmpdir(), "aphrody-python-tool-missing-"));
    try {
      const proc = Bun.spawn(
        [process.execPath, cliEntryPath, "ruff", "--version"],
        {
          windowsHide: true,
          cwd: work,
          env: {
            ...process.env,
            PATH: work,
            VU_HOME: join(work, "no-artifact"),
            YOLO_HOME: "",
          },
          stdout: "pipe",
          stderr: "pipe",
        },
      );
      const [stdout, stderr, code] = await Promise.all([
        proc.stdout.text(),
        proc.stderr.text(),
        proc.exited,
      ]);
      expect(stdout).toBe("");
      expect(stderr).toContain("ruff");
      expect(code).toBe(127);
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
  });
});

describe("Yolo canonical CLI and native capability owners", () => {
  it("uses the canonical CLI package with only first-party workspace runtime dependencies", async () => {
    expect(existsSync(cliPkgPath)).toBe(true);
    const pkg = await Bun.file(cliPkgPath).json();
    expect(pkg.name).toBe("@aphrody/yolo-cli");
    expect(pkg.bin.yolo).toBe("./src/index.ts");
    expect(pkg.dependencies).toEqual({
      "@aphrody/runtime-sdk": "npm:@aphrody/bun-runtime-sdk@1.4.4",
      "@aphrody/bun-workspace/automation": "workspace:*",
      "@aphrody/yolo-core": "workspace:*",
    });
    const rust = Bun.TOML.parse(
      await Bun.file(
        resolve(rootDir, "crates/infra/aphrody/Cargo.toml"),
      ).text(),
    );
    expect((rust.package as { name: string }).name).toBe("aphrody");
    expect(
      existsSync(resolve(rootDir, "crates/infra/aphrody/package.json")),
    ).toBe(false);
  });

  it("should inspect local fork packages programmatically via Bun file checks", async () => {
    const statuses = await inspectPackages();
    const catalog = await Bun.file(
      resolve(rootDir, "tools/config/vendor.json"),
    ).json();
    const names = statuses.map((s) => s.name).toSorted();
    expect(names).toEqual(
      catalog.sources.map((source: { name: string }) => source.name).toSorted(),
    );

    for (const status of statuses) {
      // Sources are fetched on demand and git-ignored: a missing checkout is reported as not fetched.
      expect(status.exists).toBe(existsSync(status.path));
      if (!status.exists) {
        expect(status.headCommit).toBeUndefined();
        expect(status.filesCount).toBeUndefined();
      }
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
    "searches the Bun docs of the fork checkout",
    async () => {
      const proc = Bun.spawn(
        ["bun", cliEntryPath, "docs", "server", "--json"],
        {
          windowsHide: true,
          cwd: rootDir,
          env: {
            ...process.env,
            BUN_DOCS_DIR: resolve(bunCheckout()!, "docs"),
          },
          stdout: "pipe",
          stderr: "pipe",
        },
      );
      const [stdout, exitCode] = await Promise.all([
        proc.stdout.text(),
        proc.exited,
      ]);
      const report = JSON.parse(stdout);
      expect(report.matches.map((m: { path: string }) => m.path)).toContain(
        "runtime/http/server.mdx",
      );
      expect(exitCode).toBe(0);
    },
  );

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
        windowsHide: true,
        cwd: rootDir,
        stdout: "pipe",
        stderr: "pipe",
      });
      const stdoutStatus = await new Response(procStatus.stdout).text();
      const exitCodeStatus = await procStatus.exited;

      expect(exitCodeStatus).toBe(0);
      expect(stdoutStatus).toContain("=== YOLO Monorepo Status");
      const catalog = await Bun.file(
        resolve(rootDir, "tools/config/vendor.json"),
      ).json();
      for (const source of catalog.sources)
        expect(stdoutStatus).toContain(source.path);

      const procBench = Bun.spawn(["bun", cliEntryPath, "bench"], {
        windowsHide: true,
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
        windowsHide: true,
        cwd: rootDir,
        stdout: "pipe",
        stderr: "pipe",
      });
      const stdoutDocs = await new Response(procDocs.stdout).text();
      const exitCodeDocs = await procDocs.exited;

      expect(exitCodeDocs).toBe(0);
      expect(stdoutDocs).toContain("runtime/http/server.mdx");

      const procGen = Bun.spawn(["bun", cliEntryPath, "generate"], {
        windowsHide: true,
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
    const procStatusJson = Bun.spawn(
      ["bun", cliEntryPath, "status", "--json"],
      {
        windowsHide: true,
        cwd: rootDir,
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    const statusJson = JSON.parse(
      await new Response(procStatusJson.stdout).text(),
    );
    expect(await procStatusJson.exited).toBe(0);
    expect(statusJson.schema).toBe("yolo.status/1");
    expect(statusJson.packages.length).toBeGreaterThan(0);

    // 2. parse --json
    const procParseJson = Bun.spawn(
      ["bun", cliEntryPath, "parse", cliEntryPath, "--json"],
      {
        windowsHide: true,
        cwd: rootDir,
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    const parseJson = JSON.parse(
      await new Response(procParseJson.stdout).text(),
    );
    expect(await procParseJson.exited).toBe(0);
    expect(parseJson.schema).toBe("bun.parse/1");
    expect(parseJson.lines).toBeGreaterThan(50);

    // 3. bench --json
    const procBenchJson = Bun.spawn(["bun", cliEntryPath, "bench", "--json"], {
      windowsHide: true,
      cwd: rootDir,
      stdout: "pipe",
      stderr: "pipe",
    });
    const benchJson = JSON.parse(
      await new Response(procBenchJson.stdout).text(),
    );
    expect(await procBenchJson.exited).toBe(0);
    expect(benchJson.schema).toBe("bun.bench/1");
    expect(benchJson.results[0].opsPerSec).toBeGreaterThan(0);

    // 4. doctor --json
    const procDocJson = Bun.spawn(["bun", cliEntryPath, "doctor", "--json"], {
      windowsHide: true,
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
      windowsHide: true,
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
      windowsHide: true,
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
      windowsHide: true,
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
    const config = Bun.TOML.parse(
      await Bun.file(resolve(rootDir, "vendor.toml")).text(),
    ) as {
      prefix: string;
      source: { name: string }[];
    };
    expect(lock.sources.map((s) => s.name).toSorted()).toEqual(
      config.source.map((s) => s.name).toSorted(),
    );
    await Promise.all(
      lock.crates.map(async (crate) => {
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
          expect(manifest.lib.name).not.toContain(
            config.prefix.replace("-", "_"),
          );
        }
      }),
    );
  });

  it("reports vendored sources against the submodule HEADs", async () => {
    const { readVendorStatus } = await import("../src/index");
    const status = await readVendorStatus();
    // Every crate of vendor.lock (each checked against crates/ above) is reported.
    const lock = (await Bun.file(resolve(rootDir, "vendor.lock")).json()) as {
      crates: unknown[];
    };
    expect(lock.crates.length).toBeGreaterThan(0);
    expect(status?.crates).toBe(lock.crates.length);
    const declaration = Bun.TOML.parse(
      await Bun.file(resolve(rootDir, "vendor.toml")).text(),
    ) as {
      source: { name: string }[];
    };
    expect(status?.sources.map((source) => source.name).toSorted()).toEqual(
      declaration.source.map((source) => source.name).toSorted(),
    );
    const { readGitHead } = await import("../../core/src/vendor/status");
    const heads = await Promise.all(
      status!.sources.map((source) =>
        readGitHead(resolve(rootDir, "vendor", source.name)),
      ),
    );
    for (const [index, source] of status!.sources.entries()) {
      expect(source.lockedSha).toMatch(/^[a-f0-9]{40}$/);
      expect(source.headSha).toBe(heads[index]!);
      expect(source.inSync).toBe(source.lockedSha === source.headSha);
    }
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
    const { parseAwesome, findSection, searchEntries } =
      await import("../src/awesome");
    const sections = parseAwesome(readme);
    expect(findSection(sections, "course")?.title).toBe("Courses & Books");
    expect(searchEntries(sections, "bun types").map((e) => e.name)).toEqual([
      "Bun Types",
    ]);
    expect(searchEntries(sections, "bun nothing")).toEqual([]);
  });

  it("runs the command on a local README without network", async () => {
    const path = resolve(rootDir, ".cache/awesome-test-readme.md");
    await Bun.write(path, readme);
    const proc = Bun.spawn(
      [
        "bun",
        cliEntryPath,
        "awesome",
        "search",
        "docs",
        "--file",
        path,
        "--json",
      ],
      { windowsHide: true, stdout: "pipe" },
    );
    const out = JSON.parse(await new Response(proc.stdout).text());
    expect(await proc.exited).toBe(0);
    expect(out.map((e: { name: string }) => e.name)).toEqual(["Docs"]);
  });
});

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

describe("YOLO awesome curation (Rust-based Bun)", () => {
  const since = "2026-05-14";

  it("keeps active repositories and drops archived, stale, missing and Zig ones", async () => {
    const { judge } = await import("../src/awesome");
    expect(judge(entry(), facts(), undefined, since).verdict).toBe("keep");
    expect(
      judge(entry(), facts({ archived: true }), undefined, since).reason,
    ).toMatch(/archived/);
    expect(
      judge(
        entry(),
        facts({ pushedAt: "2026-01-01T00:00:00Z" }),
        undefined,
        since,
      ).reason,
    ).toMatch(/no activity since 2026-05-14/);
    expect(judge(entry(), "missing", undefined, since).verdict).toBe("drop");
    expect(judge(entry(), "error", undefined, since).reason).toMatch(
      /could not be verified/,
    );
    expect(
      judge(entry(), facts({ language: "Zig" }), undefined, since).reason,
    ).toMatch(/Zig/);
    expect(
      judge(entry({ description: "Zig bindings" }), facts(), undefined, since)
        .verdict,
    ).toBe("drop");
  });

  it("verifies links inside repositories and external pages", async () => {
    const { judge } = await import("../src/awesome");
    const tree = entry({
      url: "https://github.com/acme/thing/tree/main/examples",
    });
    expect(judge(tree, facts(), 404, since).reason).toMatch(/404/);
    expect(judge(tree, facts(), 200, since).verdict).toBe("keep");
    const site = entry({ url: "https://bun.com/docs", github: undefined });
    expect(judge(site, undefined, 200, since).verdict).toBe("keep");
    expect(judge(site, undefined, "error", since).verdict).toBe("drop");
    const blog = entry({ url: "https://blog.example/post", github: undefined });
    expect(judge(blog, undefined, 200, since).reason).toMatch(
      /cannot be verified/,
    );
    const article = entry({
      section: "Articles",
      github: undefined,
      url: "https://bun.com/blog",
    });
    expect(judge(article, undefined, 200, since).reason).toMatch(
      /before the Rust rewrite/,
    );
  });

  it("renders a cleaned README with only the kept sections", async () => {
    const { judge, renderCleanReadme, parseAwesome } =
      await import("../src/awesome");
    const readme = `<p>header</p>\n\n## Contents\n\n- [Tools](#tools)\n\n## Tools\n\n- [A](https://github.com/acme/a) - good\n- [B](https://github.com/acme/b)\n\n## Videos\n\n- [V](https://example.com/v)\n`;
    const entries = parseAwesome(readme).flatMap((s) => s.entries);
    const curated = entries.map((e) =>
      judge(
        e,
        e.name === "A"
          ? facts()
          : e.github
            ? facts({ archived: true })
            : undefined,
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
