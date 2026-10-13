// SPDX-License-Identifier: Apache-2.0
// Payloads and keys stay outside the repository. Never print subprocess secret output.
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { randomBytes, createHash } from "node:crypto";
import { googleApi } from "@aphrody/google/api";

const home = homedir();
const store = join(home, ".aphrody/private/container-vault");
const cli = process.env["APHRODY_BIN"] ?? Bun.which("aphrody") ?? "aphrody";
const repo = "aphrody-labs/aphrody";
const vaultPath = join(store, "vault.enc.json");
const keyPath = join(store, "master.key");
type Source = { path: string; content: string; sha256: string };
type Snapshot = { files: Source[]; environment: Record<string, string> };
type Payload = {
  version: number;
  createdAt: string;
  hosts: Record<string, Snapshot>;
  runtime?: { apiToken: string };
};

// Only configuration and credential files; no databases, conversations, datasets or weights.
const collector = String.raw`
import os,json,base64,hashlib,pathlib,stat,re,subprocess
h=pathlib.Path.home()
roots=[h/'.aphrody/private',h/'.config/aphrody',h/'.config/yolo',h/'.config/rgfr',h/'.config/nie',h/'.cf-edriss',pathlib.Path('/etc/aphrody'),pathlib.Path('/etc/rose-griffon'),pathlib.Path('/etc/shenron')]
explicit=[h/'.config/gh/hosts.yml',h/'.npmrc',h/'.netrc',pathlib.Path('/etc/aphrody-discord.env')]
explicit+=list(h.glob('.shenron*.env'))
if str(h)=='/root':
 h=pathlib.Path('/home/ubuntu')
 roots += [h/'.aphrody/private',h/'.config/aphrody',h/'.config/yolo',h/'.config/rgfr',h/'.config/nie',h/'.cf-edriss']
 explicit+=list(h.glob('.shenron*.env'))
 explicit += [h/'.config/gh/hosts.yml',h/'.npmrc',h/'.netrc']
if os.environ.get('APHRODY_VAULT_LOCAL')=='1':
 explicit += [pathlib.Path(os.environ.get('APHRODY_WORKSPACE',os.getcwd()))/'.env']
paths=set(explicit)
for root in roots:
 if not root.exists(): continue
 for parent,dirs,files in os.walk(root,followlinks=False):
  dirs[:]=[d for d in dirs if d not in ('container-vault','cookies','datasets','models','memory','conversations','node_modules','.git','db','releases','backups','training','reports','sessions','home-align-20261003','cache') and not pathlib.Path(parent,d).is_symlink()]
  for name in files:
   p=pathlib.Path(parent,name)
   if name.endswith('.env') or name=='.env' or name in ('credentials','token','secrets') or (name.endswith(('.json','.yaml','.yml','.toml','.ini','.conf')) and re.search(r'(secret|token|credential|oauth|service.account|aphrody.bot|environment)',name,re.I)):
    paths.add(p)
files=[]
for p in sorted(paths):
 try:
  s=p.lstat()
  if not stat.S_ISREG(s.st_mode) or s.st_size>2097152: continue
  data=p.read_bytes()
  data.decode('utf-8')
  files.append({'path':str(p),'content':base64.b64encode(data).decode(),'sha256':hashlib.sha256(data).hexdigest()})
 except (FileNotFoundError,PermissionError,UnicodeDecodeError): continue
env=dict(os.environ) if os.environ.get('APHRODY_VAULT_LOCAL')=='1' else {}
if os.environ.get('APHRODY_VAULT_LOCAL')!='1':
 units=subprocess.run(['systemctl','list-units','--type=service','--state=running','--no-legend','--no-pager'],capture_output=True,text=True)
 for line in units.stdout.splitlines():
  unit=line.split()[0] if line.split() else ''
  if not re.match(r'(aphrody|yolo|shenron|rose-griffon|rgfr|nie)[-\.]',unit): continue
  pid=subprocess.run(['systemctl','show',unit,'--property=MainPID','--value'],capture_output=True,text=True).stdout.strip()
  if not pid.isdigit() or pid=='0': continue
  try:
   for pair in pathlib.Path('/proc',pid,'environ').read_bytes().split(b'\0'):
    if b'=' in pair:
     k,v=pair.split(b'=',1)
     env[unit+'::'+k.decode()]=v.decode()
  except (FileNotFoundError,PermissionError,UnicodeDecodeError): pass
env.pop('APHRODY_SECRETS_PASSWORD',None)
print(json.dumps({'files':files,'environment':env},separators=(',',':')))
`;

function privateWrite(path: string, data: string | Uint8Array) {
  mkdirSync(store, { recursive: true, mode: 0o700 });
  chmodSync(store, 0o700);
  const staging = `${path}.${process.pid}.tmp`;
  writeFileSync(staging, data, { mode: 0o600, flag: "wx" });
  renameSync(staging, path);
  chmodSync(path, 0o600);
}

async function run(args: string[], input?: string, extraEnv: Record<string, string> = {}) {
  const child = Bun.spawn(args, {
    windowsHide: true,
    env: { ...process.env, ...extraEnv },
    stdin: input === undefined ? "ignore" : "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });
  if (input !== undefined && child.stdin != null && typeof child.stdin !== "number") {
    child.stdin.write(input);
    child.stdin.end();
  }
  const [stdout, , code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  if (code !== 0)
    throw new Error(
      `Operation failed: ${args[0]} ${args[1] ?? ""} (exit ${code}); secret output suppressed`,
    );
  return stdout;
}

function password() {
  return readFileSync(keyPath, "utf8").trim();
}

async function decode(inputPath = vaultPath): Promise<Payload> {
  const dir = mkdtempSync(join("/dev/shm", "aphrody-vault-"));
  chmodSync(dir, 0o700);
  try {
    const output = join(dir, "payload.env");
    await run(
      [
        cli,
        "infra",
        "secrets",
        "render",
        "--service",
        "container-vault",
        "--in",
        inputPath,
        "--out",
        output,
        "--apply",
      ],
      undefined,
      { APHRODY_SECRETS_PASSWORD: password() },
    );
    const match = readFileSync(output, "utf8").match(/^PAYLOAD_B64="([A-Za-z0-9+/=]+)"$/m);
    if (!match?.[1]) throw new Error("Invalid vault payload");
    return JSON.parse(Buffer.from(match[1], "base64").toString("utf8")) as Payload;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

async function collect() {
  mkdirSync(store, { recursive: true, mode: 0o700 });
  chmodSync(store, 0o700);
  if (!(await Bun.file(keyPath).exists()))
    privateWrite(keyPath, `${randomBytes(32).toString("hex")}\n`);
  const hosts: Record<string, Snapshot> = {};
  hosts.wsl = JSON.parse(
    await run(["python3", "-c", collector], undefined, { APHRODY_VAULT_LOCAL: "1" }),
  ) as Snapshot;
  const encoded = Buffer.from(collector).toString("base64");
  await Promise.all(
    ["vps", "dbfr"].map(async (host) => {
      const command = `printf %s '${encoded}' | base64 -d | sudo -n python3`;
      const response = JSON.parse(
        await run([cli, "infra", "ssh", "exec", "--host", host, "--json", "-c", command]),
      ) as { exit_code: number; stdout: string };
      if (response.exit_code !== 0)
        throw new Error(`Cannot collect ${host}; previous vault retained`);
      hosts[host] = JSON.parse(response.stdout) as Snapshot;
      if (!hosts[host]?.files.length)
        throw new Error(`Empty ${host} collection; previous vault retained`);
    }),
  );
  const prior = (await Bun.file(vaultPath).exists()) ? await decode() : undefined;
  if (hosts.wsl && prior?.hosts.wsl)
    hosts.wsl.environment = { ...prior.hosts.wsl.environment, ...hosts.wsl.environment };
  const payload: Payload = {
    version: 1,
    createdAt: new Date().toISOString(),
    hosts,
    runtime: {
      apiToken:
        prior?.runtime?.apiToken ??
        hosts.wsl?.environment.YOLO_API_TOKEN ??
        randomBytes(32).toString("hex"),
    },
  };
  const dir = mkdtempSync(join("/dev/shm", "aphrody-vault-"));
  chmodSync(dir, 0o700);
  try {
    const input = join(dir, "input.env");
    writeFileSync(
      input,
      `PAYLOAD_B64=${Buffer.from(JSON.stringify(payload)).toString("base64")}\n`,
      { mode: 0o600 },
    );
    const staging = join(store, `vault.${process.pid}.enc.json`);
    await run(
      [
        cli,
        "infra",
        "secrets",
        "encrypt",
        "--service",
        "container-vault",
        "--in",
        input,
        "--out",
        staging,
      ],
      undefined,
      { APHRODY_SECRETS_PASSWORD: password() },
    );
    chmodSync(staging, 0o600);
    // Preserve the previous encrypted revision; never overwrite the master key.
    if (await Bun.file(vaultPath).exists())
      privateWrite(join(store, "previous.enc.json"), readFileSync(vaultPath));
    const checked = await decode(staging);
    if (JSON.stringify(checked) !== JSON.stringify(payload))
      throw new Error("Vault round trip mismatch");
    renameSync(staging, vaultPath);
    console.log(
      JSON.stringify({
        encrypted: true,
        hosts: Object.fromEntries(
          Object.entries(hosts).map(([host, value]) => [
            host,
            { files: value.files.length, variables: Object.keys(value.environment).length },
          ]),
        ),
      }),
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

async function backup() {
  await decode();
  const data = readFileSync(vaultPath);
  const hash = createHash("sha256").update(data).digest("hex");
  const metadata = JSON.parse(await run(["gh", "api", `repos/${repo}`])) as { private: boolean };
  if (!metadata.private)
    throw new Error("GitHub vault backup requires the existing private repository");
  const remotePath = "tools/config/protected-backups/container-vault.enc.json";
  let sha: string | undefined;
  try {
    sha = (
      JSON.parse(await run(["gh", "api", `repos/${repo}/contents/${remotePath}`])) as {
        sha: string;
      }
    ).sha;
  } catch {
    /* A missing first backup is expected. PUT still fails on other errors. */
  }
  await run(
    ["gh", "api", "--method", "PUT", `repos/${repo}/contents/${remotePath}`, "--input", "-"],
    JSON.stringify({
      message: "chore(infra): back up encrypted container vault",
      content: data.toString("base64"),
      ...(sha ? { sha } : {}),
      committer: { name: "aphrody-dev", email: "contact@aphrody.com" },
      author: { name: "aphrody-dev", email: "contact@aphrody.com" },
    }),
  );
  const restored = JSON.parse(await run(["gh", "api", `repos/${repo}/contents/${remotePath}`])) as {
    content: string;
  };
  if (createHash("sha256").update(Buffer.from(restored.content, "base64")).digest("hex") !== hash)
    throw new Error("GitHub backup checksum mismatch");
  const { drive } = await googleApi();
  const roots = await drive.files.list({
    q: "trashed = false and mimeType = 'application/vnd.google-apps.folder' and (name = 'Aphrody' or name = 'aphrody')",
    fields: "files(id,name),nextPageToken",
    pageSize: 100,
  });
  if (roots.data.files?.length !== 1 || roots.data.nextPageToken)
    throw new Error("Need exactly one existing aphrody Drive folder");
  const folder = roots.data.files[0]?.id;
  if (!folder) throw new Error("Missing Drive folder");
  const permissions = await drive.permissions.list({
    fileId: folder,
    fields: "permissions(type,role)",
  });
  if (permissions.data.permissions?.some((p) => p.type === "anyone" || p.type === "domain"))
    throw new Error("Drive folder has broad sharing; backup refused");
  const name = `container-vault-${hash.slice(0, 16)}.enc.json`;
  const existing = await drive.files.list({
    q: `'${folder}' in parents and trashed = false and name = '${name}'`,
    fields: "files(id)",
    pageSize: 100,
  });
  let id = existing.data.files?.[0]?.id;
  if (!id) {
    const upload = await drive.files.create({
      requestBody: {
        name,
        parents: [folder],
        description: "Encrypted Aphrody container vault. Master key is never uploaded.",
        appProperties: { sha256: hash },
      },
      media: {
        mimeType: "application/json",
        body: (await import("node:stream")).Readable.from([data]),
      },
      fields: "id",
    });
    id = upload.data.id;
  }
  if (!id) throw new Error("Drive backup failed");
  const downloaded = await drive.files.get(
    { fileId: id, alt: "media" },
    { responseType: "arraybuffer" },
  );
  if (
    createHash("sha256")
      .update(Buffer.from(downloaded.data as ArrayBuffer))
      .digest("hex") !== hash
  )
    throw new Error("Drive backup checksum mismatch");
  privateWrite(
    join(store, "backup-status.json"),
    `${JSON.stringify({ at: new Date().toISOString(), sha256: hash, github: `${repo}/${remotePath}`, driveFile: id, keyUploaded: false }, null, 2)}\n`,
  );
  console.log(
    "Encrypted GitHub and Google Drive backups checksum-verified; master key remains local.",
  );
}

async function runtime() {
  const payload = await decode();
  if (!payload.runtime?.apiToken) throw new Error("Run collect to provision runtime token");
  privateWrite(join(store, "api.token"), payload.runtime.apiToken);
  chmodSync(join(store, "api.token"), 0o400);
  privateWrite(join(store, "compose.env"), `APHRODY_API_TOKEN_FILE=${join(store, "api.token")}\n`);
  console.log("Runtime token prepared for a read-only Docker secret mount.");
}

async function exportSource(host: string, source: string, output: string) {
  if (!output.startsWith(store + "/"))
    throw new Error("Export must stay in the private vault directory");
  const payload = await decode();
  const file = payload.hosts[host]?.files.find((entry) => entry.path === source);
  if (!file) throw new Error("Source not present in vault");
  const content = Buffer.from(file.content, "base64");
  if (createHash("sha256").update(content).digest("hex") !== file.sha256)
    throw new Error("Source checksum mismatch");
  privateWrite(output, content);
  chmodSync(output, 0o400);
  console.log("Runtime source exported with mode 0400; use a read-only secret mount.");
}

const [command, host, source, output] = process.argv.slice(2);
try {
  if (command === "collect") await collect();
  else if (command === "runtime") await runtime();
  else if (command === "backup") await backup();
  else if (command === "sync") {
    await collect();
    await backup();
  } else if (command === "export" && host && source && output)
    await exportSource(host, source, output);
  else if (command === "status") {
    const payload = await decode();
    console.log(
      JSON.stringify({
        encrypted: true,
        createdAt: payload.createdAt,
        hosts: Object.fromEntries(
          Object.entries(payload.hosts).map(([name, value]) => [
            name,
            { files: value.files.length, variables: Object.keys(value.environment).length },
          ]),
        ),
      }),
    );
  } else
    throw new Error(
      "Usage: vault.ts collect|backup|sync|status|export <host> <source-path> <private-output-path>",
    );
} catch {
  console.error(
    "Vault operation failed. No secret output logged; existing source credentials preserved.",
  );
  process.exitCode = 1;
}
