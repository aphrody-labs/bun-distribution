import { M3Canvas3D } from "../canvas3d/canvas-3d.js";
/**
 * A beautiful WebGPU-powered 3D Particle Globe component.
 * Uses procedural TSL shaders to warp particle positions and color-blend
 * dynamically based on Material Design 3 theme colors.
 *
 * Fully SSR-safe via dynamic shader node resolution.
 */
export declare class M3Globe3D extends M3Canvas3D {
    particleCount: number;
    speed: number;
    private points;
    protected continuous: boolean;
    protected initThree(): Promise<void>;
    protected onTick(): void;
}
declare global {
    interface HTMLElementTagNameMap {
        "md-3d-globe": M3Globe3D;
    }
}
