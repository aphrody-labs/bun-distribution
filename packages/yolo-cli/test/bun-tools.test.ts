import { afterEach, expect, test } from "bun:test";
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bunToolArgv, runBunTool } from "../src/bun-tools";

const temporary: string[] = [];
afterEach(() => {
  for (const dir of temporary.splice(0))
    rmSync(dir, { recursive: true, force: true });
});

test("available built-ins keep their native route and exact arguments", () => {
  expect(
    bunToolArgv("bun", "rename", ["a b", "--dry-run"], false, "missing"),
  ).toEqual(["bun", "rename", "a b", "--dry-run"]);
});

test("missing built-in uses only the explicitly configured fork owner", () => {
  const fork = mkdtempSync(join(tmpdir(), "aphrody-bun-owner-"));
  temporary.push(fork);
  const directory = join(fork, "src", "js", "eval");
  mkdirSync(directory, { recursive: true });
  const entry = join(directory, "devtools.ts");
  writeFileSync(entry, "// existing fork owner fixture\n");
  expect(
    bunToolArgv("bun", "parse", ["file with spaces.ts"], true, fork),
  ).toEqual(["bun", entry, "parse", "file with spaces.ts"]);
  expect(() =>
    bunToolArgv("bun", "rename", [], true, join(fork, "absent")),
  ).toThrow("no devtools owner");
});

test("capability discovery cannot execute a checkout package script", async () => {
  const fork = mkdtempSync(join(tmpdir(), "aphrody-bun-probe-"));
  temporary.push(fork);
  const directory = join(fork, "src", "js", "eval");
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, "devtools.ts"), "process.exit(0);\n");
  writeFileSync(
    join(fork, "package.json"),
    JSON.stringify({
      scripts: {
        rename: "bun -e \"Bun.write('probe-executed', 'unexpected')\"",
      },
    }),
  );
  const previous = process.env.APHRODY_BUN_CHECKOUT;
  process.env.APHRODY_BUN_CHECKOUT = fork;
  try {
    expect(await runBunTool("rename", ["--help"], fork)).toBe(0);
    expect(existsSync(join(fork, "probe-executed"))).toBe(false);
  } finally {
    if (previous === undefined) delete process.env.APHRODY_BUN_CHECKOUT;
    else process.env.APHRODY_BUN_CHECKOUT = previous;
  }
});
