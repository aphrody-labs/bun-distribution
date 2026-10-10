# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: 2026 aphrody contributors
"""GPU-accelerated Cycles rendering — exploit an NVIDIA GPU (OPTIX/CUDA).

Headless Blender script that enables Cycles GPU compute (OPTIX preferred on RTX,
CUDA fallback), optionally imports a ``.glb``, frames it, and renders a turntable
PNG sequence on the GPU. With ``--probe`` it just enumerates the Cycles devices
as JSON and exits.

    blender -b --factory-startup -P gpu_render.py -- --probe
    blender -b --factory-startup -P gpu_render.py -- \
        --glb model.glb --out-dir frames --frames 24 --samples 64 --device AUTO
"""

from __future__ import annotations

import argparse
import json
import math
import os
import sys

import bpy

# `blender -b -P` only puts the CWD on sys.path, so add this script's own
# directory before importing the shared helpers next to it.
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import _bl_common


def _parse_args() -> argparse.Namespace:
    argv = sys.argv
    argv = argv[argv.index("--") + 1 :] if "--" in argv else []
    p = argparse.ArgumentParser(prog="gpu_render")
    p.add_argument("--glb", default=None)
    p.add_argument("--out-dir", dest="out_dir", default="gpu_frames")
    p.add_argument("--frames", type=int, default=24)
    p.add_argument("--samples", type=int, default=64)
    p.add_argument("--resolution", type=int, default=512)
    p.add_argument("--device", default="AUTO", help="AUTO|OPTIX|CUDA|CPU")
    p.add_argument("--probe", action="store_true")
    return p.parse_args(argv)


def main() -> None:
    """Enable the GPU and either probe devices or render a turntable."""
    args = _parse_args()
    info = _bl_common.enable_gpu(args.device)

    if args.probe:
        print("APHRODY_GPU_JSON " + json.dumps(info))
        return

    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete()
    obj = None
    if args.glb:
        bpy.ops.import_scene.gltf(filepath=os.path.abspath(args.glb))
        obj = next((o for o in bpy.data.objects if o.type == "MESH"), None)
    _bl_common.setup_camera_light(obj)

    scene = bpy.context.scene
    scene.cycles.samples = args.samples
    # Max GPU: OptiX AI denoiser (RTX tensor cores) + persistent BVH/textures.
    try:
        scene.cycles.use_denoising = True
        scene.cycles.denoiser = "OPTIX"
        scene.render.use_persistent_data = True
    except (AttributeError, TypeError):
        pass
    scene.render.resolution_x = scene.render.resolution_y = args.resolution
    scene.render.film_transparent = True
    scene.render.image_settings.file_format = "PNG"
    out_dir = os.path.abspath(args.out_dir)
    os.makedirs(out_dir, exist_ok=True)

    for i in range(args.frames):
        if obj is not None:
            obj.rotation_euler[2] = (i / args.frames) * 2.0 * math.pi
            bpy.context.view_layer.update()
        scene.render.filepath = os.path.join(out_dir, f"frame_{i:03d}.png")
        bpy.ops.render.render(write_still=True)

    info["frames"] = args.frames
    info["out_dir"] = out_dir
    print("APHRODY_GPU_JSON " + json.dumps(info))


if __name__ == "__main__":
    _bl_common.run(main)
