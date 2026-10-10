// SPDX-License-Identifier: Apache-2.0
import { chmod, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * Install a PATH command named `name` in `dir` that runs `source` with this Bun. POSIX gets a shebang
 * script. Windows resolves commands through PATHEXT, so it gets a `.cmd` launcher beside the script,
 * or with `native` a compiled `.exe`: Bun refuses to pass cmd.exe metacharacters (newlines, quotes,
 * `%`) to a `.cmd`. Returns the path `Bun.which(name)` resolves to.
 */
export async function writeBunCommand(
  dir: string,
  name: string,
  source: string,
  { native = false }: { native?: boolean } = {},
): Promise<string> {
  if (process.platform !== "win32") {
    const path = join(dir, name);
    await writeFile(path, `#!${process.execPath}\n${source}`);
    await chmod(path, 0o755);
    return path;
  }
  const script = join(dir, `${name}.fixture.ts`);
  await writeFile(script, source);
  if (native) {
    const path = join(dir, `${name}.exe`);
    const build = Bun.spawnSync(
      [process.execPath, "build", "--compile", script, "--outfile", path],
      { windowsHide: true, stdout: "ignore", stderr: "pipe" },
    );
    if (build.exitCode !== 0) throw new Error(`fixture compile failed: ${build.stderr}`);
    await rm(script);
    return path;
  }
  const path = join(dir, `${name}.cmd`);
  await writeFile(path, `@"${process.execPath}" "${script}" %*\r\n`);
  return path;
}

/** Copy `env` without any PATH spelling (Windows exposes `Path`) so an added `PATH` is the only one. */
export function withoutPath(env: NodeJS.ProcessEnv): Record<string, string | undefined> {
  return Object.fromEntries(Object.entries(env).filter(([key]) => key.toUpperCase() !== "PATH"));
}
