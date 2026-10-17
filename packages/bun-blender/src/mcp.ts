#!/usr/bin/env bun
// Minimal MCP (JSON-RPC 2.0 over stdio, newline-delimited) server exposing Blender.
import { liveAvailable, sendLive } from "./bridge.ts";
import { findBlender } from "./discover.ts";
import { evalPython, info, jsonPython, render, serveHeadless } from "./headless.ts";

let session: Bun.Subprocess | undefined;

/** Reuse a running Blender bridge (GUI or headless), else start a headless session. */
async function ensureLive(blend?: string): Promise<void> {
  if (await liveAvailable()) return;
  session?.kill();
  session = await serveHeadless(blend);
  for (let i = 0; i < 120; i++) {
    await Bun.sleep(500);
    if (await liveAvailable()) return;
  }
  throw new Error("headless Blender bridge did not start (blender_mcp add-on missing? set BLENDER_MCP_ADDON)");
}

process.on("exit", () => session?.kill());

type Json = Record<string, unknown>;

const str = (description: string) => ({ type: "string", description });

const tools = [
  {
    name: "blender_where",
    description: "Discovered Blender install (executable, version, python runtime).",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "blender_info",
    description: "Scenes, objects, meshes, materials and collections of a .blend (factory scene when omitted).",
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
    description: "Export a .blend to glb/gltf/fbx/obj/stl/ply/usd/abc (format from the output extension).",
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

// Tools bridged to a running Blender session through the `blender_mcp` add-on socket
// (commands of aphrody-labs/mcp-for-blender, MIT).
const obj = (properties: Json = {}, required: string[] = []) => ({
  type: "object",
  properties,
  required,
});
const LIVE: Record<string, { command: string; description: string; inputSchema: Json }> = {
  blender_live_ping: {
    command: "ping",
    description: "Check the live Blender add-on connection.",
    inputSchema: obj(),
  },
  blender_live_scene: {
    command: "get_scene_info",
    description: "Live session: current scene summary.",
    inputSchema: obj(),
  },
  blender_live_object: {
    command: "get_object_info",
    description: "Live session: details of one object.",
    inputSchema: obj({ name: str("Object name") }, ["name"]),
  },
  blender_live_list: {
    command: "list_scene_items",
    description: "Live session: search objects, materials and other datablocks.",
    inputSchema: obj({ query: str("Name filter"), limit: { type: "integer" } }),
  },
  blender_live_execute: {
    command: "execute_code",
    description: "Live session: run Python (bpy) in the open Blender, returns captured stdout.",
    inputSchema: obj({ code: str("Python source") }, ["code"]),
  },
  blender_live_screenshot: {
    command: "get_viewport_screenshot",
    description: "Live session: save a viewport screenshot to filepath.",
    inputSchema: obj(
      {
        filepath: str("Output image path"),
        max_size: { type: "integer" },
        format: str("png or jpg"),
      },
      ["filepath"],
    ),
  },
  blender_live_export: {
    command: "export_scene",
    description: "Live session: export the scene or named objects (glb, gltf, fbx, obj, usd, stl, ply).",
    inputSchema: obj(
      {
        filepath: str("Output path"),
        format: str("glb, gltf, fbx, obj, usd, stl, ply"),
        object_names: { type: "array", items: { type: "string" } },
        selection_only: { type: "boolean" },
      },
      ["filepath"],
    ),
  },
  blender_live_node_type: {
    command: "describe_node_type",
    description: "Live session: describe a node type's sockets and properties.",
    inputSchema: obj({ bl_idname: str("Node bl_idname, e.g. ShaderNodeBsdfPrincipled") }, ["bl_idname"]),
  },
  blender_live_api: {
    command: "bpy_api_lookup",
    description: "Live session: look up bpy API (types, operators, properties).",
    inputSchema: obj({ query: str("e.g. bpy.types.Object.location") }, ["query"]),
  },
  blender_live_command: {
    command: "",
    description: "Live session: send any blender_mcp add-on command (type + params).",
    inputSchema: obj({ type: str("Add-on command type"), params: { type: "object" } }, ["type"]),
  },
};
// Asset and generation integrations of the add-on; `flag` is the scene toggle that exposes the handlers.
// Keys come from the add-on preferences or BLENDERMCP_SKETCHFAB_API_KEY, BLENDERMCP_HYPER3D_API_KEY,
// BLENDERMCP_HUNYUAN3D_SECRET_ID / _SECRET_KEY in the environment.
const integer = { type: "integer" };
const ASSETS: Record<string, { command: string; flag: string; description: string; inputSchema: Json }> = {
  blender_polyhaven_categories: {
    command: "get_polyhaven_categories",
    flag: "blendermcp_use_polyhaven",
    description: "Poly Haven categories for hdris, textures or models.",
    inputSchema: obj({ asset_type: str("hdris, textures, models or all") }, ["asset_type"]),
  },
  blender_polyhaven_search: {
    command: "search_polyhaven_assets",
    flag: "blendermcp_use_polyhaven",
    description: "Search Poly Haven assets (CC0).",
    inputSchema: obj({
      asset_type: str("hdris, textures, models or all"),
      category: str("Category filter"),
      query: str("Keywords"),
      limit: integer,
    }),
  },
  blender_polyhaven_download: {
    command: "download_polyhaven_asset",
    flag: "blendermcp_use_polyhaven",
    description: "Download and import a Poly Haven asset (HDRI as world, texture as material, model into the scene).",
    inputSchema: obj(
      {
        asset_id: str("Poly Haven id"),
        asset_type: str("hdris, textures or models"),
        resolution: str("1k, 2k, 4k, ..."),
        file_format: str("hdr, exr, jpg, png, gltf, fbx, blend"),
      },
      ["asset_id", "asset_type"],
    ),
  },
  blender_polyhaven_set_texture: {
    command: "set_texture",
    flag: "blendermcp_use_polyhaven",
    description: "Apply a downloaded Poly Haven texture to an object.",
    inputSchema: obj({ object_name: str("Object"), texture_id: str("Poly Haven texture id") }, [
      "object_name",
      "texture_id",
    ]),
  },
  blender_sketchfab_search: {
    command: "search_sketchfab_models",
    flag: "blendermcp_use_sketchfab",
    description: "Search Sketchfab models (API key required).",
    inputSchema: obj(
      {
        query: str("Keywords"),
        categories: str("Comma-separated"),
        count: integer,
        downloadable: { type: "boolean" },
      },
      ["query"],
    ),
  },
  blender_sketchfab_download: {
    command: "download_sketchfab_model",
    flag: "blendermcp_use_sketchfab",
    description: "Download and import a Sketchfab model by uid.",
    inputSchema: obj(
      {
        uid: str("Model uid"),
        normalize_size: { type: "boolean" },
        target_size: { type: "number" },
      },
      ["uid"],
    ),
  },
  blender_hyper3d_create: {
    command: "create_rodin_job",
    flag: "blendermcp_use_hyper3d",
    description: "Start a Hyper3D Rodin generation from a text prompt or images.",
    inputSchema: obj({
      text_prompt: str("Prompt"),
      images: {
        type: "array",
        description: "[suffix, base64] pairs (MAIN_SITE) or URLs (FAL_AI)",
      },
      bbox_condition: { type: "array", items: { type: "number" } },
      mode: str("MAIN_SITE or FAL_AI"),
      free_trial: {
        type: "boolean",
        description: "Use the shared Hyper3D free-trial key",
      },
    }),
  },
  blender_hyper3d_poll: {
    command: "poll_rodin_job_status",
    flag: "blendermcp_use_hyper3d",
    description: "Poll a Hyper3D job (subscription_key on MAIN_SITE, request_id on FAL_AI).",
    inputSchema: obj({
      subscription_key: str("MAIN_SITE key"),
      request_id: str("FAL_AI id"),
    }),
  },
  blender_hyper3d_import: {
    command: "import_generated_asset",
    flag: "blendermcp_use_hyper3d",
    description: "Import a finished Hyper3D asset.",
    inputSchema: obj(
      {
        name: str("Object name"),
        task_uuid: str("MAIN_SITE task"),
        request_id: str("FAL_AI id"),
      },
      ["name"],
    ),
  },
  blender_hunyuan_create: {
    command: "create_hunyuan_job",
    flag: "blendermcp_use_hunyuan3d",
    description: "Start a Hunyuan3D generation from a prompt or image.",
    inputSchema: obj({
      text_prompt: str("Prompt"),
      image: str("Image URL or path"),
      mode: str("OFFICIAL_API or LOCAL_API"),
    }),
  },
  blender_hunyuan_poll: {
    command: "poll_hunyuan_job_status",
    flag: "blendermcp_use_hunyuan3d",
    description: "Poll a Hunyuan3D job.",
    inputSchema: obj({ job_id: str("Job id") }, ["job_id"]),
  },
  blender_hunyuan_import: {
    command: "import_generated_asset_hunyuan",
    flag: "blendermcp_use_hunyuan3d",
    description: "Import a finished Hunyuan3D asset.",
    inputSchema: obj({ name: str("Object name"), zip_file_url: str("Result URL") }, ["name", "zip_file_url"]),
  },
};
Object.assign(LIVE, ASSETS);

for (const [name, { description, inputSchema }] of Object.entries(LIVE))
  tools.push({ name, description, inputSchema } as (typeof tools)[number]);

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
      return res.stdout.split(/\r?\n/).filter(l => l.startsWith("Saved:") || l.includes("Time:"));
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
    default: {
      const live = LIVE[name];
      if (!live) throw new Error(`unknown tool ${name}`);
      await ensureLive(blend);
      if (name === "blender_live_command") return sendLive(a.type as string, (a.params ?? {}) as Json);
      const flag = ASSETS[name]?.flag;
      if (flag)
        await sendLive("execute_code", {
          code: `import bpy\nbpy.context.scene.${flag} = True`,
        });
      const { blend: _blend, mode, free_trial, ...params } = a;
      const setup: string[] = [];
      if (mode && flag === "blendermcp_use_hyper3d")
        setup.push(`bpy.context.scene.blendermcp_hyper3d_mode = ${JSON.stringify(mode)}`);
      if (mode && flag === "blendermcp_use_hunyuan3d")
        setup.push(`bpy.context.scene.blendermcp_hunyuan3d_mode = ${JSON.stringify(mode)}`);
      // Hyper3D's shared free-trial key, as offered by the add-on's "Set Free Trial API Key" button.
      if (free_trial && flag === "blendermcp_use_hyper3d")
        setup.push(`bpy.context.scene.blendermcp_hyper3d_api_key = "vibecoding"`);
      if (setup.length)
        await sendLive("execute_code", {
          code: `import bpy\n${setup.join("\n")}`,
        });
      return sendLive(live.command, params);
    }
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
        const out = await call(params.name as string, (params.arguments ?? {}) as Json);
        return ok({
          content: [{ type: "text", text: JSON.stringify(out, null, 2) }],
        });
      } catch (err) {
        return ok({
          content: [{ type: "text", text: String((err as Error).message ?? err) }],
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
    void handle(JSON.parse(line) as Json).then(reply => {
      if (reply) void Bun.write(Bun.stdout, `${JSON.stringify(reply)}\n`);
    });
  }
}
