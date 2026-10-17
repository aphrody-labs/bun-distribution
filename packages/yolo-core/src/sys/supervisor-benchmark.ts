// SPDX-License-Identifier: MIT
/** Paired process-lifecycle measurements using precompiled artifacts and disposable fixtures. */
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { hostTarget, libraryFileName, verifyArtifact } from "@aphrody/runtime-sdk/src/artifact.ts";

type Mode = "direct" | "native";
interface Sample {
  mode: Mode;
  elapsedMs: number;
  stdoutSha256: string;
  stderrSha256: string;
  stdoutBytes: number;
  stderrBytes: number;
  exitCode: number;
  rssBytes: number;
  maxRssKiB: number;
}
interface Pair {
  pair: number;
  order: Mode[];
  direct: Sample & { driverElapsedMs?: number };
  native: Sample & { driverElapsedMs?: number };
}
interface Options {
  samples?: number;
  artifact: string;
  sdkDirectory?: string;
}
const sha256 = (bytes: Uint8Array) => new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
const fixture =
  "process.stdout.write(Buffer.from(Array.from({length:4096},(_,i)=>i%251)));process.stderr.write(Buffer.from(Array.from({length:2048},(_,i)=>(250-i%251))));";

const driver = `
import {pathToFileURL} from "node:url";
import {join} from "node:path";
const options=JSON.parse(process.argv[2]);
const sha256=bytes=>new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
let native;
async function operation(mode){
  const command=[process.execPath,"-e",options.fixture];
  if(mode==="native"){
    native??=await import(pathToFileURL(join(options.sdkDirectory,"src/modules.ts")).href);
    using child=native.processes.spawn({program:command[0],args:command.slice(1),cwd:options.cwd,env:process.env,stdio:"capture-lossless"});
    const result=await child.collectOutput({timeoutMs:5000});
    return {stdout:result.stdout,stderr:result.stderr,code:result.status.signal>0?128+result.status.signal:result.status.exitCode};
  }
  const child=Bun.spawn(command,{cwd:options.cwd,env:process.env,stdin:"ignore",stdout:"pipe",stderr:"pipe",timeout:5000});
  const [stdout,stderr,code]=await Promise.all([new Response(child.stdout).arrayBuffer(),new Response(child.stderr).arrayBuffer(),child.exited]);
  return {stdout:new Uint8Array(stdout),stderr:new Uint8Array(stderr),code};
}
async function sample(mode){
  const start=performance.now();
  const output=await operation(mode);
  const elapsedMs=performance.now()-start;
  const rssBytes=process.memoryUsage().rss;
  const maxRssKiB=process.resourceUsage().maxRSS;
  const result={mode,elapsedMs,rssBytes,maxRssKiB,stdoutBytes:output.stdout.length,stderrBytes:output.stderr.length,stdoutSha256:sha256(output.stdout),stderrSha256:sha256(output.stderr),exitCode:output.code};
  if(output.code!==0||result.stdoutSha256!==options.stdoutSha256||result.stderrSha256!==options.stderrSha256)throw new Error("Benchmark output identity failed");
  return result;
}
try{
  if(options.phase==="cold"){
    console.log(JSON.stringify(await sample(options.mode)));
  }else{
    for(let i=0;i<3;i++){await sample("direct");await sample("native");}
    const pairs=[];
    for(let i=0;i<options.samples;i++){
      const order=i%2===0?["direct","native"]:["native","direct"];
      const first=await sample(order[0]);
      const second=await sample(order[1]);
      pairs.push({pair:i,order,direct:first.mode==="direct"?first:second,native:first.mode==="native"?first:second});
    }
    console.log(JSON.stringify(pairs));
  }
}finally{native?.closeSharedRuntime();}
`;

function distribution(values: number[]) {
  const sorted = [...values].toSorted((a, b) => a - b);
  const percentile = (p: number) => sorted[Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1)]!;
  return {
    count: sorted.length,
    min: sorted[0]!,
    p50: percentile(0.5),
    p90: percentile(0.9),
    p95: percentile(0.95),
    max: sorted.at(-1)!,
    mean: sorted.reduce((sum, value) => sum + value, 0) / sorted.length,
  };
}
function summarize(pairs: Pair[]) {
  const direct = pairs.map(pair => pair.direct.elapsedMs);
  const native = pairs.map(pair => pair.native.elapsedMs);
  return {
    directMs: distribution(direct),
    nativeMs: distribution(native),
    pairedNativeMinusDirectMs: distribution(pairs.map(pair => pair.native.elapsedMs - pair.direct.elapsedMs)),
    pairedNativeOverDirect: distribution(pairs.map(pair => pair.native.elapsedMs / pair.direct.elapsedMs)),
    directDriverMs:
      pairs[0]?.direct.driverElapsedMs === undefined
        ? undefined
        : distribution(pairs.map(pair => pair.direct.driverElapsedMs!)),
    nativeDriverMs:
      pairs[0]?.native.driverElapsedMs === undefined
        ? undefined
        : distribution(pairs.map(pair => pair.native.driverElapsedMs!)),
  };
}

export async function runSupervisorBenchmark(options: Options) {
  const samples = options.samples ?? 30;
  if (!Number.isInteger(samples) || samples < 10 || samples > 100)
    throw new RangeError("samples must be an integer in 10..100");
  const artifact = resolve(options.artifact);
  const manifest = verifyArtifact(artifact);
  const library = join(artifact, libraryFileName(manifest));
  const sdkDirectory = resolve(options.sdkDirectory ?? join(import.meta.dir, "../../../runtime-sdk"));
  const sdkIndex = join(sdkDirectory, "src/index.ts");
  const sdkModules = join(sdkDirectory, "src/modules.ts");
  const sdkArtifact = join(sdkDirectory, "src/artifact.ts");
  const sdk = await import(pathToFileURL(sdkArtifact).href);
  const runtime = sdk.loadArtifact(artifact);
  let build;
  try {
    build = runtime.buildInfo();
  } finally {
    runtime.close();
  }
  const temporary = await mkdtemp(join(tmpdir(), "yolo-supervisor-bench-"));
  const script = join(temporary, "driver.ts");
  await writeFile(script, driver);
  const output = {
    stdoutSha256: sha256(Uint8Array.from({ length: 4096 }, (_, i) => i % 251)),
    stderrSha256: sha256(Uint8Array.from({ length: 2048 }, (_, i) => 250 - (i % 251))),
  };
  const base = { samples, fixture, sdkDirectory, cwd: temporary, ...output };
  const invoke = async (phase: "cold" | "warm", mode?: Mode) => {
    const started = performance.now();
    const child = Bun.spawn([process.execPath, script, JSON.stringify({ ...base, phase, mode })], {
      windowsHide: true,
      cwd: temporary,
      env: { ...process.env, YOLO_RUNTIME_LIB: library },
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
      timeout: 30_000,
    });
    const [stdout, stderr, code] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    const elapsedMs = performance.now() - started;
    if (code !== 0) throw new Error("Benchmark driver failed: " + stderr.trim());
    return { value: JSON.parse(stdout) as Sample | Pair[], elapsedMs };
  };
  try {
    const cold: Pair[] = [];
    for (let pair = 0; pair < samples; pair++) {
      const order: Mode[] = pair % 2 === 0 ? ["direct", "native"] : ["native", "direct"];
      // Each pair depends on the previous one; simultaneous workloads would invalidate the comparison.
      // oxlint-disable-next-line no-await-in-loop
      const first = await invoke("cold", order[0]);
      // oxlint-disable-next-line no-await-in-loop
      const second = await invoke("cold", order[1]);
      const a = {
        ...(first.value as Sample),
        driverElapsedMs: first.elapsedMs,
      };
      const b = {
        ...(second.value as Sample),
        driverElapsedMs: second.elapsedMs,
      };
      cold.push({
        pair,
        order,
        direct: a.mode === "direct" ? a : b,
        native: a.mode === "native" ? a : b,
      });
    }
    const warm = (await invoke("warm")).value as Pair[];
    return {
      schema: "yolo.supervisor-benchmark/1",
      timestamp: new Date().toISOString(),
      target: hostTarget(),
      bunVersion: Bun.version,
      bunRevision: Bun.revision,
      artifact: {
        directory: artifact,
        manifestSha256: sha256(await readFile(join(artifact, "manifest.json"))),
        librarySha256: sha256(await readFile(library)),
        libraryBytes: (await stat(library)).size,
        build,
      },
      sdk: {
        packageVersion: JSON.parse(await readFile(join(sdkDirectory, "package.json"), "utf8")).version,
        indexSha256: sha256(await readFile(sdkIndex)),
        modulesSha256: sha256(await readFile(sdkModules)),
        artifactSha256: sha256(await readFile(sdkArtifact)),
      },
      protocol: {
        samplesPerModePerPhase: samples,
        pairOrder: "Alternating direct/native and native/direct; sequential execution",
        cold: "Fresh Bun driver and SDK/native context for each operation; OS page cache retained",
        coldDriverMs:
          "Entire fresh driver process through stdout/stderr collection and exit, including native context unload",
        warm: "One driver with one shared native context; three unmeasured pairs before samples; child collect/release included; final shared-context unload excluded",
        command: [process.execPath, "-e", fixture],
        stdio: "Both paths ignore stdin and losslessly capture identical stdout/stderr",
        identity: {
          exitCode: 0,
          stdoutBytes: 4096,
          stderrBytes: 2048,
          ...output,
        },
        memory:
          "Cold RSS/maximum RSS describe each fresh driver; warm RSS includes both modes and the shared native context, so it cannot establish separate memory gains",
        limit:
          "10..100 samples; disposable fixtures; no engine build, cache cleanup, protected data or service workload",
      },
      cold: { summary: summarize(cold), pairs: cold },
      warm: { summary: summarize(warm), pairs: warm },
      limits: [
        "One current Linux x64 core artifact and one deterministic short-lived process workload only",
        "Cold means process/context cold, not OS page-cache cold",
        "No desktop, browser, JSC parity, build-time, bundled-size or cross-platform gains are established",
        "The comparison measures direct Bun.spawn against native supervision with stronger process-group/capture lifecycle ownership",
        "Raw paired data is authoritative; no general speedup is inferred",
      ],
    };
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

export async function runSupervisorBenchCli(args: readonly string[]): Promise<number> {
  if (args.includes("--help") || args.includes("-h")) {
    console.log(
      "Usage: yolo bench --supervisor --artifact DIR [--sdk-dir DIR] [--samples 10..100] [--json]. Paired fresh/warm process lifecycles; identical disposable fixtures, no build or cache cleanup.",
    );
    return 0;
  }
  const options: Options = { artifact: "" };
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === "--supervisor" || arg === "--json") continue;
    if (arg !== "--artifact" && arg !== "--sdk-dir" && arg !== "--samples")
      throw new Error("Unknown benchmark option: " + arg);
    const value = args[++index];
    if (!value || value.startsWith("--")) throw new Error("Missing value for " + arg);
    if (arg === "--artifact") options.artifact = value;
    else if (arg === "--sdk-dir") options.sdkDirectory = value;
    else options.samples = Number(value);
  }
  if (!options.artifact) throw new Error("--artifact is required");
  console.log(JSON.stringify(await runSupervisorBenchmark(options), null, 2));
  return 0;
}
if (import.meta.main) {
  void runSupervisorBenchCli(Bun.argv.slice(2)).then(
    code => {
      process.exitCode = code;
      return;
    },
    (error: unknown) => {
      console.error(`yolo bench: ${error instanceof Error ? error.message : String(error)}`);
      process.exitCode = 2;
    },
  );
}
