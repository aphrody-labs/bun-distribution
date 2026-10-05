import { LitElement, type PropertyValues } from "lit";
import type * as THREE_TYPE from "three/webgpu";
import type { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { M3Theme3D } from "../3d/internal/M3Theme3D.js";
/**
 * A Lit Web Component that initializes a WebGPURenderer (with WebGL2 fallback),
 * handles responsive resizing, sets up basic controls, and bridges M3 Theme variables.
 *
 * Rendering is on demand: a frame is drawn only when something changed
 * (resize, theme, controls, {@link M3Canvas3D.requestRender}) or while an
 * animation runs (`auto-rotate`, control damping, {@link M3Canvas3D.continuous}).
 * The loop pauses while the canvas is off-screen or the page is hidden, and
 * continuous motion honours `prefers-reduced-motion`.
 *
 * Fully SSR-safe via runtime dynamic imports.
 */
export declare class M3Canvas3D extends LitElement {
    static styles: import("lit").CSSResult;
    protected canvasEl: HTMLCanvasElement;
    THREE: typeof THREE_TYPE;
    renderer: THREE_TYPE.WebGPURenderer;
    scene: THREE_TYPE.Scene;
    camera: THREE_TYPE.PerspectiveCamera | THREE_TYPE.OrthographicCamera;
    controls: OrbitControls;
    theme: M3Theme3D;
    private resizeObserver;
    private intersectionObserver;
    private reducedMotionQuery;
    private animationFrameId;
    private needsRender;
    private onScreen;
    private ready;
    /**
     * Subclasses that animate every frame (time-based shaders, particles) set
     * this to keep the loop running; it is suspended under reduced motion.
     */
    protected continuous: boolean;
    enableControls: boolean;
    autoRotate: boolean;
    /** `true` when the user asked the system to minimise motion. */
    protected get reducedMotion(): boolean;
    firstUpdated(): void;
    updated(changed: PropertyValues<this>): void;
    protected initThree(): Promise<void>;
    /** Schedule one frame (coalesced with any pending frame). */
    requestRender: () => void;
    /** Hook invoked when M3 theme tokens change; subclasses re-resolve colours. */
    protected onThemeChange(): void;
    private handleMotionChange;
    private get animating();
    private schedule;
    protected onResize(width: number, height: number): void;
    private tick;
    /**
     * Overridable hook for subclass ticking or frame mutations.
     */
    protected onTick(): void;
    disconnectedCallback(): void;
    render(): import("lit-html").TemplateResult<1>;
}
/** Release the GPU resources (geometries, materials, textures) of a subtree. */
export declare function disposeObject(root: THREE_TYPE.Object3D): void;
declare global {
    interface HTMLElementTagNameMap {
        "md-3d-canvas": M3Canvas3D;
    }
}
