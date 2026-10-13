// SPDX-License-Identifier: Apache-2.0
import { chmodSync, readdirSync, statSync } from "node:fs";
import { basename, join, resolve } from "node:path";

interface Config {
  schemaVersion: number;
  sourceService: string;
  offsiteHost: string;
  backupDirectory: string;
  offsiteDirectory: string;
  backupScript: string;
  producerSha256: string;
  replicaExecutable: string;
}
const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
export function qualifiedAcknowledgement(
  receipt: { sha256?: string; checkedAt?: string; sqliteIntegrity?: string },
  sha256: string,
  now = Date.now(),
): boolean {
  const time = Date.parse(receipt.checkedAt ?? "");
  return (
    /^[a-f0-9]{64}$/.test(sha256) &&
    receipt.sha256 === sha256 &&
    receipt.sqliteIntegrity === "ok" &&
    Number.isFinite(time) &&
    time <= now &&
    now - time < 3600000
  );
}
export function converged(report: any): boolean {
  return (
    report.ok === true &&
    report.dryRun === true &&
    report.totals?.failed === 0 &&
    report.totals?.planned === 0
  );
}
function childOutput(args: string[], milliseconds = 30000): Promise<string> {
  return (async () => {
    const child = Bun.spawn(args, { stdout: "pipe", stderr: "pipe", stdin: "ignore" });
    const watchdog = setTimeout(() => child.kill(), milliseconds);
    try {
      const [stdout, stderr, code] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
        child.exited,
      ]);
      if (code !== 0) {
        const cause = stderr
          .split("\n")
          .find((line) => /^(?:error:|[A-Za-z]+Error:)/.test(line))
          ?.replace(/postgres(?:ql)?:\/\/\S+/gi, "<DATABASE_URL>")
          .slice(0, 300);
        throw Error(
          `Infra stage failed: ${args[1] ?? args[0]} (exit ${code})${cause ? `: ${cause}` : ""}`,
        );
      }
      return stdout;
    } finally {
      clearTimeout(watchdog);
    }
  })();
}

export async function runPipeline(root: string, configuration: string): Promise<object> {
  const config = (await Bun.file(configuration).json()) as Config;
  if (
    config.schemaVersion !== 1 ||
    config.sourceService !== "shenron-bot" ||
    config.offsiteHost !== "vps"
  )
    throw Error("Existing source/host catalogue references required");
  const policy = Bun.TOML.parse(
    await Bun.file(join(root, "tools/config/host/host-policy.toml")).text(),
  ) as any;
  const home = policy.layout.home as string;
  const expand = (path: string) => (path.startsWith("~/") ? join(home, path.slice(2)) : path);
  const catalog = await Bun.file(join(root, "tools/config/service-catalog.json")).json();
  const service = catalog.services.find((entry: any) => entry.id === config.sourceService);
  if (!service?.container || service.host !== "dbfr" || !service.sharedRoot)
    throw Error("Current DBFR bot catalogue record required");
  const shared = service.sharedRoot as string;
  const source = join(shared, "bot/data/bot.db"),
    backup = join(shared, config.backupDirectory);
  const offsite = join(expand(policy.layout.build), config.offsiteDirectory);
  if (
    !/^backups\/[a-z-]+$/.test(config.backupDirectory) ||
    !/^archive\/dbfr\/backups\/[a-z-]+$/.test(config.offsiteDirectory) ||
    config.backupScript !== "scripts/tools/infra/backup-shenron-sqlite.sh" ||
    config.replicaExecutable !== "/usr/local/bin/shenron-bot"
  )
    throw Error("Unexpected pipeline scope");
  const lock = join(shared, "bot/data/.replica-sync.lock");
  if (process.env.SHENRON_SQLITE_SYNC_HELD !== lock) {
    await childOutput(
      [
        "flock",
        "-n",
        lock,
        "env",
        `SHENRON_SQLITE_SYNC_HELD=${lock}`,
        process.execPath,
        "--no-env-file",
        import.meta.path,
        root,
        configuration,
      ],
      600000,
    );
    return { delegated: true };
  }
  const parent = (await Bun.file(`/proc/${process.ppid}/cmdline`).text()).split("\0");
  if (
    !parent[0]?.endsWith("flock") ||
    !parent.includes(lock) ||
    Bun.spawnSync(["flock", "-n", lock, "true"], { stdout: "ignore", stderr: "ignore" })
      .exitCode === 0
  )
    throw Error("Real parent-held SQLite writer lease required");
  const peer = JSON.parse(
    await childOutput([
      "sudo",
      "-n",
      "-u",
      basename(home),
      process.execPath,
      "ssh",
      "config",
      "-F",
      join(home, ".ssh/config"),
      config.offsiteHost,
    ]),
  );
  const identity = peer.identityFiles?.find((path: string) => path.startsWith(home + "/"));
  if (!identity || peer.user !== basename(home))
    throw Error("Owner SSH catalogue identity unavailable");
  const sshOptions = [
    "--native",
    "-i",
    identity,
    "-F",
    join(home, ".ssh/config"),
    "-o",
    "ConnectTimeout=15",
    "-o",
    "BatchMode=yes",
    "-o",
    "StrictHostKeyChecking=yes",
    "-o",
    `UserKnownHostsFile=${join(home, ".ssh/known_hosts")}`,
  ];
  const remote = async (command: string) => {
    const value = JSON.parse(
      await childOutput(
        [process.execPath, "ssh", "exec", ...sshOptions, "--json", config.offsiteHost, command],
        45000,
      ),
    );
    if (value.code !== 0) throw Error("Off-host qualification stage failed");
    return value.stdout as string;
  };
  await remote("hostname");
  const remoteBun = (await remote("command -v bun")).trim();
  if (!remoteBun.startsWith(home + "/") || /\s/.test(remoteBun))
    throw Error("Qualified off-host runtime path required");
  const producer = "/usr/local/libexec/aphrody-infra/backup-shenron-sqlite.sh";
  if (
    new Bun.CryptoHasher("sha256").update(await Bun.file(producer).bytes()).digest("hex") !==
    config.producerSha256
  )
    throw Error("Qualified canonical SQLite producer pin differs");
  await childOutput(
    [
      "env",
      `SHENRON_SQLITE_SRC=${source}`,
      `SHENRON_SQLITE_BACKUP_DIR=${backup}`,
      "bash",
      producer,
    ],
    90000,
  );
  const name = readdirSync(backup)
    .filter((file) => /^bot-\d{8}-\d{6}\.db\.gz$/.test(file))
    .toSorted()
    .at(-1);
  if (!name) throw Error("Canonical producer emitted no snapshot");
  const snapshot = join(backup, name);
  if (Date.now() - statSync(snapshot).mtimeMs > 120000) throw Error("Producer snapshot is stale");
  const sourceBytes = await Bun.file(snapshot).bytes();
  const hash = new Bun.CryptoHasher("sha256").update(sourceBytes).digest("hex");
  const manifestHash = (await Bun.file(`${snapshot}.sha256`).text()).split(/\s+/)[0];
  if (hash !== manifestHash) throw Error("Producer checksum differs");
  await remote(`mkdir -p ${quote(offsite)} && chmod 700 ${quote(offsite)}`);
  await childOutput(
    [
      process.execPath,
      "ssh",
      "sftp",
      ...sshOptions,
      "put",
      config.offsiteHost,
      join(offsite, name),
      snapshot,
    ],
    45000,
  );
  const qualification = `import{Database}from"bun:sqlite";const p=${JSON.stringify(join(offsite, name))};const b=await Bun.file(p).bytes();const h=new Bun.CryptoHasher("sha256").update(b).digest("hex");if(h!==${JSON.stringify(hash)})throw Error("Checksum differs");const v=Bun.gunzipSync(b);const c=v.slice();c[18]=1;c[19]=1;const d=Database.deserialize(c,{readonly:true});try{if(d.query("PRAGMA quick_check").get().quick_check!=="ok")throw Error("Integrity differs");const r={kind:"shenron-sqlite-offsite-verified",checkedAt:new Date().toISOString(),sha256:h,sqliteIntegrity:"ok",compressedBytes:b.length,sqliteBytes:v.length};await Bun.write(p+".offsite-verified",JSON.stringify(r));console.log(JSON.stringify(r))}finally{d.close()}`;
  const receipt = JSON.parse(
    (await remote(`timeout 20 ${quote(remoteBun)} -e ${quote(qualification)}`)).trim(),
  );
  if (!qualifiedAcknowledgement(receipt, hash))
    throw Error("Fresh off-host acknowledgement required");
  await Bun.write(`${snapshot}.offsite-verified`, JSON.stringify(receipt));
  chmodSync(`${snapshot}.offsite-verified`, 0o600);
  const sync = JSON.parse(
    await childOutput(
      ["docker", "exec", service.container, config.replicaExecutable, "--replica-sync"],
      180000,
    ),
  );
  if (!sync.ok || sync.totals?.failed !== 0) throw Error("Canonical replica write failed");
  const readback = JSON.parse(
    await childOutput(
      [
        "docker",
        "exec",
        service.container,
        config.replicaExecutable,
        "--replica-sync",
        "--dry-run",
      ],
      180000,
    ),
  );
  if (!converged(readback)) throw Error("Canonical replica did not converge");
  const result = {
    checkedAt: new Date().toISOString(),
    sourceService: config.sourceService,
    offsiteHost: config.offsiteHost,
    backup: { name, ...receipt },
    sync: sync.totals,
    readback: readback.totals,
  };
  await Bun.write(join(backup, "pipeline-current.json"), JSON.stringify(result));
  console.log(JSON.stringify(result));
  return result;
}

if (import.meta.main) {
  const [root, config] = process.argv.slice(2);
  if (!root || !config) throw Error("Expected existing INFRA_ROOT CONFIGURATION");
  await runPipeline(resolve(root), resolve(config));
}
