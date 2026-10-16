// SPDX-License-Identifier: Apache-2.0
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import { infraRoot, runInfra } from "./runtime.ts";
import { buildFactoryPlan, readFactoryConfig } from "./build-factory.ts";

export type FleetHost = {
  id: string;
  os: "win32" | "linux";
  local: boolean;
  reserveGiB: number;
  maxJobs: number;
  heavy: boolean;
  externalLocks?: string[];
};
export type FleetRequest = {
  id: string;
  kind: "probe" | "build";
  host?: string;
  os?: "win32" | "linux";
  memoryGiB: number;
  jobs: number;
  repository?: string;
  workspace?: string;
  revision?: string;
  command?: string[];
};
export type FleetReadiness = {
  host: string;
  ready: boolean;
  os?: string;
  freeGiB?: number;
  cores?: number;
  load?: number;
  busy?: boolean;
  error?: string;
  observed?: number;
  diskGiB?: number;
};

export function resolveExternalLocks(
  locks: string[],
  checkout: string | undefined,
  pathApi: {
    isAbsolute: (path: string) => boolean;
    join: (...paths: string[]) => string;
  },
): string[] {
  const marker = "$APHRODY_BUN_CHECKOUT/";
  return locks.map((lock) => {
    if (!lock.startsWith(marker)) return lock;
    if (!checkout || !pathApi.isAbsolute(checkout))
      throw Error("APHRODY_BUN_CHECKOUT is required on this Windows host");
    return pathApi.join(checkout, lock.slice(marker.length));
  });
}

async function resolveLocalHost(
  host: FleetHost,
  workspaceRoot: string,
): Promise<FleetHost> {
  const marker = "$APHRODY_BUN_CHECKOUT/";
  const locks = host.externalLocks ?? [];
  if (!host.local || !locks.some((lock) => lock.startsWith(marker)))
    return host;

  const configured = process.env.APHRODY_BUN_CHECKOUT?.trim();
  const candidates = [
    ...(configured ? [configured] : []),
    resolve(workspaceRoot, "..", "bun"),
  ].filter(isAbsolute);
  const checkout = (
    await Promise.all(
      candidates.map(async (candidate) => {
        const path = resolve(candidate);
        return (await Bun.file(join(path, "docs", "docs.json")).exists())
          ? path
          : undefined;
      }),
    )
  ).find((path) => path !== undefined);
  if (!checkout)
    throw new Error(
      "The configured Bun checkout is unavailable for its native build lock",
    );
  return {
    ...host,
    externalLocks: resolveExternalLocks(locks, checkout, { isAbsolute, join }),
  };
}

const externalLockResolverSource = resolveExternalLocks.toString();

function digest(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
function quote(value: string) {
  return "'" + value.replaceAll("'", "'\\''") + "'";
}

const processIdentitySource = `async function identity(pid) {
 if(process.platform==='win32') {
  const p=Bun.spawn(['powershell.exe','-NoProfile','-NonInteractive','-Command','(Get-Process -Id '+pid+' -ErrorAction Stop).StartTime.ToUniversalTime().Ticks'],{stdout:'pipe',stderr:'pipe',windowsHide:true});
  const value=(await new Response(p.stdout).text()).trim();return await p.exited===0 ? value : null;
 }
 try {const stat=fs.readFileSync('/proc/'+pid+'/stat','utf8');return fs.readFileSync('/proc/sys/kernel/random/boot_id','utf8').trim()+':'+stat.slice(stat.lastIndexOf(')')+2).split(/\\s+/)[19]}catch{return null}
}`;

export function validateRequest(request: FleetRequest): void {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(request.id))
    throw new Error("Invalid stable job id");
  if (!["probe", "build"].includes(request.kind))
    throw new Error("Invalid task kind");
  if (
    !Number.isFinite(request.memoryGiB) ||
    request.memoryGiB < 0.1 ||
    request.memoryGiB > 256
  )
    throw new Error("Invalid task memory requirement");
  if (!Number.isInteger(request.jobs) || request.jobs < 1 || request.jobs > 64)
    throw new Error("Invalid jobs");
  if (request.os && !["win32", "linux"].includes(request.os))
    throw new Error("Invalid task OS");
  if (request.kind === "build") {
    if (!/^[a-f0-9]{40}$/.test(request.revision ?? ""))
      throw new Error("Full source revision required");
    if (
      !request.workspace ||
      !request.command?.length ||
      request.command.some(
        (arg) => typeof arg !== "string" || arg.includes("\0"),
      )
    )
      throw new Error("Build workspace and owner command required");
    const command = request.command!;
    if (
      !/^(?:bun(?:\.exe)?|.*[/\\]bun(?:\.exe)?)$/.test(command[0]!) ||
      !["bd", "run"].includes(command[1] ?? "")
    )
      throw new Error("Only the native Bun owner factory is supported");
    const limits = command.filter((arg) => /^-j\d+$/.test(arg));
    if (
      limits.length !== 1 ||
      Number(limits[0]!.slice(2)) > request.jobs ||
      Number(limits[0]!.slice(2)) < 1
    )
      throw new Error("Explicit bounded factory -j required");
    if (command.some((arg) => /^--jobs|^-j$/.test(arg)))
      throw new Error("Conflicting job flags");
    if (
      command[1] === "run" &&
      !["build", "build:release", "build:local", "build:windows"].includes(
        command[2] ?? "",
      )
    )
      throw Error("Unknown owner build script");
    const executionBoundary = command.findIndex(
      (arg, index) =>
        index > 1 && ["test", "run", "-e", "-p", "--"].includes(arg),
    );
    if (
      executionBoundary !== -1 &&
      command.findIndex((arg) => /^-j\d+$/.test(arg)) > executionBoundary
    )
      throw Error("Factory jobs must precede execution arguments");
  }
}

export function selectHost(
  hosts: FleetHost[],
  readiness: FleetReadiness[],
  request: FleetRequest,
  occupied = new Set<string>(),
): FleetHost {
  validateRequest(request);
  const eligible = hosts.filter((host) => {
    const state = readiness.find((item) => item.host === host.id);
    return (
      (!request.host || request.host === host.id) &&
      (!request.os || request.os === host.os) &&
      (request.kind !== "build" || host.heavy) &&
      request.jobs <= host.maxJobs &&
      !occupied.has(host.id) &&
      state?.ready &&
      state.os === host.os &&
      (request.kind === "probe" || !state.busy) &&
      (state.freeGiB ?? 0) >=
        (request.kind === "build"
          ? Math.max(10, request.memoryGiB)
          : request.memoryGiB) +
          (request.kind === "probe" ? 1 : host.reserveGiB) &&
      (!state.observed || Date.now() - state.observed < 60000) &&
      (request.kind === "probe" ||
        ((state.diskGiB ?? 0) >= 20 && (state.load ?? 1) < 0.95))
    );
  });
  eligible.sort(
    (a, b) =>
      (readiness.find((s) => s.host === a.id)?.load ?? 0) -
      (readiness.find((s) => s.host === b.id)?.load ?? 0),
  );
  if (!eligible[0])
    throw new Error(
      `No qualified host with sufficient reserved capacity for ${request.id}`,
    );
  return eligible[0];
}

export function encodedCommand(host: FleetHost, javascript: string): string {
  const encoded = Buffer.from(javascript).toString("base64");
  const expression = `eval(Buffer.from('${encoded}','base64').toString())`;
  if (host.os === "linux") return `bun -e ${quote(expression)}`;
  const powershell = `& bun -e '${expression.replaceAll("'", "''")}'; exit $LASTEXITCODE`;
  return `powershell.exe -NoProfile -NonInteractive -EncodedCommand ${Buffer.from(powershell, "utf16le").toString("base64")}`;
}

async function execute(host: FleetHost, javascript: string, seconds = 60) {
  if (!host.local)
    return runInfra({
      args: [
        "ssh",
        "exec",
        "--host",
        host.id,
        "--cmd",
        encodedCommand(host, javascript),
      ],
      env: { APHRODY_SSH_COMMAND_TIMEOUT_SECS: String(seconds) },
    });
  const proc = Bun.spawn([process.execPath, "-e", javascript], {
    stdout: "pipe",
    stderr: "pipe",
    windowsHide: true,
  });
  const timer = setTimeout(() => proc.kill(), seconds * 1000);
  try {
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    return { stdout, stderr, exitCode, command: [] };
  } finally {
    clearTimeout(timer);
  }
}

const readinessScript = `(async()=>{
 const os=await import('node:os'), fs=await import('node:fs'), path=await import('node:path');
 ${externalLockResolverSource}
 const home=os.homedir(), lease=path.join(home,'.aphrody','build-fleet','heavy.lock');
 let free=os.freemem(), load=os.loadavg()[0]/os.availableParallelism();
 if(process.platform==='win32') {
   const p=Bun.spawn(['powershell.exe','-NoProfile','-NonInteractive','-Command',"@{memory=(Get-CimInstance Win32_OperatingSystem).FreePhysicalMemory;cpu=(Get-CimInstance Win32_Processor|Measure-Object LoadPercentage -Average).Average}|ConvertTo-Json -Compress"],{stdout:'pipe',stderr:'pipe',windowsHide:true});
   const v=JSON.parse((await new Response(p.stdout).text()).trim()); if(await p.exited!==0)throw Error('Native host inventory failed');free=v.memory*1024;load=v.cpu/100;
 }
 const disk=fs.statfsSync(home);
 console.log(JSON.stringify({ready:true,observed:Date.now(),diskGiB:Number(disk.bavail)*Number(disk.bsize)/1073741824,os:process.platform,freeGiB:free/1073741824,cores:os.availableParallelism(),load,busy:fs.existsSync(lease)}));
})().catch(e=>{console.error(e.message);process.exitCode=1})`;

export async function inspectFleet(
  hosts: FleetHost[],
): Promise<FleetReadiness[]> {
  return Promise.all(
    hosts.map(async (host) => {
      try {
        const source = readinessScript.replace(
          "busy:fs.existsSync(lease)",
          `busy:fs.existsSync(lease)||resolveExternalLocks(${JSON.stringify(host.externalLocks ?? [])},process.env.APHRODY_BUN_CHECKOUT,path).some(p=>fs.existsSync(p))`,
        );
        const result = await execute(host, source, 30);
        if (result.exitCode !== 0)
          throw new Error(
            result.stderr.trim() || `probe exit ${result.exitCode}`,
          );
        const data = JSON.parse(result.stdout.trim());
        return { ...data, host: host.id, ready: data.os === host.os };
      } catch (error) {
        return { host: host.id, ready: false, error: String(error) };
      }
    }),
  );
}

export function workerScript(
  host: FleetHost,
  request: FleetRequest,
  fingerprint: string,
  ownerCommand?: string,
): string {
  validateRequest(request);
  return `(async()=>{
 const fs=await import('node:fs'), path=await import('node:path'), os=await import('node:os');
 ${externalLockResolverSource}
 ${processIdentitySource}
 const r=${JSON.stringify(request)}, host=${JSON.stringify(host)}, fingerprint=${JSON.stringify(fingerprint)};
 if(process.platform!==host.os)throw Error('Host OS changed');
 const base=path.join(os.homedir(),'.aphrody','build-fleet'), lease=path.join(base,r.kind==='build'?'heavy.lock':'probe.lock'), marker=path.join(base,r.id+'.json');
 fs.mkdirSync(base,{recursive:true});
 if(fs.realpathSync(base)!==path.join(fs.realpathSync(path.join(os.homedir(),'.aphrody')),'build-fleet'))throw Error('Fleet state root resolves outside configured owner home');
 if(fs.existsSync(marker))throw Error('Remote request already exists; reconcile status, never replay');
 const token=crypto.randomUUID(), processIdentity=await identity(process.pid); let fd, state;
 if(!processIdentity)throw Error('Native process identity unavailable');
 try {fd=fs.openSync(lease,'wx',384)}catch(e){throw Error('Host heavy lease is occupied; preserved')}
 try {
  fs.writeFileSync(fd,JSON.stringify({pid:process.pid,processIdentity,token,fingerprint}));fs.closeSync(fd);
  state={id:r.id,fingerprint,host:host.id,state:'running',pid:process.pid,processIdentity,started:new Date().toISOString()};
  fs.writeFileSync(marker,JSON.stringify(state),{flag:'wx',mode:384});
  let free=os.freemem();
  if(process.platform==='win32') {const p=Bun.spawn(['powershell.exe','-NoProfile','-NonInteractive','-Command','(Get-CimInstance Win32_OperatingSystem).FreePhysicalMemory'],{stdout:'pipe',stderr:'pipe',windowsHide:true});const v=Number((await new Response(p.stdout).text()).trim());if(await p.exited!==0||!Number.isFinite(v))throw Error('Native memory inventory failed');free=v*1024}
  if(r.kind==='probe' && free/1073741824<r.memoryGiB+1)throw Error('Reserved probe capacity changed');
  let exitCode=0;
  if(r.kind==='build') {
    if(!host.heavy)throw Error('Production host forbids heavy build');
    if(resolveExternalLocks(host.externalLocks||[],process.env.APHRODY_BUN_CHECKOUT,path).some(p=>fs.existsSync(p)))throw Error('Existing owner build lock is present; preserved');
    if(fs.realpathSync(r.workspace)!==path.resolve(r.workspace))throw Error('Source path resolves elsewhere');
    for(const directory of ['build/debug','build/release','build-native-release'])if(fs.existsSync(path.join(r.workspace,directory,'.build.lock')))throw Error('Native owner factory lease present; preserved');
    const capture=async(args)=>{const p=Bun.spawn(args,{cwd:r.workspace,stdout:'pipe',stderr:'pipe',windowsHide:true});const out=await new Response(p.stdout).text();const err=await new Response(p.stderr).text();if(await p.exited!==0)throw Error(err);return out.trim()};
    if(await capture(['git','rev-parse','HEAD'])!==r.revision)throw Error('Source pin differs');
    const remote=await capture(['git','remote','get-url','origin']);
    if(!/^https:\\/\\/github\\.com\\/aphrody-labs\\/(?:bun|aphrody)(?:\\.git)?$/.test(remote))throw Error('Source remote is outside declared public owner repositories');
    if(await capture(['git','status','--porcelain','--untracked-files=all','--ignore-submodules=none']))throw Error('Source checkout dirty; preserved');
    if(free/1073741824<Math.max(10,r.memoryGiB)+host.reserveGiB)throw Error('Reserved capacity changed; native Bun link requires at least 10 GiB plus reserve');
    const cmd=${ownerCommand ? JSON.stringify(["bash", "-c", ownerCommand]) : "r.command"};
    const p=Bun.spawn(cmd,{cwd:r.workspace,stdout:'inherit',stderr:'inherit',windowsHide:true,env:{...process.env,APHRODY_BUILD_HOST:host.id,APHRODY_CARGO_JOBS:String(r.jobs)}});
    exitCode=await p.exited;
  }
  const result={...state,state:exitCode===0?'complete':'failed',exitCode,finished:new Date().toISOString(),os:process.platform,bun:Bun.version,freeGiB:free/1073741824};
  fs.writeFileSync(marker,JSON.stringify(result),{mode:384});console.log(JSON.stringify(result));if(exitCode)process.exitCode=exitCode;
 }catch(e){const failed={...state,id:r.id,fingerprint,host:host.id,state:'failed',exitCode:1,error:e.message,finished:new Date().toISOString()};fs.writeFileSync(marker,JSON.stringify(failed),{mode:384});console.log(JSON.stringify(failed));process.exitCode=1}
 finally {try{if(JSON.parse(fs.readFileSync(lease,'utf8')).token===token)fs.unlinkSync(lease)}catch{}}
})().catch(e=>{console.error(e.message);process.exitCode=1})`;
}

export async function runBuildFleet(args: readonly string[]): Promise<number> {
  const [operation, ...rest] = args;
  if (!operation || operation === "--help") {
    console.log(
      "build-fleet readiness | plan/run --file <requests.json> | status --id <stable-id>. Plans precede apply; run persists non-replayable receipts.",
    );
    return 0;
  }
  const root = infraRoot();
  const config = JSON.parse(
    await Bun.file(join(root, "tools/config/build-fleet.json")).text(),
  ) as {
    schemaVersion: number;
    hosts: FleetHost[];
  };
  if (
    config.schemaVersion !== 1 ||
    !config.hosts.length ||
    new Set(config.hosts.map((h) => h.id)).size !== config.hosts.length
  )
    throw Error("Invalid fleet configuration");
  if (
    config.hosts.some(
      (h) =>
        !["local", "omar", "vps", "dbfr"].includes(h.id) ||
        !["win32", "linux"].includes(h.os) ||
        typeof h.local !== "boolean" ||
        !Number.isFinite(h.reserveGiB) ||
        h.reserveGiB < 1 ||
        !Number.isInteger(h.maxJobs) ||
        h.maxJobs < 1 ||
        h.maxJobs > 6 ||
        typeof h.heavy !== "boolean" ||
        (h.id === "dbfr" && h.heavy),
    )
  )
    throw Error("Invalid host capacity or protected production policy");
  const hosts = await Promise.all(
    config.hosts.map((host) => resolveLocalHost(host, root)),
  );
  const stateRoot = join(
    process.env.USERPROFILE ?? process.env.HOME ?? root,
    ".aphrody",
    "build-fleet",
    "requests",
  );
  if (operation === "status") {
    if (
      rest[0] !== "--id" ||
      !rest[1] ||
      !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(rest[1])
    )
      throw Error("Stable job id required");
    const file = join(stateRoot, rest[1] + ".json");
    const saved = JSON.parse(await readFile(file, "utf8"));
    const host = hosts.find((h) => h.id === saved.host?.id);
    if (!host) throw Error("Recorded host is not in fleet catalog");
    const script = `(async()=>{const fs=await import('node:fs'),path=await import('node:path'),os=await import('node:os');${processIdentitySource}
      const marker=path.join(os.homedir(),'.aphrody','build-fleet',${JSON.stringify(rest[1] + ".json")});
      if(!fs.existsSync(marker))throw Error('Remote marker missing; outcome remains indeterminate');
      const receipt=JSON.parse(fs.readFileSync(marker,'utf8'));
      if(receipt.fingerprint!==${JSON.stringify(saved.fingerprint)})throw Error('Remote fingerprint differs');
      if(receipt.state==='running' && (!receipt.processIdentity || await identity(receipt.pid)!==receipt.processIdentity))receipt.state='indeterminate';
      console.log(JSON.stringify(receipt));})().catch(e=>{console.error(e.message);process.exitCode=1})`;
    const result = await execute(host, script, 30);
    if (result.exitCode === 0) {
      saved.remote = JSON.parse(result.stdout.trim());
      saved.state = ["complete", "failed"].includes(saved.remote.state)
        ? "terminal"
        : "indeterminate";
      await writeFile(file, JSON.stringify(saved, null, 2), { mode: 0o600 });
    } else saved.reconciliationError = result.stderr;
    console.log(JSON.stringify(saved, null, 2));
    return 0;
  }
  if (operation === "readiness") {
    console.log(JSON.stringify(await inspectFleet(hosts), null, 2));
    return 0;
  }
  if (!["plan", "run"].includes(operation) || rest[0] !== "--file" || !rest[1])
    throw Error("Expected plan/run --file requests.json");
  const requests = JSON.parse(await Bun.file(rest[1]).text()) as FleetRequest[];
  if (
    !Array.isArray(requests) ||
    !requests.length ||
    new Set(requests.map((r) => r.id)).size !== requests.length
  )
    throw Error("Unique requests required");
  if (operation === "run") {
    const recorded = await Promise.all(
      requests.map(async (request) => {
        validateRequest(request);
        try {
          const existing = JSON.parse(
            await readFile(join(stateRoot, request.id + ".json"), "utf8"),
          );
          if (digest(existing.request) !== digest(request))
            throw Error(`Conflicting request ${request.id}`);
          return existing;
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
          return undefined;
        }
      }),
    );
    if (recorded.some(Boolean)) {
      if (!recorded.every(Boolean))
        throw Error("Partially recorded batch requires status reconciliation");
      console.log(JSON.stringify(recorded, null, 2));
      return recorded.every((r) => r.state === "terminal" && r.exitCode === 0)
        ? 0
        : 1;
    }
  }
  const readiness = await inspectFleet(hosts),
    occupied = new Set<string>();
  const plans = await Promise.all(
    requests.map(async (request) => {
      const host = selectHost(hosts, readiness, request, occupied);
      occupied.add(host.id);
      let command: string | undefined;
      if (request.kind === "build" && host.id === "vps") {
        const factory = await readFactoryConfig(root);
        if (
          !factory ||
          !request.repository ||
          factory.repositories[request.repository] !== request.workspace
        )
          throw Error("Canonical VPS repository required");
        const plan = buildFactoryPlan(
          factory,
          request.repository,
          request.revision!,
          request.command!,
        );
        command = plan.transport[5];
      }
      return {
        request,
        host,
        fingerprint: digest({ request, host }),
        sourcePin:
          request.revision ??
          createHash("sha256")
            .update(
              workerScript(host, request, digest({ request, host }), command),
            )
            .digest("hex"),
        command,
      };
    }),
  );
  console.log(JSON.stringify({ operation: "plan", readiness, plans }, null, 2));
  if (operation === "plan") return 0;
  await mkdir(stateRoot, { recursive: true });
  await Promise.all(
    plans.map(async (plan) => {
      const file = join(stateRoot, plan.request.id + ".json");
      try {
        const existing = JSON.parse(await readFile(file, "utf8"));
        if (existing.fingerprint !== plan.fingerprint)
          throw Error(`Conflicting request ${plan.request.id}`);
        throw Error(
          `Request ${plan.request.id} already recorded; reconcile status, never replay`,
        );
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }),
  );
  await Promise.all(
    plans.map((plan) =>
      writeFile(
        join(stateRoot, plan.request.id + ".json"),
        JSON.stringify(Object.assign({}, plan, { state: "reserved" })),
        { flag: "wx", mode: 0o600 },
      ),
    ),
  );
  const results = await Promise.all(
    plans.map(async (plan) => {
      const file = join(stateRoot, plan.request.id + ".json");
      const receipt = Object.assign({}, plan, {
        state: "dispatching",
        started: new Date().toISOString(),
      });
      await writeFile(file, JSON.stringify(receipt), { mode: 0o600 });
      try {
        const result = await execute(
          plan.host,
          workerScript(plan.host, plan.request, plan.fingerprint, plan.command),
          plan.request.kind === "probe" ? 60 : 21600,
        );
        const lines = result.stdout.trim().split("\n");
        let remote:
          | {
              id?: string;
              fingerprint?: string;
              host?: string;
              state?: string;
              exitCode?: number;
            }
          | undefined;
        try {
          remote = JSON.parse(lines.at(-1)!);
        } catch {}
        if (
          !remote ||
          remote.id !== plan.request.id ||
          remote.fingerprint !== plan.fingerprint ||
          remote.host !== plan.host.id ||
          !["complete", "failed"].includes(remote.state ?? "") ||
          remote.exitCode !== result.exitCode
        )
          remote = undefined;
        const final = Object.assign({}, receipt, {
          state: remote ? "terminal" : "indeterminate",
          exitCode: result.exitCode,
          remote,
          stderr: result.stderr.slice(-4096),
        });
        await writeFile(file, JSON.stringify(final, null, 2), { mode: 0o600 });
        return final;
      } catch (error) {
        await writeFile(
          file,
          JSON.stringify(
            Object.assign({}, receipt, {
              state: "indeterminate",
              error: String(error),
            }),
          ),
          { mode: 0o600 },
        );
        throw error;
      }
    }),
  );
  console.log(JSON.stringify(results, null, 2));
  return results.some((r) => r.exitCode !== 0 || r.state === "indeterminate")
    ? 1
    : 0;
}

if (import.meta.main) process.exit(await runBuildFleet(process.argv.slice(2)));
