// SPDX-License-Identifier: Apache-2.0
// Off-host copy of the Shenron backups of DBFR (PostgreSQL dumps and SQLite replica snapshots).
//
//   bun scripts/tools/infra/shenron-offsite-backup.ts [--dest <dir>]
//
// Reads the SHA-256 manifests written on DBFR by backup-shenron-pg.sh and backup-shenron-sqlite.sh, copies every
// listed artifact that is not already present with the same digest (raw `ssh cat`, streamed and hashed), verifies
// it, writes a `.sha256` sidecar and acknowledges the copy on DBFR (`<artifact>.offsite-verified`, which gates the
// remote retention). Local copies older than 14 days are pruned. Scheduled daily at 06:00 by the boot catalog
// entry `Shenron PostgreSQL off-host backup` (tools/config/service-catalog.json, `aphrody infra boot`).
//
// Environment: SHENRON_OFFSITE_DIR (default ~/vps-offload/db-backups/shenron/dbfr), SHENRON_OFFSITE_HOST (SSH alias,
// default dbfr), SHENRON_REMOTE_HOME (default: the remote $HOME). Remote directories follow the declared units:
// <home>/apps/shenron/data/backups/shenron-pg and .../shenron-sqlite.
// oxlint-disable no-await-in-loop -- one SSH transfer at a time bounds DBFR load and local disk writes.
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export type Dataset = {
  name: string;
  remoteDir: string;
  manifestGlob: string;
  artifact: RegExp;
  destination: string;
};

export type ManifestEntry = { sha256: string; name: string };

const RETENTION_DAYS = 14;
const SSH_OPTIONS = ["-o", "BatchMode=yes", "-o", "ConnectTimeout=15"];

/** Parses `sha256sum` manifest lines; every name must match the dataset artifact pattern. */
export function parseManifests(
  text: string,
  dataset: Pick<Dataset, "name" | "artifact">,
): ManifestEntry[] {
  const entries: ManifestEntry[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const match = /^([0-9a-f]{64})\s+\*?(.+)$/.exec(line.trim());
    if (!match) throw new Error(`a ${dataset.name} checksum manifest is malformed`);
    const name = match[2]!.split(/[\\/]/).pop()!;
    if (!dataset.artifact.test(name))
      throw new Error(`DBFR returned an unexpected ${dataset.name} filename`);
    entries.push({ sha256: match[1]!, name });
  }
  return entries;
}

export function datasets(remoteHome: string, destination: string): Dataset[] {
  const backups = `${remoteHome.replace(/\/+$/, "")}/apps/shenron/data/backups`;
  return [
    {
      name: "postgresql",
      remoteDir: `${backups}/shenron-pg`,
      manifestGlob: "shenron_site-*.sql.gz.sha256",
      artifact: /^shenron_site-[0-9]{8}-[0-9]{6}\.sql\.gz$/,
      destination,
    },
    {
      name: "sqlite-replica",
      remoteDir: `${backups}/shenron-sqlite`,
      manifestGlob: "bot-*.db.gz.sha256",
      artifact: /^bot-[0-9]{8}-[0-9]{6}\.db\.gz$/,
      destination: join(destination, "sqlite"),
    },
  ];
}

/** Removes local artifacts (and their sidecars) older than the retention window. */
export function prune(dir: string, now = Date.now()): string[] {
  const cutoff = now - RETENTION_DAYS * 86_400_000;
  const removed: string[] = [];
  for (const name of existsSync(dir) ? readdirSync(dir) : []) {
    if (!/\.(sql|db)\.gz$/.test(name)) continue;
    const path = join(dir, name);
    if (!statSync(path).isFile() || statSync(path).mtimeMs >= cutoff) continue;
    rmSync(path, { force: true });
    rmSync(`${path}.sha256`, { force: true });
    removed.push(name);
  }
  return removed;
}

const quote = (value: string) => `'${value.replaceAll("'", `'\\''`)}'`;

async function ssh(host: string, command: string): Promise<string> {
  const proc = Bun.spawn(["ssh", ...SSH_OPTIONS, host, command], {
    stdout: "pipe",
    stderr: "pipe",
    windowsHide: true,
  });
  const [out, err, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (code !== 0) throw new Error(`ssh ${host}: exit ${code} ${err.trim()}`);
  return out;
}

async function sha256File(path: string): Promise<string> {
  const hasher = new Bun.CryptoHasher("sha256");
  for await (const chunk of Bun.file(path).stream()) hasher.update(chunk);
  return hasher.digest("hex");
}

/** Streams one remote file to `partial` and returns its SHA-256 and size. */
async function fetchRemote(host: string, remote: string, partial: string) {
  const proc = Bun.spawn(["ssh", ...SSH_OPTIONS, host, `cat ${quote(remote)}`], {
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

export async function main(argv = Bun.argv.slice(2)): Promise<number> {
  const at = argv.indexOf("--dest");
  const destination =
    (at >= 0 ? argv[at + 1] : undefined) ??
    process.env.SHENRON_OFFSITE_DIR ??
    join(homedir(), "vps-offload", "db-backups", "shenron", "dbfr");
  const host = process.env.SHENRON_OFFSITE_HOST ?? "dbfr";
  const remoteHome =
    process.env.SHENRON_REMOTE_HOME ?? (await ssh(host, 'printf %s "$HOME"')).trim();
  if (!remoteHome.startsWith("/")) throw new Error("remote home is not an absolute path");
  const sets = datasets(remoteHome, destination);
  for (const set of sets) mkdirSync(set.destination, { recursive: true });
  const log = (message: string) =>
    appendFileSync(
      join(destination, "pull-status.log"),
      `${new Date().toISOString()} ${message}\n`,
    );
  log("start");
  let verified = 0;
  for (const set of sets) {
    const manifests = await ssh(
      host,
      `find ${quote(set.remoteDir)} -maxdepth 1 -type f -name ${quote(set.manifestGlob)} -exec cat {} +`,
    );
    const entries = parseManifests(manifests, set);
    if (entries.length === 0)
      throw new Error(`no verified ${set.name} backups are available on ${host}`);
    log(`dataset=${set.name} manifests=${entries.length}`);
    for (const entry of entries) {
      const finalPath = join(set.destination, entry.name);
      const acknowledge = () =>
        ssh(host, `touch ${quote(`${set.remoteDir}/${entry.name}.offsite-verified`)}`);
      if (existsSync(finalPath) && (await sha256File(finalPath)) === entry.sha256) {
        await acknowledge();
        log(`verified-existing=${set.name}/${entry.name}`);
        verified++;
        continue;
      }
      const partial = `${finalPath}.partial`;
      try {
        const got = await fetchRemote(host, `${set.remoteDir}/${entry.name}`, partial);
        if (got.sha256 !== entry.sha256)
          throw new Error(`off-host SHA-256 mismatch for ${entry.name}`);
        renameSync(partial, finalPath);
        await Bun.write(`${finalPath}.sha256`, `${got.sha256}  ${entry.name}\n`);
        await acknowledge();
        log(`transferred=${set.name}/${entry.name}`);
        console.log(`Off-host backup verified: ${set.name}/${entry.name} (${got.size} bytes).`);
        verified++;
      } finally {
        rmSync(partial, { force: true });
      }
    }
  }
  for (const set of sets)
    for (const name of prune(set.destination)) log(`pruned=${set.name}/${name}`);
  console.log(`Off-host Shenron backup set verified: ${verified} file(s).`);
  log(`complete=${verified}`);
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
