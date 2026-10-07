// SPDX-License-Identifier: Apache-2.0
// Typed facade over crates/infra/aphrody-command-wasm: `aphrody pure ...` in WebAssembly.
import init, { initSync, run, version, type InitInput } from "#cli-wasm-glue";

export interface RunOptions {
  /** Text read by `-` arguments. */
  stdin?: string;
  /** Named files, read by path arguments (there is no file system in the browser). */
  files?: Record<string, string>;
}

export interface Outcome {
  /** 0 success or help, 1 command failure, 2 usage error. */
  code: number;
  stdout: string;
  stderr: string;
}

export interface DragonBallProjectionOptions {
  kind:
    | "catalogue"
    | "gallery"
    | "inventory"
    | "toei"
    | "jump"
    | "translation"
    | "official"
    | "reader";
  baseUrl: string;
  slug?: string;
}

export interface Cli {
  /** Package version of the pure command crate. */
  readonly version: string;
  /** Run `aphrody pure <args...>`; never throws for a failing command, see `code`. */
  run(args: readonly string[], options?: RunOptions): Outcome;
  /** Run and parse stdout as JSON; throws with stderr when the command fails. */
  json<T = unknown>(args: readonly string[], options?: RunOptions): T;
  /** Run and return stdout; throws with stderr when the command fails. */
  text(args: readonly string[], options?: RunOptions): string;
  /** Pure source projection; shares the native Web parser without network or filesystem access. */
  dragonBall<T = unknown>(html: string, options: DragonBallProjectionOptions): T;
}

const exec = (args: readonly string[], options: RunOptions = {}): Outcome =>
  JSON.parse(run([...args], options.stdin ?? "", JSON.stringify(options.files ?? {}))) as Outcome;

function open(): Cli {
  const text = (args: readonly string[], options?: RunOptions): string => {
    const out = exec(args, options);
    if (out.code !== 0)
      throw new Error(out.stderr.trim() || `aphrody pure exited with ${out.code}`);
    return out.stdout;
  };
  return {
    version: version(),
    run: exec,
    text,
    json: <T = unknown>(args: readonly string[], options?: RunOptions) =>
      JSON.parse(text(args, options)) as T,
    dragonBall: <T = unknown>(html: string, options: DragonBallProjectionOptions) =>
      JSON.parse(
        text(
          [
            "html",
            "dragon-ball",
            "-",
            "--kind",
            options.kind,
            "--base-url",
            options.baseUrl,
            "--slug",
            options.slug ?? "",
          ],
          { stdin: html },
        ),
      ) as T,
  };
}

/**
 * Instantiate the module. In a browser pass nothing (the `.wasm` is fetched next to the glue through
 * `import.meta.url`) or a URL/Response; in Bun/Node pass the bytes.
 */
export async function loadCliWasm(source?: InitInput | Promise<InitInput>): Promise<Cli> {
  await init(source === undefined ? undefined : { module_or_path: source });
  return open();
}

/** Synchronous variant for hosts that already hold the bytes or a compiled module. */
export function loadCliWasmSync(module: BufferSource | WebAssembly.Module): Cli {
  initSync({ module });
  return open();
}
