import { dlopen, FFIType, type Library } from "bun:ffi";
import { join } from "node:path";
import { requireBlender } from "./discover.ts";

const symbols = {
  Py_IsInitialized: { args: [], returns: FFIType.i32 },
  Py_InitializeEx: { args: [FFIType.i32], returns: FFIType.void },
  PyRun_SimpleString: { args: [FFIType.cstring], returns: FFIType.i32 },
  Py_GetVersion: { args: [], returns: FFIType.cstring },
} as const;

export type BlenderPython = Library<typeof symbols>;

/**
 * Load the CPython runtime shipped with Blender (or BUN_BLENDER_PYTHON) through bun:ffi.
 * With a bpy module build (WITH_PYTHON_MODULE) on BUN_BLENDER_BPY, `import bpy` works in-process.
 */
export async function openPython(path?: string): Promise<BlenderPython> {
  const lib =
    path ?? Bun.env.BUN_BLENDER_PYTHON ?? (await requireBlender()).python;
  if (!lib) throw new Error("no Blender python runtime found");
  if (!Bun.env.PYTHONHOME && !path && !Bun.env.BUN_BLENDER_PYTHON) {
    const install = await requireBlender();
    if (install.version)
      Bun.env.PYTHONHOME = join(install.root, install.version, "python");
  }
  const py = dlopen(lib, symbols);
  if (!py.symbols.Py_IsInitialized()) py.symbols.Py_InitializeEx(0);
  const bpy = Bun.env.BUN_BLENDER_BPY;
  if (bpy) exec(py, `import sys; sys.path.insert(0, ${JSON.stringify(bpy)})`);
  return py;
}

export function exec(py: BlenderPython, code: string): void {
  if (py.symbols.PyRun_SimpleString(Buffer.from(`${code}\0`)) !== 0)
    throw new Error("python execution failed");
}

export function pythonVersion(py: BlenderPython): string {
  return String(py.symbols.Py_GetVersion());
}
