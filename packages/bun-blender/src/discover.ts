import { dirname, join } from "node:path";
import type { BlenderInstall } from "./types.ts";

const SEARCH_ROOTS: Record<string, string[]> = {
  win32: ["C:/Program Files/Blender Foundation"],
  darwin: ["/Applications"],
  linux: ["/opt", "/usr/local"],
};

async function scan(
  pattern: string,
  cwd: string,
  onlyFiles = true,
): Promise<string[]> {
  const hits: string[] = [];
  try {
    for await (const hit of new Bun.Glob(pattern).scan({ cwd, onlyFiles }))
      hits.push(hit);
  } catch {
    // missing root
  }
  return hits.sort();
}

async function candidates(): Promise<string[]> {
  const out: string[] = [];
  if (Bun.env.BLENDER_PATH) out.push(Bun.env.BLENDER_PATH);
  const which = Bun.which("blender");
  if (which) out.push(which);
  const pattern =
    process.platform === "win32"
      ? "Blender*/blender.exe"
      : "[Bb]lender*/blender";
  for (const root of SEARCH_ROOTS[process.platform] ?? []) {
    for (const hit of (await scan(pattern, root)).reverse())
      out.push(join(root, hit));
  }
  return out;
}

export async function findBlender(): Promise<BlenderInstall | null> {
  for (const executable of await candidates()) {
    if (!(await Bun.file(executable).exists())) continue;
    const root = dirname(executable);
    const version = (await scan("[0-9]*.[0-9]*", root, false)).at(-1) ?? null;
    const dll = (await scan("python3[0-9]*.dll", root)).at(-1);
    return { executable, root, version, python: dll ? join(root, dll) : null };
  }
  return null;
}

export async function requireBlender(): Promise<BlenderInstall> {
  const found = await findBlender();
  if (!found)
    throw new Error(
      "Blender not found: set BLENDER_PATH or add blender to PATH",
    );
  return found;
}
