// SPDX-License-Identifier: Apache-2.0
/**
 * Thin delegation to the single Rust CLI `aphrody` (the agent home pipeline owner).
 * Ingestion, retrieval and training are never reimplemented in Bun: `yolo scan --ingest`
 * and `yolo train` call the same library and the same database through this binary.
 */

/** Resolve the `aphrody` executable: `YOLO_APHRODY_BIN`, `APHRODY_BIN`, then PATH. */
export function resolveAphrody(
  env: Record<string, string | undefined> = process.env,
): string | undefined {
  return (
    env.YOLO_APHRODY_BIN ||
    env.APHRODY_BIN ||
    Bun.which("aphrody", { PATH: env.PATH ?? "" }) ||
    undefined
  );
}

export interface DelegateResult {
  code: number;
  stdout: string;
  stderr: string;
}

/** Run `aphrody <args>` and capture its output; a missing binary is a clear error, not a crash. */
export async function runAphrody(
  args: readonly string[],
  opts: { inherit?: boolean; env?: Record<string, string | undefined> } = {},
): Promise<DelegateResult> {
  const bin = resolveAphrody(opts.env ?? process.env);
  if (!bin) {
    return {
      code: 127,
      stdout: "",
      stderr:
        "aphrody binary not found: install it (aphrody self install-path) or set APHRODY_BIN",
    };
  }
  const proc = Bun.spawn([bin, ...args], {
    windowsHide: true,
    stdout: opts.inherit ? "inherit" : "pipe",
    stderr: opts.inherit ? "inherit" : "pipe",
    stdin: opts.inherit ? "inherit" : "ignore",
    env: { ...process.env, ...opts.env } as Record<string, string>,
  });
  const [stdout, stderr] = opts.inherit
    ? ["", ""]
    : await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
      ]);
  return { code: await proc.exited, stdout, stderr };
}
