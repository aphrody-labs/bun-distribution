import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { COMPILE_FLAGS } from "../../../../scripts/release/compile-flags";
import { toolingAsset } from "../../../../scripts/release/tooling-asset.ts";

const root = resolve(import.meta.dir, "../../../..");
const version = readFileSync(join(root, "apps/yolo/VERSION"), "utf8").trim();
const work = mkdtempSync(join(tmpdir(), "yolo-standalone-"));
const home = join(work, "installation");
const project = join(work, "project");
const checkout = join(work, "checkout");
const nodeProject = join(work, "node-project");
const binary = join(home, "bin", process.platform === "win32" ? "yolo.exe" : "yolo");
const env = {
  PATH:
    process.platform === "win32"
      ? join(process.env["SystemRoot"] ?? "C:\\Windows", "System32")
      : "/usr/bin:/bin",
  HOME: join(work, "user"),
  ...(process.platform === "win32" ? { SystemRoot: process.env["SystemRoot"] } : {}),
};

function run(args: string[], cwd = project, input?: string) {
  return Bun.spawnSync([binary, ...args], {
    cwd,
    env,
    stdin: input === undefined ? "ignore" : Buffer.from(input),
    stdout: "pipe",
    stderr: "pipe",
    timeout: 5_000,
  });
}

beforeAll(async () => {
  const tooling = await toolingAsset(root);
  for (const path of [
    join(home, "bin"),
    project,
    nodeProject,
    join(checkout, "apps/cli/src"),
    env.HOME,
  ]) {
    mkdirSync(path, { recursive: true });
  }
  writeFileSync(join(project, "sample.ts"), "export const portable = 1;\n");
  writeFileSync(join(nodeProject, "entry.js"), "#!/usr/bin/env node\nconsole.log('hello');\n");
  writeFileSync(join(project, "preload.ts"), 'throw new Error("UNEXPECTED_PROJECT_PRELOAD");\n');
  writeFileSync(join(project, "bunfig.toml"), 'preload = ["./preload.ts"]\n');
  writeFileSync(join(project, ".env"), "YOLO_HOME=/unexpected-dotenv-home\n");
  writeFileSync(join(home, "VERSION"), "wrong-file-version\n");
  writeFileSync(join(home, "Cargo.toml"), '[workspace]\nresolver = "1"\nmembers = []\n');
  writeFileSync(join(checkout, "vendor.toml"), "# checkout fixture\n");
  writeFileSync(join(checkout, "Cargo.toml"), '[workspace]\nresolver = "2"\nmembers = []\n');
  // A checkout provides data; the compiled CLI must execute its own bundled implementation.
  writeFileSync(
    join(checkout, "apps/yolo/cli/src/index.ts"),
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
      "apps/yolo/cli/src/index.ts",
      "--outfile",
      binary,
    ],
    { cwd: root, stdout: "pipe", stderr: "pipe", timeout: 30_000 },
  );
  if (build.exitCode !== 0) {
    throw new Error(`Standalone compilation failed: ${build.stderr.toString()}`);
  }
}, 35_000);

afterAll(() => {
  rmSync(work, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

describe("compiled CLI without an installed Bun", () => {
  it("prints verify and supervisor help and rejects invalid verify arguments without gates", () => {
    const before = readdirSync(checkout).sort();
    const installationBefore = readdirSync(home).sort();
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
    expect(readdirSync(checkout).sort()).toEqual(before);
    expect(readdirSync(home).sort()).toEqual(installationBefore);
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
    for (const path of ["packages/engine/python/pyproject.toml", "crates/engine/yolo-pyo3/Cargo.toml"]) {
      expect(
        report.components.find((component: { path: string }) => component.path === path).required,
      ).toBe(false);
    }
  });

  it("requires checkout data and executes bundled status without running checkout sources", () => {
    const missing = run(["status", "--json"]);
    expect(missing.exitCode).toBe(1);
    expect(missing.stderr.toString()).toContain("requires yolo checkout data");
    const result = run(["status", "--json"], join(checkout, "apps"));
    expect(result.exitCode).toBe(0);
    const report = JSON.parse(result.stdout.toString());
    expect(report.root).toBe(checkout);
    expect(report.cargo.resolver).toBe("2");
  });

  it("serves MCP initialization, tools and relative parsing from the caller's workspace", () => {
    const messages = [
      { id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } },
      { id: 2, method: "tools/list" },
      {
        id: 3,
        method: "tools/call",
        params: { name: "yolo_parse", arguments: { path: "sample.ts" } },
      },
      { id: 4, method: "tools/call", params: { name: "yolo_scan", arguments: {} } },
    ].map((message) => JSON.stringify({ jsonrpc: "2.0", ...message }));
    const result = run(["mcp"], project, `${messages.join("\n")}\n`);
    expect(result.exitCode).toBe(0);
    const replies = result.stdout
      .toString()
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(replies).toHaveLength(4);
    expect(replies[0].result.protocolVersion).toBe("2025-06-18");
    expect(replies[1].result.tools.map((tool: { name: string }) => tool.name)).toContain(
      "yolo_scan",
    );
    expect(JSON.parse(replies[2].result.content[0].text).exports).toEqual(["portable"]);
    expect(JSON.parse(replies[3].result.content[0].text).target).toBe(project);

    const status = run(
      ["mcp"],
      join(checkout, "apps"),
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: 5,
        method: "tools/call",
        params: { name: "yolo_status", arguments: {} },
      })}\n`,
    );
    expect(status.exitCode).toBe(0);
    const report = JSON.parse(JSON.parse(status.stdout.toString()).result.content[0].text);
    expect(report.root).toBe(checkout);
    expect(report.cargo.resolver).toBe("2");
  });

  it("serves HTTP parsing and scanning with workspace containment and a bounded shutdown", async () => {
    const child = Bun.spawn([binary, "api", "--port", "0"], {
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
        const chunk = await reader.read();
        if (chunk.done) throw new Error(`API exited before listening: ${output}`);
        output += decoder.decode(chunk.value, { stream: true });
        baseUrl = output.match(/Listening on: (http:\/\/127\.0\.0\.1:\d+)/)?.[1];
      }
      reader.releaseLock();
      const health = await fetch(`${baseUrl}/health`, { signal: AbortSignal.timeout(2_000) });
      expect(health.status).toBe(200);
      expect((await health.json()).status).toBe("ok");
      const status = await fetch(`${baseUrl}/api/status`, { signal: AbortSignal.timeout(2_000) });
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
