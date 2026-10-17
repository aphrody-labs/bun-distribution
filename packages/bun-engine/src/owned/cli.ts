// bep commands for the owner's private dumps (see docs/bun-engine/OWNED-DUMPS.md).
import { checkStaged, installHook } from "./guard";
import { runInbox } from "./inbox";
import { testOwned } from "./runner";
import { describe, ingestPaths, listOwned, type OwnedKind, ownedBySha, removeOwned } from "./store";
import { defaultTarget, deleteRemote, openTarget, pullDump, pushDump } from "./vault";
import { syncVps } from "./vps";

export const ownedUsage = [
  "bep import <file|dir|archive...> [--system <id>]",
  "bep owned ls [--kind firmware|rom|keys] [--system <id>] | rm <sha...> | inbox [--watch] [--system <id>]",
  `bep owned push [<sha...>|--all] [--to ${defaultTarget}|r2:private/<prefix>|file:<dir>] [--part-size <bytes>] [--limit <bytes/s>]`,
  "bep owned pull <sha> <file> [--from <target>] [--limit <bytes/s>] | forget <sha...> [--from <target>]",
  "bep owned sync vps [<sha...>] [--limit 4M] [--keys] [--system <id>] [--prune] [--host vps] [--root /games/private]",
  "bep owned hook | guard",
  "bep test owned [<sha...>] [--system <id>] [--frames N] [--timeout <ms>] [--no-roms] [--no-bios]",
];

function parse(args: string[]): { positional: string[]; flags: Map<string, string | true> } {
  const positional: string[] = [];
  const flags = new Map<string, string | true>();
  const valued = new Set([
    "--system",
    "--kind",
    "--to",
    "--from",
    "--part-size",
    "--limit",
    "--host",
    "--root",
    "--frames",
    "--timeout",
  ]);
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (valued.has(arg)) {
      const value = args[++i];
      if (value === undefined) throw new Error(`${arg} needs a value`);
      flags.set(arg, value);
    } else if (arg.startsWith("--")) flags.set(arg, true);
    else positional.push(arg);
  }
  return { positional, flags };
}

/** "4M", "512k", "1G" or plain bytes. */
export function parseBytes(value: string): number {
  const match = /^(\d+(?:\.\d+)?)\s*([kmg]?)i?b?$/i.exec(value.trim());
  if (!match) throw new Error(`not a size: ${value}`);
  const scale = { "": 1, k: 1024, m: 1024 ** 2, g: 1024 ** 3 }[match[2]!.toLowerCase() as "" | "k" | "m" | "g"];
  return Math.round(Number(match[1]) * scale);
}

function print(value: unknown): number {
  console.log(JSON.stringify(value, null, 2));
  return 0;
}

function text(flags: Map<string, string | true>, name: string): string | undefined {
  const value = flags.get(name);
  return typeof value === "string" ? value : undefined;
}

function limitOf(flags: Map<string, string | true>): number {
  const value = text(flags, "--limit");
  return value ? parseBytes(value) : 0;
}

export async function runImport(args: string[]): Promise<number> {
  const { positional, flags } = parse(args);
  if (!positional.length) throw new Error(`usage: ${ownedUsage[0]}`);
  const results = await ingestPaths(positional, { system: text(flags, "--system"), via: "cli" });
  print(results);
  return results.some(result => result.error) ? 1 : 0;
}

export async function runTestOwned(args: string[]): Promise<number> {
  const { positional, flags } = parse(args);
  const frames = text(flags, "--frames");
  const timeout = text(flags, "--timeout");
  const { report, results } = await testOwned({
    only: positional,
    system: text(flags, "--system"),
    frames: frames ? Number(frames) : undefined,
    timeoutMs: timeout ? Number(timeout) : undefined,
    roms: !flags.has("--no-roms"),
    bios: !flags.has("--no-bios"),
  });
  print({
    report,
    results: results.map(({ detail, ...rest }) => ({ ...rest, ...(detail ? { detail: detail.slice(0, 240) } : {}) })),
  });
  return results.some(result => result.status === "fail" || result.status === "timeout") ? 1 : 0;
}

export async function runOwned(args: string[]): Promise<number> {
  const [command, ...rest] = args;
  const { positional, flags } = parse(rest);
  switch (command) {
    case "ls":
    case "list":
      return print(
        listOwned({ kind: text(flags, "--kind") as OwnedKind | undefined, system: text(flags, "--system") }).map(
          describe,
        ),
      );
    case "rm":
    case "remove": {
      if (!positional.length) throw new Error("usage: bep owned rm <sha...>");
      const removed = [];
      for (const sha of positional) removed.push((await removeOwned(sha)).sha256);
      return print({ removed });
    }
    case "inbox":
      return print(
        await runInbox({
          system: text(flags, "--system"),
          watch: flags.has("--watch"),
          report: flags.has("--watch") ? results => console.log(JSON.stringify(results)) : undefined,
        }),
      );
    case "push": {
      const target = await openTarget(text(flags, "--to") ?? defaultTarget, limitOf(flags));
      const dumps =
        flags.has("--all") || !positional.length
          ? listOwned()
          : positional.map(sha => {
              const dump = ownedBySha(sha);
              if (!dump) throw new Error(`no owned dump ${sha}`);
              return dump;
            });
      const results = [];
      for (const dump of dumps)
        results.push(
          await pushDump(dump, target, {
            partBytes: text(flags, "--part-size") ? parseBytes(text(flags, "--part-size")!) : undefined,
          }),
        );
      return print(results);
    }
    case "pull": {
      const [sha, file] = positional;
      if (!sha || !file) throw new Error("usage: bep owned pull <sha> <file> [--from <target>]");
      const dump = ownedBySha(sha);
      return print(
        await pullDump(
          dump?.sha256 ?? sha,
          await openTarget(text(flags, "--from") ?? defaultTarget, limitOf(flags)),
          file,
        ),
      );
    }
    case "forget": {
      const target = await openTarget(text(flags, "--from") ?? defaultTarget);
      const removed = [];
      for (const sha of positional)
        removed.push({ sha, objects: await deleteRemote(ownedBySha(sha)?.sha256 ?? sha, target) });
      return print(removed);
    }
    case "sync": {
      if (positional[0] !== "vps") throw new Error(`usage: ${ownedUsage[4]}`);
      return print(
        await syncVps({
          host: text(flags, "--host"),
          root: text(flags, "--root"),
          limit: text(flags, "--limit") ? parseBytes(text(flags, "--limit")!) : undefined,
          keys: flags.has("--keys"),
          system: text(flags, "--system"),
          only: positional.slice(1),
          prune: flags.has("--prune"),
        }),
      );
    }
    case "hook":
      return print({ hook: await installHook() });
    case "guard": {
      const rejections = checkStaged(process.cwd());
      print(rejections);
      return rejections.length ? 1 : 0;
    }
    default:
      throw new Error(`usage:\n  ${ownedUsage.join("\n  ")}`);
  }
}
