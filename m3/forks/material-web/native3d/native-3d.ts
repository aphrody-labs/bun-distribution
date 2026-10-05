import { LitElement, css, html } from "lit";
import { customElement, property } from "lit/decorators.js";
import type { PropertyValues } from "lit";
import type { Scene3d } from "@aphrody/bun/src/scene-types.js";

/** The Tauri v2 IPC entry point (`window.__TAURI_INTERNALS__.invoke`). */
type Invoke = (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;

/** What `plugin:aphrody-3d|attach` and `|info` report. */
export interface Native3dInfo {
  adapter: string;
  /** Graphics API (`Dx12`, `Vulkan`, `Metal`, ...). */
  backend: string;
  format: string;
  /** `PreMultiplied` means per-pixel transparency. */
  alphaMode: string;
  /** Presented through DirectComposition (Windows). */
  composition: boolean;
  /** Surface size in physical pixels. */
  size: [number, number];
}

function tauriInvoke(): Invoke | null {
  const internals = (globalThis as { __TAURI_INTERNALS__?: { invoke?: Invoke } }).__TAURI_INTERNALS__;
  return typeof internals?.invoke === "function" ? internals.invoke : null;
}

const PLUGIN = "plugin:aphrody-3d|";

/**
 * A hole in the M3 interface through which the native GPU layer of
 * `crates/aphrody-tauri-3d` shows: the model is drawn by the persistent
 * wgpu renderer (DX12 + DirectComposition on Windows) *under* the transparent
 * webview, not by WebGL. The element only reports its rect
 * (`set_viewport`), forwards pointer/wheel input (`orbit`) and loads content
 * (`load_model` / `set_scene`); every low-level operation stays native.
 *
 * The window's webview must be transparent and every ancestor of this element
 * must leave its rect unpainted. One element per window (the layer is per
 * window). Outside Tauri, or when the plugin is not granted, the slotted
 * fallback is shown instead (for example an `md-3d-scene`).
 *
 * ```html
 * <md-native-3d src="C:/models/suzanne.glb" dark>
 *   <md-3d-scene src="/scenes/showcase.json"></md-3d-scene>
 * </md-native-3d>
 * ```
 *
 * @fires native-3d-ready - `detail` is the {@link Native3dInfo} of the layer.
 * @fires native-3d-error - `detail` is the error message.
 */
@customElement("md-native-3d")
export class M3Native3D extends LitElement {
  static override styles = css`
    :host {
      display: block;
      position: relative;
      min-height: 160px;
      background: transparent;
      touch-action: none;
      cursor: grab;
    }
    :host([dragging]) {
      cursor: grabbing;
    }
    :host([native]) slot {
      display: none;
    }
  `;

  /** Path of a `.glb`/`.gltf`/`.obj` model or a `Scene3d` `.json` file on the native side. */
  @property()
  public src = "";

  /** A scene to render; takes precedence over `src`. */
  @property({ attribute: false })
  public scene3d: Scene3d | null = null;

  /** Dark M3 studio scheme for models. */
  @property({ type: Boolean })
  public dark = false;

  /** Packed `0xAARRGGBB` M3 seed for the studio role colours. */
  @property({ type: Number, attribute: "seed-argb" })
  public seedArgb: number | undefined = undefined;

  /** True once the native layer is attached (reflected for styling). */
  @property({ type: Boolean, reflect: true })
  public native = false;

  /** The attached layer, once ready. */
  public info: Native3dInfo | null = null;

  private invoke: Invoke | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private lastRect = "";
  private rectFrame = 0;
  private pending = { dx: 0, dy: 0, zoom: 0 };
  private orbitFrame = 0;
  private drag: { x: number; y: number; id: number } | null = null;

  override connectedCallback() {
    super.connectedCallback();
    this.invoke = tauriInvoke();
    if (!this.invoke) return;
    void this.attach();
  }

  override disconnectedCallback() {
    super.disconnectedCallback();
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    window.removeEventListener("scroll", this.scheduleRect, true);
    window.removeEventListener("resize", this.scheduleRect);
    cancelAnimationFrame(this.rectFrame);
    cancelAnimationFrame(this.orbitFrame);
    this.rectFrame = 0;
    this.orbitFrame = 0;
    this.pending = { dx: 0, dy: 0, zoom: 0 };
    this.drag = null;
    if (this.native) void this.call("detach");
    this.native = false;
    this.info = null;
    this.lastRect = "";
  }

  override updated(changed: PropertyValues<this>) {
    if (!this.native) return;
    if (changed.has("scene3d") || changed.has("src") || changed.has("dark") || changed.has("seedArgb")) {
      void this.load();
    }
  }

  protected override render() {
    return html`<slot></slot>`;
  }

  /** Re-frame the content. */
  public reset() {
    void this.call("orbit", { dx: 0, dy: 0, zoom: 0, reset: true });
  }

  private async call(cmd: string, args?: Record<string, unknown>) {
    try {
      return await this.invoke!(PLUGIN + cmd, args);
    } catch (error) {
      this.dispatchEvent(new CustomEvent("native-3d-error", { detail: String(error), bubbles: true, composed: true }));
      return undefined;
    }
  }

  private async attach() {
    const info = (await this.call("attach")) as Native3dInfo | undefined;
    if (!info || !this.isConnected) return;
    this.info = info;
    this.native = true;
    this.resizeObserver = new ResizeObserver(this.scheduleRect);
    this.resizeObserver.observe(this);
    window.addEventListener("scroll", this.scheduleRect, { capture: true, passive: true });
    window.addEventListener("resize", this.scheduleRect, { passive: true });
    this.addEventListener("pointerdown", this.onPointerDown);
    this.addEventListener("pointermove", this.onPointerMove);
    this.addEventListener("pointerup", this.onPointerUp);
    this.addEventListener("pointercancel", this.onPointerUp);
    this.addEventListener("wheel", this.onWheel, { passive: false });
    this.addEventListener("dblclick", this.onDoubleClick);
    await this.syncRect();
    await this.load();
    this.dispatchEvent(new CustomEvent("native-3d-ready", { detail: info, bubbles: true, composed: true }));
  }

  private async load() {
    if (this.scene3d) {
      await this.call("set_scene", { scene: this.scene3d });
    } else if (this.src) {
      await this.call("load_model", {
        path: this.src,
        options: { dark: this.dark, seedArgb: this.seedArgb },
      });
    }
  }

  private scheduleRect = () => {
    cancelAnimationFrame(this.rectFrame);
    this.rectFrame = requestAnimationFrame(() => void this.syncRect());
  };

  private async syncRect() {
    const r = this.getBoundingClientRect();
    const rect = [r.left, r.top, Math.max(1, r.width), Math.max(1, r.height)];
    const key = rect.map((v) => v.toFixed(1)).join(",");
    if (key === this.lastRect) return;
    this.lastRect = key;
    await this.call("set_viewport", { rect });
  }

  private queueOrbit(dx: number, dy: number, zoom: number) {
    this.pending.dx += dx;
    this.pending.dy += dy;
    this.pending.zoom += zoom;
    if (this.orbitFrame) return;
    this.orbitFrame = requestAnimationFrame(() => {
      this.orbitFrame = 0;
      const { dx, dy, zoom } = this.pending;
      this.pending = { dx: 0, dy: 0, zoom: 0 };
      if (dx || dy || zoom) void this.call("orbit", { dx, dy, zoom });
    });
  }

  private onPointerDown = (e: PointerEvent) => {
    if (e.button !== 0) return;
    this.drag = { x: e.clientX, y: e.clientY, id: e.pointerId };
    this.setPointerCapture(e.pointerId);
    this.toggleAttribute("dragging", true);
  };

  private onPointerMove = (e: PointerEvent) => {
    if (!this.drag || e.pointerId !== this.drag.id) return;
    this.queueOrbit(e.clientX - this.drag.x, e.clientY - this.drag.y, 0);
    this.drag.x = e.clientX;
    this.drag.y = e.clientY;
  };

  private onPointerUp = (e: PointerEvent) => {
    if (!this.drag || e.pointerId !== this.drag.id) return;
    this.drag = null;
    this.toggleAttribute("dragging", false);
  };

  private onWheel = (e: WheelEvent) => {
    e.preventDefault();
    this.queueOrbit(0, 0, e.deltaMode === WheelEvent.DOM_DELTA_LINE ? e.deltaY * 16 : e.deltaY);
  };

  private onDoubleClick = () => this.reset();
}

declare global {
  interface HTMLElementTagNameMap {
    "md-native-3d": M3Native3D;
  }
}
