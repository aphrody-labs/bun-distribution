// SPDX-License-Identifier: Apache-2.0
// <m3-theme seed="#6750a4" mode="auto" variant="tonalSpot" contrast="0"> scopes a dynamic M3 colour
// scheme to its subtree (display: contents) with no framework: any <md-*> inside re-themes live.
import { schemeFromSeed, type SchemeVariant } from "@aphrody/m3-tokens/dynamic-color";

export type ThemeMode = "light" | "dark" | "auto";

// Importing the pure front helpers must also work in server renderers without a DOM.
// The browser receives the real HTMLElement; the server never constructs or registers elements.
// eslint-disable-next-line @typescript-eslint/no-extraneous-class -- The SSR fallback is only a constructor base and never instantiated.
const HTMLElementBase = globalThis.HTMLElement ?? (class {} as typeof HTMLElement);

export class M3ThemeElement extends HTMLElementBase {
  static observedAttributes = ["seed", "mode", "variant", "contrast"];
  #applied: string[] = [];
  #media: MediaQueryList | null = null;
  #listener = (): void => {
    if (this.mode === "auto") this.apply();
  };

  connectedCallback(): void {
    this.style.display = "contents";
    this.#media =
      this.ownerDocument.defaultView?.matchMedia?.("(prefers-color-scheme: dark)") ?? null;
    this.#media?.addEventListener("change", this.#listener);
    this.apply();
  }

  disconnectedCallback(): void {
    this.#media?.removeEventListener("change", this.#listener);
    this.#media = null;
    this.clear();
    this.style.removeProperty("color-scheme");
    delete this.dataset["resolvedMode"];
  }

  attributeChangedCallback(): void {
    if (this.isConnected) this.apply();
  }

  get seed(): string {
    return this.getAttribute("seed") ?? "#6750a4";
  }
  set seed(v: string) {
    this.setAttribute("seed", v);
  }
  get mode(): ThemeMode {
    const m = this.getAttribute("mode");
    return m === "light" || m === "dark" ? m : "auto";
  }
  set mode(v: ThemeMode) {
    this.setAttribute("mode", v);
  }

  get variant(): SchemeVariant {
    return (this.getAttribute("variant") ?? "tonalSpot") as SchemeVariant;
  }
  set variant(v: SchemeVariant) {
    this.setAttribute("variant", v);
  }

  get contrast(): number {
    return Number(this.getAttribute("contrast") ?? 0);
  }
  set contrast(v: number) {
    this.setAttribute("contrast", String(v));
  }

  /** The mode in effect (auto resolves through prefers-color-scheme). */
  get resolvedMode(): "light" | "dark" {
    if (this.mode !== "auto") return this.mode;
    return this.#media?.matches ? "dark" : "light";
  }

  apply(): void {
    const dark = this.resolvedMode === "dark";
    // Derive before changing styles: rejected inputs keep the last complete scheme.
    const roles = schemeFromSeed(this.seed, {
      dark,
      variant: this.variant,
      contrastLevel: this.contrast,
    });
    this.clear();
    for (const [k, val] of Object.entries(roles)) {
      this.style.setProperty(k, val);
      this.#applied.push(k);
    }
    this.style.setProperty("color-scheme", dark ? "dark" : "light");
    this.dataset["resolvedMode"] = dark ? "dark" : "light";
    this.dispatchEvent(
      new CustomEvent("m3-theme-change", {
        detail: { seed: this.seed, dark, variant: this.variant, contrastLevel: this.contrast },
        bubbles: true,
        composed: true,
      }),
    );
  }

  private clear(): void {
    for (const k of this.#applied) this.style.removeProperty(k);
    this.#applied = [];
  }
}

/** Define `<m3-theme>` or a custom tag (idempotent and safe to import during SSR). */
export function defineM3Theme(tag = "m3-theme"): void {
  const registry = globalThis.customElements;
  if (!registry || registry.get(tag)) return;
  // A CustomElementRegistry cannot associate one constructor with multiple tags.
  registry.define(tag, tag === "m3-theme" ? M3ThemeElement : class extends M3ThemeElement {});
}

defineM3Theme();
