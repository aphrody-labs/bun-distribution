// SPDX-License-Identifier: Apache-2.0
import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { runCliHelp } from "../../src/automation/cli-help.ts";
import { withoutPath, writeBunCommand } from "./fixtures/bun-command.ts";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "aphrody-cli-help-"));
  roots.push(root);
  const bin = join(root, "bin");
  const log = join(root, "invocations.jsonl");
  await mkdir(bin);
  await writeBunCommand(bin, "git", "process.exit(1);\n");
  await mkdir(join(root, "docs/ecosystem"), { recursive: true });
  await writeFile(
    join(root, "docs/ecosystem/ecosystem.json"),
    JSON.stringify({ repos: [], cli: [{ binary: "catalog-unselected" }] }),
  );
  const runner = join(root, "capture.ts");
  await writeFile(
    runner,
    `import { runCliHelp } from ${JSON.stringify(resolveCollector())};
for (const binary of ["yolo", "qualified", "aphrody", "bxc", "n2b", "nie", "niers", "inagle", "azalee", "catalog-unselected"]) {
  const resolved = Bun.which(binary);
  if (resolved && !resolved.startsWith(${JSON.stringify(bin + sep)})) throw new Error("Fixture PATH isolation failed");
}
process.exitCode = await runCliHelp(process.argv.slice(2), ${JSON.stringify(root)});
`,
  );
  const executable = async (binary: string, exitCode = 0, repeatRootHelp = false) =>
    writeBunCommand(
      bin,
      binary,
      `import { appendFileSync } from "node:fs";
const args = process.argv.slice(2);
appendFileSync(${JSON.stringify(log)}, JSON.stringify({ binary: ${JSON.stringify(binary)}, args }) + "\\n");
if (${exitCode} !== 0) { console.error("fixture failure"); process.exit(${exitCode}); }
if (args.length === 1 || ${repeatRootHelp}) {
  console.log("\\x1b[32mUsage: fixture\\x1b[0m\\nCommands:\\n  unsafe  Fixture subcommand\\n" + (process.env.CLI_HELP_TEST_SECRET ?? ""));
} else { console.log("Fixture child help"); }
`,
    );
  const capture = async (args: string[]) => {
    const child = Bun.spawn([process.execPath, runner, ...args], {
      windowsHide: true,
      env: {
        ...withoutPath(process.env),
        PATH: bin,
        XDG_DATA_HOME: join(root, "data"),
        CLI_HELP_TEST_SECRET: "fixture-sensitive-value",
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [, stderr, exitCode] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    if (stderr.includes("Fixture PATH isolation failed")) throw new Error(stderr);
    return exitCode;
  };
  const invocations = async () =>
    (await Bun.file(log).exists())
      ? (await readFile(log, "utf8"))
          .trim()
          .split("\n")
          .map(line => JSON.parse(line))
      : [];
  return { root, executable, capture, invocations, manifest: capturedManifest };
}

async function capturedManifest(out: string) {
  const latest = await Bun.file(join(out, "latest.json")).json();
  return Bun.file(join(latest.snapshot, "manifest.json")).json();
}

test("selected top-level capture invokes only requested PATH binaries and preserves the global index", async () => {
  const value = await fixture();
  const yolo = await value.executable("yolo");
  await value.executable("catalog-unselected");
  await value.executable("aphrody-unselected");
  const global = join(value.root, "data/aphrody/cli-help");
  await mkdir(global, { recursive: true });
  await writeFile(join(global, "INDEX.md"), "existing full index\n");
  await writeFile(join(global, "latest.json"), "existing full snapshot\n");
  expect(await value.capture(["--only", "yolo,yolo", "--no-recursive"])).toBe(0);
  expect(await value.invocations()).toEqual([{ binary: "yolo", args: ["--help"] }]);
  const manifest = await value.manifest(join(global, "selected/yolo"));
  expect(manifest.capture).toEqual({ binaries: ["yolo"], recursive: false });
  expect(manifest.installed.map((entry: any) => entry.executable)).toEqual([yolo]);
  expect(manifest.entries).toHaveLength(1);
  const latest = await Bun.file(join(global, "selected/yolo/latest.json")).json();
  const page = await readFile(join(latest.snapshot, "yolo.txt"), "utf8");
  expect(page).not.toContain("\x1b[");
  expect(page).not.toContain("fixture-sensitive-value");
  expect(page).toContain("[REDACTED]");
  expect(await readFile(join(global, "INDEX.md"), "utf8")).toBe("existing full index\n");
  expect(await readFile(join(global, "latest.json"), "utf8")).toBe("existing full snapshot\n");
});

function resolveCollector() {
  return fileURLToPath(new URL("../../src/automation/cli-help.ts", import.meta.url));
}

test("comma selection and explicit output remain bounded without subcommand dispatch", async () => {
  const value = await fixture();
  await value.executable("yolo");
  await value.executable("qualified");
  const out = join(value.root, "dedicated-output");
  expect(await value.capture(["--only", "yolo,qualified", "--out", out, "--no-recursive"])).toBe(0);
  expect((await value.invocations()).toSorted((a, b) => a.binary.localeCompare(b.binary))).toEqual([
    { binary: "qualified", args: ["--help"] },
    { binary: "yolo", args: ["--help"] },
  ]);
  expect((await value.manifest(out)).entries).toHaveLength(2);
});

test("recursive capture remains available unless explicitly disabled", async () => {
  const value = await fixture();
  await value.executable("yolo");
  expect(await value.capture(["--only", "yolo"])).toBe(0);
  expect(await value.invocations()).toEqual([
    { binary: "yolo", args: ["--help"] },
    { binary: "yolo", args: ["unsafe", "--help"] },
  ]);
});

test("without flags the legacy catalogue and PATH discovery remain recursive", async () => {
  const value = await fixture();
  await value.executable("aphrody");
  await value.executable("catalog-unselected");
  await value.executable("aphrody-standalone");
  await value.executable("aphrody-summary");
  expect(await value.capture([])).toBe(0);
  const out = join(value.root, "data/aphrody/cli-help");
  const manifest = await value.manifest(out);
  expect(manifest.installed.map((entry: any) => entry.binary)).toEqual([
    "aphrody",
    "aphrody-standalone",
    "catalog-unselected",
  ]);
  expect(manifest.entries).toHaveLength(6);
  expect(manifest.capture).toEqual({ binaries: null, recursive: true });
  expect((await value.invocations()).some(entry => entry.binary === "aphrody-summary")).toBe(false);
});

test("missing selected binaries and failing stderr help return a failure", async () => {
  const missing = await fixture();
  expect(await missing.capture(["--only", "absent-fixture", "--no-recursive"])).toBe(1);
  expect(await missing.invocations()).toEqual([]);
  const failed = await fixture();
  await failed.executable("yolo", 3);
  expect(await failed.capture(["--only", "yolo", "--no-recursive"])).toBe(1);
  const out = join(failed.root, "data/aphrody/cli-help/selected/yolo");
  const manifest = await failed.manifest(out);
  expect(manifest.entries[0].exitCode).toBe(3);
  expect(await failed.invocations()).toEqual([{ binary: "yolo", args: ["--help"] }]);
  const latest = await Bun.file(join(out, "latest.json")).json();
  expect(await readFile(join(latest.snapshot, "yolo.txt"), "utf8")).toContain("fixture failure");
});

test("invalid selections are rejected before invoking a binary", async () => {
  const value = await fixture();
  await value.executable("yolo");
  for (const args of [
    ["--only"],
    ["--only", "--no-recursive"],
    ["--only", "yolo,"],
    ["--only", "../yolo"],
    ["--only", "yolo", "--only", "yolo"],
  ]) {
    // oxlint-disable-next-line no-await-in-loop
    await expect(runCliHelp(args, value.root)).rejects.toThrow();
  }
  expect(await value.invocations()).toEqual([]);
});

test("a binary returning ancestor help cannot multiply recursive invocations", async () => {
  const value = await fixture();
  await value.executable("yolo", 0, true);
  expect(await value.capture(["--only", "yolo"])).toBe(0);
  expect(await value.invocations()).toEqual([
    { binary: "yolo", args: ["--help"] },
    { binary: "yolo", args: ["unsafe", "--help"] },
  ]);
  const out = join(value.root, "data/aphrody/cli-help/selected/yolo");
  const manifest = await value.manifest(out);
  expect(manifest.repeatedHelp).toEqual([["yolo", "unsafe"]]);
  expect(manifest.unresolved).toEqual([]);
});

test("the page budget records unvisited commands without executing them", async () => {
  const value = await fixture();
  await value.executable("yolo");
  expect(await value.capture(["--only", "yolo", "--max-pages", "1"])).toBe(1);
  expect(await value.invocations()).toEqual([{ binary: "yolo", args: ["--help"] }]);
  const out = join(value.root, "data/aphrody/cli-help/selected/yolo");
  const manifest = await value.manifest(out);
  expect(manifest.unresolved).toEqual([["yolo", "unsafe"]]);
  expect(manifest.traversalLimits.maxPages).toBe(1);
});

test("protocol helpers are recorded without feeding their stdin ABI --help", async () => {
  const value = await fixture();
  await value.executable("aphrody-canvas", 2);
  expect(await value.capture(["--only", "aphrody-canvas"])).toBe(0);
  expect(await value.invocations()).toEqual([]);
  const out = join(value.root, "data/aphrody/cli-help/selected/aphrody-canvas");
  const manifest = await value.manifest(out);
  expect(manifest.protocolHelpers[0]).toMatchObject({
    binary: "aphrody-canvas",
    status: "unsupported-help",
    kind: "json-stdin-png-stdout",
  });
  expect(manifest.entries).toEqual([]);
});

test("a real CLI failure propagates even when primary Aphrody help succeeds", async () => {
  const value = await fixture();
  await value.executable("aphrody");
  await value.executable("catalog-unselected", 3);
  expect(await value.capture([])).toBe(1);
  const out = join(value.root, "data/aphrody/cli-help");
  const manifest = await value.manifest(out);
  expect(manifest.entries.find((entry: any) => entry.command[0] === "catalog-unselected").exitCode).toBe(3);
});
