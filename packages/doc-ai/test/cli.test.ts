import { describe, expect, test } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { parseArgs, main, USAGE } from "../src/cli.js";
import { InvalidArgumentsError, InvalidLanguageError } from "../src/errors.js";

describe("parseArgs", () => {
  test("no args -> help", () => {
    expect(parseArgs([])).toEqual({ kind: "help" });
  });

  test("-h / --help -> help", () => {
    expect(parseArgs(["-h"]).kind).toBe("help");
    expect(parseArgs(["--help"]).kind).toBe("help");
  });

  test("-v / --version -> version", () => {
    expect(parseArgs(["-v"]).kind).toBe("version");
    expect(parseArgs(["--version"]).kind).toBe("version");
  });

  test("translate with explicit lang", () => {
    expect(parseArgs(["translate", "docs", "en"])).toEqual({
      kind: "translate",
      targetPath: "docs",
      lang: "en",
    });
  });

  test("translate defaults lang to fr", () => {
    expect(parseArgs(["translate", "docs"])).toEqual({
      kind: "translate",
      targetPath: "docs",
      lang: "fr",
    });
  });

  test("translate without path throws InvalidArgumentsError", () => {
    expect(() => parseArgs(["translate"])).toThrow(InvalidArgumentsError);
  });

  test("translate with unsupported lang throws InvalidLanguageError", () => {
    expect(() => parseArgs(["translate", "docs", "de"])).toThrow(
      InvalidLanguageError,
    );
  });

  test("generate with and without out file", () => {
    expect(parseArgs(["generate", "a.ts"])).toEqual({
      kind: "generate",
      tsFile: "a.ts",
      outFile: undefined,
    });
    expect(parseArgs(["generate", "a.ts", "out.md"])).toEqual({
      kind: "generate",
      tsFile: "a.ts",
      outFile: "out.md",
    });
  });

  test("generate without file throws", () => {
    expect(() => parseArgs(["generate"])).toThrow(InvalidArgumentsError);
  });

  test("sync defaults to fr and accepts a lang", () => {
    expect(parseArgs(["sync"])).toEqual({ kind: "sync", lang: "fr" });
    expect(parseArgs(["sync", "en"])).toEqual({ kind: "sync", lang: "en" });
  });

  test("unknown command throws", () => {
    expect(() => parseArgs(["frobnicate"])).toThrow(InvalidArgumentsError);
  });

  test("language is case-insensitive and trimmed", () => {
    expect(parseArgs(["sync", "FR"])).toEqual({ kind: "sync", lang: "fr" });
  });
});

describe("main (exit codes)", () => {
  test("empty invocation returns 1 (historical behaviour)", async () => {
    expect(await main([])).toBe(1);
  });

  test("--help returns 0", async () => {
    expect(await main(["--help"])).toBe(0);
  });

  test("--version returns 0", async () => {
    expect(await main(["--version"])).toBe(0);
  });

  test("invalid args return exit code 2", async () => {
    expect(await main(["translate"])).toBe(2);
    expect(await main(["bogus"])).toBe(2);
    expect(await main(["translate", "x", "de"])).toBe(2);
  });

  test("missing path for generate returns non-zero (InvalidPathError, code 1)", async () => {
    const code = await main(["generate", "/no/such/file/xyz.ts"]);
    expect(code).toBe(1);
  });

  test("end-to-end generate offline writes a markdown file (exit 0)", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "doc-ai-cli-"));
    const tsFile = path.join(dir, "thing.ts");
    await fs.writeFile(
      tsFile,
      '@customElement("md-thing")\nexport class MdThing {}\n',
      "utf-8",
    );
    // Force offline: clear any inherited credentials for this process call.
    const credentialKeys = [
      "GOOGLE_APPLICATION_CREDENTIALS",
      "GOOGLE_CLOUD_PROJECT",
      "APHRODY_VERTEX_PROJECT",
    ] as const;
    const previous = credentialKeys.map((key) => process.env[key]);
    for (const key of credentialKeys) delete process.env[key];
    try {
      const code = await main(["generate", tsFile]);
      expect(code).toBe(0);
      const outMd = await fs.readFile(path.join(dir, "thing.md"), "utf-8");
      expect(outMd).toContain("md-thing");
    } finally {
      credentialKeys.forEach((key, index) => {
        if (previous[index] !== undefined) process.env[key] = previous[index];
      });
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});

describe("USAGE", () => {
  test("documents commands, languages and env knobs", () => {
    expect(USAGE).toContain("translate");
    expect(USAGE).toContain("generate");
    expect(USAGE).toContain("sync");
    expect(USAGE).toContain("GOOGLE_CLOUD_PROJECT");
    expect(USAGE).toContain("DOC_AI_MODEL");
    expect(USAGE).toContain("en, fr");
  });
});

async function invokeOffline(
  args: string[],
  cwd: string,
  requireOnline = false,
) {
  const env = { ...process.env };
  env.DOC_AI_REQUIRE_ONLINE = requireOnline ? "1" : "0";
  for (const key of [
    "GOOGLE_APPLICATION_CREDENTIALS",
    "GOOGLE_CLOUD_PROJECT",
    "APHRODY_VERTEX_PROJECT",
  ])
    delete env[key];
  const child = Bun.spawn(
    [
      process.execPath,
      path.resolve(import.meta.dir, "../../yolo-cli/src/index.ts"),
      "doc-ai",
      ...args,
    ],
    { windowsHide: true, cwd, env, stdout: "pipe", stderr: "pipe" },
  );
  const [code, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  return { code, stdout, stderr };
}

describe("standalone translation scope", () => {
  test("offline sync translates originals and preserves excluded documentation", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "doc-ai-scope-"));
    try {
      const docs = path.join(root, "docs");
      await fs.mkdir(docs);
      await fs.writeFile(
        path.join(docs, "guide.md"),
        "# Guide\n\nUse the documented command.\n",
      );
      const excluded = [
        "upstream-bun/API.md",
        "migration/report.md",
        "history/report.md",
        "node_modules/README.md",
        "privateMarkdown/private.md",
        "private-markdown/private.md",
        ".coord/private.md",
        "MEMORY.md",
        "CONVERSATIONS.md",
        "TRANSCRIPTS.md",
        "LIVE.md",
        "LICENSE.md",
        "guide.fr.md",
        "another.en.md",
        "generated.md",
        "imported.md",
        "pointer.md",
      ];
      await Promise.all(
        excluded.map(async (name) => {
          await fs.mkdir(path.dirname(path.join(docs, name)), {
            recursive: true,
          });
          const content =
            name === "generated.md"
              ? "<!-- @generated by docs:gen -->\n# Generated\n"
              : name === "imported.md"
                ? "---\nstatus: imported\n---\n# Imported\n"
                : name === "pointer.md"
                  ? "---\nclassification: pointer\n---\n# Pointer\n"
                  : "# Preserve\n";
          await fs.writeFile(path.join(docs, name), content);
        }),
      );
      await fs.symlink(
        path.join(docs, "MEMORY.md"),
        path.join(docs, "linked.md"),
      );
      await fs.symlink(
        path.join(docs, "privateMarkdown"),
        path.join(docs, "linked-directory"),
      );
      const result = await invokeOffline(["sync", "fr"], root);
      expect(await Bun.file(path.join(docs, "linked.fr.md")).exists()).toBe(
        false,
      );
      expect(result.code).toBe(0);
      expect(
        await fs.readFile(path.join(docs, "guide.fr.md"), "utf8"),
      ).not.toBe("# Preserve\n");
      await Promise.all(
        excluded
          .filter((candidate) => candidate !== "guide.fr.md")
          .map(async (name) => {
            expect(
              await Bun.file(
                path.join(docs, name.replace(/\.md$/, ".fr.md")),
              ).exists(),
            ).toBe(false);
          }),
      );
      expect(await Bun.file(path.join(docs, "guide.fr.fr.md")).exists()).toBe(
        false,
      );
      expect(await fs.readFile(path.join(docs, "another.en.md"), "utf8")).toBe(
        "# Preserve\n",
      );
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  test("sync propagates translation write failures instead of reporting completion", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "doc-ai-failure-"));
    try {
      await fs.mkdir(path.join(root, "docs", "guide.fr.md"), {
        recursive: true,
      });
      await fs.writeFile(path.join(root, "docs", "guide.md"), "# Guide\n");
      const result = await invokeOffline(["sync"], root);
      expect(result.code).toBe(1);
      expect(result.stderr).toContain("Failed to write");
      expect(result.stdout).not.toContain("Documentation sync complete!");
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  test("sync tolerates an absent docs tree but rejects a file at its path", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "doc-ai-path-"));
    try {
      expect((await invokeOffline(["sync"], root)).code).toBe(0);
      await fs.writeFile(path.join(root, "docs"), "not a directory");
      const result = await invokeOffline(["sync"], root);
      expect(result.code).toBe(1);
      expect(result.stderr).toContain("Expected documentation directory");
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});

test("translation refuses symlink output and skips explicit symlink input", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "doc-ai-links-"));
  try {
    const source = path.join(root, "guide.md");
    const protectedFixture = path.join(root, "MEMORY.md");
    await fs.writeFile(source, "# Guide\n");
    await fs.writeFile(protectedFixture, "synthetic fixture\n");
    await fs.symlink(protectedFixture, path.join(root, "guide.fr.md"));
    const result = await invokeOffline(["translate", source], root);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("Refusing symbolic-link output");
    expect(await fs.readFile(protectedFixture, "utf8")).toBe(
      "synthetic fixture\n",
    );
    await fs.symlink(protectedFixture, path.join(root, "linked.md"));
    expect((await invokeOffline(["translate", "linked.md"], root)).code).toBe(
      0,
    );
    expect(await Bun.file(path.join(root, "linked.fr.md")).exists()).toBe(
      false,
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("CLI forwards required online mode and writes no offline output", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "doc-ai-online-"));
  try {
    await fs.writeFile(path.join(root, "guide.md"), "# Guide\n");
    const result = await invokeOffline(["translate", "guide.md"], root, true);
    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain("requires a configured LLM client");
    expect(await Bun.file(path.join(root, "guide.fr.md")).exists()).toBe(false);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
