import type { PropertyValues } from "lit";
import type { Scene3d } from "@aphrody/bun/src/scene-types.js";
import { M3Canvas3D } from "../canvas3d/canvas-3d.js";
export type { Scene3d } from "@aphrody/bun/src/scene-types.js";
/**
 * Renders an `aphrody_render::scene3d::Scene3d` — the same JSON scene the
 * native CPU/GPU renderer (`crates/ui/render`, `m3Render3d`) consumes —
 * with three.js `WebGPURenderer` (WebGL2 fallback).
 *
 * The scene graph is flattened once per change and meshes that share a
 * geometry and a material are grouped into a single `InstancedMesh` (one draw
 * call per group, like the native `DrawBatch`es). Geometries and materials are
 * cached and reused across rebuilds. M3 colour roles resolve from
 * `--md-sys-color-<role>` and follow theme changes live; the first
 * shadow-casting directional light gets a PCF soft shadow map fitted to the
 * casters. Frames are drawn on demand by {@link M3Canvas3D}.
 *
 * ```html
 * <md-3d-scene .scene3d=${scene}></md-3d-scene>
 * <md-3d-scene src="/scenes/showcase.json"></md-3d-scene>
 * ```
 */
export declare class M3Scene3D extends M3Canvas3D {
    /** The scene to render (`width`/`height` are ignored: the element sizes it). */
    scene3d: Scene3d | null;
    /** URL of a scene JSON document, fetched when `scene3d` is not set. */
    src: string;
    private root;
    private lights;
    private geometries;
    private materials;
    /** Material colour slots bound to M3 roles, re-resolved on theme change. */
    private paintBindings;
    private initialised;
    private fetchAbort;
    constructor();
    protected initThree(): Promise<void>;
    updated(changed: PropertyValues<this>): void;
    protected onThemeChange(): void;
    private loadScene;
    /** Rebuild the three.js scene from the current `scene3d` / `src`. */
    rebuild(): Promise<void>;
    private applyCamera;
    private addLights;
    private createLight;
    private geometry;
    private material;
    private bindMaterial;
    private bindPaint;
    /** Resolve every bound paint against the current M3 tokens. */
    private resolvePaints;
    private evictUnused;
    disconnectedCallback(): void;
}
declare global {
    interface HTMLElementTagNameMap {
        "md-3d-scene": M3Scene3D;
    }
}
