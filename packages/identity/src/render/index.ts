// SPDX-License-Identifier: Apache-2.0
// Public entry of the pet renderer: picks WebGPU when the page has it, Canvas 2D otherwise.
import { PET_ATLAS_URL } from "../atlas";
import { PET, type PetData } from "../pet";
import { createCanvas2dDrawer } from "./canvas2d";
import { acquireWebGpu, createWebGpuDrawer } from "./webgpu";
import {
  PetTimeline,
  swayYaw,
  type DrawOptions,
  type PetDrawer,
} from "./frames";

export type PetRenderMode = "2d" | "3d";
export type PetRenderBackend = "auto" | "webgpu" | "canvas2d";

export interface PetRendererOptions {
  mode?: PetRenderMode;
  backend?: PetRenderBackend;
  /** Initial track, default `idle`. */
  state?: string;
  /** Atlas image URL, default the bundled spritesheet. */
  atlasUrl?: string;
  data?: PetData;
  /** Extrusion depth in pixels for the 3d mode, default 0.3 of the frame height. */
  depth?: number;
  /** Number of 3d slices, default 24. */
  slices?: number;
  /** Sway amplitude in degrees for the 3d mode, default 12. */
  swayDeg?: number;
}

export interface PetRenderer {
  readonly backend: "webgpu" | "canvas2d";
  readonly state: string;
  readonly mode: PetRenderMode;
  play(state: string, loop?: boolean): void;
  look(dx: number, dy: number): void;
  setMode(mode: PetRenderMode): void;
  /** Draws the pose at `nowMs` (defaults to `performance.now()`). */
  render(nowMs?: number): void;
  /** Redraws on every animation frame until `stop` or `dispose`. */
  start(): void;
  stop(): void;
  dispose(): void;
}

async function loadAtlas(url: string): Promise<ImageBitmap> {
  const response = await fetch(url);
  if (!response.ok)
    throw new Error(`pet atlas ${url}: HTTP ${response.status}`);
  return createImageBitmap(await response.blob());
}

async function makeDrawer(
  canvas: HTMLCanvasElement,
  backend: PetRenderBackend,
  atlas: ImageBitmap,
): Promise<PetDrawer> {
  if (backend !== "canvas2d") {
    const env = await acquireWebGpu(canvas);
    if (env) return createWebGpuDrawer(env, atlas);
    if (backend === "webgpu")
      throw new Error("WebGPU indisponible sur cette plateforme");
  }
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D indisponible");
  return createCanvas2dDrawer(ctx, atlas);
}

export async function createPetRenderer(
  canvas: HTMLCanvasElement,
  options: PetRendererOptions = {},
): Promise<PetRenderer> {
  const data = options.data ?? PET;
  const atlas = await loadAtlas(options.atlasUrl ?? PET_ATLAS_URL);
  const drawer = await makeDrawer(canvas, options.backend ?? "auto", atlas);
  const timeline = new PetTimeline(options.state ?? "idle", data);
  const depthRatio = options.depth ?? 0.3;
  const slices = options.slices ?? 24;
  const swayDeg = options.swayDeg ?? 12;
  let mode: PetRenderMode = options.mode ?? "2d";
  let frame: number | null = null;
  let disposed = false;

  const renderer: PetRenderer = {
    backend: drawer.backend,
    get state() {
      return timeline.state;
    },
    get mode() {
      return mode;
    },
    play(state, loop = true) {
      timeline.play(state, performance.now(), loop);
    },
    look(dx, dy) {
      timeline.look(dx, dy);
    },
    setMode(next) {
      mode = next;
    },
    render(nowMs = performance.now()) {
      if (disposed) return;
      const pose = timeline.pose(nowMs);
      const drawOptions: DrawOptions = {
        mode,
        yaw: mode === "3d" ? swayYaw(nowMs, swayDeg) : 0,
        depth: pose.frame.h * depthRatio,
        slices,
      };
      drawer.draw(pose, drawOptions);
    },
    start() {
      if (frame !== null || disposed) return;
      const tick = (now: number) => {
        renderer.render(now);
        frame = requestAnimationFrame(tick);
      };
      frame = requestAnimationFrame(tick);
    },
    stop() {
      if (frame !== null) cancelAnimationFrame(frame);
      frame = null;
    },
    dispose() {
      renderer.stop();
      disposed = true;
      drawer.dispose();
    },
  };
  return renderer;
}
