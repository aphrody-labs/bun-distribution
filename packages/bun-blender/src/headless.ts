import { requireBlender } from "./discover.ts";
import type { BlendScene, RenderOptions, RunResult } from "./types.ts";

const MARK = "@@BUN_BLENDER_JSON@@";

const INFO_EXPR = `{
  "file": bpy.data.filepath,
  "version": ".".join(map(str, bpy.data.version)),
  "scenes": [{"name": s.name, "frameStart": s.frame_start, "frameEnd": s.frame_end,
              "camera": s.camera.name if s.camera else None} for s in bpy.data.scenes],
  "objects": [{"name": o.name, "type": o.type, "location": list(o.location),
               "parent": o.parent.name if o.parent else None,
               "data": o.data.name if o.data else None} for o in bpy.data.objects],
  "meshes": [m.name for m in bpy.data.meshes],
  "materials": [m.name for m in bpy.data.materials],
  "collections": [c.name for c in bpy.data.collections],
}`;

export async function runBlender(
  args: string[],
  timeoutMs = 600_000,
): Promise<RunResult> {
  const { executable } = await requireBlender();
  const proc = Bun.spawn(
    [executable, "--background", "--factory-startup", ...args],
    {
      stdout: "pipe",
      stderr: "pipe",
      timeout: timeoutMs,
    },
  );
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { exitCode, stdout, stderr };
}

/** Python snippet printing `expr` as JSON on the marker line read by evalPython. */
export function jsonPython(expr: string): string {
  return `import bpy, json\nprint(${JSON.stringify(MARK)} + json.dumps(${expr}))`;
}

export async function evalPython<T = unknown>(
  code: string,
  blend?: string,
): Promise<T> {
  const res = await runBlender([
    ...(blend ? [blend] : []),
    "--python-exit-code",
    "1",
    "--python-expr",
    code,
  ]);
  const line = res.stdout.split(/\r?\n/).find((l) => l.startsWith(MARK));
  if (res.exitCode !== 0 || !line)
    throw new Error(
      `blender failed (${res.exitCode}): ${res.stderr || res.stdout}`,
    );
  return JSON.parse(line.slice(MARK.length)) as T;
}

export function info(blend?: string): Promise<BlendScene> {
  return evalPython<BlendScene>(jsonPython(INFO_EXPR), blend);
}

export function runScript(
  script: string,
  blend?: string,
  extra: string[] = [],
): Promise<RunResult> {
  return runBlender([
    ...(blend ? [blend] : []),
    "--python-exit-code",
    "1",
    "--python",
    script,
    "--",
    ...extra,
  ]);
}

export function render(
  blend: string,
  opts: RenderOptions = {},
): Promise<RunResult> {
  const args = [blend];
  if (opts.engine) args.push("--engine", opts.engine);
  if (opts.output) args.push("--render-output", opts.output);
  if (opts.format) args.push("--render-format", opts.format);
  if (opts.animation) args.push("--render-anim");
  else args.push("--render-frame", String(opts.frame ?? 1));
  return runBlender(args, 3_600_000);
}

/**
 * Persistent headless Blender session serving the `blender_mcp` add-on bridge (no window).
 * The add-on comes from the Blender build (core add-on) or BLENDER_MCP_ADDON (directory holding `blender_mcp`).
 */
export async function serveHeadless(
  blend?: string,
  port = Number(Bun.env.BLENDER_MCP_PORT ?? 9876),
  verbose = false,
): Promise<Bun.Subprocess> {
  const { executable } = await requireBlender();
  const addonDir = Bun.env.BLENDER_MCP_ADDON ?? "";
  const code = `import sys, importlib
if ${JSON.stringify(addonDir)}: sys.path.insert(0, ${JSON.stringify(addonDir)})
mod = importlib.import_module("blender_mcp")
try:
    mod.register()
except ValueError:
    pass
mod.BlenderMCPServer(port=${port}).serve_forever()`;
  return Bun.spawn(
    [
      executable,
      "--background",
      "--factory-startup",
      ...(blend ? [blend] : []),
      "--python-expr",
      code,
    ],
    {
      // stdout stays off the MCP stdio channel unless asked (CLI serve).
      stdout: verbose ? "inherit" : "ignore",
      stderr: "inherit",
      env: { ...Bun.env, PYTHONUNBUFFERED: "1" },
    },
  );
}
