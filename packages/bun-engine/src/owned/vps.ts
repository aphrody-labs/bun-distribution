// Mirrors owned dumps to the VPS test host over the wg1 mesh (`ssh vps`), into /games/private
// (mode 0700, a `*` .gitignore, files 0600), where the stream and emulator tests read them.
// The VPS is reserved for games and streaming, so transfers stay light: one file at a time,
// throttled on this side, idle I/O priority and `nice` on the remote side, resumed from the bytes
// already received, verified with sha256sum before the file is published.
import { type OwnedDump, listOwned, storePath } from "./store";

export interface VpsOptions {
  host?: string;
  root?: string;
  /** Bytes per second; default 4 MiB/s. */
  limit?: number;
  /** Mirror key files too (excluded by default). */
  keys?: boolean;
  system?: string;
  only?: string[];
  /** Remove remote dumps that are no longer in the local store. */
  prune?: boolean;
}

export interface VpsResult {
  host: string;
  root: string;
  sent: Array<{ sha256: string; file: string; bytes: number; resumedAt: number; ms: number }>;
  present: number;
  pruned: string[];
}

const defaultLimit = 4 * 1024 * 1024;

function quote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function ssh(host: string, script: string, stdin?: "pipe") {
  return Bun.spawn(["ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=15", host, script], {
    stdin: stdin ?? "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
}

async function run(host: string, script: string): Promise<string> {
  const child = ssh(host, script);
  const [out, err, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  if (code !== 0) throw new Error(`ssh ${host}: ${err.trim() || `exit ${code}`}`);
  return out;
}

const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));

/** Remote path of a dump: <root>/<kind dir>/<console>/<sha256>.<ext>, mirroring the local store. */
function remotePath(root: string, dump: OwnedDump): string {
  return `${root}/${dump.file}`;
}

async function send(host: string, root: string, dump: OwnedDump, offset: number, limit: number) {
  const target = remotePath(root, dump);
  const directory = target.slice(0, target.lastIndexOf("/"));
  const script = [
    "set -e; umask 077",
    `mkdir -p ${quote(directory)}`,
    "io=$(command -v ionice >/dev/null 2>&1 && echo 'ionice -c3' || true)",
    `$io nice -n19 sh -c ${quote(`cat >> ${quote(`${target}.part`)}`)}`,
    `sum=$(nice -n19 sha256sum ${quote(`${target}.part`)} | cut -d' ' -f1)`,
    `if [ "$sum" = ${quote(dump.sha256)} ]; then mv ${quote(`${target}.part`)} ${quote(target)}; echo ok; else echo "mismatch $sum"; fi`,
  ].join("; ");
  const child = ssh(host, script, "pipe");
  const stdin = child.stdin as import("bun").FileSink;
  const started = performance.now();
  let sent = 0;
  for await (const chunk of Bun.file(storePath(dump)).slice(offset).stream()) {
    for (let at = 0; at < chunk.byteLength; at += 256 * 1024) {
      const slice = chunk.subarray(at, at + 256 * 1024);
      stdin.write(slice);
      await stdin.flush();
      sent += slice.byteLength;
      const due = (sent / limit) * 1000 - (performance.now() - started);
      if (due > 0) await sleep(due);
    }
  }
  await stdin.end();
  const [out, err, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  if (code !== 0 || out.trim() !== "ok") {
    if (/mismatch/.test(out)) await run(host, `rm -f ${quote(`${target}.part`)}`);
    throw new Error(`${dump.sha256.slice(0, 12)}: ${out.trim() || err.trim() || `exit ${code}`}`);
  }
  return { sha256: dump.sha256, file: dump.file, bytes: sent, resumedAt: offset, ms: Math.round(performance.now() - started) };
}

/** Sends the dumps the VPS does not hold yet (keys only with `keys`), one at a time. */
export async function syncVps(options: VpsOptions = {}): Promise<VpsResult> {
  const host = options.host ?? "vps";
  const root = (options.root ?? "/games/private").replace(/\/+$/, "");
  const limit = options.limit ?? defaultLimit;
  const listing = await run(
    host,
    [
      "set -e; umask 077",
      `mkdir -p ${quote(root)}`,
      `chmod 700 ${quote(root)}`,
      `[ -f ${quote(`${root}/.gitignore`)} ] || printf '*\\n' > ${quote(`${root}/.gitignore`)}`,
      `cd ${quote(root)} && find . -type f ! -name .gitignore -printf '%P %s\\n'`,
    ].join("; "),
  );
  const remote = new Map<string, number>();
  for (const line of listing.split("\n")) {
    const at = line.lastIndexOf(" ");
    if (at > 0) remote.set(line.slice(0, at), Number(line.slice(at + 1)));
  }
  const dumps = listOwned({ system: options.system }).filter(
    (dump) =>
      (options.keys || dump.kind !== "keys") &&
      (!options.only?.length || options.only.some((sha) => dump.sha256.startsWith(sha.toLowerCase()))),
  );
  const result: VpsResult = { host, root, sent: [], present: 0, pruned: [] };
  for (const dump of dumps) {
    if (remote.get(dump.file) === dump.size) {
      result.present++;
      continue;
    }
    result.sent.push(await send(host, root, dump, remote.get(`${dump.file}.part`) ?? 0, limit));
  }
  if (options.prune) {
    const local = new Set(listOwned().map((dump) => dump.file));
    const stale = [...remote.keys()].filter((file) => !local.has(file.replace(/\.part$/, "")));
    if (stale.length) await run(host, `cd ${quote(root)} && rm -f ${stale.map(quote).join(" ")}`);
    result.pruned = stale;
  }
  return result;
}
