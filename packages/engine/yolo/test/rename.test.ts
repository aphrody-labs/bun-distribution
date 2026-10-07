import { afterEach, describe, expect, test } from "bun:test";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
  symlinkSync,
  existsSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  applyRules,
  renameRepo,
  restoreRenameJournal,
  runRenameCommand,
  type RenameOptions,
} from "../src/rename";

const roots: string[] = [];
function fixture(): RenameOptions {
  const cwd = mkdtempSync(join(tmpdir(), "yolo-rename-"));
  roots.push(cwd);
  const git = Bun.spawnSync(["git", "init", "-q", cwd]);
  if (git.exitCode) throw new Error("git init failed");
  return {
    cwd,
    rules: [{ from: "foo", to: "bar" }],
    apply: false,
    paths: false,
    include: [],
    exclude: [],
    concurrency: 4,
    journalDir: join(cwd, ".cache/rename"),
  };
}
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
describe("rename preflight and recovery", () => {
  test("identifier boundaries and scope prefixes", () => {
    expect(
      applyRules("foo fooSuffix xfoo foo_bar foo-bar éfoo fooé foo$", [{ from: "foo", to: "bar" }])
        .output,
    ).toBe("bar fooSuffix xfoo foo_bar foo-bar éfoo fooé foo$");
    expect(
      applyRules('"@tauri-apps/api" x@tauri-apps/api', [{ from: "@tauri-apps/", to: "@aphrody/" }])
        .output,
    ).toBe('"@aphrody/api" x@tauri-apps/api');
    expect(() => applyRules("text", [{ from: "", to: "x" }])).toThrow("empty");
  });
  test("dry run preserves content and creates no journal or folders", async () => {
    const o = fixture();
    writeFileSync(join(o.cwd, "foo.ts"), "foo");
    const report = await renameRepo({ ...o, paths: true });
    expect(report.renamedPaths).toBe(1);
    expect(readFileSync(join(o.cwd, "foo.ts"), "utf8")).toBe("foo");
    expect(existsSync(o.journalDir)).toBe(false);
  });
  test("existing destination refuses before modifying any content", async () => {
    const o = fixture();
    writeFileSync(join(o.cwd, "foo.ts"), "foo");
    writeFileSync(join(o.cwd, "bar.ts"), "foo");
    await expect(renameRepo({ ...o, paths: true, apply: true })).rejects.toThrow(
      /Destination exists|collision/,
    );
    expect(readFileSync(join(o.cwd, "foo.ts"), "utf8")).toBe("foo");
    expect(existsSync(o.journalDir)).toBe(false);
  });
  test("multiple source destinations and ancestor collisions refused", async () => {
    const o = fixture();
    writeFileSync(join(o.cwd, "foo"), "foo");
    writeFileSync(join(o.cwd, "baz"), "foo");
    await expect(
      renameRepo({
        ...o,
        apply: true,
        paths: true,
        rules: [
          { from: "foo", to: "bar" },
          { from: "baz", to: "bar" },
        ],
      }),
    ).rejects.toThrow("collision");
    await expect(
      renameRepo({
        ...o,
        apply: true,
        paths: true,
        rules: [
          { from: "foo", to: "bar" },
          { from: "baz", to: "bar/child" },
        ],
      }),
    ).rejects.toThrow("collision");
    expect(readFileSync(join(o.cwd, "foo"), "utf8")).toBe("foo");
  });
  test("symlinks and escaping destinations refused", async () => {
    const o = fixture();
    writeFileSync(join(o.cwd, "foo.ts"), "foo");
    symlinkSync("foo.ts", join(o.cwd, "link.ts"));
    await expect(renameRepo({ ...o, apply: true })).rejects.toThrow("Symlink");
    rmSync(join(o.cwd, "link.ts"));
    await expect(
      renameRepo({ ...o, paths: true, apply: true, rules: [{ from: "foo", to: "../outside" }] }),
    ).rejects.toThrow("Unsafe path");
    await expect(
      renameRepo({
        ...o,
        paths: true,
        apply: true,
        rules: [{ from: "foo.ts", to: ".git/config" }],
      }),
    ).rejects.toThrow("Unsafe path");
  });
  test("symlink destination directory refused", async () => {
    const o = fixture();
    mkdirSync(join(o.cwd, "real"));
    symlinkSync("real", join(o.cwd, "alias"));
    writeFileSync(join(o.cwd, "foo.ts"), "foo");
    await expect(
      renameRepo({
        ...o,
        apply: true,
        paths: true,
        include: ["foo.ts"],
        rules: [{ from: "foo.ts", to: "alias/bar.ts" }],
      }),
    ).rejects.toThrow("Symlink");
  });
  test("private journal restores exact content and names, refuses later edits", async () => {
    const o = fixture();
    writeFileSync(join(o.cwd, "foo.ts"), "\ufefffoo\r\n", { mode: 0o751 });
    const before = readFileSync(join(o.cwd, "foo.ts"));
    const report = await renameRepo({ ...o, apply: true, paths: true });
    expect(statSync(report.journal!).mode & 0o777).toBe(0o600);
    expect(readFileSync(join(o.cwd, "bar.ts"), "utf8")).toBe("\ufeffbar\r\n");
    expect(await restoreRenameJournal(report.journal!)).toEqual({ files: 1, applied: false });
    writeFileSync(join(o.cwd, "bar.ts"), "user edit");
    await expect(restoreRenameJournal(report.journal!, true)).rejects.toThrow("changed");
    expect(existsSync(join(o.cwd, "foo.ts"))).toBe(false);
    writeFileSync(join(o.cwd, "bar.ts"), "\ufeffbar\r\n");
    await restoreRenameJournal(report.journal!, true);
    expect(readFileSync(join(o.cwd, "foo.ts"))).toEqual(before);
    expect(statSync(join(o.cwd, "foo.ts")).mode & 0o777).toBe(0o751);
    expect(await restoreRenameJournal(report.journal!, true)).toEqual({ files: 0, applied: true });
  });
  test("path-only binary rename can be restored", async () => {
    const o = fixture();
    writeFileSync(join(o.cwd, "foo.bin"), Buffer.from([0, 255, 3]));
    const report = await renameRepo({ ...o, apply: true, paths: true });
    expect(report.changedFiles).toBe(0);
    expect(report.journal).toBeDefined();
    await restoreRenameJournal(report.journal!, true);
    expect(readFileSync(join(o.cwd, "foo.bin"))).toEqual(Buffer.from([0, 255, 3]));
  });
  test("invalid UTF8 remains intact and include/exclude filters honored", async () => {
    const o = fixture();
    writeFileSync(join(o.cwd, "bad.ts"), Buffer.from([255, 102, 111, 111]));
    writeFileSync(join(o.cwd, "yes.ts"), "foo");
    writeFileSync(join(o.cwd, "no.ts"), "foo");
    const report = await renameRepo({ ...o, apply: true, include: ["*.ts"], exclude: ["no.ts"] });
    expect(report.skippedBinary).toBe(1);
    expect(readFileSync(join(o.cwd, "no.ts"), "utf8")).toBe("foo");
    expect(readFileSync(join(o.cwd, "yes.ts"), "utf8")).toBe("bar");
  });
  test("restore corruption and later edits refuse before modifying any file", async () => {
    const o = fixture();
    writeFileSync(join(o.cwd, "a.ts"), "foo");
    writeFileSync(join(o.cwd, "b.ts"), "foo");
    const report = await renameRepo({ ...o, apply: true });
    writeFileSync(join(o.cwd, "b.ts"), "later edit");
    await expect(restoreRenameJournal(report.journal!, true)).rejects.toThrow("changed");
    expect(readFileSync(join(o.cwd, "a.ts"), "utf8")).toBe("bar");
    const records = readFileSync(report.journal!, "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    records[1].originalBase64 = Buffer.from("corruption").toString("base64");
    writeFileSync(report.journal!, records.map((r) => JSON.stringify(r)).join("\n"));
    await expect(restoreRenameJournal(report.journal!, true)).rejects.toThrow("Corrupt");
    expect(readFileSync(join(o.cwd, "a.ts"), "utf8")).toBe("bar");
  });
  test("restore accepts an interrupted apply before a path rename", async () => {
    const o = fixture();
    writeFileSync(join(o.cwd, "foo.ts"), "foo");
    const report = await renameRepo({ ...o, apply: true, paths: true });
    // Simulate content write completed, subsequent path rename interrupted.
    const bytes = readFileSync(join(o.cwd, "bar.ts"));
    rmSync(join(o.cwd, "bar.ts"));
    writeFileSync(join(o.cwd, "foo.ts"), bytes);
    await restoreRenameJournal(report.journal!, true);
    expect(readFileSync(join(o.cwd, "foo.ts"), "utf8")).toBe("foo");
  });
  test("parser rejects empty, missing and overwritten from arguments", async () => {
    await expect(runRenameCommand(["--from", "", "--to", "x"], "/tmp")).rejects.toThrow("empty");
    await expect(
      runRenameCommand(["--from", "x", "--from", "y", "--to", "z"], "/tmp"),
    ).rejects.toThrow("without");
    await expect(runRenameCommand(["--restore"], "/tmp")).rejects.toThrow("JOURNAL");
    expect(await runRenameCommand(["--help"], "/tmp")).toBe(0);
  });
});
