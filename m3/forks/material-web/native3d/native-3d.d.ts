import { LitElement } from "lit";
import type { PropertyValues } from "lit";
import type { Scene3d } from "@aphrody/bun/src/scene-types.js";
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
export declare class M3Native3D extends LitElement {
    static styles: import("lit").CSSResult;
    /** Path of a `.glb`/`.gltf`/`.obj` model or a `Scene3d` `.json` file on the native side. */
    src: string;
    /** A scene to render; takes precedence over `src`. */
    scene3d: Scene3d | null;
    /** Dark M3 studio scheme for models. */
    dark: boolean;
    /** Packed `0xAARRGGBB` M3 seed for the studio role colours. */
    seedArgb: number | undefined;
    /** True once the native layer is attached (reflected for styling). */
    native: boolean;
    /** The attached layer, once ready. */
    info: Native3dInfo | null;
    private invoke;
    private resizeObserver;
    private lastRect;
    private rectFrame;
    private pending;
    private orbitFrame;
    private drag;
    connectedCallback(): void;
    disconnectedCallback(): void;
    updated(changed: PropertyValues<this>): void;
    protected render(): import("lit-html").TemplateResult<1>;
    /** Re-frame the content. */
    reset(): void;
    private call;
    private attach;
    private load;
    private scheduleRect;
    private syncRect;
    private queueOrbit;
    private onPointerDown;
    private onPointerMove;
    private onPointerUp;
    private onWheel;
    private onDoubleClick;
}
declare global {
    interface HTMLElementTagNameMap {
        "md-native-3d": M3Native3D;
    }
}
