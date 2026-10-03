// SPDX-License-Identifier: Apache-2.0
import { mkdir, readdir, realpath, stat } from "node:fs/promises";
import { delimiter, join, resolve } from "node:path";
import { homedir } from "node:os";

interface Entry {
  command: string[];
  executable: string;
  exitCode: number;
  timedOut: boolean;
  file: string;
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
  root = resolve(import.meta.dir, "../../../.."),
): Promise<number> {
  if (args.includes("--help")) {
    console.log(
      "Usage: aphrody-ops cli-help [--out <directory>]\nCapture installed first-party CLI --help recursively; absent binaries are recorded.",
    );
    return 0;
  }
  let out = join(process.env.XDG_DATA_HOME ?? join(homedir(), ".local/share"), "aphrody/cli-help");
  for (let i = 0; i < args.length; i++) {
    if (args[i] !== "--out" || !args[i + 1]) throw new Error("usage: cli-help [--out <directory>]");
    out = resolve(args[++i]!);
  }
  const catalog = await Bun.file(join(root, "docs/ecosystem/ecosystem.json")).json();
  const binaries = new Set<string>(["aphrody", "bxc", "n2b", "nie", "niers", "inagle", "azalee"]);
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
    for (const name of directory.value) if (/^aphrody-[a-z\d-]+$/.test(name)) binaries.add(name);
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
  const queue = installed.map(({ binary, executable }) => ({ command: [binary], executable }));
  const seen = new Set<string>();
  while (queue.length) {
    const batch = queue.splice(0, 6);
    // Each bounded batch discovers the next level; the queue must finish in order.
    // oxlint-disable-next-line no-await-in-loop
    await Promise.all(
      batch.map(async ({ command, executable }) => {
        const key = command.join(" ");
        if (seen.has(key)) return;
        seen.add(key);
        const proc = Bun.spawn([executable, ...command.slice(1), "--help"], {
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
        if (timedOut || exitCode !== 0) return;
        const children = helpCommands(help);
        if (command.length >= 12 && children.length) {
          unresolved.push(command);
          return;
        }
        for (const child of children) queue.push({ command: [...command, child], executable });
      }),
    );
    if (entries.length % 50 < 6)
      console.error(`CLI help: ${entries.length} captured, ${queue.length} pending`);
  }
  entries = entries.toSorted((a, b) => a.command.join(" ").localeCompare(b.command.join(" ")));
  const failed = entries.filter((entry) => entry.exitCode !== 0 || entry.timedOut);
  const manifest = {
    schemaVersion: 1,
    capturedAt,
    platform: process.platform,
    sourceCommit: await gitHead(root),
    installed: executableInfo,
    missing,
    unresolved,
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
    "Regenerate: `bun run cli:help`. Source trees: `docs/ecosystem/CLI.md`.",
    "",
    "Only advertised subcommands are traversed; every invocation ends with `--help`.",
    "",
    "## Captured commands",
    "",
    "| Command | Result | Help |",
    "| --- | --- | --- |",
    ...entries.map(
      (entry) =>
        `| \`${entry.command.join(" ")} --help\` | ${entry.timedOut ? "timeout" : entry.exitCode === 0 ? "ok" : `exit ${entry.exitCode}`} | [text](${snapshot.split("/").at(-1)}/${entry.file}) |`,
    ),
    "",
    "## Absent binaries",
    "",
    ...missing.map((name) => `- \`${name}\``),
    "",
    "## Traversal limits",
    "",
    ...unresolved.map((command) => `- \`${command.join(" ")}\`: depth limit reached`),
    "",
  ];
  await Bun.write(join(out, "INDEX.md"), lines.join("\n"));
  await Bun.write(
    join(out, "latest.json"),
    `${JSON.stringify({ snapshot, capturedAt, installed: installed.length, pages: entries.length, failures: failed.length, missing: missing.length, unresolved: unresolved.length }, null, 2)}\n`,
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
  return entries.some(
    (entry) => entry.command.length === 1 && entry.command[0] === "aphrody" && entry.exitCode === 0,
  )
    ? 0
    : 1;
}

async function gitHead(root: string): Promise<string> {
  const proc = Bun.spawn(["git", "rev-parse", "HEAD"], {
    cwd: root,
    stdout: "pipe",
    stderr: "ignore",
  });
  const head = (await new Response(proc.stdout).text()).trim();
  return (await proc.exited) === 0 ? head : "unknown";
}
