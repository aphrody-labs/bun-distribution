// SPDX-License-Identifier: Apache-2.0
// Off-host copy of the DBFR container snapshots (backup-shenron-container.py, shenron-container-backup.timer):
// PostgreSQL custom dump, Redis RDB and the live SQLite stores, one directory per snapshot.
//
//   bun scripts/tools/infra/shenron-offsite-backup.ts [--dest <dir>] [--restore-check]
//
// Lists the published snapshots on DBFR (root-owned, read with `sudo -n`), copies the newest one unless it is
// already verified locally (raw `ssh cat`, streamed and hashed against its VERIFIED.json), then writes
// `.offsite-verified`. `--restore-check` restores its PostgreSQL dump into a disposable
// pgvector/pgvector:0.8.1-pg18 container, checks the SQLite copies with `PRAGMA quick_check`, and writes
// `.restore-verified`. Existing local snapshots are preserved as rollback evidence while the owner resolves the
// conflicting retention policies. Fails when the newest DBFR snapshot is older than 36 h (stalled producer). Runs daily on the VPS
// (tools/config/host/systemd/shenron/shenron-offsite-backup.{service,timer}).
//
// Environment: SHENRON_OFFSITE_DIR (default /mnt/aphrody-storage/disk500/archive/dbfr/backups/shenron), SHENRON_OFFSITE_HOST (SSH alias,
// default dbfr), SHENRON_REMOTE_HOME (default: the remote $HOME).
// oxlint-disable no-await-in-loop -- one SSH transfer at a time bounds DBFR load and local disk writes.
import { Database } from "bun:sqlite";
import { appendFileSync, existsSync, mkdirSync, renameSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";

export type Verified = { files: Record<string, string> };

const STALE_HOURS = 36;
const RESTORE_IMAGE = "pgvector/pgvector:0.8.1-pg18";
const SSH_OPTIONS = ["-o", "BatchMode=yes", "-o", "ConnectTimeout=15"];
const STAMP = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})\d{6}Z$/;
const RELATIVE = /^[A-Za-z0-9_-][A-Za-z0-9._-]*(\/[A-Za-z0-9_-][A-Za-z0-9._-]*)*$/;

/** UTC time of a snapshot directory name (`%Y%m%dT%H%M%S%fZ`), or null when the name is not a snapshot. */
export function stampTime(name: string): number | null {
  const m = STAMP.exec(name);
  if (!m) return null;
  const [, y, mo, d, h, mi, s] = m.map(Number);
  return Date.UTC(y!, mo! - 1, d!, h!, mi!, s!);
}

export function remoteRoot(remoteHome: string): string {
  return `${remoteHome.replace(/\/+$/, "")}/apps/shenron/shared/backups/container`;
}

/** Parses a snapshot VERIFIED.json strictly: relative names without `..`, SHA-256 digests, the PostgreSQL dump. */
export function parseVerified(text: string): Verified {
  const doc = JSON.parse(text) as { kind?: unknown; files?: unknown };
  if (doc.kind !== "shenron-container-backup" || !doc.files || typeof doc.files !== "object")
    throw new Error("VERIFIED.json is not a shenron-container-backup manifest");
  const files: Record<string, string> = {};
  for (const [name, digest] of Object.entries(doc.files as Record<string, unknown>)) {
    if (!RELATIVE.test(name) || name.split("/").includes(".."))
      throw new Error("VERIFIED.json lists an unexpected path");
    if (typeof digest !== "string" || !/^[0-9a-f]{64}$/.test(digest))
      throw new Error("VERIFIED.json lists a malformed digest");
    files[name] = digest;
  }
  if (!files["shenron_site.dump"]) throw new Error("VERIFIED.json has no PostgreSQL dump");
  return { files };
}

const quote = (value: string) => `'${value.replaceAll("'", `'\\''`)}'`;

async function run(cmd: string[], stdin?: Blob): Promise<string> {
  const proc = Bun.spawn(cmd, {
    stdin: stdin ?? "ignore",
    stdout: "pipe",
    stderr: "pipe",
    windowsHide: true,
  });
  const [out, err, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (code !== 0) throw new Error(`${cmd.slice(0, 3).join(" ")}: exit ${code} ${err.trim()}`);
  return out;
}

const ssh = (host: string, command: string) => run(["ssh", ...SSH_OPTIONS, host, command]);

/** Streams one remote root-owned file to `partial` and returns its SHA-256 and size. */
async function fetchRemote(host: string, remote: string, partial: string) {
  const proc = Bun.spawn(["ssh", ...SSH_OPTIONS, host, `sudo -n cat -- ${quote(remote)}`], {
    stdout: "pipe",
    stderr: "pipe",
    windowsHide: true,
  });
  const hasher = new Bun.CryptoHasher("sha256");
  const writer = Bun.file(partial).writer();
  let size = 0;
  for await (const chunk of proc.stdout) {
    hasher.update(chunk);
    writer.write(chunk);
    size += chunk.byteLength;
  }
  await writer.end();
  const code = await proc.exited;
  if (code !== 0)
    throw new Error(
      `transfer of ${remote} failed: ${(await new Response(proc.stderr).text()).trim()}`,
    );
  return { sha256: hasher.digest("hex"), size };
}

async function sha256File(path: string): Promise<string> {
  const hasher = new Bun.CryptoHasher("sha256");
  for await (const chunk of Bun.file(path).stream()) hasher.update(chunk);
  return hasher.digest("hex");
}

/** Copies one snapshot into `<dest>/.<stamp>.partial`, verifies every digest, then publishes `<dest>/<stamp>`. */
async function pull(host: string, root: string, stamp: string, dest: string) {
  const verifiedText = await ssh(host, `sudo -n cat -- ${quote(`${root}/${stamp}/VERIFIED.json`)}`);
  const { files } = parseVerified(verifiedText);
  const stage = join(dest, `.${stamp}.partial`);
  rmSync(stage, { recursive: true, force: true });
  mkdirSync(stage, { recursive: true, mode: 0o700 });
  let bytes = 0;
  try {
    for (const [name, digest] of Object.entries(files)) {
      const target = join(stage, ...name.split("/"));
      mkdirSync(dirname(target), { recursive: true, mode: 0o700 });
      const got = await fetchRemote(host, `${root}/${stamp}/${name}`, target);
      if (got.sha256 !== digest) throw new Error(`off-host SHA-256 mismatch for ${stamp}/${name}`);
      bytes += got.size;
    }
    await Bun.write(join(stage, "VERIFIED.json"), verifiedText);
    await Bun.write(
      join(stage, ".offsite-verified"),
      `${JSON.stringify({ at: new Date().toISOString(), source: host, bytes, files: Object.keys(files).length })}\n`,
    );
    renameSync(stage, join(dest, stamp));
  } finally {
    rmSync(stage, { recursive: true, force: true });
  }
  return bytes;
}

/** Re-hashes a local snapshot against its own VERIFIED.json. */
async function verifyLocal(dir: string): Promise<boolean> {
  const manifest = join(dir, "VERIFIED.json");
  if (!existsSync(join(dir, ".offsite-verified")) || !existsSync(manifest)) return false;
  const { files } = parseVerified(await Bun.file(manifest).text());
  for (const [name, digest] of Object.entries(files)) {
    const path = join(dir, ...name.split("/"));
    if (!existsSync(path) || (await sha256File(path)) !== digest) return false;
  }
  return true;
}

/** Restores the dump into a disposable PostgreSQL 18 and checks the SQLite copies; returns the restore report. */
export async function restoreCheck(dir: string) {
  const name = `shenron-restore-check-${process.pid}`;
  const report: Record<string, unknown> = { at: new Date().toISOString(), image: RESTORE_IMAGE };
  await run([
    "docker",
    "run",
    "-d",
    "--rm",
    "--name",
    name,
    "--network",
    "none",
    "-e",
    "POSTGRES_HOST_AUTH_METHOD=trust",
    RESTORE_IMAGE,
  ]);
  try {
    const deadline = Date.now() + 120_000;
    for (;;) {
      const ready = Bun.spawnSync(["docker", "exec", name, "pg_isready", "-U", "postgres"], {
        stdout: "ignore",
        stderr: "ignore",
      });
      // The entrypoint restarts the server once after initdb; require the final server.
      const init = Bun.spawnSync(["docker", "logs", name], { stdout: "pipe", stderr: "pipe" });
      if (
        ready.exitCode === 0 &&
        /init process complete/.test(String(init.stderr) + String(init.stdout))
      )
        break;
      if (Date.now() > deadline) throw new Error("restore PostgreSQL did not become ready");
      await Bun.sleep(1000);
    }
    await run(["docker", "exec", name, "createdb", "-U", "postgres", "shenron_site"]);
    const started = Date.now();
    await run(
      [
        "docker",
        "exec",
        "-i",
        name,
        "pg_restore",
        "-U",
        "postgres",
        "-d",
        "shenron_site",
        "--no-owner",
        "--no-privileges",
        "--exit-on-error",
      ],
      Bun.file(join(dir, "shenron_site.dump")),
    );
    report.restoreSeconds = Math.round((Date.now() - started) / 1000);
    const psql = (sql: string) =>
      run(["docker", "exec", name, "psql", "-U", "postgres", "-d", "shenron_site", "-tAc", sql]);
    await psql("ANALYZE");
    const stats = await psql(
      "select count(*), coalesce(sum(greatest(c.reltuples, 0)), 0)::bigint, pg_database_size('shenron_site') " +
        "from pg_class c join pg_namespace n on n.oid = c.relnamespace " +
        "where c.relkind in ('r', 'p') and n.nspname not in ('pg_catalog', 'information_schema') " +
        "and n.nspname not like 'pg_toast%'",
    );
    const [tables, rows, databaseBytes] = stats.trim().split("|").map(Number);
    if (!tables) throw new Error("restored database has no user tables");
    Object.assign(report, { tables, rows, databaseBytes });
  } finally {
    Bun.spawnSync(["docker", "rm", "-f", name], { stdout: "ignore", stderr: "ignore" });
  }
  const sqlite: Record<string, string> = {};
  const scratch = join(dir, ".restore-scratch");
  mkdirSync(scratch, { recursive: true, mode: 0o700 });
  try {
    const { files } = parseVerified(await Bun.file(join(dir, "VERIFIED.json")).text());
    for (const file of Object.keys(files).filter((f) => /\.(db|sqlite)\.gz$/.test(f))) {
      const plain = join(scratch, file.replaceAll("/", "_").replace(/\.gz$/, ""));
      const gunzip = Bun.spawn(["gzip", "-dc", join(dir, ...file.split("/"))], {
        stdout: Bun.file(plain),
      });
      if ((await gunzip.exited) !== 0) throw new Error(`gzip -d failed for ${file}`);
      const db = new Database(plain, { readonly: true });
      try {
        sqlite[file] = String(
          (db.query("PRAGMA quick_check").get() as Record<string, unknown>)["quick_check"],
        );
      } finally {
        db.close();
      }
      rmSync(plain, { force: true });
      if (sqlite[file] !== "ok") throw new Error(`SQLite quick_check failed for ${file}`);
    }
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
  report.sqlite = sqlite;
  await Bun.write(join(dir, ".restore-verified"), `${JSON.stringify(report)}\n`);
  return report;
}

export async function main(argv = Bun.argv.slice(2)): Promise<number> {
  const at = argv.indexOf("--dest");
  const dest =
    (at >= 0 ? argv[at + 1] : undefined) ??
    process.env.SHENRON_OFFSITE_DIR ??
    "/mnt/aphrody-storage/disk500/archive/dbfr/backups/shenron";
  const host = process.env.SHENRON_OFFSITE_HOST ?? "dbfr";
  const remoteHome =
    process.env.SHENRON_REMOTE_HOME ?? (await ssh(host, 'printf %s "$HOME"')).trim();
  if (!remoteHome.startsWith("/")) throw new Error("remote home is not an absolute path");
  const root = remoteRoot(remoteHome);
  mkdirSync(dest, { recursive: true, mode: 0o700 });
  const log = (message: string) =>
    appendFileSync(join(dest, "pull-status.log"), `${new Date().toISOString()} ${message}\n`);
  log("start");
  const listing = await ssh(
    host,
    `sudo -n find ${quote(root)} -mindepth 1 -maxdepth 1 -type d -name '2*Z' -printf '%f\\n'`,
  );
  const remote = listing
    .split(/\r?\n/)
    .filter((name) => stampTime(name) !== null)
    .toSorted();
  if (remote.length === 0) throw new Error(`no published container snapshot on ${host}`);
  const newest = remote.at(-1)!;
  const local = join(dest, newest);
  let pulled = 0;
  if (existsSync(local) && (await verifyLocal(local))) log(`verified-existing=${newest}`);
  else {
    rmSync(local, { recursive: true, force: true });
    const bytes = await pull(host, root, newest, dest);
    log(`transferred=${newest} bytes=${bytes}`);
    console.log(`Off-host snapshot verified: ${newest} (${bytes} bytes).`);
    pulled = 1;
  }
  if (argv.includes("--restore-check")) {
    const report = await restoreCheck(join(dest, newest));
    log(`restore-verified=${newest} ${JSON.stringify(report)}`);
    console.log(`Restore check ${newest}: ${JSON.stringify(report)}`);
  }
  // Preserve historical verified snapshots until the owner resolves the conflicting
  // one/two/three-copy retention policies. Never delete backup evidence implicitly.
  const ageHours = (Date.now() - stampTime(newest)!) / 3_600_000;
  log(`complete pulled=${pulled} newest=${newest} age=${ageHours.toFixed(1)}h`);
  console.log(`Off-host Shenron snapshot kept: ${newest} (pulled ${pulled}).`);
  if (ageHours > STALE_HOURS)
    throw new Error(`newest DBFR snapshot ${newest} is ${ageHours.toFixed(0)} h old`);
  return 0;
}

if (import.meta.main) {
  main().then(
    (code) => process.exit(code),
    (error: unknown) => {
      console.error(
        `shenron-offsite-backup: ${error instanceof Error ? error.message : String(error)}`,
      );
      process.exit(1);
    },
  );
}
