import type { Render3dPolicy, Scene as M3Scene, Scene3d as M3Scene3d } from "./scene-types.js";
import type { Canvas, Image, SvgCanvas, SvgExportFlag } from "./vendor/index.js";

// The browser-safe contract has a single implementation, shared with `@aphrody/canvas/site`.
export {
  aphrodyCanvasRuntime,
  aphrodyCanvasVersion,
  configureBrowserCanvas,
  createBrowserCanvas,
  createM3CanvasSurface,
  isBrowserCanvasAvailable,
  selectCanvasBackend,
} from "./site.js";
export type { AphrodyCanvasOptions, CanvasBackend, CanvasSize, M3CanvasSurface } from "./site.js";

export function isNativeCanvasAvailable(): boolean {
  const runtime = globalThis as typeof globalThis & { process?: { versions?: { bun?: string } } };
  return runtime.process?.versions?.bun !== undefined;
}

/**
 * Load the vendored upstream Skia/N-API runtime (`vendor/`, pinned `@napi-rs/canvas`) in Bun.
 * The addon resolves from `NAPI_RS_NATIVE_LIBRARY_PATH`, `vendor/skia.<platform>.node`, then the
 * `@napi-rs/canvas-<platform>` optional dependency.
 */
export async function loadNativeCanvas() {
  if (!isNativeCanvasAvailable())
    throw new Error("@aphrody/canvas: native Skia requires Bun and its native addon");
  return import("./vendor/index.js");
}

export async function createNativeCanvas(width: number, height: number): Promise<Canvas>;
export async function createNativeCanvas(
  width: number,
  height: number,
  flag: SvgExportFlag,
): Promise<SvgCanvas>;
export async function createNativeCanvas(
  width: number,
  height: number,
  flag?: SvgExportFlag,
): Promise<Canvas | SvgCanvas> {
  const { createCanvas } = await loadNativeCanvas();
  return flag === undefined ? createCanvas(width, height) : createCanvas(width, height, flag);
}

export async function loadNativeImage(source: string | Uint8Array): Promise<Image> {
  const { loadImage } = await loadNativeCanvas();
  return loadImage(source);
}

export async function clearNativeCanvasCache(): Promise<void> {
  const { clearAllCache } = await loadNativeCanvas();
  clearAllCache();
}

/** Scene contracts consumed by the Rust renderer (drift-checked mirror of `@aphrody/bun`). */
export type { M3Scene, M3Scene3d };
/** Backend policy for {@link drawM3Scene3d}: see `@aphrody/bun`'s `m3Render3d`. */
export type M3Render3dPolicy = Render3dPolicy;

/** The part of the optional `@aphrody/bun` peer used by the scene renderers. */
interface AphrodyBunRenderer {
  m3Render(scene: M3Scene): Uint8Array;
  m3Render3d(scene: M3Scene3d, policy: Render3dPolicy): Uint8Array;
}

/**
 * Kept out of static analysis: `@aphrody/bun` is an optional peer, so neither bundlers nor
 * type-checkers of consumers may require it unless a scene renderer is actually called.
 */
const APHRODY_BUN: string = "@aphrody/bun";

function isMissingModule(error: unknown, specifier: string): boolean {
  const { code, message } = (error ?? {}) as { code?: unknown; message?: unknown };
  return (
    (code === "ERR_MODULE_NOT_FOUND" || code === "MODULE_NOT_FOUND") &&
    typeof message === "string" &&
    message.includes(specifier)
  );
}

async function loadAphrodyBun(caller: string): Promise<AphrodyBunRenderer> {
  try {
    return (await import(APHRODY_BUN)) as AphrodyBunRenderer;
  } catch (cause) {
    if (isMissingModule(cause, APHRODY_BUN)) {
      throw new Error(
        `@aphrody/canvas: ${caller} needs the optional peer dependency ${APHRODY_BUN} ` +
          `(Rust M3 renderer); add it next to @aphrody/canvas`,
        { cause },
      );
    }
    throw cause;
  }
}

async function blitPng(png: Uint8Array, width: number, height: number): Promise<Canvas> {
  const [canvas, image] = await Promise.all([
    createNativeCanvas(width, height),
    loadNativeImage(png),
  ]);
  canvas.getContext("2d").drawImage(image, 0, 0, width, height);
  return canvas;
}

/**
 * Draw an M3 [`Scene`](https://github.com/aphrody-labs/aphrody/blob/main/crates/ui/render/src/scene.rs)
 * onto a fresh native Skia canvas.
 *
 * Rendering itself happens off-thread of the addon: the scene is rasterized
 * deterministically in Rust (`aphrody_render::raster`, via `@aphrody/bun`'s
 * `m3Render`) to a PNG, which is then decoded and blitted by the native
 * canvas addon. This keeps `@aphrody/canvas`'s own contract (surface sizing,
 * pixel ratio, `M3CanvasSurface` density/color-scheme) as the single native
 * canvas entry point, without duplicating M3 shape/elevation/text math in
 * JS. Requires the optional peer `@aphrody/bun`.
 */
export async function drawM3Scene(scene: M3Scene): Promise<Canvas> {
  if (!isNativeCanvasAvailable()) {
    throw new Error("@aphrody/canvas: drawM3Scene requires Bun's native canvas addon");
  }
  const bun = await loadAphrodyBun("drawM3Scene");
  return blitPng(bun.m3Render(scene), scene.width, scene.height);
}

/**
 * Draw an M3 3D scene (`aphrody_render::scene3d::Scene3d`: grouped meshes,
 * PBR materials resolved from M3 roles, lights, shadows, 4x MSAA) onto a
 * fresh native Skia canvas.
 *
 * The frame is rendered in Rust through `aphrody_render::pipeline3d` —
 * deterministic CPU by default, the persistent GPU renderer with
 * `policy: "auto"` — and blitted by the native canvas addon, exactly like
 * {@link drawM3Scene} does for 2D scenes. Requires the optional peer `@aphrody/bun`.
 */
export async function drawM3Scene3d(
  scene: M3Scene3d,
  policy: M3Render3dPolicy = "cpu",
): Promise<Canvas> {
  if (!isNativeCanvasAvailable()) {
    throw new Error("@aphrody/canvas: drawM3Scene3d requires Bun's native canvas addon");
  }
  const bun = await loadAphrodyBun("drawM3Scene3d");
  return blitPng(bun.m3Render3d(scene, policy), scene.width, scene.height);
}

// Root entry = native runtime: the upstream API (createCanvas, loadImage, GlobalFonts, ...).
export * from "./vendor/index.js";
export { default } from "./vendor/index.js";
