// `yolo rename` is `bun rename` (Bun fork, test/cli/devtools/devtools.test.ts covers the renamer);
// this covers the Aphrody defaults it adds.
import { describe, expect, test } from "bun:test";
import { APHRODY_EXCLUDES, DEFAULT_TARGET, JOURNAL_DIR, bunRenameArgs } from "../src/rename";

const defaults = ["--journal-dir", JOURNAL_DIR, ...APHRODY_EXCLUDES.flatMap(glob => ["--exclude", glob])];

describe("yolo rename -> bun rename", () => {
  test("no rules and no target: the aphrody preset on crates/tauri", () => {
    expect(bunRenameArgs([])).toEqual(["--from", "@tauri-apps/", "--to", "@aphrody/", ...defaults, DEFAULT_TARGET]);
  });

  test("--preset aphrody expands to its rules", () => {
    expect(bunRenameArgs(["--preset", "aphrody", "--apply", "src"])).toEqual([
      "--from",
      "@tauri-apps/",
      "--to",
      "@aphrody/",
      "--apply",
      "src",
      ...defaults,
    ]);
  });

  test("explicit rules, values that look like targets and --journal-dir are kept", () => {
    expect(bunRenameArgs(["--from", "foo", "--to", "bar", "--include", "src/**", "--journal-dir", "j"])).toEqual([
      "--from",
      "foo",
      "--to",
      "bar",
      "--include",
      "src/**",
      "--journal-dir",
      "j",
      ...APHRODY_EXCLUDES.flatMap(glob => ["--exclude", glob]),
      DEFAULT_TARGET,
    ]);
  });

  test("targets after -- stay last", () => {
    expect(bunRenameArgs(["--from", "a", "--to", "b", "--", "-odd-dir"])).toEqual([
      "--from",
      "a",
      "--to",
      "b",
      ...defaults,
      "--",
      "-odd-dir",
    ]);
  });

  test("--restore and --help pass through", () => {
    expect(bunRenameArgs(["--restore", "j.jsonl", "--apply"])).toEqual(["--restore", "j.jsonl", "--apply"]);
    expect(bunRenameArgs(["--from", "a", "-h"])).toEqual(["--help"]);
  });

  test("unknown presets are rejected", () => {
    expect(() => bunRenameArgs(["--preset", "nope"])).toThrow('Unknown preset "nope"');
  });
});
