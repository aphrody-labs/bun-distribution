import { M3Canvas3D } from "../canvas3d/canvas-3d.js";
/**
 * An interactive 3D Glassmorphic Card component.
 * Tilts dynamically based on mouse position, reflects high-fidelity scene lights,
 * and updates its materials reactively using M3 theme color variables.
 *
 * Fully SSR-safe via runtime dynamic initialization.
 */
export declare class M3Card3D extends M3Canvas3D {
    private cardGroup;
    private cardMesh;
    private glowMesh;
    private spotLight;
    private targetRotationX;
    private targetRotationY;
    protected initThree(): Promise<void>;
    private handleMouseMove;
    private handleMouseLeave;
    protected onTick(): void;
    disconnectedCallback(): void;
}
declare global {
    interface HTMLElementTagNameMap {
        "md-3d-card": M3Card3D;
    }
}
