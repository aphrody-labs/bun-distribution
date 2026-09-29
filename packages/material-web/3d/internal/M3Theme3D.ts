import type * as THREE_TYPE from "three/webgpu";
import type { uniform as UNIFORM_TYPE } from "three/tsl";

/**
 * M3Theme3D bridges CSS Custom Properties (Material Design 3 tokens)
 * and Three.js Shading Language (TSL) uniforms. It observes changes to
 * the document element and reactively updates WebGPU shader variables.
 *
 * Designed with dependency injection for SSR safety.
 */
export class M3Theme3D {
  // Reactive TSL uniform nodes
  public primary: any;
  public secondary: any;
  public tertiary: any;
  public background: any;
  public surfaceVariant: any;
  public error: any;

  private observer: MutationObserver | null = null;
  private schemeQuery: MediaQueryList | null = null;
  private container: HTMLElement;
  private readonly onChange: (() => void) | undefined;

  constructor(
    THREE: typeof THREE_TYPE,
    uniformNode: typeof UNIFORM_TYPE,
    container: HTMLElement = document.documentElement,
    onChange?: () => void,
  ) {
    this.container = container;
    this.onChange = onChange;

    // Initialize uniforms using injected dependencies
    this.primary = uniformNode(new THREE.Color("#6750a4"));
    this.secondary = uniformNode(new THREE.Color("#625b71"));
    this.tertiary = uniformNode(new THREE.Color("#7d5260"));
    this.background = uniformNode(new THREE.Color("#fef7ff"));
    this.surfaceVariant = uniformNode(new THREE.Color("#e7e0ec"));
    this.error = uniformNode(new THREE.Color("#ba1a1a"));

    this.update();
    this.startObserving();
  }

  /**
   * Resolve an M3 colour role (kebab-case, e.g. `primary-container`) to the
   * current CSS value of `--md-sys-color-<role>`, or `fallback` when the
   * token is not defined in the container's cascade.
   */
  public resolve(role: string, fallback = "#808080"): string {
    const value = getComputedStyle(this.container)
      .getPropertyValue(`--md-sys-color-${role}`)
      .trim();
    return value || fallback;
  }

  /**
   * Reads current CSS variables and updates the uniform buffer values.
   */
  public update() {
    const style = getComputedStyle(this.container);

    const primaryHex = style.getPropertyValue("--md-sys-color-primary").trim();
    const secondaryHex = style.getPropertyValue("--md-sys-color-secondary").trim();
    const tertiaryHex = style.getPropertyValue("--md-sys-color-tertiary").trim();
    const backgroundHex = style.getPropertyValue("--md-sys-color-background").trim();
    const surfaceVariantHex = style.getPropertyValue("--md-sys-color-surface-variant").trim();
    const errorHex = style.getPropertyValue("--md-sys-color-error").trim();

    if (primaryHex) this.primary.value.set(primaryHex);
    if (secondaryHex) this.secondary.value.set(secondaryHex);
    if (tertiaryHex) this.tertiary.value.set(tertiaryHex);
    if (backgroundHex) this.background.value.set(backgroundHex);
    if (surfaceVariantHex) this.surfaceVariant.value.set(surfaceVariantHex);
    if (errorHex) this.error.value.set(errorHex);

    this.onChange?.();
  }

  /**
   * Observes the theme sources: class/style/data-theme on the container and
   * its document root (where M3 themes are usually switched) and the
   * system light/dark preference.
   */
  private startObserving() {
    if (typeof window === "undefined") return;

    if (window.MutationObserver) {
      this.observer = new MutationObserver(() => this.update());
      const options = { attributes: true, attributeFilter: ["class", "style", "data-theme"] };
      this.observer.observe(this.container, options);
      const root = this.container.ownerDocument?.documentElement;
      if (root && root !== this.container) this.observer.observe(root, options);
    }
    if (window.matchMedia) {
      this.schemeQuery = window.matchMedia("(prefers-color-scheme: dark)");
      this.schemeQuery.addEventListener("change", this.handleSchemeChange);
    }
  }

  private handleSchemeChange = () => this.update();

  /**
   * Disconnects the theme observers.
   */
  public dispose() {
    this.observer?.disconnect();
    this.observer = null;
    this.schemeQuery?.removeEventListener("change", this.handleSchemeChange);
    this.schemeQuery = null;
  }
}
