#!/usr/bin/env bun
// SPDX-License-Identifier: Apache-2.0
/**
 * PC side of the VFS sync contract (docs/re/vfs-sync.md). The server (`ssh vps`) is the source of
 * truth: it publishes, for IEVR and DBXV2, a canonical manifest and its digest. This tool
 *
 *   digest <game>                      server digest header (JSON)
 *   fetch  <game>                      download the server manifest into the cache (verified)
 *   verify <game> [--root <dir>]       digest of this PC's view (bunre vfs, e.g. over the G: share)
 *                                      against the server manifest; lists differences, exit 1 if any
 *   read   <game> <path> [--pack p]    entry bytes through the cache: sha256 and size are checked
 *                                      against the server copy; --out writes the bytes
 *   selftest <game> <path> [--pack p]  read, corrupt the cached blob, prove the corruption is detected
 *
 * `game` is `ievr` or `dbxv2`. The cache lives under `.local/vfs-cache` (git-ignored), content
 * addressed by sha256; no credential is read, printed or written: the server side runs on the
 * server with its own environment, and the PC uses the SMB drive mapped by Windows.
 */
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const HOST = process.env.VFS_SYNC_HOST ?? "vps";
const SERVER_ROOT: Record<string, string> = {
  ievr: "/games/SteamLibrary/steamapps/common/INAZUMA ELEVEN Victory Road",
  dbxv2: "/games/SteamLibrary/steamapps/common/DB Xenoverse 2",
};
const PC_ROOT: Record<string, string> = {
  ievr: "G:\\steamapps\\common\\INAZUMA ELEVEN Victory Road",
  dbxv2: "G:\\steamapps\\common\\DB Xenoverse 2",
};
const SERVER_BUNRE = process.env.VFS_SYNC_SERVER_BUNRE ?? "~/src/bun-os/target/release/bunre";
const REPO = resolve(import.meta.dir, "../../../..");
const PC_BUNRE = process.env.BUNRE ?? join(REPO, "target", "release", "bunre.exe");
const CACHE = process.env.VFS_SYNC_CACHE ?? join(REPO, ".local", "vfs-cache");

const sh = (s: string) => `'${s.replaceAll("'", `'\\''`)}'`;

async function run(
  cmd: string[],
  opts: { stdin?: string } = {},
): Promise<{ code: number; out: Uint8Array; err: string }> {
  const proc = Bun.spawn(cmd, {
    stdout: "pipe",
    stderr: "pipe",
    stdin: opts.stdin ? new TextEncoder().encode(opts.stdin) : "ignore",
  });
  const [out, err, code] = await Promise.all([
    new Response(proc.stdout).bytes(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { code, out, err };
}

async function ssh(script: string) {
  return run(["ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=15", HOST, script]);
}

function game(argv: string[]): string {
  const g = argv[0];
  if (g !== "ievr" && g !== "dbxv2") throw new Error("game must be ievr or dbxv2");
  return g;
}

const flag = (argv: string[], name: string) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};

/** Canonical digest of NDJSON rows, written independently of the Rust implementation (contract in the docs). */
export function digestRows(
  rows: Array<{ path: string; source: string; offset: number; size: number; extractSize: number; flags: string }>,
): string {
  const esc = (t: string) =>
    t
      .replaceAll("%", "%25")
      .replaceAll("\\", "%5C")
      .replaceAll("\t", "%09")
      .replaceAll("\n", "%0A")
      .replaceAll("\r", "%0D");
  const key = (r: { path: string; source: string; offset: number }) =>
    [Buffer.from(r.path), Buffer.from(r.source), r.offset] as const;
  const sorted = [...rows].sort((a, b) => {
    const [ap, as, ao] = key(a);
    const [bp, bs, bo] = key(b);
    return Buffer.compare(ap, bp) || Buffer.compare(as, bs) || ao - bo;
  });
  const hash = createHash("sha256");
  for (const r of sorted)
    hash.update(`${esc(r.path)}\t${esc(r.source)}\t${r.offset}\t${r.size}\t${r.extractSize}\t${r.flags}\n`);
  return `sha256:${hash.digest("hex")}`;
}

async function serverDigest(g: string): Promise<Record<string, unknown>> {
  const script =
    g === "ievr" ? "curl -fsS http://127.0.0.1:8792/vfs/digest" : "head -n 1 ~/apps/dbxv2-assets/meta/vfs-index.ndjson";
  const r = await ssh(script);
  if (r.code !== 0) throw new Error(`server digest failed: ${r.err.trim()}`);
  return JSON.parse(new TextDecoder().decode(r.out));
}

async function fetchManifest(g: string): Promise<string> {
  const script =
    g === "ievr"
      ? "curl -fsS http://127.0.0.1:8792/vfs/index | gzip -1 -c"
      : "gzip -1 -c ~/apps/dbxv2-assets/meta/vfs-index.ndjson";
  const t0 = performance.now();
  const r = await ssh(script);
  if (r.code !== 0) throw new Error(`manifest fetch failed: ${r.err.trim()}`);
  const text = new TextDecoder().decode(Bun.gunzipSync(r.out));
  const lines = text.split("\n").filter(Boolean);
  const header = JSON.parse(lines[0]!);
  const rows = lines.slice(1).map(l => JSON.parse(l));
  if (header.count !== rows.length) throw new Error(`manifest truncated: header ${header.count}, rows ${rows.length}`);
  const own = digestRows(rows);
  if (own !== header.digest)
    throw new Error(`manifest digest mismatch: header ${header.digest}, recomputed in TS ${own}`);
  const dir = join(CACHE, g);
  await mkdir(dir, { recursive: true });
  const file = join(dir, "index.ndjson");
  await writeFile(file, text);
  console.log(
    JSON.stringify({
      game: g,
      fetched: rows.length,
      digest: header.digest,
      tsRecomputed: own,
      bytes: text.length,
      millis: Math.round(performance.now() - t0),
      cache: file,
    }),
  );
  return file;
}

async function verify(g: string, argv: string[]) {
  const root = flag(argv, "--root") ?? PC_ROOT[g]!;
  const file = await fetchManifest(g);
  const t0 = performance.now();
  const r = await run([PC_BUNRE, "vfs", "verify", g, root, "--against", file]);
  process.stdout.write(new TextDecoder().decode(r.out));
  if (r.err) process.stderr.write(r.err);
  console.error(`verify wall ${Math.round(performance.now() - t0)} ms`);
  process.exit(r.code);
}

const sha = (b: Uint8Array) => `sha256:${createHash("sha256").update(b).digest("hex")}`;

async function serverHash(g: string, path: string, pack?: string): Promise<{ size: number; sha256: string }> {
  const packArg = pack ? ` --pack ${sh(pack)}` : "";
  const r = await ssh(`${SERVER_BUNRE} vfs hash ${g} ${sh(SERVER_ROOT[g]!)} ${sh(path)}${packArg}`);
  if (r.code !== 0) throw new Error(`server hash failed: ${r.err.trim()}`);
  return JSON.parse(new TextDecoder().decode(r.out));
}

async function pcRead(g: string, path: string, pack?: string, root?: string): Promise<Uint8Array> {
  const cmd = [PC_BUNRE, "vfs", "cat", g, root ?? PC_ROOT[g]!, path];
  if (pack) cmd.push("--pack", pack);
  const r = await run(cmd);
  if (r.code !== 0) throw new Error(`pc read failed: ${r.err.trim()}`);
  return r.out;
}

/** Cached, verified read. Returns the bytes and where they came from. */
async function read(g: string, path: string, pack: string | undefined, root?: string) {
  const blobs = join(CACHE, "blobs");
  await mkdir(blobs, { recursive: true });
  const indexFile = join(CACHE, g, "entries.json");
  await mkdir(join(CACHE, g), { recursive: true });
  const entries: Record<string, { sha256: string; size: number }> = existsSync(indexFile)
    ? JSON.parse(await readFile(indexFile, "utf8"))
    : {};
  const key = `${pack ?? ""}|${path}`;
  const t0 = performance.now();
  const expected = await serverHash(g, path, pack);
  const note: string[] = [];
  const cached = entries[key];
  if (cached && cached.sha256 === expected.sha256) {
    const blob = join(blobs, cached.sha256.slice(7));
    if (existsSync(blob)) {
      const bytes = new Uint8Array(await readFile(blob));
      if (sha(bytes) === expected.sha256 && bytes.length === expected.size) {
        return { bytes, from: "cache", note, millis: Math.round(performance.now() - t0), ...expected };
      }
      note.push("CACHE CORRUPT: blob does not hash to its name, refetching");
    }
  }
  const bytes = await pcRead(g, path, pack, root);
  if (bytes.length !== expected.size) throw new Error(`size mismatch: pc ${bytes.length}, server ${expected.size}`);
  if (sha(bytes) !== expected.sha256) throw new Error(`sha256 mismatch: pc ${sha(bytes)}, server ${expected.sha256}`);
  await writeFile(join(blobs, expected.sha256.slice(7)), bytes);
  entries[key] = { sha256: expected.sha256, size: expected.size };
  await writeFile(indexFile, JSON.stringify(entries, null, 1));
  return { bytes, from: "pc-view", note, millis: Math.round(performance.now() - t0), ...expected };
}

const [command, ...rest] = Bun.argv.slice(2);
try {
  if (command === "digest") console.log(JSON.stringify(await serverDigest(game(rest))));
  else if (command === "fetch") await fetchManifest(game(rest));
  else if (command === "verify") await verify(game(rest), rest);
  else if (command === "read") {
    const g = game(rest);
    const r = await read(g, rest[1]!, flag(rest, "--pack"), flag(rest, "--root"));
    const out = flag(rest, "--out");
    if (out) await writeFile(out, r.bytes);
    console.log(
      JSON.stringify({ path: rest[1], from: r.from, size: r.size, sha256: r.sha256, millis: r.millis, note: r.note }),
    );
  } else if (command === "selftest") {
    const g = game(rest);
    const first = await read(g, rest[1]!, flag(rest, "--pack"), flag(rest, "--root"));
    const blob = join(CACHE, "blobs", first.sha256.slice(7));
    const bad = new Uint8Array(first.bytes);
    bad[0] = bad[0]! ^ 0xff;
    await writeFile(blob, bad);
    const second = await read(g, rest[1]!, flag(rest, "--pack"), flag(rest, "--root"));
    console.log(
      JSON.stringify({
        firstFrom: first.from,
        afterCorruption: { from: second.from, note: second.note, restored: sha(second.bytes) === first.sha256 },
      }),
    );
    if (!second.note.some(n => n.startsWith("CACHE CORRUPT"))) process.exit(1);
  } else {
    console.error("usage: vfs-sync.ts digest|fetch|verify|read|selftest <ievr|dbxv2> ...");
    process.exit(2);
  }
} catch (e) {
  console.error(`vfs-sync: ${(e as Error).message}`);
  process.exit(1);
}
