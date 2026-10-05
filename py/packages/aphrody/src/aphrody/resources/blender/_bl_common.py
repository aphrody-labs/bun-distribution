# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: 2026 aphrody contributors
"""Shared Blender-side helpers for the ``blender -b -P`` scripts in this dir.

These scripts run inside Blender's own interpreter, where the aphrody package
is not importable; they bootstrap this module with :func:`bootstrap` (which
puts the script directory on ``sys.path``) and share the two pieces of setup
that every one of them needs: picking the GPU backend for Cycles, and framing
the subject with a camera and key light.
"""

from __future__ import annotations

import math
import os
import sys

import bpy

#: Cycles compute backends, best first. ``AUTO`` walks this list in order.
DEVICE_ORDER = ("OPTIX", "CUDA", "HIP", "ONEAPI", "METAL")


def bootstrap() -> None:
    """Put this file's directory on ``sys.path``.

    Blender runs ``-P`` scripts with the *current working directory* on the
    path, not the script's own directory, so a sibling import fails unless the
    script calls this first.
    """
    here = os.path.dirname(os.path.abspath(__file__))
    if here not in sys.path:
        sys.path.insert(0, here)


def enable_gpu(device_pref: str = "AUTO") -> dict:
    """Enable Cycles GPU compute and return the chosen device summary.

    Args:
        device_pref: ``AUTO`` (best available), a name from
            :data:`DEVICE_ORDER`, or ``CPU`` to force CPU rendering.

    Returns:
        A dict ``{compute_device_type, scene_device, devices: [...]}`` where
        ``devices`` lists every enumerated device as
        ``{name, type, use}``.
    """
    prefs = bpy.context.preferences.addons["cycles"].preferences
    candidates = (
        ("CPU",)
        if device_pref == "CPU"
        else (device_pref,)
        if device_pref in DEVICE_ORDER
        else DEVICE_ORDER
    )

    chosen = None
    for dt in candidates:
        try:
            prefs.compute_device_type = dt
        except TypeError:
            continue  # back-end not compiled in
        prefs.get_devices()
        if any(d.type == dt for d in prefs.devices):
            chosen = dt
            break

    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    if chosen and device_pref != "CPU":
        for d in prefs.devices:
            d.use = d.type in (chosen, "CPU")  # GPU + CPU hybrid
        scene.cycles.device = "GPU"
    else:
        scene.cycles.device = "CPU"

    return {
        "compute_device_type": chosen,
        "scene_device": scene.cycles.device,
        "devices": [
            {"name": d.name, "type": d.type, "use": bool(d.use)} for d in prefs.devices
        ],
    }


def setup_camera_light(obj=None) -> None:
    """Add a framing camera plus a sun key light aimed at *obj*.

    Args:
        obj: The object to frame. When ``None`` (nothing imported) the camera
            falls back to a fixed three-quarter view of the world origin.
    """
    import mathutils

    scene = bpy.context.scene
    cam = bpy.data.objects.new("aphrody_cam", bpy.data.cameras.new("aphrody_cam"))
    scene.collection.objects.link(cam)
    scene.camera = cam

    light_data = bpy.data.lights.new("aphrody_sun", type="SUN")
    light_data.energy = 3.0
    light = bpy.data.objects.new("aphrody_sun", light_data)
    light.rotation_euler = (math.radians(55.0), 0.0, math.radians(35.0))
    scene.collection.objects.link(light)

    size = (max(obj.dimensions) if obj else 2.0) or 2.0
    cam.location = mathutils.Vector((0.0, -size * 2.4, size * 0.4))
    cam.rotation_euler = (
        (obj.location - cam.location).to_track_quat("-Z", "Y").to_euler()
        if obj
        else (math.radians(75.0), 0.0, 0.0)
    )
    bpy.context.view_layer.update()


def run(main) -> None:
    """Run *main*, printing a traceback and exiting non-zero on failure.

    ``blender -b -P`` swallows script exceptions and still exits 0, which makes
    a failed render look like a successful one to any caller. This wrapper
    restores a usable exit code.
    """
    try:
        main()
    except Exception:
        import traceback

        traceback.print_exc()
        sys.exit(1)
