// SPDX-License-Identifier: Apache-2.0
import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stageCliWasm, validateWasmInput, freezeWasmInput, type WasmBuildProvenance } from "./stage-cli-wasm.ts";
import { run, sha256Bytes, sha256File } from "./publish-downloads.ts";

const wasm = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]);
async function fixture() {
  const work = await mkdtemp(join(tmpdir(), "cli-wasm-stage-test-"));
  const input = join(work, "input");
  await mkdir(input);
  await writeFile(join(input, "aphrody_command_wasm_bg.wasm"), wasm);
  // Unit fixture covers packaging/loader mechanics; actual Rust commands use the qualified artifact smoke.
  await writeFile(
    join(input, "aphrody_command_wasm.js"),
    `
export default async function init(source) { await WebAssembly.instantiate(source.module_or_path); }
export function initSync(source) { new WebAssembly.Instance(new WebAssembly.Module(source.module)); }
export function version() { return "fixture"; }
export function run() { return JSON.stringify({code:0,stdout:"toolcall fixture",stderr:""}); }
export function abiVersion() { return 1; }
export function initPanicHook() {}
export function manifest() { return JSON.stringify({abi:1,json:[],vec:[]}); }
export function callJson(op,input) { return input; }
export function callVec(op,params,a,b) { return a; }
`,
  );
  await writeFile(
    join(input, "aphrody_command_wasm.d.ts"),
    `
export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;
export default function init(source?: {module_or_path: InitInput | Promise<InitInput>}): Promise<unknown>;
export function initSync(source: {module: BufferSource | WebAssembly.Module}): unknown;
export function run(args:string[],stdin:string,files:string):string;
export function version():string;
export function abiVersion():number;
export function initPanicHook():void;
export function manifest():string;
export function callJson(op:string,input:string):string;
export function callVec(op:string,params:string,a:Uint8Array,b:Uint8Array):Uint8Array;
`,
  );
  await writeFile(join(input, "aphrody_command_wasm_bg.wasm.d.ts"), "export {};\n");
  const provenance: WasmBuildProvenance = {
    source: {
      revision: "1".repeat(40),
      patches: [{ path: "tools/config/container/Dockerfile", sha256: "2".repeat(64) }],
    },
    wasm: { sha256: sha256Bytes(wasm), bytes: wasm.length },
    inputs: Object.fromEntries(
      await Promise.all(
        [
          "aphrody_command_wasm.js",
          "aphrody_command_wasm.d.ts",
          "aphrody_command_wasm_bg.wasm.d.ts",
          "aphrody_command_wasm_bg.wasm",
        ].map(async name => [
          name,
          {
            sha256: await sha256File(join(input, name)),
            bytes: Bun.file(join(input, name)).size,
          },
        ]),
      ),
    ),
  };
  return { work, input, provenance };
}

test("portable stage bundles the existing facade, emits usable declarations and keeps one WASM copy", async () => {
  const f = await fixture();
  try {
    const out = join(f.work, "out");
    const entries = await stageCliWasm({
      out,
      input: f.input,
      provenance: f.provenance,
    });
    expect(entries).toHaveLength(1);
    const entry = entries[0]!;
    expect(entry).toMatchObject({
      name: "aphrody-cli-wasm",
      platform: "wasm",
      target: "wasm32-unknown-unknown",
      kind: "wasm",
    });
    expect(await sha256File(join(out, entry.file))).toBe(entry.sha256);
    const contents = (await run(["tar", "-tzf", join(out, entry.file)])).stdout.trim().split(/\r?\n/);
    expect(contents.filter(name => name.endsWith(".wasm"))).toEqual(["aphrody_command_wasm_bg.wasm"]);
    expect(contents).toContain("index.d.ts");
    expect(contents).toContain("LICENSE");
    expect(contents).not.toContain("aphrody_command_wasm.js");
    const pack = join(f.work, "pack");
    await mkdir(pack);
    await run(["tar", "-xzf", join(out, entry.file), "-C", pack]);
    const metadata = JSON.parse(await readFile(join(pack, "provenance.json"), "utf8"));
    expect(metadata.packagingSource.facade.path).toBe("packages/cli-wasm/src/index.ts");
    expect(metadata.packagingSource.stage.path).toBe("scripts/aphrody/release/stage-cli-wasm.ts");
    expect(metadata.build).toEqual(f.provenance);
    expect(metadata.files["aphrody_command_wasm_bg.wasm"]).toEqual(f.provenance.wasm);
    const portable = await import(join(pack, "index.js"));
    const cli = await portable.loadCliWasm(wasm);
    expect(cli.version).toBe("fixture");
    expect(cli.run(["--help"]).code).toBe(0);
    expect(cli.rag.abiVersion).toBe(1);
    expect(JSON.parse(cli.rag.manifest()).abi).toBe(1);
    await writeFile(
      join(pack, "consumer.ts"),
      `import {loadCliWasm, type Cli, type Outcome} from "./index.js";
const cli: Cli = await loadCliWasm(new Uint8Array());
const outcome: Outcome = cli.run(["--help"], {stdin:"text",files:{"file":"text"}});
const ragAbi: number = cli.rag.abiVersion;
const vector: Uint8Array = cli.rag.callVec("normalize_f32", "{}", new Uint8Array(), new Uint8Array());
// @ts-expect-error readonly string arguments are required
cli.run([1]);
void outcome;
void ragAbi;
void vector;
`,
    );
    await run([
      process.execPath,
      "check",
      "--noEmit",
      "--target",
      "esnext",
      "--module",
      "preserve",
      "--moduleResolution",
      "bundler",
      "--skipLibCheck",
      join(pack, "consumer.ts"),
    ]);
  } finally {
    await rm(f.work, { recursive: true, force: true });
  }
});

test("qualified input rejects hash/size/source mismatch and linked or invalid modules", async () => {
  await Promise.all(
    ["hash", "size", "revision", "patch", "link", "invalid", "js", "types", "missing-hash"].map(async failure => {
      const f = await fixture();
      try {
        if (failure === "hash") f.provenance.wasm.sha256 = "3".repeat(64);
        if (failure === "size") f.provenance.wasm.bytes += 1;
        if (failure === "revision") f.provenance.source.revision = "unknown";
        if (failure === "js") await writeFile(join(f.input, "aphrody_command_wasm.js"), "unqualified glue");
        if (failure === "types") await writeFile(join(f.input, "aphrody_command_wasm.d.ts"), "unqualified types");
        if (failure === "missing-hash") delete f.provenance.inputs["aphrody_command_wasm.js"];
        if (failure === "patch") f.provenance.source.patches![0]!.path = "../escape";
        const path = join(f.input, "aphrody_command_wasm_bg.wasm");
        if (failure === "link") {
          await rm(path);
          await writeFile(join(f.work, "outside.wasm"), wasm);
          await symlink(join(f.work, "outside.wasm"), path);
        }
        if (failure === "invalid") {
          const bytes = new Uint8Array([1, 2, 3]);
          await writeFile(path, bytes);
          f.provenance.wasm = {
            sha256: sha256Bytes(bytes),
            bytes: bytes.length,
          };
          f.provenance.inputs["aphrody_command_wasm_bg.wasm"] = f.provenance.wasm;
        }
        await expect(validateWasmInput(f.input, f.provenance)).rejects.toThrow();
      } finally {
        await rm(f.work, { recursive: true, force: true });
      }
    }),
  );
});

test("bundling consumes frozen validated inputs even after the source glue changes", async () => {
  const f = await fixture();
  try {
    const frozen = join(f.work, "frozen");
    await freezeWasmInput(f.input, f.provenance, frozen);
    const previous = await readFile(join(frozen, "aphrody_command_wasm.js"), "utf8");
    await writeFile(join(f.input, "aphrody_command_wasm.js"), "source changed after freeze");
    await validateWasmInput(frozen, f.provenance);
    expect(await readFile(join(frozen, "aphrody_command_wasm.js"), "utf8")).toBe(previous);
    await expect(validateWasmInput(f.input, f.provenance)).rejects.toThrow("checksum");
  } finally {
    await rm(f.work, { recursive: true, force: true });
  }
});

test("prebuilt input cannot silently skip provenance", async () => {
  const f = await fixture();
  try {
    await expect(stageCliWasm({ out: join(f.work, "out"), input: f.input })).rejects.toThrow("provenance");
  } finally {
    await rm(f.work, { recursive: true, force: true });
  }
});

test.skipIf(!existsSync("/dev/shm"))("archive promotion works when output is on a separate tmpfs", async () => {
  const f = await fixture();
  const out = await mkdtemp("/dev/shm/aphrody-cli-wasm-test-");
  try {
    const entries = await stageCliWasm({
      input: f.input,
      provenance: f.provenance,
      out,
    });
    expect(await sha256File(join(out, entries[0]!.file))).toBe(entries[0]!.sha256);
  } finally {
    await rm(f.work, { recursive: true, force: true });
    await rm(out, { recursive: true, force: true });
  }
});
