// SPDX-License-Identifier: Apache-2.0
/* eslint-disable no-await-in-loop -- Repository scans are bounded; deletion gates are deliberately sequential. */
// Run on vps: sudo -n /home/ubuntu/.bun/bin/bun vps-bun-cleanup.ts
// Default: inventory and plan only. --apply PLAN --sha256 HASH applies exact entries.
import {
  readdirSync,
  readFileSync,
  readlinkSync,
  lstatSync,
  realpathSync,
  mkdirSync,
  rmSync,
  existsSync,
  openSync,
  closeSync,
  writeSync,
} from "node:fs";
import { join, dirname } from "node:path";
import { hostname } from "node:os";

const home = "/home/ubuntu";
const args = Bun.argv.slice(2);
// Retained CDN assets are summarized without traversing millions of leaf directories.
const retainedAssetTrees = [
  `${home}/build/apps/cdn-src/material-design-icons`,
  `${home}/apps/cdn-src/material-design-icons`,
  `${home}/.rustup`,
  `${home}/.cargo/registry`,
  `${home}/build/cargo/registry`,
  `${home}/.bun/install/cache`,
  `${home}/.bun/build-cache`,
  `${home}/build/cache`,
  `${home}/build/fork-target`,
  `${home}/build/linux-aphrody-7.2`,
  `${home}/build/linux-wsl-7.2`,
  `${home}/build/linux-wsl-7.2-arm64`,
];
const option = (name: string): string => {
  const value = args[args.indexOf(name) + 1];
  if (value === undefined || value.startsWith("--")) throw new Error(`${name} requires a value.`);
  return value;
};
const output = args.includes("--out")
  ? option("--out")
  : `${home}/.local/share/aphrody/infra/bun-cleanup-${Date.now()}`;
const protectedRoots = [
  "src",
  "apps",
  ".aphrody",
  ".codex",
  ".claude",
  ".ssh",
  ".aws",
  ".docker",
  ".config",
  ".cargo",
  ".rustup",
  ".bun",
  ".cache",
  ".deploy-secrets",
  ".postgres-mcp",
  ".mullvad-wg",
  ".nginx-snapshots",
  "Documents",
  "artifacts",
  "forks",
  "bin",
  ".local",
  "var",
  "builds/bun-browser-fusion",
  "builds/bun-os-obscura",
  "builds/bun-os-factory",
  "builds/bun-browser-transfer",
  "builds/bun-release-1.4.4-20261010",
  "build/locks",
  "build/cache",
  "build/cargo",
  "build/fork-target",
  "build/apps",
  "build/artifacts",
  "build/archive",
  "build/workspaces",
  "build/tools-build",
  "build/xmsvc",
].map(path => join(home, path));
const within = (path: string, root: string) => path === root || path.startsWith(`${root}/`);
const overlaps = (a: string, b: string) => within(a, b) || within(b, a);
const digest = (text: string) => new Bun.CryptoHasher("sha256").update(text).digest("hex");
const sanitizeRemote = (value: string) =>
  value.replace(/([a-z][a-z0-9+.-]*:\/\/)[^/@\s]+@/gi, "$1[redacted]@").replace(/[?#].*$/, "");

async function command(argv: string[], seconds = 60) {
  const child = Bun.spawn(["timeout", "--signal=TERM", "--kill-after=3", `${seconds}s`, ...argv], {
    stdout: "pipe",
    stderr: "pipe",
    env: {
      ...process.env,
      GIT_OPTIONAL_LOCKS: "0",
      GIT_TERMINAL_PROMPT: "0",
    },
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  return { exitCode, stdout, stderr };
}

function processes() {
  const rows: {
    pid: number;
    name: string;
    cwd: string | null;
    exe: string | null;
    references: string[];
  }[] = [];
  const failures: string[] = [];
  for (const pid of readdirSync("/proc").filter(name => /^\d+$/.test(name))) {
    const root = `/proc/${pid}`;
    try {
      const references: string[] = [];
      const link = (part: string) => {
        try {
          const value = readlinkSync(join(root, part));
          references.push(value);
          return value;
        } catch (error) {
          if ((error as { code?: string }).code !== "ENOENT") failures.push(`${pid}:${part}`);
          return null;
        }
      };
      const cwd = link("cwd");
      const exe = link("exe");
      for (const fd of readdirSync(join(root, "fd"))) link(`fd/${fd}`);
      // Used privately for isolation checks, never exported: these can contain secrets.
      for (const file of ["cmdline", "environ"]) {
        const fields = readFileSync(join(root, file), "utf8").split("\0");
        for (const field of fields) {
          for (const match of field.matchAll(/\/home\/ubuntu\/[^\s\0'";]+/g)) references.push(match[0]);
        }
      }
      rows.push({
        pid: Number(pid),
        name: readFileSync(join(root, "comm"), "utf8").trim(),
        cwd,
        exe,
        references,
      });
    } catch (error) {
      if (!["ENOENT", "ESRCH"].includes((error as { code?: string }).code ?? "")) failures.push(`${pid}:inspection`);
    }
  }
  return { rows, failures };
}

let filesystemScan: Promise<{ exitCode: number; stderr: string; directories: number }> | undefined;
async function scanFilesystem() {
  const directoriesFd = openSync(join(output, "directories.nul"), "w", 0o644);
  const markersFd = openSync(join(output, "git-markers.nul"), "w", 0o644);
  const indexDirectories = new Set<string>();
  const failures: string[] = [];
  const seen = new Set<string>();
  const generated = new Set(["node_modules", "target", ".next", ".next-build", "__pycache__", ".git"]);
  const stack = [home, `${home}/build`].map(path => ({
    path,
    device: lstatSync(path).dev,
    depth: 0,
  }));
  const started = Date.now();
  let directories = 0;
  try {
    while (stack.length) {
      if (Date.now() - started > 600_000) {
        failures.push("Scan deadline reached");
        break;
      }
      const item = stack.pop()!;
      try {
        const stat = lstatSync(item.path);
        if (stat.isSymbolicLink() || !stat.isDirectory()) continue;
        writeSync(directoriesFd, `${item.path}\0`);
        const identity = `${stat.dev}:${stat.ino}`;
        if (stat.dev !== item.device || seen.has(identity)) continue;
        seen.add(identity);
        directories++;
        const marker = join(item.path, ".git");
        if (existsSync(marker)) {
          writeSync(markersFd, `${marker}\0`);
          // Git indexes enumerate source trees without millions of filesystem metadata reads.
          const index = await command(
            [
              "git",
              "-c",
              `safe.directory=${item.path}`,
              "-c",
              "core.fsmonitor=false",
              "-c",
              "core.hooksPath=/dev/null",
              "-C",
              item.path,
              "ls-files",
              "--stage",
              "-z",
            ],
            25,
          );
          if (index.exitCode !== 0) failures.push(`Git index inaccessible: ${item.path}`);
          for (const record of index.stdout.split("\0").filter(Boolean)) {
            const tab = record.indexOf("\t");
            if (tab < 0) continue;
            const name = record.slice(tab + 1);
            const path = join(item.path, name);
            if (!within(path, item.path)) continue;
            if (record.startsWith("160000 ") && existsSync(path))
              stack.push({ path, device: item.device, depth: item.depth + 1 });
            let relative = dirname(name);
            while (relative !== "." && relative !== "/") {
              indexDirectories.add(join(item.path, relative));
              relative = dirname(relative);
            }
          }
          continue;
        }
        if (
          retainedAssetTrees.includes(item.path) ||
          generated.has(item.path.split("/").at(-1)!) ||
          (args.includes("--summary") && item.depth >= 7)
        )
          continue;
        for (const entry of readdirSync(item.path, { withFileTypes: true })) {
          if (entry.isDirectory() && !entry.isSymbolicLink())
            stack.push({
              path: join(item.path, entry.name),
              device: item.device,
              depth: item.depth + 1,
            });
        }
        if (directories % 256 === 0) await Bun.sleep(0);
      } catch (error) {
        failures.push(`${item.path}: ${(error as { code?: string }).code ?? "inspection failed"}`);
      }
    }
  } finally {
    closeSync(directoriesFd);
    closeSync(markersFd);
  }
  await Bun.write(join(output, "indexed-directories.nul"), [...indexDirectories].join("\0") + "\0");
  return {
    exitCode: failures.length ? 1 : 0,
    stderr: failures.join("\n"),
    directories,
  };
}
async function exportFind(file: string) {
  filesystemScan ??= scanFilesystem();
  return { file, ...(await filesystemScan) };
}

async function inventory() {
  if (!within(output, `${home}/.local/share/aphrody/infra`) || output.includes("/../"))
    throw new Error("Inventory reports must remain in the declared Infra store.");
  mkdirSync(output, { recursive: true, mode: 0o700 });
  if (realpathSync(output) !== output) throw new Error("Report directory is not canonical.");
  console.log(`Inventory: ${output}`);
  const [gitScan, directoryScan, mounts, services, usage, ps, containers, sessions] = await Promise.all([
    exportFind("git-markers.nul"),
    exportFind("directories.nul"),
    command(["findmnt", "--json", "--output", "TARGET,SOURCE,FSTYPE"]),
    command(["systemctl", "list-units", "--type=service", "--state=running", "--no-legend", "--no-pager"]),
    command(["du", "-x", "-B1", "--max-depth=1", "--", home], 180),
    command(["ps", "-eo", "pid,ppid,user,comm,pcpu,pmem,etimes", "--sort=-pmem"]),
    command(["docker", "ps", "--format", "{{.ID}}\t{{.Names}}\t{{.Image}}"]),
    command(["tmux", "list-sessions"]),
  ]);
  const shallow = await command([
    "find",
    "-P",
    `${home}/src`,
    `${home}/build/work`,
    `${home}/build/workspaces`,
    "-maxdepth",
    "5",
    "-name",
    ".git",
    "-print0",
    "-prune",
  ]);
  const markers = [
    ...new Set(
      ((await Bun.file(join(output, gitScan.file)).text()) + shallow.stdout)
        .split("\0")
        .filter(Boolean)
        .concat(retainedAssetTrees.map(path => join(path, ".git")).filter(existsSync)),
    ),
  ];
  const repositories = [];
  for (const marker of markers) {
    const path = dirname(marker);
    const git = (rest: string[]) =>
      command(
        [
          "git",
          "-c",
          `safe.directory=${path}`,
          "-c",
          "core.fsmonitor=false",
          "-c",
          "core.hooksPath=/dev/null",
          "-C",
          path,
          ...rest,
        ],
        25,
      );
    const [head, branch, status, remotes, refs, worktrees] = await Promise.all([
      git(["rev-parse", "HEAD"]),
      git(["branch", "--show-current"]),
      git(["status", "--porcelain=v1", "-z", "--untracked-files=normal"]),
      git(["remote", "-v"]),
      git(["for-each-ref", "--format=%(refname) %(objectname) %(upstream:track)"]),
      git(["worktree", "list", "--porcelain"]),
    ]);
    repositories.push({
      path,
      identity: `${lstatSync(marker).dev}:${lstatSync(marker).ino}`,
      head: head.stdout.trim(),
      branch: branch.stdout.trim(),
      statusExitCode: status.exitCode,
      metadataExitCodes: {
        head: head.exitCode,
        branch: branch.exitCode,
        remotes: remotes.exitCode,
        refs: refs.exitCode,
        worktrees: worktrees.exitCode,
      },
      dirty: status.exitCode === 0 ? status.stdout.length > 0 : null,
      changedEntries: status.stdout.split("\0").filter(Boolean).length,
      remotes: remotes.stdout.split("\n").map(sanitizeRemote),
      refs: refs.stdout,
      worktrees: worktrees.stdout,
      preserved: true,
    });
  }
  const proc = processes();
  const directories = readdirSync(home).map(name => {
    const path = join(home, name);
    const stat = lstatSync(path);
    return {
      path,
      kind: stat.isSymbolicLink() ? "symlink" : stat.isDirectory() ? "directory" : "file",
      target: stat.isSymbolicLink() ? readlinkSync(path) : undefined,
      disposition: protectedRoots.some(root => overlaps(path, root)) ? "preserve" : "needs-owner-classification",
    };
  });
  const report = {
    schema: "aphrody.bun-cleanup/1",
    host: "vps",
    home,
    observedAt: new Date().toISOString(),
    apply: false,
    coverage: args.includes("--summary") ? "bounded-depth-summary" : "recursive-filesystem-scan",
    directories,
    repositories,
    protectedRoots,
    retainedAssetTrees,
    gitScan,
    directoryScan,
    shallowScan: { exitCode: shallow.exitCode, stderr: shallow.stderr },
    mounts,
    services,
    usage,
    ps,
    containers,
    sessions,
    processes: proc.rows.map(({ references: _privateReferences, ...row }) => row),
    processInspectionFailures: proc.failures,
    limitations: [
      "Symlink destinations outside home are retained, not recursively scanned.",
      "Bind aliases src/apps reuse build/workspaces and build/apps; the underlying filesystem is scanned once.",
      "Retained assets, installed toolchains and registry/prebuilt caches are summarized; nested Git repositories inside those retained trees are not discovered.",
      "Generated target, node_modules, Next.js caches and Python bytecode are retained as directory summaries; nested dependency checkouts are not traversed.",
      "Source directories inside Git checkouts come from Git indexes, not a physical leaf traversal; registered submodules are inspected, unregistered nested clones inside checkouts are retained but not discovered.",
      "Directories on mounted filesystems are inventoried; all mounts are protected during apply.",
      "Git status failures and incomplete scans prohibit apply.",
      "No processes or services are stopped; no dependency caches are purged.",
    ],
  };
  await Bun.write(join(output, "inventory.json"), JSON.stringify(report, null, 2));
  const plan = {
    schema: "aphrody.bun-cleanup-plan/1",
    home,
    inventoryFile: join(output, "inventory.json"),
    inventorySha256: digest(JSON.stringify(report)),
    observedAt: report.observedAt,
    entries: [],
    note: "Exact retired output paths require owner classification. Never delete the complement of a keep list.",
  };
  await Bun.write(join(output, "plan.json"), JSON.stringify(plan, null, 2));
  console.log(
    JSON.stringify({
      output,
      repositories: repositories.length,
      dirty: repositories.filter(repo => repo.dirty).length,
      unknown: repositories.filter(repo => repo.dirty === null).length,
      directories: directories.filter(entry => entry.kind === "directory").length,
      processes: proc.rows.length,
      scanComplete: gitScan.exitCode === 0 && directoryScan.exitCode === 0,
      removed: 0,
    }),
  );
}

async function apply() {
  if (process.getuid?.() !== 0) throw new Error("Apply requires privileged process inspection through sudo -n.");
  const planFile = option("--apply");
  if (
    !within(planFile, `${home}/.local/share/aphrody/infra`) ||
    realpathSync(planFile) !== planFile ||
    !lstatSync(planFile).isFile() ||
    !planFile.endsWith("/plan.json")
  )
    throw new Error("Invalid Infra plan file.");
  const raw = await Bun.file(planFile).text();
  if (!args.includes("--sha256") || digest(raw) !== option("--sha256")) throw new Error("Reviewed plan hash mismatch.");
  const plan = JSON.parse(raw);
  if (plan.schema !== "aphrody.bun-cleanup-plan/1" || plan.home !== home || !Array.isArray(plan.entries))
    throw new Error("Invalid plan.");
  if (
    typeof plan.inventoryFile !== "string" ||
    !within(plan.inventoryFile, `${home}/.local/share/aphrody/infra`) ||
    realpathSync(plan.inventoryFile) !== plan.inventoryFile
  )
    throw new Error("Invalid inventory reference.");
  const inventoryReceipt = JSON.parse(await Bun.file(plan.inventoryFile).text());
  if (
    digest(JSON.stringify(inventoryReceipt)) !== plan.inventorySha256 ||
    inventoryReceipt.host !== "vps" ||
    inventoryReceipt.home !== home ||
    inventoryReceipt.gitScan.exitCode !== 0 ||
    inventoryReceipt.directoryScan.exitCode !== 0 ||
    inventoryReceipt.shallowScan.exitCode !== 0 ||
    inventoryReceipt.repositories.some(
      (repo: { statusExitCode: number; metadataExitCodes?: Record<string, number> }) =>
        repo.statusExitCode !== 0 ||
        !repo.metadataExitCodes ||
        Object.values(repo.metadataExitCodes).some(code => code !== 0),
    ) ||
    Math.abs(Date.now() - Date.parse(inventoryReceipt.observedAt)) > 1_800_000 ||
    !Number.isFinite(Date.parse(inventoryReceipt.observedAt))
  )
    throw new Error("Inventory is incomplete, stale, or changed; apply refused.");
  if (
    plan.entries.some((entry: { path: string }, index: number) =>
      plan.entries.some(
        (other: { path: string }, otherIndex: number) => index !== otherIndex && overlaps(entry.path, other.path),
      ),
    )
  )
    throw new Error("Overlapping cleanup entries are forbidden.");
  // Serialize against the declared Bun factory, not a competing build lock.
  if (!args.includes("--locked")) {
    const lock = `${home}/build/locks/heavy.lock`;
    if (!existsSync(lock)) throw new Error("Declared factory lock is absent.");
    const child = Bun.spawn(
      ["flock", "--exclusive", "--nonblock", lock, process.execPath, Bun.argv[1]!, ...args, "--locked"],
      { stdout: "inherit", stderr: "inherit" },
    );
    process.exit(await child.exited);
  }
  const mounts = readFileSync("/proc/self/mountinfo", "utf8")
    .split("\n")
    .map(line =>
      line.split(" ")[4]?.replace(/\\([0-7]{3})/g, (_match, octal) => String.fromCharCode(parseInt(octal, 8))),
    )
    .filter(Boolean) as string[];
  const docker = await command(["docker", "ps", "-q"]);
  if (docker.exitCode !== 0) throw new Error("Cannot inspect live containers.");
  const ids = docker.stdout.trim().split(/\s+/).filter(Boolean);
  const inspection = ids.length ? await command(["docker", "inspect", ...ids]) : { exitCode: 0, stdout: "[]" };
  if (inspection.exitCode !== 0) throw new Error("Cannot inspect container mounts.");
  const binds: string[] = JSON.parse(inspection.stdout).flatMap((container: { Mounts: { Source: string }[] }) =>
    container.Mounts.map(mount => mount.Source),
  );
  // Validate the entire batch before deleting even the first item.
  for (const entry of plan.entries) {
    const path = entry.path;
    if (
      typeof path !== "string" ||
      !within(path, home) ||
      path === home ||
      realpathSync(path) !== path ||
      lstatSync(path).isSymbolicLink()
    )
      throw new Error("Unsafe path.");
    if (entry.kind !== "retired-build-output" || !entry.reason || !entry.terminalReceipt)
      throw new Error("Only explicitly retired outputs with terminal evidence may be removed.");
    if (protectedRoots.some(root => overlaps(path, root)) || overlaps(path, output))
      throw new Error(`Protected: ${path}`);
    if (!within(path, `${home}/build`) && !within(path, `${home}/builds`))
      throw new Error(`Outside declared build roots: ${path}`);
    if (mounts.some(mount => within(mount, path)) || binds.some(bind => overlaps(path, bind)))
      throw new Error(`Mounted or container-used: ${path}`);
    const scan = await command([
      "find",
      "-P",
      path,
      "(",
      "-name",
      ".git",
      "-o",
      "-name",
      "Cargo.toml",
      "-o",
      "-name",
      "package.json",
      "-o",
      "-name",
      "*.sqlite*",
      "-o",
      "-name",
      "*.db",
      "-o",
      "-name",
      "*.safetensors",
      ")",
      "-print",
      "-quit",
    ]);
    if (scan.exitCode !== 0 || scan.stdout) throw new Error(`Source or protected payload: ${path}`);
    if (
      typeof entry.terminalReceipt !== "string" ||
      ![
        `${home}/build/artifacts`,
        `${home}/builds/bun-os-factory/artifacts`,
        `${home}/.local/share/aphrody/infra`,
      ].some(root => within(entry.terminalReceipt, root)) ||
      realpathSync(entry.terminalReceipt) !== entry.terminalReceipt ||
      !lstatSync(entry.terminalReceipt).isFile()
    )
      throw new Error("Terminal receipt must be a regular canonical file in the Infra artifact store.");
    const terminal = JSON.parse(await Bun.file(entry.terminalReceipt).text());
    if (
      within(realpathSync(entry.terminalReceipt), path) ||
      !Number.isFinite(Date.parse(terminal.finishedAt)) ||
      terminal.exitCode !== 0 ||
      terminal.outputPath !== path
    )
      throw new Error("Missing successful terminal receipt retained outside output.");
    const proc = processes();
    if (
      proc.failures.length ||
      proc.rows.some(row => row.references.some(ref => within(ref.replace(/ \(deleted\)$/, ""), path)))
    )
      throw new Error(`Active or inaccessible process: ${path}`);
  }
  for (const entry of plan.entries) {
    // Revalidate activity and canonical identity immediately before removal.
    const proc = processes();
    if (
      realpathSync(entry.path) !== entry.path ||
      proc.failures.length ||
      proc.rows.some(row => row.references.some(ref => within(ref, entry.path)))
    )
      throw new Error("Concurrent use; stopping cleanup.");
    rmSync(entry.path, { recursive: true });
    console.log(JSON.stringify({ removed: entry.path, reason: entry.reason }));
  }
}

if (process.platform !== "linux" || hostname() !== "vps-203bea89" || !existsSync(home))
  throw new Error("This script is for the declared VPS Ubuntu home only.");
if (args.includes("--apply")) await apply();
else await inventory();
