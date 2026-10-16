// SPDX-License-Identifier: Apache-2.0
import { mkdir, readdir, realpath, stat } from "node:fs/promises";
import { basename, delimiter, dirname, extname, join, resolve } from "node:path";
import { homedir } from "node:os";

interface Entry {
  command: string[];
  executable: string;
  exitCode: number;
  timedOut: boolean;
  file: string;
}

interface SourceCli {
  runtime: "Rust" | "Bun";
  repo: string;
  owner: string;
  binary: string;
  manifest: string;
  entrypoint?: string;
  sourceExists: boolean;
  installed: string | null;
  parser?: string;
}

// Capability-owner contracts: these entry points consume a machine protocol or
// a protected service configuration. Invoking --help is not part of their ABI.
const PROTOCOL_HELPERS: Record<string, { kind: string; owner: string; reason: string }> = {
  "aphrody-canvas": {
    kind: "json-stdin-png-stdout",
    owner: "crates/ui/render/src/canvas_cli.rs",
    reason: "Canvas rendering subprocess; stdin is a JSON scene, stdout is PNG.",
  },
  "aphrody-host-service": {
    kind: "configured-service-entry",
    owner: "crates/os/kernel/core/src/host_service.rs",
    reason:
      "Native boot service; requires a protected absolute --config path and has no help mode.",
  },
};

async function sourceCliIndex(catalog: any, root: string): Promise<SourceCli[]> {
  const repositories = catalog.repos.filter((repo: any) =>
    ["aphrody", "iecode"].includes(repo.name),
  );
  const groups = await Promise.all(
    repositories.map(async (repo: any) => {
      const repoRoot = repo.name === "aphrody" ? root : join(dirname(root), repo.name);
      const rust: SourceCli[] = repo.crates.flatMap((crate: any) =>
        crate.bins.map((binary: string): SourceCli => {
          const cli = catalog.cli.find(
            (item: any) =>
              item.repo === repo.name && item.binary === binary && item.crate === crate.name,
          );
          return {
            runtime: "Rust",
            repo: repo.name,
            owner: crate.name,
            binary,
            manifest: join(repoRoot, crate.path, "Cargo.toml"),
            sourceExists: false,
            installed: Bun.which(binary),
            parser: cli?.source,
          };
        }),
      );
      await Promise.all(
        rust.map(async (entry) => {
          entry.sourceExists = await Bun.file(entry.manifest).exists();
        }),
      );
      const bun = (
        await Promise.all(
          repo.bunPackages.map(async (pkg: any): Promise<SourceCli[]> => {
            const manifest = join(repoRoot, pkg.path, "package.json");
            if (!(await Bun.file(manifest).exists())) {
              return pkg.bins.map((binary: string) => ({
                runtime: "Bun",
                repo: repo.name,
                owner: pkg.name,
                binary,
                manifest,
                sourceExists: false,
                installed: Bun.which(binary),
              }));
            }
            const current = await Bun.file(manifest).json();
            const bins =
              typeof current.bin === "string"
                ? { [current.name.split("/").at(-1)]: current.bin }
                : (current.bin ?? {});
            return Promise.all(
              Object.entries(bins).map(async ([binary, target]): Promise<SourceCli> => {
                const entrypoint = resolve(dirname(manifest), String(target));
                return {
                  runtime: "Bun",
                  repo: repo.name,
                  owner: current.name,
                  binary,
                  manifest,
                  entrypoint,
                  sourceExists: await Bun.file(entrypoint).exists(),
                  installed: Bun.which(binary),
                };
              }),
            );
          }),
        )
      ).flat();
      return rust.concat(bun);
    }),
  );
  return groups
    .flat()
    .toSorted((a, b) =>
      `${a.runtime}/${a.repo}/${a.binary}`.localeCompare(`${b.runtime}/${b.repo}/${b.binary}`),
    );
}

/** Read only command names advertised in a help section, never usage examples. */
export function helpCommands(help: string): string[] {
  const commands: string[] = [];
  let inCommands = false;
  let commandIndent: number | undefined;
  for (const line of help.split("\n")) {
    if (/^(?:Commands|Subcommands|Available commands):\s*$/i.test(line.trim())) {
      inCommands = true;
      commandIndent = undefined;
      continue;
    }
    if (inCommands && /^\S/.test(line)) inCommands = false;
    if (!inCommands) continue;
    const row = /^(\s{2,})([a-zA-Z][\w-]*)(?:\s{2,}|\s*$)/.exec(line);
    if (!row) continue;
    commandIndent ??= row[1]!.length;
    if (row[1]!.length === commandIndent && row[2] !== "help") commands.push(row[2]!);
  }
  return [...new Set(commands)];
}

export async function runCliHelp(
  args: string[],
  root = resolve(import.meta.dir, "../../../docs/aphrody"),
): Promise<number> {
  const usage =
    "yolo ops cli-help [--out <directory>] [--only <bin[,bin]>] [--no-recursive] [--max-pages N]";
  if (args.includes("--help")) {
    console.log(
      `Usage: ${usage}\nCapture installed first-party CLI --help; absent binaries are recorded.\n--only resolves only the named binaries through PATH.\n--no-recursive captures top-level help without invoking advertised subcommands.\nSelected captures default to a separate selected/<bins> directory; --out overrides it.`,
    );
    return 0;
  }
  let out = join(process.env.XDG_DATA_HOME ?? join(homedir(), ".local/share"), "aphrody/cli-help");
  let explicitOut = false;
  let only: string[] | undefined;
  let recursive = true;
  let maxPages = 2048;
  for (let i = 0; i < args.length; i++) {
    const option = args[i];
    if (option === "--no-recursive") {
      recursive = false;
      continue;
    }
    const value = args[i + 1];
    if (
      (option !== "--out" && option !== "--only" && option !== "--max-pages") ||
      !value ||
      value.startsWith("--")
    ) {
      throw new Error(`usage: ${usage}`);
    }
    i++;
    if (option === "--max-pages") {
      if (!/^\d+$/.test(value) || Number(value) < 1 || Number(value) > 10000) {
        throw new Error("--max-pages requires an integer from 1 to 10000");
      }
      maxPages = Number(value);
    } else if (option === "--out") {
      out = resolve(value);
      explicitOut = true;
    } else {
      if (only) throw new Error("--only may be specified once");
      const names = value.split(",");
      if (names.some((name) => !/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(name))) {
        throw new Error("--only requires comma-separated binary names, without paths");
      }
      only = [...new Set(names)].toSorted();
    }
  }
  if (only && !explicitOut) out = join(out, "selected", only.join(","));
  const catalog = await Bun.file(join(root, "docs/ecosystem/ecosystem.json")).json();
  const sourceCli = (await sourceCliIndex(catalog, root)).filter(
    (entry) => !only || only.includes(entry.binary),
  );
  const binaries = new Set<string>(
    only ?? ["aphrody", "bxc", "n2b", "nie", "niers", "inagle", "azalee"],
  );
  if (!only) {
    for (const cli of catalog.cli) binaries.add(cli.binary);
    for (const repo of catalog.repos) {
      for (const pkg of repo.bunPackages) for (const name of pkg.bins) binaries.add(name);
      for (const pkg of repo.pythonPackages) for (const name of pkg.scripts) binaries.add(name);
    }
    // Standalone native surfaces can be installed after the source catalog was generated.
    const pathDirectories = await Promise.allSettled(
      (process.env.PATH ?? "").split(delimiter).map((dir) => readdir(dir)),
    );
    for (const directory of pathDirectories) {
      if (directory.status !== "fulfilled") continue;
      for (const entry of directory.value) {
        const name = commandName(entry);
        if (/^aphrody-[a-z\d-]+$/.test(name)) binaries.add(name);
      }
    }
    // The retired summary executable treats --help as generation and rewrites
    // repository documentation. It is not a current capability to capture.
    binaries.delete("aphrody-summary");
  }
  const installed = [...binaries].toSorted().flatMap((binary) => {
    const executable = Bun.which(binary);
    return executable ? [{ binary, executable }] : [];
  });
  const missing = [...binaries].filter((binary) => !Bun.which(binary)).toSorted();
  const capturedAt = new Date().toISOString();
  const snapshot = join(out, capturedAt.replaceAll(/[:.]/g, "-"));
  await mkdir(snapshot, { recursive: true, mode: 0o700 });
  let entries: Entry[] = [];
  const unresolved: string[][] = [];
  const executableInfo = await Promise.all(
    installed.map(async ({ binary, executable }) => {
      const resolved = await realpath(executable);
      const info = await stat(resolved);
      return {
        binary,
        executable,
        realpath: resolved,
        size: info.size,
        mtime: info.mtime.toISOString(),
      };
    }),
  );
  const sensitiveValues = Object.entries(process.env)
    .filter(
      ([key, value]) =>
        /token|secret|password|api.?key|credential/i.test(key) && value && value.length >= 8,
    )
    .map(([, value]) => value!);
  const protocolHelpers = installed
    .filter(({ binary }) => PROTOCOL_HELPERS[binary])
    .map(({ binary, executable }) =>
      Object.assign({ binary, executable, status: "unsupported-help" }, PROTOCOL_HELPERS[binary]),
    );
  const queue = installed
    .filter(({ binary }) => !PROTOCOL_HELPERS[binary])
    .map(({ binary, executable }) => ({ command: [binary], executable }));
  const seen = new Set<string>();
  const helpByCommand = new Map<string, string>();
  const repeatedHelp: string[][] = [];
  while (queue.length && entries.length < maxPages) {
    const batch = queue.splice(0, Math.min(6, maxPages - entries.length));
    // Each bounded batch discovers the next level; the queue must finish in order.
    // oxlint-disable-next-line no-await-in-loop
    await Promise.all(
      batch.map(async ({ command, executable }) => {
        const key = command.join(" ");
        if (seen.has(key)) return;
        seen.add(key);
        const proc = Bun.spawn([executable, ...command.slice(1), "--help"], {
          windowsHide: true,
          cwd: root,
          stdin: "ignore",
          stdout: "pipe",
          stderr: "pipe",
          env: { ...process.env, NO_COLOR: "1", CLICOLOR: "0", TERM: "dumb" },
        });
        let timedOut = false;
        const timer = setTimeout(() => {
          timedOut = true;
          proc.kill("SIGKILL");
        }, 15_000);
        const [stdout, stderr, exitCode] = await Promise.all([
          new Response(proc.stdout).text(),
          new Response(proc.stderr).text(),
          proc.exited,
        ]);
        clearTimeout(timer);
        let help = Bun.stripANSI([stdout, stderr].filter(Boolean).join("\n"));
        for (const value of sensitiveValues) help = help.replaceAll(value, "[REDACTED]");
        const file = `${command.join("__")}.txt`;
        await Bun.write(join(snapshot, file), help);
        entries.push({ command, executable, exitCode, timedOut, file });
        if (timedOut || exitCode !== 0 || !recursive) return;
        helpByCommand.set(key, help);
        for (let length = 1; length < command.length; length++) {
          if (helpByCommand.get(command.slice(0, length).join(" ")) === help) {
            repeatedHelp.push(command);
            return;
          }
        }
        const children = helpCommands(help);
        if (command.length >= 8 && children.length) {
          unresolved.push(command);
          return;
        }
        for (const child of children) queue.push({ command: [...command, child], executable });
      }),
    );
    if (entries.length % 50 < 6)
      console.error(`CLI help: ${entries.length} captured, ${queue.length} pending`);
  }
  unresolved.push(...queue.map(({ command }) => command));
  entries = entries.toSorted((a, b) => a.command.join(" ").localeCompare(b.command.join(" ")));
  const failed = entries.filter((entry) => entry.exitCode !== 0 || entry.timedOut);
  const manifest = {
    schemaVersion: 1,
    capturedAt,
    platform: process.platform,
    sourceCommit: await gitHead(root),
    capture: { binaries: only ?? null, recursive },
    installed: executableInfo,
    missing,
    unresolved,
    repeatedHelp,
    traversalLimits: { maxPages, maxDepth: 8 },
    sourceCli,
    protocolHelpers,
    entries,
  };
  await Bun.write(join(snapshot, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  const lines = [
    "# Installed CLI help",
    "",
    `Captured ${capturedAt} on ${process.platform}.`,
    "",
    `${installed.length} installed binaries; ${entries.length} help pages; ${failed.length} failures/timeouts; ${missing.length} absent binaries.`,
    "",
    `Regenerate: \`bun run cli:help${only ? ` --only ${only.join(",")}` : ""}${recursive ? "" : " --no-recursive"}\`. Source trees: \`docs/ecosystem/CLI.md\`.`,
    "",
    recursive
      ? "Only advertised subcommands are traversed; every invocation ends with `--help`."
      : "Only top-level help is captured; advertised subcommands are not invoked.",
    "",
    "## Rust CLI sources (including NIE / IECODE)",
    "",
    "All catalogued Cargo binary declarations are listed, including helpers without a clap command tree. No Cargo builds are started.",
    "",
    "| Repository | Crate | Binary | Local manifest | Status | Clap parser |",
    "| --- | --- | --- | --- | --- | --- |",
    ...sourceCli
      .filter((entry) => entry.runtime === "Rust")
      .map(
        (entry) =>
          `| ${entry.repo} | \`${entry.owner}\` | \`${entry.binary}\` | [Cargo.toml](${entry.manifest}) | ${entry.installed ? "installed" : entry.sourceExists ? "source only" : "source absent"} | ${entry.parser ? `\`${entry.parser}\`` : "not catalogued"} |`,
      ),
    "",
    "## Bun CLI sources",
    "",
    "Current package.json bin entrypoints are read directly from the owning checkout. Source existence does not prove successful execution; no source CLI is launched as a fallback.",
    "",
    "| Repository | Package | CLI | Entrypoint | Status |",
    "| --- | --- | --- | --- | --- |",
    ...sourceCli
      .filter((entry) => entry.runtime === "Bun")
      .map(
        (entry) =>
          `| ${entry.repo} | \`${entry.owner}\` | \`${entry.binary}\` | ${entry.entrypoint ? `[source](${entry.entrypoint})` : `[package.json](${entry.manifest})`} | ${entry.installed ? "installed" : entry.sourceExists ? "source only" : "entrypoint absent"} |`,
      ),
    "",
    "## Captured commands",
    "",
    "| Command | Result | Help |",
    "| --- | --- | --- |",
    ...entries.map(
      (entry) =>
        `| \`${entry.command.join(" ")} --help\` | ${entry.timedOut ? "timeout" : entry.exitCode === 0 ? "ok" : `exit ${entry.exitCode}`} | [text](${basename(snapshot)}/${entry.file}) |`,
    ),
    "",
    "## Absent binaries",
    "",
    ...missing.map((name) => `- \`${name}\``),
    "",
    "## Traversal limits",
    "",
    ...unresolved.map((command) => `- \`${command.join(" ")}\`: depth or page limit reached`),
    "",
    "## Repeated ancestor help",
    "",
    "These invocations return the same help as an ancestor; their advertised children are not traversed again.",
    ...repeatedHelp.map((command) => `- \`${command.join(" ")}\``),
    "",
    "## Protocol helpers without a human help mode",
    "",
    ...protocolHelpers.map(
      (helper) =>
        `- \`${helper.binary}\`: unsupported-help (${helper.kind}); ${helper.reason} Owner: \`${helper.owner}\`. Not invoked by this collector.`,
    ),
    "",
  ];
  await Bun.write(join(out, "INDEX.md"), lines.join("\n"));
  await Bun.write(
    join(out, "latest.json"),
    `${JSON.stringify({ snapshot, capturedAt, installed: installed.length, pages: entries.length, failures: failed.length, missing: missing.length, unresolved: unresolved.length, rustSources: sourceCli.filter((entry) => entry.runtime === "Rust").length, bunSources: sourceCli.filter((entry) => entry.runtime === "Bun").length }, null, 2)}\n`,
  );
  console.log(
    JSON.stringify({
      index: join(out, "INDEX.md"),
      installed: installed.length,
      pages: entries.length,
      failures: failed.length,
      missing: missing.length,
      unresolved: unresolved.length,
    }),
  );
  if (only) return missing.length === 0 && failed.length === 0 && unresolved.length === 0 ? 0 : 1;
  return failed.length === 0 &&
    unresolved.length === 0 &&
    entries.some(
      (entry) =>
        entry.command.length === 1 && entry.command[0] === "aphrody" && entry.exitCode === 0,
    )
    ? 0
    : 1;
}

/** PATH entry name as a command: Windows launchers drop their PATHEXT extension (`aphrody-x.exe` is `aphrody-x`). */
function commandName(entry: string): string {
  if (process.platform !== "win32") return entry;
  const extension = extname(entry).toLowerCase();
  const executable = (process.env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD")
    .toLowerCase()
    .split(";")
    .includes(extension);
  return extension && executable ? entry.slice(0, -extension.length) : entry;
}

async function gitHead(root: string): Promise<string> {
  if (!Bun.which("git")) return "unknown";
  const proc = Bun.spawn(["git", "rev-parse", "HEAD"], {
    windowsHide: true,
    cwd: root,
    stdout: "pipe",
    stderr: "ignore",
  });
  const head = (await new Response(proc.stdout).text()).trim();
  return (await proc.exited) === 0 ? head : "unknown";
}
