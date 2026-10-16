import { expect, test } from "bun:test";
import { mkdtemp, mkdir, copyFile, readFile, writeFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

const root = resolve(import.meta.dir, "../../..");

function nativeBash(): string {
  if (process.platform !== "win32") return "/bin/bash";
  const git = Bun.which("git");
  const candidates = process.env.IECODE_TEST_BASH
    ? [process.env.IECODE_TEST_BASH]
    : git
      ? [resolve(dirname(git), "../bin/bash.exe"), resolve(dirname(git), "../../../bin/bash.exe")]
      : [];
  const bash = candidates.find(
    (path) => existsSync(path) && existsSync(resolve(dirname(path), "../usr/bin/msys-2.0.dll")),
  );
  if (!bash)
    throw new Error(
      "Native Git Bash is required; select its bin/bash.exe with IECODE_TEST_BASH. WSL launchers are not used.",
    );
  return bash;
}

function shellPath(path: string): string {
  if (process.platform !== "win32") return path;
  return path
    .replaceAll("\\", "/")
    .replace(/^([a-z]):/i, (_, drive: string) => `/${drive.toLowerCase()}`);
}

function shellEnvironment(extra: Record<string, string>): Record<string, string> {
  return {
    PATH:
      process.platform === "win32"
        ? `${resolve(dirname(nativeBash()), "../usr/bin")};${process.env.PATH ?? process.env.Path ?? ""}`
        : "/usr/bin:/bin",
    ...extra,
  };
}

async function fixture(run: (directory: string) => Promise<void>) {
  const directory = await mkdtemp(join(tmpdir(), "iecode-domain-test-"));
  try {
    await run(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function execute(args: string[], env: Record<string, string>) {
  const child = Bun.spawn(args, { env, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, status] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  expect(stderr).toBe("");
  expect(status).toBe(0);
  return stdout;
}

test("IECODE memory uses the ie profile despite an inherited foreign domain", async () => {
  await fixture(async (directory) => {
    const state = join(directory, "state");
    const memory = join(state, "workspaces", "ie", "memory");
    const target = join(directory, "explicit-adapter");
    await mkdir(memory, { recursive: true });
    await writeFile(join(memory, "fixture.md"), "IECODE fixture note\n");
    const output = await execute(
      [process.execPath, join(root, "scripts/iecode/tools/sync-memory-to-agy.ts"), "--apply"],
      {
        APHRODY_HOME: state,
        APHRODY_AGENT_DOMAIN: "aphrody",
        APHRODY_WORKSPACE: join(state, "workspaces", "aphrody"),
        NIE_REPO_ROOT: join(directory, "renamed-checkout"),
        NIE_MEMORY_TARGETS: target,
      },
    );
    expect(output).toContain(join(memory, "project-memory.md"));
    expect(await readFile(join(target, "nie-workspace.md"), "utf8")).toContain(
      "IECODE fixture note",
    );
    expect(
      await Bun.file(join(state, "workspaces", "aphrody", "memory", "project-memory.md")).exists(),
    ).toBe(false);
    expect(
      await Bun.file(
        join(state, "workspaces", "renamed-checkout", "memory", "project-memory.md"),
      ).exists(),
    ).toBe(false);
  });
});

test("repository environment never maps another domain's database URL", async () => {
  await fixture(async (directory) => {
    const script = join(directory, "repo", "scripts", "dev", "env.sh");
    await mkdir(join(directory, "repo", "scripts", "dev"), { recursive: true });
    await copyFile(join(root, "scripts/dev/env.sh"), script);
    const env = shellEnvironment({
      DATABASE_URL: "postgresql://fixture.invalid/foreign",
    });
    const output = await execute(
      [
        nativeBash(),
        "--noprofile",
        "--norc",
        "-c",
        'source "$1" >/dev/null; test -z "${NIE_PG_URL:-}"',
        "fixture",
        shellPath(script),
      ],
      env,
    );
    expect(output).toBe("");
    await execute(
      [
        nativeBash(),
        "--noprofile",
        "--norc",
        "-c",
        'source "$1" >/dev/null; test "$NIE_PG_URL" = "postgresql://fixture.invalid/ie"',
        "fixture",
        shellPath(script),
      ],
      { ...env, NIE_PG_URL: "postgresql://fixture.invalid/ie" },
    );
  });
});

test("an inherited NIE_ENV_ACTIVE does not skip a new checkout", async () => {
  await fixture(async (directory) => {
    const checkout = join(directory, "repo");
    const script = join(checkout, "scripts", "dev", "nie-env.sh");
    await mkdir(join(checkout, "scripts", "dev"), { recursive: true });
    await copyFile(join(root, "scripts/dev/nie-env.sh"), script);
    await execute(
      [
        nativeBash(),
        "--noprofile",
        "--norc",
        "-c",
        'source "$1"; test "$NIE_REPO_ROOT" = "$2"; source "$1"; test "$NIE_REPO_ROOT" = "$2"',
        "fixture",
        shellPath(script),
        shellPath(checkout),
      ],
      shellEnvironment({ HOME: shellPath(join(directory, "home")), NIE_ENV_ACTIVE: "1" }),
    );
  });
});
