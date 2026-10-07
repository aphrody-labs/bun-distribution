// SPDX-License-Identifier: Apache-2.0
/* eslint-disable no-await-in-loop -- Private snapshot files are uploaded and verified in sequence. */
import { createHash } from "node:crypto";
import { chmod, lstat, mkdir, readdir } from "node:fs/promises";
import { join } from "node:path";

export interface ReplicaConfig {
  incoming: string;
  contract: string;
  homeDocuments?: string[];
  directory: string;
  stateRoot: string;
  shenronRoot: string;
  intervalSeconds: number;
}
type Run = (argv: string[], environment?: Record<string, string>) => Promise<string>;
export interface SnapshotFile {
  relative: string;
  sha256: string;
  bytes: number;
  local: string;
}
const roles = new Set([
  "remote.candidate.md",
  "local.md",
  "reviewed-baseline.md",
  "remote.native.json",
  "evidence.json",
]);

/** Snapshot only contracted home documents and the native connector's staged evidence. */
export async function snapshotFiles(
  home: string,
  incoming: string,
  names: string[],
  destination: string,
) {
  const sources: { source: string; relative: string }[] = [];
  for (const name of names) {
    if (!/^[A-Z][A-Z0-9_-]*\.md$/.test(name)) throw new Error("Unsafe home document name");
    sources.push({ source: join(home, name), relative: `active/${name}` });
  }
  const folders = await readdir(incoming, { withFileTypes: true }).catch(
    (error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") throw error;
      return [];
    },
  );
  for (const folder of folders) {
    if (!folder.isDirectory() || !names.some((name) => folder.name.startsWith(name + "-")))
      continue;
    const document = names.find((name) => folder.name.startsWith(name + "-"))!;
    const suffix = folder.name.slice(document.length + 1);
    if (!/^[a-f0-9]{16}-[a-f0-9]{16}$/.test(suffix)) continue;
    for (const role of roles)
      sources.push({
        source: join(incoming, folder.name, role),
        relative: `incoming/${folder.name}/${role}`,
      });
  }
  const files: SnapshotFile[] = [];
  for (const { source, relative } of sources) {
    const info = await lstat(source).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") throw error;
      return undefined;
    });
    if (!info) continue;
    if (!info.isFile() || info.isSymbolicLink() || info.size > 16 * 1024 * 1024)
      throw new Error("Unsafe snapshot source");
    const bytes = await Bun.file(source).bytes();
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const local = join(destination, relative);
    await mkdir(join(local, ".."), { recursive: true, mode: 0o700 });
    await Bun.write(local, bytes, { mode: 0o600 });
    await chmod(local, 0o600);
    files.push({ relative, sha256, bytes: bytes.length, local });
  }
  if (!files.length) throw new Error("No contracted snapshot documents found");
  return files;
}

export async function replicateHome(
  config: ReplicaConfig,
  home: string,
  receiptRoot: string,
  aphrody: string,
  run: Run,
) {
  const names = [
    ...new Set([
      ...((await Bun.file(config.contract).json()) as string[]),
      ...(config.homeDocuments ?? []),
    ]),
  ];
  const files = await snapshotFiles(
    home,
    config.incoming,
    names,
    join(receiptRoot, "replica-outgoing"),
  );
  const manifest = files.map(({ local: _local, ...file }) => file);
  const digest = createHash("sha256").update(JSON.stringify(manifest)).digest("hex");
  const root = `${config.directory}/${digest}`;
  const environment = { APHRODY_DBFR_HOST: "10.200.77.3" };
  const exec = (command: string) =>
    run([aphrody, "infra", "ssh", "exec", "--host", "dbfr", "--cmd", command], environment);
  const path64 = Buffer.from(root).toString("base64");
  const manifest64 = Buffer.from(JSON.stringify(manifest)).toString("base64");
  const ready = await exec(
    "python3 -c '" +
      [
        `import base64,json,pathlib,hashlib; root=pathlib.Path(base64.b64decode("${path64}").decode()); files=json.loads(base64.b64decode("${manifest64}"))`,
        'marker=root/"verified.json"',
        "try: valid=marker.is_file() and not marker.is_symlink() and json.loads(marker.read_text())==files",
        "except (ValueError,OSError): valid=False",
        'valid=valid and all((root/f["relative"]).is_file() and not (root/f["relative"]).is_symlink() and hashlib.sha256((root/f["relative"]).read_bytes()).hexdigest()==f["sha256"] for f in files)',
        'print("verified" if valid else "missing")',
      ].join("\n") +
      "'",
  );
  let copied = 0;
  if (ready.trim() !== "verified") {
    const prepare = [
      `import base64,json,pathlib; root=pathlib.Path(base64.b64decode("${path64}").decode()); files=json.loads(base64.b64decode("${manifest64}"))`,
      "for f in files:",
      ' (root/f["relative"]).parent.mkdir(mode=0o700,parents=True,exist_ok=True)',
    ].join("\n");
    await exec("python3 -c '" + prepare + "'");
    for (const file of files) {
      await run(
        [
          aphrody,
          "infra",
          "ssh",
          "sftp",
          "--host",
          "dbfr",
          "--path",
          `${root}/${file.relative}`,
          "--put",
          file.local,
        ],
        environment,
      );
      copied++;
    }
    const verify = [
      `import base64,json,pathlib,hashlib,os; root=pathlib.Path(base64.b64decode("${path64}").decode()); files=json.loads(base64.b64decode("${manifest64}"))`,
      "for f in files:",
      ' p=root/f["relative"]; assert p.is_file() and not p.is_symlink(); assert hashlib.sha256(p.read_bytes()).hexdigest()==f["sha256"]; os.chmod(p,0o600)',
      'p=root/"verified.json"; t=p.with_suffix(".tmp"); t.write_text(json.dumps(files)); os.chmod(t,0o600); t.replace(p); print("snapshot-verified")',
    ].join("\n");
    if ((await exec("python3 -c '" + verify + "'")).trim() !== "snapshot-verified")
      throw new Error("Remote snapshot verification failed");
  }
  const args = [
    ["--state", config.stateRoot, "--profile", "dbfr"],
    ["--state", config.shenronRoot],
  ];
  let indexed = 0;
  for (const flags of args) {
    const argv = [
      "/home/ubuntu/.local/bin/aphrody",
      "home",
      "index",
      root,
      "--label",
      "drive-dbfr-replica",
      ...flags,
    ];
    const command = argv.map((arg) => "'" + arg.replaceAll("'", "'\\''") + "'").join(" ");
    const report = JSON.parse(await exec(command));
    if (!Array.isArray(report.errors) || report.errors.length)
      throw new Error("Remote home index failed");
    if (Number.isSafeInteger(report.indexed) && report.indexed >= 0) indexed += report.indexed;
  }
  return { files_copied: copied, homes_indexed: 2, indexed };
}
