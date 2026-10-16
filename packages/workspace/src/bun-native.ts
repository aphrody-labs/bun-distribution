// SPDX-License-Identifier: Apache-2.0
/** Build and qualify the aggregate aphrody-ffi artifact for @aphrody/bun. */
import { copyFile, cp, mkdir, mkdtemp, rename, rm } from "node:fs/promises";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { suffix } from "bun:ffi";

interface CargoPackage {
  id: string;
  name: string;
  version: string;
  manifest_path: string;
  features: Record<string, string[]>;
}
interface CargoMetadata {
  packages: CargoPackage[];
  target_directory: string;
}

async function execute(
  command: string[],
  cwd: string,
  signal: AbortSignal,
  env = process.env,
  inheritStderr = false,
): Promise<{ stdout: string; stderr: string; code: number }> {
  signal.throwIfAborted();
  // Each invocation owns its process group, including Cargo/rustc descendants.
  const child = Bun.spawn(command, {
    windowsHide: true,
    cwd,
    env,
    detached: process.platform !== "win32",
    stdin: "ignore",
    stdout: "pipe",
    stderr: inheritStderr ? "inherit" : "pipe",
  });
  const stop = () => {
    if (process.platform === "win32") {
      Bun.spawnSync(["taskkill", "/PID", String(child.pid), "/T", "/F"], {
        windowsHide: true,
        stdout: "ignore",
        stderr: "ignore",
      });
    } else {
      try {
        process.kill(-child.pid, "SIGKILL");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
      }
    }
  };
  signal.addEventListener("abort", stop, { once: true });
  try {
    if (signal.aborted) stop();
    const [stdout, stderr] = await Promise.all([
      new Response(child.stdout).text(),
      child.stderr instanceof ReadableStream
        ? new Response(child.stderr).text()
        : "",
      child.exited,
    ]);
    signal.throwIfAborted();
    return { stdout, stderr, code: child.exitCode ?? 1 };
  } finally {
    signal.removeEventListener("abort", stop);
    if (child.exitCode === null && child.signalCode === null) stop();
  }
}

async function output(
  command: string[],
  cwd: string,
  signal: AbortSignal,
): Promise<string> {
  const { stdout, stderr, code } = await execute(command, cwd, signal);
  if (code !== 0)
    throw new Error(
      `${command[0]} ${command[1]} failed (${code}): ${stderr.trim()}`,
    );
  return stdout;
}

async function sha256(path: string): Promise<string> {
  const hash = new Bun.CryptoHasher("sha256");
  for await (const chunk of Bun.file(
    path,
  ).stream() as unknown as AsyncIterable<Uint8Array>)
    hash.update(chunk);
  return hash.digest("hex");
}

/** Native verification must import the selected consumer, independent of host package resolution. */
export function renderNativeConsumerImports(packageRoot: string): string {
  const modules = {
    m3: "index",
    oxc: "oxc",
    n2b: "n2b",
    cli: "cli",
    web: "web",
  };
  return Object.entries(modules)
    .map(
      ([name, file]) =>
        `const ${name} = await import(${JSON.stringify(pathToFileURL(join(packageRoot, "src", `${file}.ts`)).href)});`,
    )
    .join("\n");
}

/** Copy the selected SDK's source dependency closure, never the host's runtime state. */
export async function stageNativeConsumer(
  packageRoot: string,
  staging: string,
): Promise<string> {
  const seen = new Map<string, string>();
  async function stage(source: string): Promise<string> {
    source = realpathSync(source);
    const pkg = JSON.parse(
      readFileSync(join(source, "package.json"), "utf8"),
    ) as {
      name: string;
      dependencies?: Record<string, string>;
    };
    if (!/^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/i.test(pkg.name))
      throw new Error("invalid native SDK dependency name");
    const previous = seen.get(pkg.name);
    if (previous && previous !== source)
      throw new Error(`conflicting native SDK dependency: ${pkg.name}`);
    const destination = join(staging, "node_modules", pkg.name);
    if (previous) return destination;
    seen.set(pkg.name, source);
    await cp(join(source, "src"), join(destination, "src"), {
      recursive: true,
    });
    await copyFile(
      join(source, "package.json"),
      join(destination, "package.json"),
    );
    // Build the Paths package from its own source for the isolated consumer.
    if (pkg.name === "@aphrody/paths") {
      const entrypoint = join(source, "src/index.ts");
      const inputs = [entrypoint].map((path) => ({
        path: relative(source, path).replaceAll(sep, "/"),
        sha256: new Bun.CryptoHasher("sha256")
          .update(readFileSync(path))
          .digest("hex"),
      }));
      const bundle = await Bun.build({
        entrypoints: [entrypoint],
        target: "bun",
        packages: "external",
      });
      if (!bundle.success || bundle.outputs.length !== 1)
        throw new Error(
          "Cannot build canonical Paths facade for the native SDK",
        );
      const bytes = new Uint8Array(await bundle.outputs[0]!.arrayBuffer());
      await Bun.write(join(destination, "src/index.ts"), bytes);
      await Bun.write(
        join(destination, "source-provenance.json"),
        JSON.stringify({
          schemaVersion: 1,
          package: pkg.name,
          inputs,
          output: {
            path: "src/index.ts",
            sha256: new Bun.CryptoHasher("sha256").update(bytes).digest("hex"),
          },
          runtime: { version: Bun.version, revision: Bun.revision },
        }) + "\n",
      );
    }
    const require = createRequire(join(source, "package.json"));
    for (const name of Object.keys(pkg.dependencies ?? {})) {
      let dependency = dirname(require.resolve(name));
      while (
        !existsSync(join(dependency, "package.json")) ||
        JSON.parse(readFileSync(join(dependency, "package.json"), "utf8"))
          .name !== name
      ) {
        const parent = dirname(dependency);
        if (parent === dependency)
          throw new Error(`native SDK dependency owner missing: ${name}`);
        dependency = parent;
      }
      // Keep dependency ownership checks and shared staging mutations ordered.
      // eslint-disable-next-line no-await-in-loop
      await stage(dependency);
    }
    return destination;
  }
  return stage(packageRoot);
}

/** Qualify a selected aggregate against the isolated SDK before publication. */
export async function smokeNativeConsumer(
  packageRoot: string,
  artifact: string,
  cwd: string,
  signal: AbortSignal,
  debug: boolean,
): Promise<void> {
  // The child owns all bindings and fixture resources; no native state enters the build process.
  const source = `
    import assert from "node:assert/strict";
    import { dlopen } from "bun:ffi";
    import { mkdtemp, rm } from "node:fs/promises";
    import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
    import { join } from "node:path";
    const { NATIVE_ABI_VERSIONS: expected } = await import(${JSON.stringify(join(packageRoot, "src/native-artifact.ts"))});
    const abi = dlopen(${JSON.stringify(artifact)}, Object.fromEntries(
      Object.keys(expected).map(name => [name, { args: [], returns: "u32" }])
    ));
    try {
      for (const [name, version] of Object.entries(expected)) assert.equal(abi.symbols[name](), version, name);
    } finally { abi.close(); }
    const binding = await import(${JSON.stringify(join(packageRoot, "src/library.ts"))});
    const root = await mkdtemp(join(tmpdir(), "aphrody-native-stage-"));
    try {
      ${renderNativeConsumerImports(packageRoot)}
      assert.equal(m3.add(2, 3), 5);
      assert.equal(cli.getAphrodyAbiVersion(), expected.aphrody_abi_version);
      const captured = cli.runAphrodyCaptured(["--version"]);
      assert.equal(captured.code, 0);
      assert.match(captured.stdout, /aphrody/i);
      assert.match(web.webStripTags("<p>native fixture</p>"), /native fixture/);
      assert.equal(oxc.formatSource("const x=1;", "fixture.js"), "const x = 1;\\n");
      assert.equal(typeof oxc.minifySource("const x=1;", "fixture.js"), "string");
      assert.ok(Array.isArray(oxc.lintSource("const x=1;", "fixture.js")));
      const input = "#!/usr/bin/env node\\nconsole.log('hello');\\n";
      await Bun.write(join(root, "index.js"), input);
      const report = n2b.scanNodeProject(root, { mode: "check", dry_run: true });
      assert.equal(report.schema_version, 2);
      assert.ok(report.findings_total > 0);
      assert.equal(await Bun.file(join(root, "index.js")).text(), input);
      assert.equal(globalThis[Symbol.for("aphrody.ffi.library.v1")].path, ${JSON.stringify(artifact)});
      console.log("aggregate native consumer verified");
    } finally {
      binding.closeNativeLibrary();
      await rm(root, { recursive: true, force: true });
    }
  `;
  const { stdout, stderr, code } = await execute(
    [process.execPath, "-e", source],
    cwd,
    signal,
    {
      ...process.env,
      APHRODY_FFI_LIB: undefined,
      APHRODY_FFI_DEV: debug ? "1" : undefined,
      YOLO_TOOLING_LIB: artifact,
      CARGO_TARGET_DIR: join(cwd, "no-cargo-artifacts"),
    },
  );
  if (code !== 0 || stdout.trim() !== "aggregate native consumer verified") {
    throw new Error(
      `staged native consumer failed (${code}): ${stderr.trim()} ${stdout.trim()}`,
    );
  }
}

/** Preserve the ops dispatcher; --package-root selects an isolated consumer staging copy. */
export async function runBunNative(
  argv: string[],
  options: { signal?: AbortSignal } = {},
): Promise<number> {
  const controller = new AbortController();
  const abort = () => controller.abort(new Error("native operation aborted"));
  process.on("SIGINT", abort);
  process.on("SIGTERM", abort);
  options.signal?.addEventListener("abort", abort, { once: true });
  if (options.signal?.aborted) abort();
  const signal = controller.signal;
  try {
    let repo = process.cwd();
    let packageRoot: string | undefined;
    let existingArtifact: string | undefined;
    let expectedHash: string | undefined;
    const flags = new Set<string>();
    for (const arg of argv) {
      if (arg.startsWith("--root=") && arg.slice(7)) repo = arg.slice(7);
      else if (arg.startsWith("--package-root=") && arg.slice(15))
        packageRoot = arg.slice(15);
      else if (arg.startsWith("--stage-existing=") && arg.slice(17))
        existingArtifact = arg.slice(17);
      else if (
        arg.startsWith("--artifact-sha256=") &&
        /^[a-f0-9]{64}$/.test(arg.slice(18))
      )
        expectedHash = arg.slice(18);
      else if (
        [
          "--unlocked",
          "--gpu",
          "--jobs",
          "--inference",
          "--debug",
          "--offline",
        ].includes(arg)
      )
        flags.add(arg);
      else {
        console.error(`bun-native: unknown argument ${arg}`);
        console.error(
          "usage: bun-native [--root=<monorepo>] [--package-root=<consumer>] [--debug] [--gpu] [--jobs] [--inference] [--offline] [--unlocked] [--stage-existing=<debug-artifact>] [--artifact-sha256=<hex>]",
        );
        return 2;
      }
    }
    repo = resolve(repo);
    if (existingArtifact && (!flags.has("--debug") || flags.has("--gpu")))
      throw new Error(
        "staging an existing artifact requires --debug and forbids --gpu; build features are unknown",
      );
    if (expectedHash && !existingArtifact)
      throw new Error("--artifact-sha256 requires --stage-existing");
    if (existingArtifact && flags.has("--jobs"))
      throw new Error(
        "staging an existing artifact forbids --jobs; build features are unknown",
      );
    packageRoot = resolve(packageRoot ?? join(repo, "packages/interop/native"));
    const manifest = join(repo, "Cargo.toml");
    const ffiManifest = join(repo, "crates/interop/ffi/Cargo.toml");
    if (!existsSync(ffiManifest))
      throw new Error(`aggregate crate missing: ${ffiManifest}`);
    const pkg = await Bun.file(join(packageRoot, "package.json")).json();
    if (pkg.name !== "@aphrody/bun")
      throw new Error(`consumer is not @aphrody/bun: ${packageRoot}`);
    for (const file of [
      "library.ts",
      "native-artifact.ts",
      "index.ts",
      "n2b.ts",
      "oxc.ts",
    ]) {
      if (!existsSync(join(packageRoot, "src", file)))
        throw new Error(`consumer source missing: ${file}`);
    }
    const locked = flags.has("--unlocked") ? [] : ["--locked"];
    const offline = flags.has("--offline") ? ["--offline"] : [];
    const metadata = existingArtifact
      ? undefined
      : (JSON.parse(
          await output(
            [
              "cargo",
              "metadata",
              "--manifest-path",
              manifest,
              "--no-deps",
              "--format-version",
              "1",
              ...locked,
              ...offline,
            ],
            repo,
            signal,
          ),
        ) as CargoMetadata);
    const ffi = metadata?.packages.find(
      (candidate) => candidate.name === "aphrody-ffi",
    );
    if (
      !existingArtifact &&
      (!ffi || resolve(ffi.manifest_path) !== ffiManifest)
    )
      throw new Error("Cargo metadata did not resolve the aggregate owner");
    if (flags.has("--gpu") && !ffi?.features.gpu?.includes("aphrody-bun/gpu")) {
      throw new Error(
        "aphrody-ffi does not forward the GPU feature to aphrody-bun",
      );
    }
    if (
      flags.has("--jobs") &&
      !ffi?.features.jobs?.includes("aphrody-command/jobs")
    ) {
      throw new Error(
        "aphrody-ffi does not forward the jobs feature to aphrody-command",
      );
    }
    if (
      flags.has("--inference") &&
      !ffi?.features.inference?.includes("dep:aphrody-llama-server")
    ) {
      throw new Error(
        "aphrody-ffi does not expose the native llama inference owner",
      );
    }
    const rustc = await output(
      ["rustc", "--version", "--verbose"],
      repo,
      signal,
    );
    const triple = rustc.match(/^host: (\S+)$/m)?.[1];
    if (!triple) throw new Error("rustc did not report its host target");
    const profile = flags.has("--debug") ? "debug" : "release";
    const features = ["gpu", "jobs", "inference"].filter((feature) =>
      flags.has(`--${feature}`),
    );
    const sourceBefore = existingArtifact
      ? null
      : (
          await output(["git", "rev-parse", "HEAD"], repo, signal).catch(
            () => "",
          )
        ).trim();
    const dirtyBefore = existingArtifact
      ? true
      : (
          await output(["git", "status", "--porcelain"], repo, signal).catch(
            () => "unknown",
          )
        ).trim().length > 0;
    const command = [
      "cargo",
      "build",
      "--manifest-path",
      manifest,
      "-p",
      "aphrody-ffi",
      "--lib",
      "--message-format=json-render-diagnostics",
      ...locked,
      ...offline,
      ...(profile === "release" ? ["--release"] : []),
      ...(features.length ? ["--features", features.join(",")] : []),
    ];
    const serialScript = join(
      repo,
      process.platform === "win32"
        ? "scripts/build/rust/cargo-serial.ts"
        : "scripts/build/rust/cargo-serial.sh",
    );
    if (!existingArtifact && !existsSync(serialScript))
      throw new Error(`Cargo serialization wrapper missing: ${serialScript}`);
    const serializedCommand =
      process.platform === "win32"
        ? [process.execPath, serialScript, "--msvc", ...command.slice(1)]
        : ["bash", serialScript, ...command.slice(1)];
    if (!existingArtifact) console.log(`[bun-native] ${command.join(" ")}`);
    const { stdout: messages, code } = existingArtifact
      ? { stdout: "", code: 0 }
      : await execute(serializedCommand, repo, signal, process.env, true);
    if (code !== 0) return code;
    const filename = `${process.platform === "win32" ? "" : "lib"}aphrody_ffi.${suffix}`;
    const artifact = existingArtifact
      ? resolve(existingArtifact)
      : messages
          .split("\n")
          .filter(Boolean)
          .map(
            (line) =>
              JSON.parse(line) as {
                reason: string;
                package_id?: string;
                filenames?: string[];
              },
          )
          .find(
            (message) =>
              message.reason === "compiler-artifact" &&
              message.package_id === ffi!.id,
          )
          ?.filenames?.find((path) => basename(path) === filename);
    if (!artifact)
      throw new Error("Cargo did not produce the aggregate cdylib");
    const artifactTarget = metadata
      ? relative(metadata.target_directory, artifact).split(sep)[0]
      : triple;
    if (artifactTarget !== profile && artifactTarget !== triple) {
      throw new Error(
        `cross target ${artifactTarget} cannot be qualified on ${triple}`,
      );
    }
    // Observe the build's source before temporary package copies introduce untracked files.
    const observedSourceHead = (
      await output(["git", "rev-parse", "HEAD"], repo, signal)
    ).trim();
    const observedSourceDirty =
      (await output(["git", "status", "--porcelain"], repo, signal)).trim()
        .length > 0;
    const cargoLockSha256 = await sha256(join(repo, "Cargo.lock"));
    const directory = join(packageRoot, "native", triple);
    await mkdir(directory, { recursive: true });
    const staging = await mkdtemp(join(tmpdir(), "aphrody-native-stage-"));
    try {
      const isolatedConsumer = await stageNativeConsumer(packageRoot, staging);
      const isolatedNative = join(isolatedConsumer, "native", triple);
      await mkdir(isolatedNative, { recursive: true });
      const staged = join(isolatedNative, filename);
      await copyFile(artifact, staged);
      const [originalHash, stagedHash] = await Promise.all([
        sha256(artifact),
        sha256(staged),
      ]);
      if (originalHash !== stagedHash)
        throw new Error("native artifact changed during staging");
      if (expectedHash && stagedHash !== expectedHash)
        throw new Error("native artifact does not match --artifact-sha256");
      const contract = (await import(
        join(isolatedConsumer, "src/native-artifact.ts")
      )) as {
        NATIVE_ABI_VERSIONS: Record<string, number>;
      };
      if (
        !contract.NATIVE_ABI_VERSIONS ||
        !Object.keys(contract.NATIVE_ABI_VERSIONS).length
      )
        throw new Error("consumer native ABI contract is missing");
      const attestation = {
        schemaVersion: 1,
        package: "@aphrody/bun",
        crate: "aphrody-ffi",
        version: ffi?.version ?? null,
        packageVersion: pkg.version,
        target: triple,
        profile,
        libc: triple.includes("-linux-")
          ? triple.endsWith("-musl")
            ? "musl"
            : "gnu"
          : null,
        features: existingArtifact ? null : features,
        artifact: filename,
        sha256: stagedHash,
        bytes: Bun.file(staged).size,
        abi: contract.NATIVE_ABI_VERSIONS,
        provenance: existingArtifact ? "existing-debug" : "cargo-build",
        buildSourceHead:
          !existingArtifact &&
          !dirtyBefore &&
          !observedSourceDirty &&
          sourceBefore === observedSourceHead
            ? observedSourceHead
            : null,
        observedSourceHead,
        observedSourceDirty,
        cargoLockSha256,
        rustc: rustc.trim(),
        consumerSmoke: "pending",
      };
      // The temporary manifest is invisible to the installed consumer until every smoke passes.
      const stagedManifest = join(isolatedNative, "manifest.json");
      await Bun.write(
        stagedManifest,
        JSON.stringify(attestation, null, 2) + "\n",
      );
      await smokeNativeConsumer(
        isolatedConsumer,
        staged,
        staging,
        signal,
        true,
      );
      attestation.consumerSmoke = "passed";
      await Bun.write(
        stagedManifest,
        JSON.stringify(attestation, null, 2) + "\n",
      );
      // Release installation must also pass with development overrides disabled.
      if (profile === "release")
        await smokeNativeConsumer(
          isolatedConsumer,
          staged,
          staging,
          signal,
          false,
        );
      signal.throwIfAborted();
      const publication = await mkdtemp(join(directory, ".stage-"));
      try {
        const finalArtifact = join(publication, filename);
        try {
          await rename(staged, finalArtifact);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "EXDEV") throw error;
          await copyFile(staged, finalArtifact);
          if ((await sha256(finalArtifact)) !== stagedHash)
            throw new Error("native publication copy changed", {
              cause: error,
            });
        }
        await copyFile(stagedManifest, join(publication, "manifest.json"));
        signal.throwIfAborted();
        await rename(finalArtifact, join(directory, filename));
        // Publish the verified manifest last; failures never create a success marker.
        await rename(
          join(publication, "manifest.json"),
          join(directory, "manifest.json"),
        );
      } finally {
        await rm(publication, { recursive: true, force: true });
      }
      console.log(
        `[bun-native] qualified ${join(directory, filename)} (${profile}, ${stagedHash})`,
      );
    } finally {
      await rm(staging, { recursive: true, force: true });
    }
    return 0;
  } catch (error) {
    console.error(
      `bun-native: ${error instanceof Error ? error.message : String(error)}`,
    );
    return 1;
  } finally {
    options.signal?.removeEventListener("abort", abort);
    process.removeListener("SIGINT", abort);
    process.removeListener("SIGTERM", abort);
  }
}

if (import.meta.main) process.exit(await runBunNative(process.argv.slice(2)));
