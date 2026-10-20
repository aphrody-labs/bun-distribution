// SPDX-License-Identifier: Apache-2.0
import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { editCommand, parseCodeEdit, runCodeEdit } from "../../src/automation/code-edit.ts";

test("preview preserves files; apply inserts literal dollar signs and removal works", () => {
  const root = mkdtempSync(join(tmpdir(), "aphrody-edit-"));
  const path = join(root, "code.ts");
  try {
    writeFileSync(path, "foo();\n");
    const args = ["add-before", "--root", root, "--glob", "*.ts", "--find", "foo", "--with", "$bar"];
    expect(runCodeEdit(args)).toBe(0);
    expect(readFileSync(path, "utf8")).toBe("foo();\n");
    expect(runCodeEdit([...args, "--apply"])).toBe(0);
    expect(readFileSync(path, "utf8")).toBe("$barfoo();\n");
    expect(runCodeEdit(["remove", "--root", root, "--find", "$bar", "--apply"])).toBe(0);
    expect(readFileSync(path, "utf8")).toBe("foo();\n");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
test("AST templates remain literal arguments and preview never adds update-all", () => {
  const options = parseCodeEdit([
    "replace",
    "--engine",
    "ast",
    "--find",
    "foo($A)",
    "--with",
    "bar($A)",
    "--lang",
    "ts",
  ]);
  expect(editCommand(options, ["file with spaces.ts"])).toContain("bar($A)");
  expect(editCommand(options, ["file with spaces.ts"])).not.toContain("-U");
});
test("regex insertion escapes dollars and retains the full match", () => {
  const options = parseCodeEdit(["add-after", "--engine", "regex", "--find", "foo\\w*", "--with", "$1"]);
  expect(editCommand(options, ["code.ts"])).toContain("$0$$1");
});

test("YOLO rename delegates path selection and literal rules to the owner CLI", () => {
  const options = parseCodeEdit([
    "rename",
    "--root",
    "/tmp/source repo",
    "--find",
    "@old/",
    "--with",
    "@new/",
    "--paths",
    "--glob",
    "**/*.ts",
    "--glob",
    "!**/*.test.ts",
    "--yolo-root",
    "/tmp/yolo",
  ]);
  const command = editCommand(options, []);
  expect(command).toContain(resolve("/tmp/yolo/packages/yolo-cli/src/index.ts"));
  expect(command).toContain(resolve("/tmp/source repo"));
  expect(command).toContain("--exclude");
  expect(command).toContain("**/*.test.ts");
  expect(command).toContain("--paths");
  expect(command).not.toContain("--apply");
});
test("YOLO restore requires a journal and previews by default", () => {
  expect(() => parseCodeEdit(["restore"])).toThrow("--journal");
  const options = parseCodeEdit(["restore", "--journal", "/tmp/rename.jsonl"]);
  expect(editCommand(options, [])).toContain("--restore");
  expect(editCommand(options, [])).not.toContain("--apply");
  expect(() => parseCodeEdit(["replace", "--find", "a", "--with", "b", "--paths"])).toThrow("--paths");
});
