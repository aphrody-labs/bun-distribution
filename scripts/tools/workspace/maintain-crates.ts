// SPDX-License-Identifier: Apache-2.0
/** Fast, UI-free Rust workspace maintenance using host-installed Cargo tools. */
import { existsSync, mkdirSync, readdirSync, realpathSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { Glob } from "bun";

type Mode = "scan" | "update" | "fix" | "clean" | "dispatch";
type Result = { code: number; stdout: string; stderr: string };
type Row = Record<string, unknown> & { repo: string; status: string };

const argv = process.argv.slice(2);
const mode = (argv[0]?.startsWith("--") ? "scan" : (argv.shift() ?? "scan")) as Mode;
const flag = (name: string) => argv.includes(name);
const value = (name: string) => {
  const index = argv.indexOf(name);
  return index < 0 ? undefined : argv[index + 1];
};
const selected = value("--repo");
const explicitRoot = value("--workspace-root");
const apply = flag("--apply");
const deep = flag("--deep");
const full = flag("--full");
const online = flag("--online");
const json = flag("--json");
const registry = value("--registry");
const harness = value("--harness");
if (flag("--help") || flag("-h")) usage();

function findWorkspace(start: string): string | undefined {
  let current = resolve(start);
  while (true) {
    if (
      existsSync(join(current, "aphrody-infra", "Cargo.toml")) &&
      existsSync(join(current, "aphrody-shell", "Cargo.toml"))
    )
      return current;
    const parent = dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
}
const root = explicitRoot
  ? findWorkspace(resolve(explicitRoot))
  : (findWorkspace(process.cwd()) ??
    findWorkspace(dirname(process.execPath)) ??
    findWorkspace(import.meta.dir));
if (!root)
  throw new Error("Aphrody workspace not found; pass --workspace-root /absolute/path/to/src");
const infra = join(root, "aphrody-infra");

function usage(): never {
  console.log(`Usage: aphrody-crates [scan|update|fix|clean|dispatch] [--workspace-root /path/to/src] [--repo aphrody-NAME] [--deep] [--full] [--online] [--apply] [--registry name@version] [--harness agy|claude] [--json]

scan: offline Cargo metadata and lockfile summary; --deep adds cargo-machete, cargo-audit (cached DB), and cargo update --dry-run.
scan --full: run the Nushell copied-source and dependency inventory with --skip-ui.
update: preview compatible Cargo.lock updates; --apply writes the lockfile in a clean selected repo.
fix: preview cargo fix command; --apply runs cargo fix --workspace --all-targets in a clean selected repo.
clean: preview workspace artifacts with cargo clean --dry-run; --apply removes them in a clean selected repo.
dispatch: preview YOLO plan/check/detect, a scoped MRX map, and up to three sequential maintenance missions; --apply builds the native CLI and dispatches one tick.
--online permits a registry refresh for update/deep scan. --registry checks one exact crates.io release, including yanked state.
UI is always excluded. No mode edits a submodule or dirty repository.`);
  process.exit(0);
}
if (!["scan", "update", "fix", "clean", "dispatch"].includes(mode) || (apply && mode === "scan")) {
  throw new Error("Invalid mode or --apply with scan; use --help");
}
if (mode !== "scan" && !selected) throw new Error(`${mode} requires --repo`);
if (deep && !selected) throw new Error("--deep requires --repo to keep scans bounded");
if (full && mode !== "scan") throw new Error("--full is only available with scan");
if (harness && !["agy", "claude", "gemini"].includes(harness))
  throw new Error("Unknown agent harness");
if (selected === "aphrody-ui") throw new Error("aphrody-ui is owned by its designated agent");
if (registry && !/^[A-Za-z0-9_-]+@[0-9][A-Za-z0-9.+-]*$/.test(registry)) {
  throw new Error("--registry expects name@version");
}

function run(command: string, args: string[], cwd: string): Result {
  if (!(command.includes("/") ? existsSync(command) : Bun.which(command))) {
    return { code: 2, stdout: "", stderr: `${command} is not installed` };
  }
  const result = Bun.spawnSync([command, ...args], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, CARGO_TERM_COLOR: "never" },
  });
  const decoder = new TextDecoder();
  return {
    code: result.exitCode ?? 2,
    stdout: decoder.decode(result.stdout),
    stderr: decoder.decode(result.stderr),
  };
}
async function runLogged(
  command: string,
  args: string[],
  cwd: string,
  logDir: string,
): Promise<{ code: number; stdoutLog: string; stderrLog: string }> {
  mkdirSync(logDir, { recursive: true });
  const stdoutLog = join(logDir, "stdout.log");
  const stderrLog = join(logDir, "stderr.log");
  const child = Bun.spawn([command, ...args], {
    cwd,
    stdin: "ignore",
    stdout: Bun.file(stdoutLog),
    stderr: Bun.file(stderrLog),
    env: { ...globalThis.process.env, CARGO_TERM_COLOR: "never" },
  });
  return { code: await child.exited, stdoutLog, stderrLog };
}
function detail(result: Result): string {
  return (result.stderr || result.stdout).trim().split("\n").slice(-3).join(" | ");
}
function updateChanges(result: Result): string[] {
  return result.stderr
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => /^(Adding|Removing|Updating|Downgrading)\s/.test(line))
    .slice(0, 200);
}
function isWithin(path: string, parent: string): boolean {
  const rel = relative(parent, path);
  return rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`) && !rel.startsWith("/"));
}
function status(dir: string): string {
  const result = run("git", ["status", "--porcelain=v1", "--untracked-files=normal"], dir);
  return result.code === 0 ? (result.stdout.trim() ? "dirty" : "clean") : "git-error";
}
async function lockSummary(file: string): Promise<Record<string, unknown>> {
  if (!existsSync(file)) return { lock: "missing" };
  try {
    const contents = await Bun.file(file).text();
    const lockSha256 = new Bun.CryptoHasher("sha256").update(contents).digest("hex");
    const packages =
      (
        Bun.TOML.parse(contents) as {
          package?: { name: string; version: string; source?: string }[];
        }
      ).package ?? [];
    const versions = new Map<string, Set<string>>();
    for (const pkg of packages) {
      if (!pkg.source?.startsWith("registry+")) continue;
      const group = versions.get(pkg.name) ?? new Set<string>();
      group.add(pkg.version);
      versions.set(pkg.name, group);
    }
    return {
      lock: "present",
      lockSha256,
      packages: packages.length,
      registryNames: versions.size,
      duplicatedRegistryNames: [...versions.values()].filter((items) => items.size > 1).length,
      extraVersions: [...versions.values()].reduce((sum, items) => sum + items.size - 1, 0),
    };
  } catch (error) {
    return { lock: `parse-error: ${String(error)}` };
  }
}

async function uiPathReference(dir: string): Promise<boolean> {
  const pattern = /\bpath\s*=\s*["'][^"'\n]*aphrody-ui/;
  const manifests = ["Cargo.toml"];
  const glob = new Glob("{crates,packages,apps}/**/Cargo.toml");
  for await (const file of glob.scan({ cwd: dir, followSymlinks: false })) manifests.push(file);
  for (const file of manifests) {
    if (pattern.test(await Bun.file(join(dir, file)).text())) return true;
  }
  return false;
}

async function registryVersion(spec: string): Promise<Record<string, unknown>> {
  const at = spec.lastIndexOf("@");
  const name = spec.slice(0, at);
  const version = spec.slice(at + 1);
  try {
    const response = await fetch(
      `https://crates.io/api/v1/crates/${encodeURIComponent(name)}/${encodeURIComponent(version)}`,
      {
        headers: {
          "User-Agent": "aphrody-code/maintenance (contact@aphrody.com)",
          Accept: "application/json",
        },
        signal: AbortSignal.timeout(8000),
      },
    );
    if (response.status === 404) return { spec, status: "not-published" };
    if (!response.ok) return { spec, status: "unknown", httpStatus: response.status };
    const body = (await response.json()) as {
      version?: { num?: string; yanked?: boolean; rust_version?: string };
    };
    if (body.version?.num !== version)
      return { spec, status: "unknown", error: "unexpected version response" };
    return {
      spec,
      status: body.version?.yanked ? "yanked" : "published",
      rustVersion: body.version?.rust_version ?? null,
    };
  } catch (error) {
    return { spec, status: "unknown", error: String(error) };
  }
}

async function main(): Promise<void> {
  const candidates = readdirSync(root, { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isDirectory() && entry.name.startsWith("aphrody-") && entry.name !== "aphrody-ui",
    )
    .map((entry) => ({ name: entry.name, dir: join(root, entry.name) }))
    .filter(({ dir }) => existsSync(join(dir, "Cargo.toml")));
  if (
    selected &&
    (!/^aphrody-[a-z0-9-]+$/.test(selected) || !candidates.some(({ name }) => name === selected))
  ) {
    throw new Error(`Unknown or excluded Rust repository: ${selected}`);
  }
  const targets = selected ? candidates.filter(({ name }) => name === selected) : candidates;
  const rows: Row[] = [];
  for (const { name, dir } of targets) {
    const git = status(dir);
    const row: Row = { repo: name, status: git, ...(await lockSummary(join(dir, "Cargo.lock"))) };
    // Refuse Cargo traversal when a first-party manifest points at UI.
    let uiReference = false;
    let manifestError = "";
    try {
      uiReference = await uiPathReference(dir);
    } catch (error) {
      manifestError = String(error);
      row.metadataError = `manifest scan: ${manifestError}`;
    }
    if (uiReference) row.uiReference = "Cargo commands skipped";
    const metadata =
      uiReference || manifestError
        ? null
        : run(
            "cargo",
            ["metadata", "--format-version", "1", "--no-deps", "--offline", "--locked"],
            dir,
          );
    if (metadata?.code === 0) {
      try {
        const parsed = JSON.parse(metadata.stdout) as {
          workspace_members: string[];
          target_directory: string;
        };
        row.workspaceMembers = parsed.workspace_members.length;
        row.targetDirectory = parsed.target_directory;
      } catch (error) {
        row.metadataError = `JSON: ${String(error)}`;
      }
    } else if (metadata) row.metadataError = detail(metadata);

    if (mode === "scan" && deep && metadata?.code === 0) {
      const machete = run("cargo", ["machete", "--skip-target-dir", dir], dir);
      row.machete = machete.code === 0 ? "clear" : machete.code === 1 ? "candidates" : "error";
      if (machete.code !== 0)
        row.macheteDetail = (machete.stdout || machete.stderr).trim().split("\n").slice(0, 100);
      const db = join(
        process.env.CARGO_HOME ?? join(process.env.HOME ?? "", ".cargo"),
        "advisory-db",
      );
      if (online || existsSync(db)) {
        const audit = run(
          "cargo",
          [
            "audit",
            ...(online ? [] : ["--no-fetch", "--stale", "--no-yanked"]),
            "--file",
            join(dir, "Cargo.lock"),
            "--format",
            "json",
          ],
          dir,
        );
        row.audit = audit.code === 0 ? "clear" : audit.code === 1 ? "findings" : "error";
        if (audit.code !== 0) row.auditDetail = detail(audit);
      } else row.audit = "advisory-db-unavailable";
      const updates = run("cargo", ["update", "--dry-run", ...(online ? [] : ["--offline"])], dir);
      row.updatePreview =
        updates.code === 0 ? detail(updates) || "no updates" : `error: ${detail(updates)}`;
      row.updateChanges = updateChanges(updates);
    }

    if (mode !== "scan") {
      if (uiReference || manifestError) {
        row.action = "skipped: repository manifests reference UI or manifest scan failed";
      } else if (git !== "clean" && apply) {
        row.action = "skipped: repository is not clean";
      } else if (metadata?.code !== 0) {
        row.action = "skipped: Cargo metadata unavailable";
      } else if (mode === "dispatch") {
        const scope = `Modify only files inside ${dir}. Never inspect or modify aphrody-ui. Reuse YOLO detect/map; for path or text lookup use OS search_files or Shell's aphrody utils grep/find through a running kernel, otherwise installed rg. Preserve concurrent work; run the relevant owner gates before claiming completion. Commit only your own changes as aphrody-code <contact@aphrody.com>.`;
        const goals = [
          `Cargo dependency lane: own Cargo.toml, Cargo.lock and manifests under crates/. Use the MRX map, Nu inventory, cargo tree and exact crates.io releases to remove verified redundant dependencies and resolve compatible updates. ${scope}`,
        ];
        if (existsSync(join(dir, "crates")) || existsSync(join(dir, "src"))) {
          goals.push(
            `Rust source lane: own crates/**/src/** and src/** only. Use the Nu copied-source hashes and MRX map to consolidate verified duplicate source with existing owners and APIs. ${scope}`,
          );
        }
        if (existsSync(join(dir, "scripts")) || existsSync(join(dir, "package.json"))) {
          goals.push(
            `Bun and Nushell tooling lane: own scripts/** and package.json only. Improve maintenance automation using installed host commands and native runtime APIs where useful; avoid redundant packages or binaries. ${scope}`,
          );
        }
        const native = join(infra, "target", "debug", "aphrody");
        const nativeSource = join(infra, "crates", "infra", "yolo", "src", "cli.rs");
        const needsBuild =
          !existsSync(native) || statSync(nativeSource).mtimeMs > statSync(native).mtimeMs;
        const mrxDir = join(infra, "target", "aphrody-crates-mrx", name);
        const mapArgs = [
          "yolo",
          "--root",
          dir,
          "--json",
          "map",
          "--out",
          join(mrxDir, "path.json"),
          "--map",
          join(mrxDir, "monorepo-map.json"),
          "scan",
        ];
        const planArgs = ["yolo", "--root", dir, "--json", "plan"];
        const checkArgs = ["yolo", "--root", dir, "--json", "check"];
        const agentArgs = [
          "yolo",
          "--root",
          dir,
          "--json",
          "autopilot",
          "--once",
          "--sequential",
          ...goals.flatMap((goal) => ["--goal", goal]),
          ...(harness ? ["--harness", harness] : []),
        ];
        row.dispatchPlan = {
          nativeBinary: native,
          plan: planArgs,
          check: checkArgs,
          map: mapArgs,
          agent: agentArgs,
          nativeBuildRequired: needsBuild,
        };
        if (apply && harness && !Bun.which(harness)) {
          row.action = `error: agent harness ${harness} is not installed`;
        } else if (
          apply &&
          (run("git", ["check-ignore", "-q", "var/yolo/runs/example"], dir).code !== 0 ||
            run("git", ["check-ignore", "-q", ".coord/heartbeat-aphrody-yolo.txt"], dir).code !== 0)
        ) {
          row.action = "skipped: YOLO runtime state is not gitignored in the selected repository";
        } else {
          if (apply) {
            const build = run(
              "cargo",
              ["build", "--locked", ...(online ? [] : ["--offline"]), "-p", "aphrody"],
              infra,
            );
            if (build.code !== 0) row.action = `error: native YOLO build: ${detail(build)}`;
          }
          if (!row.action && (apply || !needsBuild)) {
            const plan = run(native, planArgs, infra);
            const check = run(native, checkArgs, infra);
            const preview = run(native, [...agentArgs, "--dry-run"], infra);
            const detected = [
              "Cargo.toml",
              ...(existsSync(join(dir, "package.json")) ? ["package.json"] : []),
            ].map((path) => {
              const result = run(native, ["yolo", "--root", dir, "--json", "detect", path], infra);
              if (result.code !== 0) return { path, error: detail(result) };
              try {
                const report = JSON.parse(result.stdout) as {
                  definition?: { id?: string };
                  parse?: { validation_gate?: string };
                };
                return {
                  path,
                  language: report.definition?.id,
                  gate: report.parse?.validation_gate,
                };
              } catch (error) {
                return { path, error: String(error) };
              }
            });
            let missions: unknown = `error: ${detail(preview)}`;
            if (preview.code === 0) {
              try {
                const tick = JSON.parse(preview.stdout.trim().split("\n").at(-1) ?? "") as {
                  tasks?: { owner: string }[];
                };
                missions = tick.tasks?.map(({ owner }) => owner) ?? "error: YOLO returned no tasks";
              } catch (error) {
                missions = `error: YOLO preview JSON: ${String(error)}`;
              }
            }
            row.yolo = {
              plan: plan.code === 0 ? "ready" : `error: ${detail(plan)}`,
              check: check.code === 0 ? "ready" : `error: ${detail(check)}`,
              detected,
              missions,
            };
            if (
              plan.code !== 0 ||
              check.code !== 0 ||
              detected.some((item) => "error" in item) ||
              !Array.isArray(missions) ||
              missions.length !== goals.length
            ) {
              row.action = "error: YOLO preflight failed";
            }
          }
          if (!row.action && !apply)
            row.action = needsBuild
              ? "dispatch preview complete; native build required"
              : "dispatch preview complete";
          if (!row.action && apply) {
            mkdirSync(mrxDir, { recursive: true });
            const map = run(native, mapArgs, infra);
            row.mrx =
              map.code === 0
                ? (((await Bun.file(join(mrxDir, "path.json")).json()) as { status?: string })
                    .status ?? "mapped")
                : `error: ${detail(map)}`;
            if (map.code !== 0) row.action = "error: MRX map failed";
            else {
              const dispatched = await runLogged(
                native,
                agentArgs,
                infra,
                join(mrxDir, `tick-${Date.now()}`),
              );
              row.action =
                dispatched.code === 0
                  ? "YOLO tick finished; audit evidence required"
                  : `error: YOLO tick exited ${dispatched.code}`;
              row.actionDetail = {
                stdoutLog: dispatched.stdoutLog,
                stderrLog: dispatched.stderrLog,
              };
            }
          }
        }
      } else if (mode === "clean") {
        const target = row.targetDirectory;
        const targetPath = typeof target === "string" ? resolve(target) : "";
        const resolvedTarget =
          targetPath && existsSync(targetPath) ? realpathSync(targetPath) : targetPath;
        if (
          !targetPath ||
          !isWithin(realpathSync(dir), root) ||
          !isWithin(resolvedTarget, realpathSync(dir))
        ) {
          row.action = "skipped: Cargo target directory is outside the selected repository";
        } else {
          const result = run(
            "cargo",
            ["clean", "--workspace", ...(apply ? [] : ["--dry-run"]), "--offline", "--locked"],
            dir,
          );
          row.action =
            result.code === 0
              ? apply
                ? "cleaned workspace artifacts"
                : "clean preview complete"
              : `error: ${detail(result)}`;
          row.actionDetail = detail(result);
        }
      } else if (mode === "fix" && !apply) {
        row.action = "preview: cargo fix --workspace --all-targets --locked --offline";
      } else if (mode === "fix") {
        const result = run(
          "cargo",
          ["fix", "--workspace", "--all-targets", "--locked", "--offline"],
          dir,
        );
        row.action = result.code === 0 ? "cargo fix completed" : `error: ${detail(result)}`;
        row.actionDetail = detail(result);
      } else {
        const args = ["update", ...(apply ? [] : ["--dry-run"]), ...(online ? [] : ["--offline"])];
        const result = run("cargo", args, dir);
        row.action =
          result.code === 0
            ? apply
              ? "lockfile updated"
              : "update preview complete"
            : `error: ${detail(result)}`;
        row.actionDetail = detail(result);
        row.changes = updateChanges(result);
        if (apply && result.code === 0) {
          const check = run(
            "cargo",
            ["metadata", "--format-version", "1", "--locked", ...(online ? [] : ["--offline"])],
            dir,
          );
          row.resolution = check.code === 0 ? "valid" : `error: ${detail(check)}`;
        }
      }
    }
    rows.push(row);
  }
  let fullInventory: Record<string, unknown> | null = null;
  if (full) {
    const inventory = run("nu", [join(infra, "scripts", "scan-ui-crates.nu"), "--skip-ui"], infra);
    const count = (pattern: RegExp) => Number(pattern.exec(inventory.stdout)?.[1] ?? 0);
    fullInventory =
      inventory.code === 0
        ? {
            status: "complete",
            firstPartyCrates: count(/First-party crates across Aphrody repos: (\d+)/),
            copiedManifests: count(/Cargo package manifests under copied source: (\d+)/),
            identicalCopiedGroups: count(/Identical Rust source files across copied trees: (\d+)/),
          }
        : { status: "error", detail: detail(inventory) };
  }
  const output = {
    workspaceRoot: root,
    mode,
    apply,
    online,
    uiSkipped: true,
    registry: registry ? await registryVersion(registry) : null,
    fullInventory,
    repos: rows,
  };
  if (json) console.log(JSON.stringify(output, null, 2));
  else {
    for (const row of rows) console.log(`${row.repo}: ${JSON.stringify(row)}`);
    if (output.registry) console.log(`crates.io: ${JSON.stringify(output.registry)}`);
    if (output.fullInventory) console.log(`Nushell: ${JSON.stringify(output.fullInventory)}`);
  }
  if (
    rows.some(
      (row) =>
        row.metadataError ||
        row.machete === "error" ||
        row.audit === "error" ||
        String(row.updatePreview ?? "").startsWith("error:") ||
        String(row.action ?? "").startsWith("error:") ||
        (apply && String(row.action ?? "").startsWith("skipped:")) ||
        String(row.resolution ?? "").startsWith("error:"),
    ) ||
    output.registry?.status === "unknown" ||
    output.fullInventory?.status === "error"
  ) {
    process.exitCode = 1;
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
