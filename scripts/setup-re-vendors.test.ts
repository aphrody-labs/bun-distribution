import { afterAll, expect, test } from "bun:test";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inspectReVendors, validateVendorPath, vendorInitializationCommands, type ReVendor } from "./setup-re-vendors";

const revision = "1".repeat(40);
const missing: ReVendor = {
  path: "third_party/unblob",
  url: "https://example.com/unblob.git",
  revision,
  state: "missing",
  windowsSparse: true,
};

test("Windows skips incompatible fixture trees before exact detached checkout", () => {
  const plan = vendorInitializationCommands(missing, "win32");
  expect(plan[1]).toEqual(["clone", "--no-checkout", "--", missing.url, missing.path]);
  expect(plan[2]).toEqual(["-C", missing.path, "sparse-checkout", "set", "--cone", "unblob", "docs"]);
  expect(plan[3]).toEqual(["-C", missing.path, "-c", "core.protectNTFS=false", "checkout", "--detach", revision]);
  expect(plan.flat().includes("--global")).toBe(false);
  expect(plan.at(-1)).toEqual(["submodule", "absorbgitdirs", "--", missing.path]);
  expect(vendorInitializationCommands(missing, "linux")).toEqual([
    ["submodule", "update", "--init", "--", missing.path],
  ]);
});

test("existing work is never initialized or reset and paths cannot escape", () => {
  for (const state of ["ready", "dirty", "revision-mismatch", "occupied"] as const)
    expect(vendorInitializationCommands({ ...missing, state }, "win32")).toEqual([]);
  for (const path of ["../other", "third_party/../other", "third_party/..", "C:/data", "third_party\\unblob"])
    expect(() => validateVendorPath(path)).toThrow();
});

const fixture = await mkdtemp(join(tmpdir(), "re-vendor-plan-"));
afterAll(() => rm(fixture, { recursive: true, force: true }));

test("planner reads the declared Git URL and exact gitlink without initializing sources", async () => {
  const rea = join(fixture, "vendor", "rea");
  await mkdir(rea, { recursive: true });
  const git = (...args: string[]) => {
    const result = Bun.spawnSync(["git", ...args], { cwd: rea, stdout: "pipe", stderr: "pipe" });
    if (result.exitCode !== 0) throw new Error(new TextDecoder().decode(result.stderr));
    return new TextDecoder().decode(result.stdout).trim();
  };
  git("init");
  await Bun.write(
    join(rea, ".gitmodules"),
    `[submodule "third_party/unblob"]\npath = third_party/unblob\nurl = ${missing.url}\n`,
  );
  git("add", ".gitmodules");
  git("update-index", "--add", "--cacheinfo", `160000,${revision},third_party/unblob`);
  git("-c", "user.name=Fixture", "-c", "user.email=fixture@example.com", "commit", "-m", "fixture");
  const plan = await inspectReVendors(fixture, "win32");
  expect(plan).toEqual([missing]);
  expect(await Bun.file(join(rea, "third_party/unblob/.git")).exists()).toBe(false);
});

test("sparse checkout reads sources while a Windows-invalid fixture stays unmaterialized", async () => {
  const source = join(fixture, "fixture-source");
  const destination = join(fixture, "fixture-checkout");
  await mkdir(join(source, "unblob"), { recursive: true });
  const git = (cwd: string, args: string[], input?: string) => {
    const result = Bun.spawnSync(["git", ...args], {
      cwd,
      stdout: "pipe",
      stderr: "pipe",
      ...(input === undefined ? {} : { stdin: new TextEncoder().encode(input) }),
    });
    if (result.exitCode !== 0) throw new Error(new TextDecoder().decode(result.stderr));
    return new TextDecoder().decode(result.stdout).trim();
  };
  git(source, ["init"]);
  await Bun.write(join(source, "unblob", "__init__.py"), "# fixture source\n");
  git(source, ["add", "unblob"]);
  const blob = git(source, ["hash-object", "-w", "--stdin"], "invalid fixture\n");
  git(source, ["-c", "core.protectNTFS=false", "update-index", "--add", "--cacheinfo", `100644,${blob},tests/CON`]);
  git(source, ["-c", "user.name=Fixture", "-c", "user.email=fixture@example.com", "commit", "-m", "fixture"]);
  const pin = git(source, ["rev-parse", "HEAD"]);
  git(fixture, ["clone", "--no-checkout", "--", source, destination]);
  git(destination, ["sparse-checkout", "set", "--cone", "unblob", "docs"]);
  git(destination, ["-c", "core.protectNTFS=false", "checkout", "--detach", pin]);
  expect(git(destination, ["rev-parse", "HEAD"])).toBe(pin);
  expect(await Bun.file(join(destination, "unblob", "__init__.py")).text()).toBe("# fixture source\n");
  expect(git(destination, ["status", "--porcelain"])).toBe("");
  expect(git(destination, ["ls-tree", "-r", "--name-only", "HEAD"])).toContain("tests/CON");
  expect(git(destination, ["config", "--get", "core.sparseCheckout"])).toBe("true");
});
