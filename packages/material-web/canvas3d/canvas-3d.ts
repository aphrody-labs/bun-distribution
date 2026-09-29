import { LitElement, html, css, type PropertyValues } from "lit";
import { customElement, property, query } from "lit/decorators.js";
import { configureBrowserCanvas } from "@aphrody/canvas/site";

// Type-only imports to preserve compile-time safety without loading the modules during SSR
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
@customElement("md-3d-canvas")
export class M3Canvas3D extends LitElement {
  static override styles = css`
    :host {
      display: block;
      width: 100%;
      height: 100%;
      position: relative;
      overflow: hidden;
      border-radius: inherit;
    }
    canvas {
      display: block;
      width: 100%;
      height: 100%;
    }
  `;

  @query("canvas")
  protected canvasEl!: HTMLCanvasElement;

  // Public properties resolved on the client at runtime
  public THREE!: typeof THREE_TYPE;
  public renderer!: THREE_TYPE.WebGPURenderer;
  public scene!: THREE_TYPE.Scene;
  public camera!: THREE_TYPE.PerspectiveCamera | THREE_TYPE.OrthographicCamera;
  public controls!: OrbitControls;
  public theme!: M3Theme3D;

  private resizeObserver: ResizeObserver | null = null;
  private intersectionObserver: IntersectionObserver | null = null;
  private reducedMotionQuery: MediaQueryList | null = null;
  private animationFrameId: number | null = null;
  private needsRender = true;
  private onScreen = true;
  private ready = false;

  /**
   * Subclasses that animate every frame (time-based shaders, particles) set
   * this to keep the loop running; it is suspended under reduced motion.
   */
  protected continuous = false;

  @property({ type: Boolean, attribute: "enable-controls" })
  public enableControls = true;

  @property({ type: Boolean, attribute: "auto-rotate" })
  public autoRotate = false;

  /** `true` when the user asked the system to minimise motion. */
  protected get reducedMotion(): boolean {
    return this.reducedMotionQuery?.matches ?? false;
  }

  override firstUpdated() {
    configureBrowserCanvas(this.canvasEl, { width: 1, height: 1 });
    this.initThree();
  }

  override updated(changed: PropertyValues<this>) {
    if (!this.controls) return;
    if (changed.has("enableControls")) this.controls.enabled = this.enableControls;
    if (changed.has("autoRotate")) this.controls.autoRotate = this.autoRotate && !this.reducedMotion;
    this.requestRender();
  }

  protected async initThree() {
    // 1. Asynchronously load heavy browser-only dependencies
    const THREE = await import("three/webgpu");
    const { OrbitControls } = await import("three/examples/jsm/controls/OrbitControls.js");
    const { uniform } = await import("three/tsl");
    const { M3Theme3D } = await import("../3d/internal/M3Theme3D.js");

    this.THREE = THREE;

    // 2. Scene setup
    this.scene = new THREE.Scene();

    // 3. Camera setup
    const rect = this.getBoundingClientRect();
    const aspect = rect.width / (rect.height || 1);
    this.camera = new THREE.PerspectiveCamera(50, aspect, 0.1, 100);
    this.camera.position.set(0, 0, 5);

    // 4. Renderer setup
    this.renderer = new THREE.WebGPURenderer({
      canvas: this.canvasEl,
      antialias: true,
      alpha: true,
    });

    try {
      await this.renderer.init();
    } catch (e) {
      console.warn("WebGPU initialization failed. Falling back to WebGL2 backend.", e);
    }

    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(rect.width, rect.height, false);

    // 5. Initialize M3 Theme Bridge (injecting Three dependencies)
    this.theme = new M3Theme3D(THREE, uniform, this, () => this.onThemeChange());

    // 6. Motion preferences
    this.reducedMotionQuery = window.matchMedia?.("(prefers-reduced-motion: reduce)") ?? null;
    this.reducedMotionQuery?.addEventListener("change", this.handleMotionChange);

    // 7. Controls setup: every camera change schedules one frame.
    this.controls = new OrbitControls(this.camera, this.canvasEl);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.05;
    this.controls.enabled = this.enableControls;
    this.controls.autoRotate = this.autoRotate && !this.reducedMotion;
    this.controls.addEventListener("change", this.requestRender);

    // 8. Handle resizing, visibility and page lifecycle
    this.resizeObserver = new ResizeObserver((entries) => {
      if (!entries || entries.length === 0) return;
      const { width, height } = entries[0].contentRect;
      this.onResize(width, height);
    });
    this.resizeObserver.observe(this);
    this.intersectionObserver = new IntersectionObserver((entries) => {
      this.onScreen = entries.some((entry) => entry.isIntersecting);
      this.schedule();
    });
    this.intersectionObserver.observe(this);
    document.addEventListener("visibilitychange", this.schedule);

    this.ready = true;
    this.requestRender();

    // Dispatch initialized event
    this.dispatchEvent(
      new CustomEvent("md-3d-init", {
        detail: {
          canvas: this,
          scene: this.scene,
          camera: this.camera,
          renderer: this.renderer,
          theme: this.theme,
        },
        bubbles: true,
        composed: true,
      }),
    );
  }

  /** Schedule one frame (coalesced with any pending frame). */
  public requestRender = () => {
    this.needsRender = true;
    this.schedule();
  };

  /** Hook invoked when M3 theme tokens change; subclasses re-resolve colours. */
  protected onThemeChange() {
    this.requestRender();
  }

  private handleMotionChange = () => {
    if (this.controls) this.controls.autoRotate = this.autoRotate && !this.reducedMotion;
    this.requestRender();
  };

  private get animating(): boolean {
    return (
      (this.continuous && !this.reducedMotion) || (this.controls?.autoRotate ?? false)
    );
  }

  private schedule = () => {
    if (!this.ready || this.animationFrameId !== null) return;
    if (!this.onScreen || document.visibilityState === "hidden") return;
    if (!this.needsRender && !this.animating) return;
    this.animationFrameId = requestAnimationFrame(this.tick);
  };

  protected onResize(width: number, height: number) {
    if (!this.camera || !this.renderer) return;

    const aspect = width / (height || 1);
    if ("isPerspectiveCamera" in this.camera && this.camera.isPerspectiveCamera) {
      this.camera.aspect = aspect;
    } else {
      const ortho = this.camera as THREE_TYPE.OrthographicCamera;
      const halfHeight = (ortho.top - ortho.bottom) / 2;
      ortho.left = -halfHeight * aspect;
      ortho.right = halfHeight * aspect;
    }
    this.camera.updateProjectionMatrix();

    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(width, height, false);
    this.requestRender();
  }

  private tick = () => {
    this.animationFrameId = null;

    // `update()` reports whether damping or auto-rotation moved the camera.
    const moving = this.controls?.enabled || this.controls?.autoRotate ? this.controls.update() : false;

    // Call custom render function hook or dispatch event
    this.onTick();

    if (this.renderer && this.scene && this.camera) {
      this.renderer.render(this.scene, this.camera);
    }
    this.needsRender = moving;
    this.schedule();
  };

  /**
   * Overridable hook for subclass ticking or frame mutations.
   */
  protected onTick() {
    this.dispatchEvent(
      new CustomEvent("md-3d-tick", {
        bubbles: false,
      }),
    );
  }

  override disconnectedCallback() {
    super.disconnectedCallback();
    this.ready = false;

    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
    this.resizeObserver?.disconnect();
    this.intersectionObserver?.disconnect();
    document.removeEventListener("visibilitychange", this.schedule);
    this.reducedMotionQuery?.removeEventListener("change", this.handleMotionChange);
    this.theme?.dispose();
    if (this.controls) {
      this.controls.removeEventListener("change", this.requestRender);
      this.controls.dispose();
    }
    if (this.scene) disposeObject(this.scene);
    this.renderer?.dispose();
  }

  override render() {
    return html`<canvas></canvas>`;
  }
}

/** Release the GPU resources (geometries, materials, textures) of a subtree. */
export function disposeObject(root: THREE_TYPE.Object3D) {
  root.traverse((object) => {
    const mesh = object as Partial<THREE_TYPE.Mesh>;
    mesh.geometry?.dispose();
    const materials = mesh.material ? [mesh.material].flat() : [];
    for (const material of materials) {
      for (const value of Object.values(material)) {
        if (value && typeof value === "object" && "isTexture" in value) {
          (value as THREE_TYPE.Texture).dispose();
        }
      }
      material.dispose();
    }
  });
}

declare global {
  interface HTMLElementTagNameMap {
    "md-3d-canvas": M3Canvas3D;
  }
}
