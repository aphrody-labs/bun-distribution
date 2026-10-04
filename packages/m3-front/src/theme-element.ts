// SPDX-License-Identifier: Apache-2.0
// <m3-theme seed="#6750a4" mode="auto" variant="tonalSpot" contrast="0"> scopes a dynamic M3 colour
// scheme to its subtree (display: contents) with no framework: any <md-*> inside re-themes live.
import { schemeFromSeed, type SchemeVariant } from "@aphrody/m3-tokens/dynamic-color";

export type ThemeMode = "light" | "dark" | "auto";

const VARIANTS = [
  "tonalSpot",
  "content",
  "fidelity",
  "expressive",
  "vibrant",
  "neutral",
  "monochrome",
];

export class M3ThemeElement extends HTMLElement {
  static observedAttributes = ["seed", "mode", "variant", "contrast"];
  #applied: string[] = [];
  #media: MediaQueryList | null = null;
  #listener = (): void => this.apply();

  connectedCallback(): void {
    this.style.display = "contents";
    this.#media = globalThis.matchMedia?.("(prefers-color-scheme: dark)") ?? null;
    this.#media?.addEventListener("change", this.#listener);
    this.apply();
  }

  disconnectedCallback(): void {
    this.#media?.removeEventListener("change", this.#listener);
    this.clear();
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

  /** The mode in effect (auto resolves through prefers-color-scheme). */
  get resolvedMode(): "light" | "dark" {
    if (this.mode !== "auto") return this.mode;
    return this.#media?.matches ? "dark" : "light";
  }

  apply(): void {
    const v = this.getAttribute("variant") ?? "tonalSpot";
    const variant = (VARIANTS.includes(v) ? v : "tonalSpot") as SchemeVariant;
    const dark = this.resolvedMode === "dark";
    const roles = schemeFromSeed(this.seed, {
      dark,
      variant,
      contrastLevel: Number(this.getAttribute("contrast") ?? 0) || 0,
    });
    this.clear();
    for (const [k, val] of Object.entries(roles)) {
      this.style.setProperty(k, val);
      this.#applied.push(k);
    }
    this.style.setProperty("color-scheme", dark ? "dark" : "light");
    this.dataset["resolvedMode"] = dark ? "dark" : "light";
    this.dispatchEvent(
      new CustomEvent("m3-theme-change", { detail: { seed: this.seed, dark }, bubbles: true }),
    );
  }

  private clear(): void {
    for (const k of this.#applied) this.style.removeProperty(k);
    this.#applied = [];
  }
}

/** Define `<m3-theme>` (idempotent). */
export function defineM3Theme(tag = "m3-theme"): void {
  if (!customElements.get(tag)) customElements.define(tag, M3ThemeElement);
}

defineM3Theme();
