// SPDX-License-Identifier: Apache-2.0
import type { Camera } from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

interface MeshOrbitOwner {
  controls: OrbitControls;
  dispose: () => void;
}

/** Own the official Three controls and their DOM listeners for one mesh preview. */
export function bindMeshOrbitControls(camera: Camera, element: HTMLElement, invalidate: () => void): MeshOrbitOwner {
  const previousTouchAction = element.style.touchAction;
  const controls = new OrbitControls(camera, element);
  controls.enableDamping = true;
  controls.dampingFactor = 0.05;
  controls.minDistance = 0.5;
  controls.maxDistance = 100;
  controls.addEventListener("change", invalidate);
  let disposed = false;
  return {
    controls,
    dispose() {
      if (disposed) return;
      disposed = true;
      controls.removeEventListener("change", invalidate);
      controls.dispose();
      element.style.touchAction = previousTouchAction;
    },
  };
}
