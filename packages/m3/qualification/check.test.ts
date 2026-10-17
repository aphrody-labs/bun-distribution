// SPDX-License-Identifier: Apache-2.0
import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findWorkspaceRoot, runCli } from "../src/cli.ts";

async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), "m3-check-"));
  return {
    dir,
    async [Symbol.asyncDispose]() {
      await rm(dir, { recursive: true, force: true });
    },
  };
}

async function workspace(dir: string, name: string, script: "check" | "bun:check", exitCode = 0) {
  await Bun.write(join(dir, "package.json"), JSON.stringify({ name, scripts: { [script]: "bun contract.ts" } }));
  await Bun.write(
    join(dir, "contract.ts"),
    `await Bun.write("contract.txt", process.cwd()); process.exit(${exitCode});\n`,
  );
}

async function app(dir: string, passing = true) {
  await Bun.write(
    join(dir, "package.json"),
    JSON.stringify({
      name: "consumer",
      scripts: { check: "bun nonexistent.ts" },
    }),
  );
  await Bun.write(
    join(dir, "app.test.ts"),
    `import { expect, test } from "bun:test";
test("application contract", async () => {
  await Bun.write("tests.txt", process.cwd());
  expect(${passing}).toBe(true);
});\n`,
  );
}

describe("m3 check workspace contract", () => {
  test("checking the M3 repository root uses its owned test script", async () => {
    await using tmp = await fixture();
    await workspace(tmp.dir, "aphrody-m3", "check");
    await Bun.write(
      join(tmp.dir, "package.json"),
      JSON.stringify({
        name: "aphrody-m3",
        scripts: { check: "bun contract.ts", test: "bun test owner.test.ts" },
      }),
    );
    await Bun.write(
      join(tmp.dir, "owner.test.ts"),
      'import { expect, test } from "bun:test"; test("owned tests", async () => { await Bun.write("tests.txt", process.cwd()); expect(true).toBe(true); });\n',
    );
    await Bun.write(
      join(tmp.dir, "docs", "reference", "unowned.test.ts"),
      'throw new Error("reference tests must not run");\n',
    );

    expect(await runCli(["check"], tmp.dir)).toBe(0);
    expect(await Bun.file(join(tmp.dir, "contract.txt")).text()).toBe(tmp.dir);
    expect(await Bun.file(join(tmp.dir, "tests.txt")).text()).toBe(tmp.dir);
  });

  test("a standalone M3 checkout runs its own check and the current application's tests", async () => {
    await using tmp = await fixture();
    await workspace(tmp.dir, "aphrody-m3", "check");
    const current = join(tmp.dir, "apps", "web");
    await app(current);

    expect(findWorkspaceRoot(current)).toBe(tmp.dir);
    expect(await runCli(["check"], current)).toBe(0);
    expect(await Bun.file(join(tmp.dir, "contract.txt")).text()).toBe(tmp.dir);
    expect(await Bun.file(join(current, "tests.txt")).text()).toBe(current);
  });

  test("a nested M3 checkout owns its check ahead of the parent bun:check", async () => {
    await using tmp = await fixture();
    await workspace(tmp.dir, "aphrody", "bun:check", 19);
    const local = join(tmp.dir, "design", "aphrody-m3");
    await workspace(local, "aphrody-m3", "check");
    const current = join(local, "apps", "web");
    await app(current);

    expect(findWorkspaceRoot(current)).toBe(local);
    expect(await runCli(["check"], current)).toBe(0);
    expect(await Bun.file(join(local, "contract.txt")).text()).toBe(local);
    expect(await Bun.file(join(tmp.dir, "contract.txt")).exists()).toBe(false);
  });

  test("a host bun:check remains supported and ignores the application's unrelated check", async () => {
    await using tmp = await fixture();
    await workspace(tmp.dir, "aphrody", "bun:check");
    const current = join(tmp.dir, "apps", "web");
    await app(current);

    expect(findWorkspaceRoot(current)).toBe(tmp.dir);
    expect(await runCli(["check"], current)).toBe(0);
    expect(await Bun.file(join(tmp.dir, "contract.txt")).text()).toBe(tmp.dir);
  });

  test("an application's check cannot qualify as the M3 repository owner", async () => {
    await using tmp = await fixture();
    await app(tmp.dir);

    expect(findWorkspaceRoot(tmp.dir)).toBeUndefined();
    await expect(runCli(["check"], tmp.dir)).rejects.toThrow("no aphrody-m3 check or host bun:check");
    expect(await Bun.file(join(tmp.dir, "tests.txt")).exists()).toBe(false);
  });

  test("a failing repository contract keeps its exit code after application tests", async () => {
    await using tmp = await fixture();
    await workspace(tmp.dir, "aphrody-m3", "check", 17);
    const current = join(tmp.dir, "apps", "web");
    await app(current);

    expect(await runCli(["check"], current)).toBe(17);
    expect(await Bun.file(join(current, "tests.txt")).exists()).toBe(true);
  });

  test("a failing application test determines the exit code when the repository contract passes", async () => {
    await using tmp = await fixture();
    await workspace(tmp.dir, "aphrody-m3", "check");
    const current = join(tmp.dir, "apps", "web");
    await app(current, false);

    expect(await runCli(["check"], current)).toBe(1);
    expect(await Bun.file(join(tmp.dir, "contract.txt")).exists()).toBe(true);
    expect(await Bun.file(join(current, "tests.txt")).exists()).toBe(true);
  });
});
