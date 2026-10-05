import type * as THREE_TYPE from "three/webgpu";
import type { uniform as UNIFORM_TYPE } from "three/tsl";
/**
 * M3Theme3D bridges CSS Custom Properties (Material Design 3 tokens)
 * and Three.js Shading Language (TSL) uniforms. It observes changes to
 * the document element and reactively updates WebGPU shader variables.
 *
 * Designed with dependency injection for SSR safety.
 */
export declare class M3Theme3D {
    primary: any;
    secondary: any;
    tertiary: any;
    background: any;
    surfaceVariant: any;
    error: any;
    private observer;
    private schemeQuery;
    private container;
    private readonly onChange;
    constructor(THREE: typeof THREE_TYPE, uniformNode: typeof UNIFORM_TYPE, container?: HTMLElement, onChange?: () => void);
    /**
     * Resolve an M3 colour role (kebab-case, e.g. `primary-container`) to the
     * current CSS value of `--md-sys-color-<role>`, or `fallback` when the
     * token is not defined in the container's cascade.
     */
    resolve(role: string, fallback?: string): string;
    /**
     * Reads current CSS variables and updates the uniform buffer values.
     */
    update(): void;
    /**
     * Observes the theme sources: class/style/data-theme on the container and
     * its document root (where M3 themes are usually switched) and the
     * system light/dark preference.
     */
    private startObserving;
    private handleSchemeChange;
    /**
     * Disconnects the theme observers.
     */
    dispose(): void;
}
