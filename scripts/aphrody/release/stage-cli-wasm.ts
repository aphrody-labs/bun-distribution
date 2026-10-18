#!/usr/bin/env bun
// SPDX-License-Identifier: Apache-2.0
/** Portable browser/Bun/Node package of the existing typed pure-command facade and Rust WASM. */
import { createHash } from "node:crypto";
import { copyFile, lstat, mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { buildWasmPackage } from "../build/rust/wasm-package.ts";
import { run, scanBytes, scanName, loadConfig, sha256File, type StagedEntry } from "./publish-downloads.ts";

const repository = resolve(import.meta.dir, "../../..");
const wasmName = "aphrody_command_wasm";
const wasmFile = `${wasmName}_bg.wasm`;
const generatedFiles = [`${wasmName}.js`, `${wasmName}.d.ts`, `${wasmName}_bg.wasm.d.ts`, wasmFile];

export interface WasmBuildProvenance {
  source: { revision: string; patches?: { path: string; sha256: string }[] };
  wasm: { sha256: string; bytes: number };
  inputs: Record<string, { sha256: string; bytes: number }>;
  [key: string]: unknown;
}

export interface WasmStageOptions {
  out: string;
  /** Qualified wasm-bindgen output. Omitting this builds through the existing factory owner. */
  input?: string;
  provenance?: WasmBuildProvenance;
  root?: string;
}

export async function validateWasmInput(input: string, provenance: WasmBuildProvenance) {
  if (
    !provenance?.source ||
    !/^[0-9a-f]{40}$/.test(provenance.source.revision) ||
    !provenance.wasm ||
    !/^[0-9a-f]{64}$/.test(provenance.wasm.sha256) ||
    !Number.isSafeInteger(provenance.wasm.bytes) ||
    provenance.wasm.bytes <= 0 ||
    !provenance.inputs ||
    Object.keys(provenance.inputs).length !== generatedFiles.length ||
    generatedFiles.some(
      name =>
        !Object.hasOwn(provenance.inputs, name) ||
        !/^[0-9a-f]{64}$/.test(provenance.inputs[name]!.sha256) ||
        !Number.isSafeInteger(provenance.inputs[name]!.bytes) ||
        provenance.inputs[name]!.bytes <= 0,
    ) ||
    provenance.inputs[wasmFile]!.sha256 !== provenance.wasm.sha256 ||
    provenance.inputs[wasmFile]!.bytes !== provenance.wasm.bytes ||
    (provenance.source.patches !== undefined &&
      (!Array.isArray(provenance.source.patches) ||
        provenance.source.patches.some(
          patch =>
            !patch ||
            typeof patch.path !== "string" ||
            patch.path.startsWith("/") ||
            patch.path.includes("\\") ||
            patch.path.split("/").some(part => !part || part === "..") ||
            !/^[0-9a-f]{64}$/.test(patch.sha256),
        )))
  )
    throw new Error("invalid qualified WASM provenance");
  if (!(await lstat(input)).isDirectory()) throw new Error("WASM input must be a regular directory");
  await Promise.all(
    generatedFiles.map(async name => {
      if (!(await lstat(join(input, name))).isFile()) throw new Error(`WASM input must be regular: ${name}`);
      const file = Bun.file(join(input, name));
      if (
        file.size !== provenance.inputs[name]!.bytes ||
        (await sha256File(join(input, name))) !== provenance.inputs[name]!.sha256
      )
        throw new Error(`qualified WASM input size or checksum mismatch: ${name}`);
    }),
  );
  const module = await Bun.file(join(input, wasmFile)).arrayBuffer();
  const hash = createHash("sha256").update(new Uint8Array(module)).digest("hex");
  if (module.byteLength !== provenance.wasm.bytes || hash !== provenance.wasm.sha256)
    throw new Error("qualified WASM size or checksum mismatch");
  if (!WebAssembly.validate(module)) throw new Error("qualified WASM module is invalid");
}

/** Freeze every generated input before the bundler or type compiler can consume it. */
export async function freezeWasmInput(input: string, provenance: WasmBuildProvenance, frozen: string) {
  if (!(await lstat(input)).isDirectory()) throw new Error("WASM input must be a regular directory");
  await mkdir(frozen);
  await Promise.all(
    generatedFiles.map(async name => {
      const source = join(input, name);
      if (!(await lstat(source)).isFile()) throw new Error(`WASM input must be regular: ${name}`);
      await copyFile(source, join(frozen, name));
    }),
  );
  await validateWasmInput(frozen, provenance);
}

export async function stageCliWasm(options: WasmStageOptions): Promise<StagedEntry[]> {
  const root = options.root ?? repository;
  const app = join(root, "packages/cli-wasm");
  const pkg = JSON.parse(await readFile(join(app, "package.json"), "utf8"));
  const commit = (await run(["git", "rev-parse", "HEAD"], { cwd: root })).stdout.trim();
  const out = resolve(options.out);
  // The archive is promoted by rename; /tmp may be a separate tmpfs on the factory.
  await mkdir(out, { recursive: true });
  const work = await mkdtemp(join(out, ".aphrody-cli-wasm-stage-"));
  try {
    const source = options.input ? resolve(options.input) : join(work, "generated");
    let provenance = options.provenance;
    if (options.input && !provenance) throw new Error("--input requires qualified build provenance");
    if (!options.input) {
      const dirty = (
        await run(["git", "status", "--porcelain", "--untracked-files=no"], {
          cwd: root,
        })
      ).stdout;
      if (dirty.trim())
        throw new Error(
          "default WASM staging requires a clean tracked source checkout; use qualified --input for a composite build",
        );
      const built = await buildWasmPackage(
        {
          crate: "aphrody-command-wasm",
          name: wasmName,
          out: source,
        },
        { root },
      );
      provenance = {
        source: { revision: commit },
        wasm: { sha256: await sha256File(built.wasm), bytes: built.bytes },
        inputs: Object.fromEntries(
          await Promise.all(
            generatedFiles.map(async name => [
              name,
              {
                sha256: await sha256File(join(source, name)),
                bytes: Bun.file(join(source, name)).size,
              },
            ]),
          ),
        ),
        builder: "scripts/build/rust/wasm-package.ts",
        optimization: built.optimization,
        rawBytes: built.rawBytes,
      };
    }
    const input = join(work, "qualified-input");
    await freezeWasmInput(source, provenance!, input);
    const pack = join(work, "pack");
    await mkdir(pack);
    const generated = join(input, `${wasmName}.js`);
    const bundled = await Bun.build({
      entrypoints: [join(app, "src/index.ts")],
      target: "browser",
      format: "esm",
      minify: true,
      outdir: pack,
      naming: "index.js",
      plugins: [
        {
          name: "qualified-cli-wasm",
          setup(build) {
            build.onResolve({ filter: /^#cli-wasm-glue$/ }, () => ({
              path: generated,
            }));
          },
        },
      ],
    });
    if (!bundled.success) throw new Error(`WASM facade bundle failed: ${bundled.logs.join("\n")}`);
    const tsconfig = join(work, "tsconfig.json");
    await writeFile(
      tsconfig,
      JSON.stringify({
        compilerOptions: {
          target: "ESNext",
          module: "ESNext",
          moduleResolution: "Bundler",
          lib: ["ESNext", "DOM"],
          strict: true,
          skipLibCheck: true,
          declaration: true,
          emitDeclarationOnly: true,
          rootDir: join(app, "src"),
          outDir: join(work, "declarations"),
          paths: { "#cli-wasm-glue": [join(input, `${wasmName}.d.ts`)] },
        },
        files: [join(app, "src/index.ts")],
      }),
    );
    await mkdir(join(work, "declarations"));
    await run(
      [
        process.execPath,
        "check",
        "--project",
        tsconfig,
        "--emitDeclarationOnly=true",
        "--declaration=true",
        "--noEmit=false",
        "--rootDir",
        join(app, "src"),
        "--outDir",
        join(work, "declarations"),
        join(app, "src/index.ts"),
      ],
      { cwd: root },
    );
    await copyFile(join(work, "declarations/index.d.ts"), join(pack, "index.d.ts"));
    await copyFile(join(input, `${wasmName}.d.ts`), join(pack, `${wasmName}.d.ts`));
    await copyFile(join(input, wasmFile), join(pack, wasmFile));
    // Verify copied module, not mutable source bytes, before producing distribution metadata.
    if ((await sha256File(join(pack, wasmFile))) !== provenance!.wasm.sha256)
      throw new Error("qualified WASM changed during staging");
    await copyFile(join(root, "LICENSE-APACHE"), join(pack, "LICENSE"));
    await writeFile(
      join(pack, "package.json"),
      JSON.stringify(
        {
          name: pkg.name,
          version: pkg.version,
          type: "module",
          license: "Apache-2.0",
          exports: {
            ".": {
              types: "./index.d.ts",
              import: "./index.js",
              default: "./index.js",
            },
            "./wasm": `./${wasmFile}`,
          },
          imports: { "#cli-wasm-glue": { types: `./${wasmName}.d.ts` } },
        },
        null,
        2,
      ) + "\n",
    );
    await writeFile(join(pack, "README.md"), await readFile(join(app, "README.md"), "utf8"));
    const hashes: Record<string, { sha256: string; bytes: number }> = {};
    await Promise.all(
      ["index.js", "index.d.ts", `${wasmName}.d.ts`, wasmFile, "package.json", "LICENSE", "README.md"].map(
        async name => {
          const file = Bun.file(join(pack, name));
          hashes[name] = {
            sha256: await sha256File(file.name!),
            bytes: file.size,
          };
        },
      ),
    );
    await writeFile(
      join(pack, "provenance.json"),
      JSON.stringify(
        {
          schemaVersion: 1,
          packagingRevision: commit,
          packagingSource: {
            facade: {
              path: "packages/cli-wasm/src/index.ts",
              sha256: await sha256File(join(app, "src/index.ts")),
            },
            stage: {
              path: "scripts/release/stage-cli-wasm.ts",
              sha256: await sha256File(join(root, "scripts/release/stage-cli-wasm.ts")),
            },
          },
          build: provenance,
          target: "wasm32-unknown-unknown",
          bundler: {
            runtime: "Bun",
            version: Bun.version,
            target: "browser",
            minify: true,
          },
          files: hashes,
        },
        null,
        2,
      ) + "\n",
    );
    const secrets = loadConfig().secrets;
    await Promise.all(
      [...Object.keys(hashes), "provenance.json"].map(async name => {
        const bytes = new Uint8Array(await Bun.file(join(pack, name)).arrayBuffer());
        if (scanName(name, secrets.deniedNames).length || scanBytes(name, bytes, secrets.contentPatterns).length)
          throw new Error(`secret scan failed for WASM package ${name}`);
      }),
    );
    const file = `aphrody-cli-wasm-${pkg.version}-${commit.slice(0, 9)}-wasm32-unknown-unknown.tar.gz`;
    await run(["tar", "-czf", join(work, file), "-C", pack, ...[...Object.keys(hashes), "provenance.json"].toSorted()]);
    const entries: StagedEntry[] = [
      {
        name: "aphrody-cli-wasm",
        version: pkg.version,
        platform: "wasm",
        target: "wasm32-unknown-unknown",
        kind: "wasm",
        file,
        size: Bun.file(join(work, file)).size,
        sha256: await sha256File(join(work, file)),
      },
    ];
    await mkdir(out, { recursive: true });
    await rename(join(work, file), join(out, file));
    await writeFile(join(out, "aphrody-cli-wasm.manifest.json"), JSON.stringify(entries, null, 2) + "\n");
    await writeFile(join(out, "SHA256SUMS"), `${entries[0]!.sha256}  ${file}\n`);
    return entries;
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

if (import.meta.main) {
  const args = Bun.argv.slice(2);
  const flag = (name: string) => {
    const at = args.indexOf(name);
    return at < 0 ? undefined : args[at + 1];
  };
  const provenanceFile = flag("--provenance");
  const entries = await stageCliWasm({
    out: flag("--out") ?? join(repository, "dist/cli-wasm"),
    input: flag("--input"),
    provenance: provenanceFile ? await Bun.file(provenanceFile).json() : undefined,
  });
  console.log(JSON.stringify(entries, null, 2));
}
