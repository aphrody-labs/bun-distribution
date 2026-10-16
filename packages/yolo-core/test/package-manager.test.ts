// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "bun:test";
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cargoSerialArgv, planPackageSync, syncPackages } from "../src/pm";
import { closeSharedRuntime, getRuntimeStatus } from "../src/runtime";
import { executeTool, ToolExecutionContext } from "../src/tools/registry";

async function run(argv: string[], cwd: string): Promise<void> {
  const child = Bun.spawn(argv, { windowsHide: true, cwd, stdout: "pipe", stderr: "pipe" });
  const [exitCode, out, err] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  if (exitCode) throw new Error(`Fixture command failed: ${argv[0]} (${exitCode}): ${out}${err}`);
}

async function fixture() {
  const root = mkdtempSync(join(tmpdir(), "yolo-packages-"));
  try {
    mkdirSync(join(root, "localdep"));
    writeFileSync(
      join(root, "localdep", "package.json"),
      JSON.stringify({ name: "local-fixture", version: "1.0.0" }),
    );
    writeFileSync(
      join(root, "package.json"),
      JSON.stringify({
        name: "fixture",
        private: true,
        dependencies: { "local-fixture": "file:./localdep" },
        scripts: { postinstall: "touch scripts-executed" },
      }),
    );
    writeFileSync(
      join(root, "pyproject.toml"),
      '[project]\nname="fixture"\nversion="0.1.0"\nrequires-python=">=3.10"\ndependencies=[]\n[tool.uv]\npackage=false\n',
    );
    writeFileSync(
      join(root, "Cargo.toml"),
      '[package]\nname="fixture"\nversion="0.1.0"\nedition="2024"\n[lib]\npath="lib.rs"\n',
    );
    writeFileSync(join(root, "lib.rs"), "pub fn fixture() {}\n");
    await run(
      [Bun.which("bun")!, "install", "--lockfile-only", "--ignore-scripts", "--offline"],
      root,
    );
    await run([Bun.which("uv")!, "lock", "--offline", "--no-python-downloads"], root);
    await run([Bun.which("cargo")!, "generate-lockfile", "--offline"], root);
    return {
      root,
      cleanup() {
        rmSync(root, { recursive: true, force: true });
      },
    };
  } catch (error) {
    rmSync(root, { recursive: true, force: true });
    throw error;
  }
}

/** Both tests drive the real native supervisor; they run only where the precompiled runtime is installed. */
const itNative = it.skipIf(!getRuntimeStatus().installed);

describe("native unified dependency synchronization", () => {
  it("plans all three managers without modifying files or installing dependencies", async () => {
    const f = await fixture();
    try {
      const plan = await planPackageSync({ root: f.root, offline: true });
      expect(plan.ready).toBe(true);
      expect(plan.steps.map((step) => step.manager)).toEqual(["bun", "uv", "cargo"]);
      expect(plan.steps.every((step) => step.argv.includes("--offline"))).toBe(true);
      expect(plan.steps[0]!.argv).toContain("--frozen-lockfile");
      expect(plan.steps[1]!.argv).toContain("--locked");
      expect(plan.steps[2]!.argv.slice(0, -3)).toEqual(cargoSerialArgv());
      const result = await syncPackages({ root: f.root, offline: true });
      expect(result.applied).toBe(false);
      expect(existsSync(join(f.root, ".venv"))).toBe(false);
      expect(existsSync(join(f.root, "node_modules"))).toBe(false);
    } finally {
      f.cleanup();
    }
  });

  itNative(
    "executes global Bun, uv and serialized Cargo under the real native supervisor",
    async () => {
      const f = await fixture();
      try {
        expect(getRuntimeStatus().installed).toBe(true);
        const before = Object.fromEntries(
          ["bun.lock", "uv.lock", "Cargo.lock"].map((name) => [
            name,
            readFileSync(join(f.root, name), "utf8"),
          ]),
        );
        const result = await syncPackages({
          root: f.root,
          offline: true,
          apply: true,
          timeoutMs: 30000,
        });
        expect(result.ok).toBe(true);
        expect(result.results.map((step) => [step.manager, step.status, step.exitCode])).toEqual([
          ["bun", "pass", 0],
          ["uv", "pass", 0],
          ["cargo", "pass", 0],
        ]);
        expect(existsSync(join(f.root, "node_modules/local-fixture/package.json"))).toBe(true);
        expect(existsSync(join(f.root, ".venv/pyvenv.cfg"))).toBe(true);
        expect(existsSync(join(f.root, "scripts-executed"))).toBe(false);
        expect(existsSync(join(f.root, "target"))).toBe(false);
        for (const [name, content] of Object.entries(before))
          expect(readFileSync(join(f.root, name), "utf8")).toBe(content);
      } finally {
        f.cleanup();
        closeSharedRuntime();
      }
    },
  );

  it("preflights every manager before applying and rejects escaping manifest symlinks", async () => {
    const f = await fixture();
    const external = mkdtempSync(join(tmpdir(), "yolo-packages-external-"));
    try {
      rmSync(join(f.root, "uv.lock"));
      const result = await syncPackages({ root: f.root, apply: true });
      expect(result.applied).toBe(false);
      expect(result.ok).toBe(false);
      expect(result.results).toEqual([]);
      expect(existsSync(join(f.root, "node_modules"))).toBe(false);
      writeFileSync(join(external, "package.json"), '{"name":"outside"}');
      rmSync(join(f.root, "package.json"));
      symlinkSync(join(external, "package.json"), join(f.root, "package.json"));
      const plan = await planPackageSync({ root: f.root, managers: ["bun"] });
      expect(plan.ready).toBe(false);
      expect(plan.steps[0]!.blockers.join(" ")).toContain("symlink escapes");
    } finally {
      f.cleanup();
      rmSync(external, { recursive: true, force: true });
    }
  });

  it("preserves stale locks and stops subsequent managers when Bun rejects them", async () => {
    const f = await fixture();
    try {
      const manifest = JSON.parse(readFileSync(join(f.root, "package.json"), "utf8"));
      manifest.dependencies.extra = "file:./localdep";
      writeFileSync(join(f.root, "package.json"), JSON.stringify(manifest));
      const lock = readFileSync(join(f.root, "bun.lock"), "utf8");
      const result = await syncPackages({
        root: f.root,
        apply: true,
        offline: true,
        timeoutMs: 30000,
      });
      expect(result.ok).toBe(false);
      expect(result.results[0]!.status).toBe("fail");
      expect(result.results.slice(1).map((step) => step.status)).toEqual(["skipped", "skipped"]);
      expect(readFileSync(join(f.root, "bun.lock"), "utf8")).toBe(lock);
      expect(existsSync(join(f.root, ".venv"))).toBe(false);
    } finally {
      f.cleanup();
      closeSharedRuntime();
    }
  });

  it("does not start a process for an already cancelled caller", async () => {
    const f = await fixture();
    try {
      const result = await syncPackages({ root: f.root, apply: true, signal: AbortSignal.abort() });
      expect(result.ok).toBe(false);
      expect(
        result.results.every((step) => step.status === "skipped" && step.reason === "Cancelled"),
      ).toBe(true);
      expect(existsSync(join(f.root, "node_modules"))).toBe(false);
    } finally {
      f.cleanup();
    }
  });

  itNative("cancels a real stalled package download and refuses a competing sync", async () => {
    const root = mkdtempSync(join(tmpdir(), "yolo-packages-abort-"));
    const packageDir = join(root, "package");
    mkdirSync(packageDir);
    writeFileSync(join(packageDir, "package.json"), '{"name":"slow-fixture","version":"1.0.0"}');
    await run(["tar", "-czf", "fixture.tgz", "package"], root);
    const bytes = readFileSync(join(root, "fixture.tgz"));
    let stall = false;
    let pendingDownload = false;
    const server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch() {
        if (!stall) return new Response(bytes);
        pendingDownload = true;
        return new Promise<Response>(() => {});
      },
    });
    const controller = new AbortController();
    let pending: Promise<Awaited<ReturnType<typeof syncPackages>>> | undefined;
    try {
      writeFileSync(
        join(root, "package.json"),
        JSON.stringify({
          name: "fixture",
          dependencies: { "slow-fixture": `http://127.0.0.1:${server.port}/fixture.tgz` },
        }),
      );
      writeFileSync(
        join(root, "bunfig.toml"),
        `[install.cache]\ndir = ${JSON.stringify(join(root, "cache"))}\n`,
      );
      await run([Bun.which("bun")!, "install", "--lockfile-only", "--ignore-scripts"], root);
      rmSync(join(root, "cache"), { force: true, recursive: true });
      stall = true;
      pending = syncPackages({ root, apply: true, signal: controller.signal, timeoutMs: 5000 });
      const deadline = Date.now() + 3000;
      // oxlint-disable-next-line no-await-in-loop, no-unmodified-loop-condition -- polling : pendingDownload est mis à jour par le téléchargement asynchrone en cours
      while (!pendingDownload && Date.now() < deadline) await Bun.sleep(5);
      expect(pendingDownload).toBe(true);
      await expect(syncPackages({ root, apply: true })).rejects.toThrow("already running");
      controller.abort();
      const result = await pending;
      expect(result.ok).toBe(false);
      expect(result.results[0]?.reason).toBe("Cancelled");
    } finally {
      controller.abort();
      await pending;
      await server.stop(true);
      closeSharedRuntime();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("exposes the same read-only preflight through native MCP", async () => {
    const f = await fixture();
    const context = new ToolExecutionContext({ containPaths: true });
    try {
      const result = (await executeTool(
        "yolo_package_sync",
        { managers: "bun,uv,cargo", offline: true },
        f.root,
        context,
      )) as { applied: boolean; ok: boolean };
      expect(result).toMatchObject({ applied: false, ok: true });
      await expect(
        executeTool("yolo_package_sync", { managers: "npx" }, f.root, context),
      ).rejects.toThrow("Choose managers");
    } finally {
      context.close();
      f.cleanup();
    }
  });
});
