import { test, expect, setDefaultTimeout } from "bun:test";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  rmSync,
  copyFileSync,
  symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

setDefaultTimeout(30_000);

function fixture(run: (root: string, command: (name: string) => number) => void): void {
  const root = mkdtempSync(join(tmpdir(), "iecode-docs-test-"));
  try {
    mkdirSync(join(root, "scripts/tools"), { recursive: true });
    mkdirSync(join(root, "scripts/validation"), { recursive: true });
    for (const file of ["tools/docs-archive.ts", "validation/docs.ts", "validation/docs-files.ts"])
      copyFileSync(join(import.meta.dir, "..", file), join(root, "scripts", file));
    // Archive fixtures exercise the real documentation gate; root inventory has separate tests.
    writeFileSync(join(root, "scripts/iecode/tools/readme.ts"), "export function checkReadmeInventory() {}\n");
    for (const folder of ["docs/history", "docs/research"]) mkdirSync(join(root, folder), { recursive: true });
    writeFileSync(join(root, "docs/README.md"), "[History](history/report.md)\n");
    writeFileSync(join(root, "docs/history/report.md"), "Unique historical evidence\n");
    writeFileSync(join(root, "docs/research/report.md"), "Unique research evidence\n");
    writeFileSync(
      join(root, "docs/documentation.json"),
      JSON.stringify({
        entrypoints: ["docs/README.md"],
        currentFiles: [],
        currentPrefixes: [],
        referencePrefixes: ["docs/research/"],
        historicalPrefixes: ["docs/history/"],
        sourceOwners: [],
      }),
    );
    writeFileSync(
      join(root, "package.json"),
      JSON.stringify({
        scripts: { "docs:check": "bun scripts/iecode/validation/docs.ts" },
      }),
    );
    expect(Bun.spawnSync(["git", "init", "-q", root]).exitCode).toBe(0);
    expect(Bun.spawnSync(["git", "add", "."], { cwd: root }).exitCode).toBe(0);
    const command = (name: string): number =>
      Bun.spawnSync(["bun", join(root, "scripts/iecode/tools/docs-archive.ts"), name], { cwd: root }).exitCode;
    run(root, command);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("compact, repack and unpack preserve all evidence and local edits", () => {
  fixture((root, command) => {
    expect(command("compact")).toBe(0);
    expect(existsSync(join(root, "docs/history"))).toBe(false);
    expect(existsSync(join(root, "docs/research"))).toBe(false);
    expect(Bun.spawnSync(["bun", "run", "docs:check"], { cwd: root }).exitCode).toBe(0);
    writeFileSync(join(root, "docs/README.md"), "Local edit\n");
    expect(command("pack")).toBe(0);
    expect(command("compact")).toBe(0);
    writeFileSync(join(root, "docs/README.md"), "New local edit\n");
    expect(command("unpack")).toBe(0);
    expect(readFileSync(join(root, "docs/README.md"), "utf8")).toBe("New local edit\n");
    expect(readFileSync(join(root, "docs/history/report.md"), "utf8")).toBe("Unique historical evidence\n");
    expect(readFileSync(join(root, "docs/research/report.md"), "utf8")).toBe("Unique research evidence\n");
  });
});

test("an unreadable cold archive is not replaced by a partial snapshot", () => {
  fixture((root, command) => {
    expect(command("compact")).toBe(0);
    writeFileSync(join(root, "docs.7z"), "corrupt fixture");
    expect(command("pack")).not.toBe(0);
    expect(readFileSync(join(root, "docs.7z"), "utf8")).toBe("corrupt fixture");
    expect(existsSync(join(root, "docs/README.md"))).toBe(true);
  });
});

test("non-regular historical inputs prevent projection deletion", () => {
  fixture((root, command) => {
    symlinkSync("report.md", join(root, "docs/history/link.md"), "file");
    expect(command("compact")).not.toBe(0);
    expect(existsSync(join(root, "docs/history/report.md"))).toBe(true);
    expect(existsSync(join(root, "docs/research/report.md"))).toBe(true);
  });
});

test("partial cold-tree edits cannot discard other archived files", () => {
  fixture((root, command) => {
    expect(command("compact")).toBe(0);
    mkdirSync(join(root, "docs/history"));
    writeFileSync(join(root, "docs/history/new.md"), "New evidence\n");
    expect(Bun.spawnSync(["git", "add", "docs/history/new.md"], { cwd: root }).exitCode).toBe(0);
    expect(command("compact")).toBe(0);
    expect(command("unpack")).toBe(0);
    expect(readFileSync(join(root, "docs/history/report.md"), "utf8")).toBe("Unique historical evidence\n");
    expect(readFileSync(join(root, "docs/history/new.md"), "utf8")).toBe("New evidence\n");
  });
});

test("packing excludes ignored private notes and untracked drafts but retains tracked ignored source", () => {
  fixture((root, command) => {
    mkdirSync(join(root, "docs/domain/memory"), { recursive: true });
    writeFileSync(join(root, ".gitignore"), "docs/domain/memory/\ndocs/history/report.md\n");
    writeFileSync(join(root, "docs/domain/memory/private.md"), "Private fixture only\n");
    writeFileSync(join(root, "docs/draft.md"), "Concurrent draft fixture\n");
    expect(command("compact")).toBe(0);
    const sevenZip = Bun.which("7za") ?? Bun.which("7z");
    expect(sevenZip).toBeTruthy();
    const listing = Bun.spawnSync([sevenZip!, "l", "-slt", join(root, "docs.7z")]);
    expect(listing.exitCode).toBe(0);
    const paths = listing.stdout.toString().replaceAll("\\", "/");
    expect(paths).toContain("docs/history/report.md");
    expect(paths).not.toContain("private.md");
    expect(paths).not.toContain("draft.md");
    expect(readFileSync(join(root, "docs/domain/memory/private.md"), "utf8")).toBe("Private fixture only\n");
    expect(command("pack")).toBe(0);
    // Untracked drafts are independently checked by docs:check; remove this fixture draft
    // before exercising unpack validation of the classified public snapshot.
    rmSync(join(root, "docs/draft.md"));
    expect(command("unpack")).toBe(0);
    expect(readFileSync(join(root, "docs/history/report.md"), "utf8")).toBe("Unique historical evidence\n");
  });
});
