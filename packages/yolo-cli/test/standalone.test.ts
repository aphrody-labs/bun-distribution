import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { COMPILE_FLAGS } from "../../../../scripts/release/compile-flags";
import { toolingAsset } from "../../../scripts/aphrody/release/tooling-asset.ts";
import { hostTarget } from "@aphrody/runtime-sdk/artifact";
import { libraryFile } from "@aphrody/runtime-sdk";

const root = resolve(import.meta.dir, "../../../docs/aphrody");
const version = readFileSync(
  join(root, "packages/engine/yolo/VERSION"),
  "utf8",
).trim();
const work = mkdtempSync(join(tmpdir(), "yolo-standalone-"));
const home = join(work, "installation");
const project = join(work, "project");
const checkout = join(work, "checkout");
const nodeProject = join(work, "node-project");
const binary = join(
  home,
  "bin",
  process.platform === "win32" ? "yolo.exe" : "yolo",
);
const env = {
  PATH:
    process.platform === "win32"
      ? join(process.env["SystemRoot"] ?? "C:\\Windows", "System32")
      : "/usr/bin:/bin",
  HOME: join(work, "user"),
  ...(process.platform === "win32"
    ? { SystemRoot: process.env["SystemRoot"] }
    : {}),
};

function run(args: string[], cwd = project, input?: string) {
  return Bun.spawnSync([binary, ...args], {
    windowsHide: true,
    cwd,
    env,
    stdin: input === undefined ? "ignore" : Buffer.from(input),
    stdout: "pipe",
    stderr: "pipe",
    timeout: 15_000,
  });
}

beforeAll(async () => {
  const tooling = await toolingAsset(root);
  for (const path of [
    join(home, "bin"),
    project,
    nodeProject,
    join(checkout, "crates/infra/aphrody/src"),
    join(checkout, "packages/engine/yolo/src"),
    join(checkout, "apps"),
    env.HOME,
  ]) {
    mkdirSync(path, { recursive: true });
  }
  writeFileSync(join(project, "sample.ts"), "export const portable = 1;\n");
  writeFileSync(
    join(nodeProject, "entry.js"),
    "#!/usr/bin/env node\nconsole.log('hello');\n",
  );
  writeFileSync(
    join(project, "preload.ts"),
    'throw new Error("UNEXPECTED_PROJECT_PRELOAD");\n',
  );
  writeFileSync(join(project, "bunfig.toml"), 'preload = ["./preload.ts"]\n');
  writeFileSync(join(project, ".env"), "YOLO_HOME=/unexpected-dotenv-home\n");
  writeFileSync(join(home, "VERSION"), "wrong-file-version\n");
  writeFileSync(
    join(home, "Cargo.toml"),
    '[workspace]\nresolver = "1"\nmembers = []\n',
  );
  writeFileSync(join(checkout, "vendor.toml"), "# checkout fixture\n");
  writeFileSync(
    join(checkout, "Cargo.toml"),
    '[workspace]\nresolver = "2"\nmembers = []\n',
  );
  // A checkout provides data; the compiled CLI must execute its own bundled implementation.
  writeFileSync(
    join(checkout, "packages/engine/yolo/src/index.ts"),
    'throw new Error("UNEXPECTED_CHECKOUT_CLI_EXECUTION");\n',
  );
  const build = Bun.spawnSync(
    [
      process.execPath,
      "build",
      "--compile",
      ...COMPILE_FLAGS,
      ...tooling.flags,
      "--define",
      `YOLO_VERSION=${JSON.stringify(version)}`,
      "packages/engine/yolo/src/index.ts",
      "--outfile",
      binary,
    ],
    {
      windowsHide: true,
      cwd: root,
      stdout: "pipe",
      stderr: "pipe",
      timeout: 30_000,
    },
  );
  if (build.exitCode !== 0) {
    throw new Error(
      `Standalone compilation failed: ${build.stderr.toString()}`,
    );
  }
}, 35_000);

afterAll(() => {
  rmSync(work, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 100,
  });
});

describe("compiled CLI without an installed Bun", () => {
  it("refuses a checksum-valid broken installed library despite its healthy embedded provider", () => {
    const runtimeHome = join(work, "broken-installed-runtime");
    const artifact = join(runtimeHome, hostTarget(), "current");
    mkdirSync(artifact, { recursive: true });
    const data = Buffer.from("not a native shared library\n");
    writeFileSync(join(artifact, libraryFile()), data);
    writeFileSync(
      join(artifact, "manifest.json"),
      JSON.stringify({
        schema: 1,
        name: "yolo-runtime",
        version: "0.1.1",
        target: hostTarget(),
        abi: "1.5",
        compatibility: { abiMajor: 1 },
        capabilities: [],
        files: {
          [libraryFile()]: {
            sha256: new Bun.CryptoHasher("sha256").update(data).digest("hex"),
            bytes: data.length,
          },
        },
      }),
    );
    const candidateEnv = { ...env, YOLO_RUNTIME_HOME: runtimeHome };
    const healthy = Bun.spawnSync([binary, "runtime", "info"], {
      windowsHide: true,
      cwd: project,
      env: candidateEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(healthy.exitCode).toBe(0);
    const broken = Bun.spawnSync([binary, "runtime", "info", "--installed"], {
      windowsHide: true,
      cwd: project,
      env: candidateEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(broken.exitCode).toBe(1);
    expect(broken.stderr.toString()).toContain(libraryFile());
    expect(broken.stderr.toString()).not.toContain("Hash mismatch");
  });
  it("prints verify and supervisor help and rejects invalid verify arguments without gates", () => {
    const before = readdirSync(checkout).toSorted();
    const installationBefore = readdirSync(home).toSorted();
    const help = run(["verify", "--help"], checkout);
    expect(help.exitCode).toBe(0);
    expect(help.stdout.toString()).toContain("Usage: yolo verify");
    for (const args of [
      ["verify", "--unrecognized"],
      ["verify", "--parallel", "NaN"],
    ]) {
      const rejected = run(args, checkout);
      expect(rejected.exitCode).toBe(2);
      expect(rejected.stderr.toString()).toContain("yolo verify:");
    }
    const bench = run(["bench", "--supervisor", "--help"]);
    expect(bench.exitCode).toBe(0);
    expect(bench.stdout.toString()).toContain("Usage: yolo bench --supervisor");
    expect(readdirSync(checkout).toSorted()).toEqual(before);
    expect(readdirSync(home).toSorted()).toEqual(installationBefore);
  });

  it("uses embedded Bun and version without loading the project's config or dotenv", () => {
    const result = run(["version", "--json"]);
    expect(result.exitCode).toBe(0);
    const data = JSON.parse(result.stdout.toString());
    expect(data.schema).toBe("yolo.version/1");
    expect(data.version).toBe(version);
    expect(data.bunVersion).toBe(Bun.version);
  });

  it("scans the current directory and parses its files with bundled implementations", () => {
    const scan = run(["scan", "--json"]);
    expect(scan.exitCode).toBe(0);
    const report = JSON.parse(scan.stdout.toString());
    expect(report.schema).toBe("yolo.scan/1");
    expect(report.target).toBe(project);
    expect(report.totalFiles).toBe(3);
    const parse = run(["parse", "sample.ts", "--json"]);
    expect(parse.exitCode).toBe(0);
    expect(JSON.parse(parse.stdout.toString()).exports).toEqual(["portable"]);
  });

  it("runs N2B from the embedded provider and applies only requested transformations", () => {
    const file = join(nodeProject, "entry.js");
    const original = readFileSync(file, "utf8");
    const help = run(["n2b", "--help"], nodeProject);
    expect(help.exitCode).toBe(0);
    expect(help.stdout.toString()).toContain("Usage: yolo n2b");
    const checked = run(["n2b", "--json", "--jobs", "1"], nodeProject);
    expect(checked.stderr.toString()).toBe("");
    expect(checked.exitCode).toBe(1);
    const report = JSON.parse(checked.stdout.toString());
    expect(report.schema_version).toBe(2);
    expect(report.mode).toBe("check");
    expect(report.root).toBe(nodeProject);
    expect(
      report.files[0].findings.some(
        (finding: { rule_id: string }) => finding.rule_id === "shebang/node",
      ),
    ).toBe(true);
    expect(readFileSync(file, "utf8")).toBe(original);
    const preview = run(["n2b", "--fix", "--dry-run", "--json"], nodeProject);
    expect(preview.exitCode).toBe(0);
    expect(readFileSync(file, "utf8")).toBe(original);
    const fixed = run(["n2b", "--fix", "--json"], nodeProject);
    expect(fixed.exitCode).toBe(0);
    expect(readFileSync(file, "utf8")).toContain("#!/usr/bin/env bun");
  });

  it("keeps distribution diagnostics pointed at the installation", () => {
    const result = run(["doctor", "--json"]);
    // This fixture intentionally has no packaged runtime; diagnostic failure remains explicit.
    expect(result.exitCode).toBe(1);
    const report = JSON.parse(result.stdout.toString());
    expect(report.home).toBe(home);
    expect(report.yoloVersion).toBe(version);
    expect(report.runtime.installed).toBe(false);
    for (const path of ["packages/engine/python/pyproject.toml"]) {
      expect(
        report.components.find(
          (component: { path: string }) => component.path === path,
        ).required,
      ).toBe(false);
    }
  });

  it("requires checkout data and executes bundled status without running checkout sources", () => {
    const missing = run(["status", "--json"]);
    expect(missing.exitCode).toBe(1);
    expect(missing.stderr.toString()).toContain("requires yolo checkout data");
    const result = run(["status", "--json"], join(checkout, "packages"));
    expect(result.exitCode).toBe(0);
    const report = JSON.parse(result.stdout.toString());
    expect(report.root).toBe(checkout);
    expect(report.cargo.resolver).toBe("2");
  });

  it("hosts the tools and relative parsing from the caller's workspace", () => {
    const list = run(["tool", "list"], project);
    expect(list.exitCode).toBe(0);
    expect(
      JSON.parse(list.stdout.toString()).map(
        (tool: { name: string }) => tool.name,
      ),
    ).toContain("yolo_scan");
    const parse = run(
      ["tool", "call", "yolo_parse", JSON.stringify({ path: "sample.ts" })],
      project,
    );
    expect(parse.exitCode).toBe(0);
    expect(
      JSON.parse(JSON.parse(parse.stdout.toString()).content[0].text).exports,
    ).toEqual(["portable"]);
    const scan = run(["tool", "call", "yolo_scan", "{}"], project);
    expect(
      JSON.parse(JSON.parse(scan.stdout.toString()).content[0].text).target,
    ).toBe(project);

    const status = run(
      ["tool", "call", "yolo_status", "{}"],
      join(checkout, "packages"),
    );
    expect(status.exitCode).toBe(0);
    const report = JSON.parse(
      JSON.parse(status.stdout.toString()).content[0].text,
    );
    expect(report.root).toBe(checkout);
    expect(report.cargo.resolver).toBe("2");
  });

  it("serves HTTP parsing and scanning with workspace containment and a bounded shutdown", async () => {
    const child = Bun.spawn([binary, "api", "--port", "0"], {
      windowsHide: true,
      cwd: project,
      env,
      stdout: "pipe",
      stderr: "pipe",
      timeout: 5_000,
      killSignal: "SIGKILL",
    });
    try {
      const reader = child.stdout.getReader();
      const decoder = new TextDecoder();
      let output = "";
      let baseUrl: string | undefined;
      while (baseUrl === undefined) {
        // oxlint-disable-next-line no-await-in-loop -- lecture séquentielle du flux stdout jusqu'à la ligne d'écoute du serveur
        const chunk = await reader.read();
        if (chunk.done)
          throw new Error(`API exited before listening: ${output}`);
        output += decoder.decode(chunk.value, { stream: true });
        baseUrl = output.match(
          /Listening on: (http:\/\/127\.0\.0\.1:\d+)/,
        )?.[1];
      }
      reader.releaseLock();
      const health = await fetch(`${baseUrl}/health`, {
        signal: AbortSignal.timeout(2_000),
      });
      expect(health.status).toBe(200);
      expect((await health.json()).status).toBe("ok");
      const status = await fetch(`${baseUrl}/api/status`, {
        signal: AbortSignal.timeout(2_000),
      });
      expect(status.status).toBe(200);
      const report = await status.json();
      expect(report.root).toBe(project);
      expect(report.cargo).toBeNull();
      const parse = await fetch(`${baseUrl}/api/parse`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ path: "sample.ts" }),
        signal: AbortSignal.timeout(2_000),
      });
      expect(parse.status).toBe(200);
      expect((await parse.json()).exports).toEqual(["portable"]);
      const scan = await fetch(`${baseUrl}/api/scan`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
        signal: AbortSignal.timeout(2_000),
      });
      expect(scan.status).toBe(200);
      expect((await scan.json()).target).toBe(project);
      const outside = await fetch(`${baseUrl}/api/parse`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ path: "../installation/VERSION" }),
        signal: AbortSignal.timeout(2_000),
      });
      expect(outside.status).toBe(400);
      expect((await outside.json()).error).toContain("Path traversal denied");
    } finally {
      child.kill();
      await child.exited;
    }
  }, 8_000);
});
