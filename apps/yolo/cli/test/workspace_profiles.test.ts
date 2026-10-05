import { afterEach, expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dir, "../../../..");
const just = Bun.which("just");
const profileTest = just !== null && process.platform !== "win32" ? test : test.skip;
const fixtures: string[] = [];

afterEach(async () => {
  await Promise.all(fixtures.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), "yolo profiles "));
  fixtures.push(dir);
  const log = join(dir, "calls.jsonl");
  const wrapper = join(dir, "cargo owner");
  const bin = join(dir, "bin");
  const recorder = `#!${process.execPath}
import { appendFileSync } from "node:fs";
appendFileSync(process.env.YOLO_PROFILE_LOG, JSON.stringify(process.argv.slice(2)) + "\\n");
`;
  await Bun.write(wrapper, recorder);
  await chmod(wrapper, 0o700);
  await mkdir(bin);
  const rustup = join(bin, "rustup");
  await Bun.write(
    rustup,
    `#!${process.execPath}
import { appendFileSync } from "node:fs";
appendFileSync(process.env.YOLO_PROFILE_PREFLIGHT_LOG, JSON.stringify(process.argv.slice(2)) + "\\n");
if (process.env.YOLO_PROFILE_MISSING_NIGHTLY === "1") process.exit(1);
`,
  );
  await chmod(rustup, 0o700);
  return { dir, log, wrapper, recorder, bin, preflightLog: join(dir, "preflight.jsonl") };
}

async function runRecipes(
  setup: Awaited<ReturnType<typeof fixture>>,
  recipes: string[],
  workingDirectory = root,
  environment: Record<string, string> = {},
) {
  const child = Bun.spawn(
    [
      just!,
      "--shell",
      "bash",
      "--clear-shell-args",
      "--shell-arg",
      "-c",
      "--justfile",
      join(workingDirectory, "apps/yolo/yolo.just"),
      ...recipes,
    ],
    {
      cwd: workingDirectory,
      env: {
        ...process.env,
        YOLO_CARGO_WRAPPER: setup.wrapper,
        YOLO_PROFILE_LOG: setup.log,
        YOLO_PROFILE_PREFLIGHT_LOG: setup.preflightLog,
        PATH: `${setup.bin}:${process.env.PATH}`,
        ...environment,
      },
      stdout: "pipe",
      stderr: "pipe",
    },
  );
  const [exitCode, stderr] = await Promise.all([
    child.exited,
    new Response(child.stderr).text(),
    new Response(child.stdout).text(),
  ]);
  return { exitCode, stderr };
}

async function calls(log: string): Promise<string[][]> {
  return (await Bun.file(log).text())
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as string[]);
}

async function bunFixture(setup: Awaited<ReturnType<typeof fixture>>) {
  await Bun.write(join(setup.dir, "apps/yolo/yolo.just"), Bun.file(join(root, "apps/yolo/yolo.just")));
  const source = join(setup.dir, "vendor/bun");
  await mkdir(join(source, "scripts"), { recursive: true });
  const pinFile = Bun.file(join(root, "vendor/bun/rust-toolchain.toml"));
  const toolchain = (await pinFile.exists())
    ? (Bun.TOML.parse(await pinFile.text()) as { toolchain: { channel: string } }).toolchain.channel
    : "nightly-2026-09-15";
  await Bun.write(join(source, "rust-toolchain.toml"), `[toolchain]\nchannel = "${toolchain}"\n`);
  await Bun.write(
    join(source, "scripts/build.ts"),
    'throw new Error("Engine fixture must not execute");\n',
  );
  const log = join(setup.dir, "bun.jsonl");
  const bun = join(setup.bin, "bun");
  await Bun.write(
    bun,
    `#!${process.execPath}
import { appendFileSync } from "node:fs";
const args = process.argv.slice(2);
appendFileSync(${JSON.stringify(log)}, JSON.stringify({args, cwd: process.cwd(), toolchain: process.env.RUSTUP_TOOLCHAIN, wrapper: process.env.RUSTC_WRAPPER}) + "\\n");
// Only the source-pin parser executes. The engine command is recorded without running the driver.
if (args[0] === "-e") {
  const result = Bun.spawnSync([process.execPath, ...args], {stdout: "inherit", stderr: "inherit"});
  process.exit(result.exitCode);
}
`,
  );
  await chmod(bun, 0o700);
  return { source, toolchain, log };
}

function packages(args: string[]): string[] {
  return args.flatMap((value, index) => (value === "-p" ? [args[index + 1]!] : []));
}

profileTest(
  "Bun engine recipes refuse a local contract before any source probe or build",
  async () => {
    const setup = await fixture();
    const bun = await bunFixture(setup);
    const result = await runRecipes(setup, ["qualify-bun"], setup.dir, {
      APHRODY_BUILD_HOST: "",
      APHRODY_LOCAL_CARGO: "1",
    });
    expect(result.exitCode, result.stderr).not.toBe(0);
    expect(result.stderr).toContain("Bun engine builds require the declared factory");
    expect(await Bun.file(bun.log).exists()).toBe(false);
    expect(await Bun.file(setup.preflightLog).exists()).toBe(false);
  },
);

profileTest(
  "Bun engine recipes reject source pin drift before probing or acquiring a toolchain",
  async () => {
    const setup = await fixture();
    const bun = await bunFixture(setup);
    await Bun.write(join(bun.source, "rust-toolchain.toml"), '[toolchain]\nchannel = "stable"\n');
    const result = await runRecipes(setup, ["qualify-bun"], setup.dir, {
      APHRODY_BUILD_HOST: "vps",
    });
    expect(result.exitCode, result.stderr).not.toBe(0);
    expect(result.stderr).toContain("Bun source toolchain differs from the qualified recipe pin");
    expect(await Bun.file(setup.preflightLog).exists()).toBe(false);
    const probes = (await Bun.file(bun.log).text()).trim().split("\n");
    expect(probes).toHaveLength(1);
    expect(JSON.parse(probes[0]!).args[0]).toBe("-e");
  },
);

profileTest("an absent Bun nightly stops before the engine driver", async () => {
  const setup = await fixture();
  const bun = await bunFixture(setup);
  const result = await runRecipes(setup, ["qualify-bun"], setup.dir, {
    APHRODY_BUILD_HOST: "vps",
    YOLO_PROFILE_MISSING_NIGHTLY: "1",
  });
  expect(result.exitCode, result.stderr).not.toBe(0);
  expect(await calls(setup.preflightLog)).toEqual([["run", bun.toolchain, "rustc", "--version"]]);
  const probes = (await Bun.file(bun.log).text()).trim().split("\n");
  expect(probes).toHaveLength(1);
  expect(JSON.parse(probes[0]!).args[0]).toBe("-e");
});

profileTest(
  "the Bun recipe uses its native owner, source toolchain and bounded Ninja jobs",
  async () => {
    const setup = await fixture();
    const bun = await bunFixture(setup);
    const result = await runRecipes(setup, ["qualify-bun"], setup.dir, {
      APHRODY_BUILD_HOST: "vps",
      RUSTUP_TOOLCHAIN: "inherited-override",
      RUSTC_WRAPPER: "preserved-cache-wrapper",
    });
    expect(result.exitCode, result.stderr).toBe(0);
    expect(await calls(setup.preflightLog)).toEqual([["run", bun.toolchain, "rustc", "--version"]]);
    const probes = (await Bun.file(bun.log).text())
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(probes).toHaveLength(2);
    expect(probes[1]).toEqual({
      args: ["scripts/build.ts", "--profile=release", "-j2"],
      cwd: bun.source,
      toolchain: bun.toolchain,
      wrapper: "preserved-cache-wrapper",
    });
    expect(await Bun.file(setup.log).exists()).toBe(false);
  },
);

profileTest("an absent pinned compiler toolchain stops before any Cargo command", async () => {
  const setup = await fixture();
  const result = await runRecipes(setup, ["qualify-compiler"], root, {
    YOLO_PROFILE_MISSING_NIGHTLY: "1",
  });
  expect(result.exitCode).not.toBe(0);
  expect(await Bun.file(setup.log).exists()).toBe(false);
  expect(await calls(setup.preflightLog)).toHaveLength(1);
});

profileTest(
  "historical full ship refuses a missing factory contract before bootstrap",
  async () => {
    const setup = await fixture();
    await mkdir(join(setup.dir, "scripts/release"), { recursive: true });
    await Bun.write(join(setup.dir, "VERSION"), "0.0.0\n");
    await Bun.write(
      join(setup.dir, "scripts/release/bootstrap_remote.sh"),
      "#!/usr/bin/env bash\nprintf started > bootstrap.started\nexit 98\n",
    );
    for (const environment of [
      { APHRODY_BUILD_HOST: "", YOLO_CARGO_WRAPPER: setup.wrapper },
      { APHRODY_BUILD_HOST: "vps", YOLO_CARGO_WRAPPER: join(setup.dir, "missing owner") },
    ]) {
      const child = Bun.spawn(
        ["bash", join(root, "scripts/release/ship_remote.sh"), "fixture", setup.dir, setup.dir],
        {
          cwd: setup.dir,
          env: { ...process.env, ...environment },
          stdout: "pipe",
          stderr: "pipe",
        },
      );
      const [exitCode, stderr] = await Promise.all([
        child.exited,
        new Response(child.stderr).text(),
        new Response(child.stdout).text(),
      ]);
      expect(exitCode, stderr).toBe(64);
      expect(await Bun.file(join(setup.dir, "bootstrap.started")).exists()).toBe(false);
      expect(await Bun.file(join(setup.dir, "STATUS")).exists()).toBe(false);
    }
  },
);

profileTest(
  "core recipes execute only the minimal packages through the declared Cargo owner",
  async () => {
    const setup = await fixture();
    const result = await runRecipes(setup, [
      "rust-fmt-check",
      "check-core",
      "clippy",
      "test-crates",
      "runtime-build",
    ]);
    expect(result.exitCode, result.stderr).toBe(0);
    const [formatter, ...commands] = await calls(setup.log);
    expect(formatter).toEqual(["fmt", "--check", "-p", "yolo-core", "-p", "yolo-runtime"]);
    expect(commands.map((args) => args[0])).toEqual(["check", "clippy", "nextest", "build"]);
    for (const args of commands) {
      expect(args).toContain("--locked");
      expect(args).toContain("--no-default-features");
      expect(args).not.toContain("--features");
      expect(args).not.toContain("--workspace");
      expect(packages(args).sort()).toEqual(
        args[0] === "build" ? ["yolo-runtime"] : ["yolo-core", "yolo-runtime"],
      );
    }
    expect(commands[1]!.slice(-3)).toEqual(["--", "-D", "warnings"]);
    const manifest = Bun.TOML.parse(await Bun.file(join(root, "Cargo.toml")).text()) as {
      workspace: { "default-members": string[] };
    };
    expect(manifest.workspace["default-members"].sort()).toEqual([
      "crates/engine/yolo-core",
      "crates/engine/yolo-runtime",
    ]);
  },
);

profileTest(
  "provider recipes keep desktop, browser, Python and compiler selections explicit",
  async () => {
    const setup = await fixture();
    const result = await runRecipes(setup, [
      "qualify-desktop",
      "qualify-browser",
      "check-python",
      "clippy-python",
      "test-python-crate",
      "qualify-compiler",
      "qualify-upstream",
    ]);
    expect(result.exitCode, result.stderr).toBe(0);
    const executed = await calls(setup.log);
    const formatters = executed.filter((args) => args[0] === "fmt");
    expect(formatters).toContainEqual(["fmt", "--check", "-p", "yolo-desktop"]);
    expect(formatters).toContainEqual(["fmt", "--check", "-p", "yolo-core", "-p", "yolo-runtime"]);
    expect(formatters).toContainEqual(["fmt", "--all", "--check"]);
    const commands = executed.filter((args) => args[0] !== "fmt");
    expect(commands).toHaveLength(13);
    for (const args of commands) expect(args).toContain("--locked");
    for (const args of commands.slice(0, 3)) expect(packages(args)).toEqual(["yolo-desktop"]);
    for (const args of commands.slice(3, 6)) {
      expect(packages(args)).toEqual(["yolo-runtime"]);
      expect(args[args.indexOf("--features") + 1]).toBe("browser");
    }
    for (const args of commands.slice(6, 9)) expect(packages(args)).toEqual(["yolo-pyo3"]);

    const baseline = await Bun.file(
      join(root, "docs/core-module-boundaries-2026-10-04.json"),
    ).json();
    const names = new Map<string, string>();
    for (const path of new Bun.Glob("crates/*/Cargo.toml").scanSync({ cwd: root })) {
      const manifest = Bun.TOML.parse(await Bun.file(join(root, path)).text()) as {
        package: { name: string };
      };
      names.set(path.slice(0, -"/Cargo.toml".length), manifest.package.name);
    }
    const selected = (args: string[]) =>
      [...names.values()]
        .filter((name) => packages(args).some((pattern) => new Bun.Glob(pattern).match(name)))
        .sort();
    const compilerNames = baseline.crates
      .filter((entry: { family: string }) => entry.family === "compiler")
      .map((entry: { package: string }) => entry.package)
      .sort();
    expect(compilerNames).toHaveLength(59);
    const compilerPin = Bun.file(join(root, "vendor/next/rust-toolchain.toml"));
    // A core-only CI checkout need not materialize the compiler vendor. Hydrated
    // producer checkouts also verify the exact pin against its source owner.
    const compilerToolchain = (await compilerPin.exists())
      ? (Bun.TOML.parse(await compilerPin.text()) as { toolchain: { channel: string } })
      : undefined;
    for (const args of commands.slice(9, 11)) {
      expect(selected(args)).toEqual(compilerNames);
      expect(args[0]).toMatch(/^\+nightly-\d{4}-\d{2}-\d{2}$/);
      if (compilerToolchain !== undefined)
        expect(args[0]).toBe(`+${compilerToolchain.toolchain.channel}`);
    }
    const preflights = await calls(setup.preflightLog);
    expect(preflights).toHaveLength(1);
    expect(preflights[0]).toEqual(["run", commands[9]![0]!.slice(1), "rustc", "--version"]);
    const formerImportedDefaults = baseline.currentDefaultMembers
      .filter((path: string) => path.startsWith("crates/aphrody-"))
      .map((path: string) => names.get(path))
      .sort();
    expect(formerImportedDefaults).toHaveLength(44);
    expect(selected(commands[12]!)).toEqual(formerImportedDefaults);
  },
);

profileTest(
  "factory recipes dispatch a pinned profile through the native owner and reject invalid input",
  async () => {
    const setup = await fixture();
    await Bun.write(join(setup.dir, "apps/yolo/yolo.just"), Bun.file(join(root, "apps/yolo/yolo.just")));
    const yolo = join(setup.dir, "bin/yolo");
    await Bun.write(yolo, setup.recorder);
    await chmod(yolo, 0o700);
    const revision = "a".repeat(40);
    const result = await runRecipes(setup, ["factory", "compiler", revision], setup.dir);
    expect(result.exitCode, result.stderr).toBe(0);
    expect(await calls(setup.log)).toEqual([
      [
        "ops",
        "build-factory",
        "run",
        "--repo",
        "yolo",
        "--revision",
        revision,
        "--",
        "just",
        "qualify-compiler",
      ],
    ]);
    const bun = await runRecipes(setup, ["factory", "bun", revision], setup.dir);
    expect(bun.exitCode, bun.stderr).toBe(0);
    expect((await calls(setup.log))[1]).toEqual([
      "ops",
      "build-factory",
      "run",
      "--repo",
      "yolo",
      "--revision",
      revision,
      "--submodules",
      "vendor/bun",
      "--",
      "just",
      "qualify-bun",
    ]);
    for (const args of [
      ["invalid", revision],
      ["browser", "main"],
    ]) {
      const rejected = await runRecipes(setup, ["factory", ...args], setup.dir);
      expect(rejected.exitCode).not.toBe(0);
    }
    expect(await calls(setup.log)).toHaveLength(2);
  },
);
