#!/usr/bin/env bun
// Minimal MCP (JSON-RPC 2.0 over stdio, newline-delimited) server exposing Blender.
import { findBlender } from "./discover.ts";
import { evalPython, info, jsonPython, render } from "./headless.ts";

type Json = Record<string, unknown>;

const str = (description: string) => ({ type: "string", description });

const tools = [
  {
    name: "blender_where",
    description:
      "Discovered Blender install (executable, version, python runtime).",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "blender_info",
    description:
      "Scenes, objects, meshes, materials and collections of a .blend (factory scene when omitted).",
    inputSchema: {
      type: "object",
      properties: { blend: str("Path to a .blend file") },
    },
  },
  {
    name: "blender_run_python",
    description:
      "Run Python in headless Blender (bpy available). Assign a JSON-serializable value to `result` to return it.",
    inputSchema: {
      type: "object",
      properties: {
        code: str("Python source"),
        blend: str("Optional .blend to open first"),
      },
      required: ["code"],
    },
  },
  {
    name: "blender_render",
    description: "Render a frame or the animation of a .blend.",
    inputSchema: {
      type: "object",
      properties: {
        blend: str("Path to a .blend file"),
        output: str("Output path pattern, e.g. C:/out/frame_####"),
        frame: { type: "integer" },
        animation: { type: "boolean" },
        engine: str("CYCLES, BLENDER_EEVEE_NEXT or BLENDER_WORKBENCH"),
        format: str("PNG, JPEG, OPEN_EXR, ..."),
      },
      required: ["blend"],
    },
  },
  {
    name: "blender_import",
    description:
      "Import a model (glb/gltf/fbx/obj/stl/ply/usd/abc) into a .blend (new scene when blend omitted) and save it.",
    inputSchema: {
      type: "object",
      properties: {
        file: str("Model to import"),
        save: str("Destination .blend"),
        blend: str("Optional existing .blend"),
      },
      required: ["file", "save"],
    },
  },
  {
    name: "blender_export",
    description:
      "Export a .blend to glb/gltf/fbx/obj/stl/ply/usd/abc (format from the output extension).",
    inputSchema: {
      type: "object",
      properties: {
        blend: str("Source .blend"),
        output: str("Output model path"),
      },
      required: ["blend", "output"],
    },
  },
];

const PY_IO = `
import bpy, os
def _ext(p): return os.path.splitext(p)[1].lower().lstrip(".")
IMPORT = {"glb": lambda p: bpy.ops.import_scene.gltf(filepath=p), "gltf": lambda p: bpy.ops.import_scene.gltf(filepath=p),
  "fbx": lambda p: bpy.ops.import_scene.fbx(filepath=p), "obj": lambda p: bpy.ops.wm.obj_import(filepath=p),
  "stl": lambda p: bpy.ops.wm.stl_import(filepath=p), "ply": lambda p: bpy.ops.wm.ply_import(filepath=p),
  "usd": lambda p: bpy.ops.wm.usd_import(filepath=p), "usdc": lambda p: bpy.ops.wm.usd_import(filepath=p),
  "usdz": lambda p: bpy.ops.wm.usd_import(filepath=p), "abc": lambda p: bpy.ops.wm.alembic_import(filepath=p)}
EXPORT = {"glb": lambda p: bpy.ops.export_scene.gltf(filepath=p, export_format="GLB"),
  "gltf": lambda p: bpy.ops.export_scene.gltf(filepath=p, export_format="GLTF_SEPARATE"),
  "fbx": lambda p: bpy.ops.export_scene.fbx(filepath=p), "obj": lambda p: bpy.ops.wm.obj_export(filepath=p),
  "stl": lambda p: bpy.ops.wm.stl_export(filepath=p), "ply": lambda p: bpy.ops.wm.ply_export(filepath=p),
  "usd": lambda p: bpy.ops.wm.usd_export(filepath=p), "usdc": lambda p: bpy.ops.wm.usd_export(filepath=p),
  "usdz": lambda p: bpy.ops.wm.usd_export(filepath=p), "abc": lambda p: bpy.ops.wm.alembic_export(filepath=p)}
`;

const py = (v: unknown) => JSON.stringify(v);

async function call(name: string, a: Json): Promise<unknown> {
  const blend = a.blend as string | undefined;
  switch (name) {
    case "blender_where":
      return findBlender();
    case "blender_info":
      return info(blend);
    case "blender_run_python": {
      const wrapped = `import bpy\nresult = None\nexec(compile(${py(a.code)}, "<mcp>", "exec"), globals())\n${jsonPython("result")}`;
      return evalPython(wrapped, blend);
    }
    case "blender_render": {
      const res = await render(a.blend as string, {
        output: a.output as string | undefined,
        frame: a.frame as number | undefined,
        animation: a.animation as boolean | undefined,
        engine: a.engine as string | undefined,
        format: a.format as string | undefined,
      });
      if (res.exitCode !== 0) throw new Error(res.stderr || res.stdout);
      return res.stdout
        .split(/\r?\n/)
        .filter((l) => l.startsWith("Saved:") || l.includes("Time:"));
    }
    case "blender_import": {
      const code = `${PY_IO}
if not ${py(blend ?? "")}: bpy.ops.wm.read_homefile(use_empty=True)
IMPORT[_ext(${py(a.file)})](${py(a.file)})
bpy.ops.wm.save_as_mainfile(filepath=${py(a.save)})
${jsonPython(`{"saved": ${py(a.save)}, "objects": [o.name for o in bpy.data.objects]}`)}`;
      return evalPython(code, blend);
    }
    case "blender_export": {
      const code = `${PY_IO}
EXPORT[_ext(${py(a.output)})](${py(a.output)})
${jsonPython(`{"exported": ${py(a.output)}}`)}`;
      return evalPython(code, blend);
    }
    default:
      throw new Error(`unknown tool ${name}`);
  }
}

async function handle(msg: Json): Promise<Json | null> {
  const { id, method } = msg;
  const params = (msg.params ?? {}) as Json;
  const ok = (result: unknown): Json => ({ jsonrpc: "2.0", id, result });
  switch (method) {
    case "initialize":
      return ok({
        protocolVersion: (params.protocolVersion as string) ?? "2025-06-18",
        capabilities: { tools: {} },
        serverInfo: { name: "bun-blender", version: "1.4.4" },
      });
    case "tools/list":
      return ok({ tools });
    case "tools/call":
      try {
        const out = await call(
          params.name as string,
          (params.arguments ?? {}) as Json,
        );
        return ok({
          content: [{ type: "text", text: JSON.stringify(out, null, 2) }],
        });
      } catch (err) {
        return ok({
          content: [
            { type: "text", text: String((err as Error).message ?? err) },
          ],
          isError: true,
        });
      }
    case "ping":
      return ok({});
    default:
      if (id === undefined) return null;
      return {
        jsonrpc: "2.0",
        id,
        error: { code: -32601, message: `method not found: ${String(method)}` },
      };
  }
}

const decoder = new TextDecoder();
let buffer = "";
for await (const chunk of Bun.stdin.stream()) {
  buffer += decoder.decode(chunk, { stream: true });
  let nl: number;
  while ((nl = buffer.indexOf("\n")) >= 0) {
    const line = buffer.slice(0, nl).trim();
    buffer = buffer.slice(nl + 1);
    if (!line) continue;
    void handle(JSON.parse(line) as Json).then((reply) => {
      if (reply) void Bun.write(Bun.stdout, `${JSON.stringify(reply)}\n`);
    });
  }
}
