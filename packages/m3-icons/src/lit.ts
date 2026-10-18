// SPDX-License-Identifier: Apache-2.0

import { html, LitElement, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import { unsafeHTML } from "lit/directives/unsafe-html.js";
import { m3Icon, type M3IconStyle } from "@aphrody/bun";

/**
 * `<m3-icon>`: renders a Material Symbols icon as inline SVG, generated from the variable font
 * outlines by the `icons` module of `aphrody-bun` (no icon font requested, loaded or applied via CSS).
 *
 * ```html
 * <m3-icon name="home" variant="rounded" fill="1" weight="500"></m3-icon>
 * ```
 */
@customElement("m3-icon")
export class M3IconElement extends LitElement {
  @property({ type: String }) name = "";
  /** Named `variant`, not `style`: `style` is already `HTMLElement.style` (`CSSStyleDeclaration`). */
  @property({ type: String }) variant: M3IconStyle = "outlined";
  @property({ type: Number }) fill = 0;
  @property({ type: Number }) weight = 400;
  @property({ type: Number }) grade = 0;
  @property({ type: Number, attribute: "optical-size" }) opticalSize = 24;
  @property({ type: Number }) size = 24;
  @property({ type: String }) title = "";

  protected override createRenderRoot() {
    // Inline SVG needs to inherit `currentColor`/font-size from the host document; light DOM
    // keeps that trivial instead of piping custom properties through a shadow boundary.
    return this;
  }

  override render() {
    if (!this.name) return nothing;
    const svg = m3Icon({
      name: this.name,
      style: this.variant,
      fill: this.fill,
      weight: this.weight,
      grade: this.grade,
      opticalSize: this.opticalSize,
      size: this.size,
    });
    return html`${
      this.title
        ? html`<span role="img" aria-label=${this.title}>${unsafeHTML(svg)}</span>`
        : html`<span aria-hidden="true">${unsafeHTML(svg)}</span>`
    }`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "m3-icon": M3IconElement;
  }
}
