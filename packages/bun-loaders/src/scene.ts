// SPDX-License-Identifier: MIT
/** Read-only 3D scene inspection: glTF/GLB and OBJ natively, every other format through bun-blender. */
import { extname, resolve } from "node:path";
import { evalPython, info, jsonPython } from "../../bun-blender/src/headless.ts";

export interface SceneInfo {
  path: string;
  format: string;
  backend: "native" | "blender";
  [key: string]: unknown;
}

/** Blender import operators per extension (bpy 4.x / 5.x). */
const IMPORTERS: Record<string, string> = {
  ".fbx": "bpy.ops.import_scene.fbx(filepath=P)",
  ".dae": "bpy.ops.wm.collada_import(filepath=P)",
  ".abc": "bpy.ops.wm.alembic_import(filepath=P)",
  ".usd": "bpy.ops.wm.usd_import(filepath=P)",
  ".usda": "bpy.ops.wm.usd_import(filepath=P)",
  ".usdc": "bpy.ops.wm.usd_import(filepath=P)",
  ".usdz": "bpy.ops.wm.usd_import(filepath=P)",
  ".ply": "bpy.ops.wm.ply_import(filepath=P)",
  ".stl": "bpy.ops.wm.stl_import(filepath=P)",
  ".x3d": "bpy.ops.import_scene.x3d(filepath=P)",
  ".3ds": "bpy.ops.import_scene.max3ds(filepath=P)",
};

const SUMMARY = `{
  "objects": [{"name": o.name, "type": o.type, "parent": o.parent.name if o.parent else None,
               "vertices": len(o.data.vertices) if o.type == "MESH" else None} for o in bpy.data.objects],
  "meshes": [m.name for m in bpy.data.meshes],
  "materials": [m.name for m in bpy.data.materials],
  "armatures": [a.name for a in bpy.data.armatures],
  "actions": [a.name for a in bpy.data.actions],
  "images": [i.name for i in bpy.data.images],
}`;

function gltf(
  json: Record<string, unknown[] | Record<string, unknown> | undefined>,
  path: string,
  format: string,
): SceneInfo {
  const list = (k: string) => (Array.isArray(json[k]) ? (json[k] as Record<string, unknown>[]) : []);
  return {
    path,
    format,
    backend: "native",
    asset: json.asset,
    extensionsUsed: json.extensionsUsed ?? [],
    scenes: list("scenes").map(s => s.name ?? null),
    nodes: list("nodes").map(n => n.name ?? null),
    meshes: list("meshes").map(m => ({
      name: m.name ?? null,
      primitives: (m.primitives as unknown[] | undefined)?.length ?? 0,
    })),
    materials: list("materials").map(m => m.name ?? null),
    animations: list("animations").map(a => a.name ?? null),
    skins: list("skins").length,
    textures: list("textures").length,
    images: list("images").map(i => i.uri ?? i.name ?? null),
    buffers: list("buffers").map(b => ({
      uri: b.uri ?? null,
      byteLength: b.byteLength,
    })),
  };
}

async function obj(path: string): Promise<SceneInfo> {
  const counts = { v: 0, vt: 0, vn: 0, f: 0 };
  const objects: string[] = [];
  const groups: string[] = [];
  const materials = new Set<string>();
  const libraries: string[] = [];
  for (const line of (await Bun.file(path).text()).split(/\r?\n/)) {
    const [k, ...rest] = line.trim().split(/\s+/);
    const arg = rest.join(" ");
    if (k === "v" || k === "vt" || k === "vn" || k === "f") counts[k]++;
    else if (k === "o") objects.push(arg);
    else if (k === "g") groups.push(arg);
    else if (k === "usemtl") materials.add(arg);
    else if (k === "mtllib") libraries.push(arg);
  }
  return {
    path,
    format: "obj",
    backend: "native",
    vertices: counts.v,
    texcoords: counts.vt,
    normals: counts.vn,
    faces: counts.f,
    objects,
    groups,
    materials: [...materials],
    libraries,
  };
}

export async function inspectScene(input: string): Promise<SceneInfo> {
  const path = resolve(input);
  const ext = extname(path).toLowerCase();
  if (ext === ".gltf") return gltf(await Bun.file(path).json(), path, "gltf");
  if (ext === ".glb") {
    const bytes = await Bun.file(path).bytes();
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (view.getUint32(0, true) !== 0x46546c67) throw new TypeError(`not a GLB file: ${path}`);
    const length = view.getUint32(12, true);
    return {
      ...gltf(JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + length))), path, "glb"),
      version: view.getUint32(4, true),
    };
  }
  if (ext === ".obj") return obj(path);
  if (ext === ".blend") return { path, format: "blend", backend: "blender", ...(await info(path)) };
  const importer = IMPORTERS[ext];
  if (!importer) throw new TypeError(`unsupported 3D format: ${ext}`);
  const code = jsonPython(SUMMARY).replace(
    "import bpy, json\n",
    `import bpy, json\nbpy.ops.wm.read_factory_settings(use_empty=True)\nP = ${JSON.stringify(path)}\n${importer}\n`,
  );
  return {
    path,
    format: ext.slice(1),
    backend: "blender",
    ...(await evalPython<Record<string, unknown>>(code)),
  };
}
