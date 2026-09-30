/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { html, LitElement, nothing, TemplateResult } from "lit";
import { property, queryAssignedElements } from "lit/decorators.js";
import { ClassInfo, classMap } from "lit/directives/class-map.js";

/**
 * A banner shows a prominent message and related optional actions. It
 * appears at the top of the screen, below a top app bar, and stays until the
 * user acts on it or dismisses it.
 *
 * The default slot holds the message (one or two lines depending on
 * `lines`); slot a leading icon or image into `slot="icon"` and up to two
 * actions (e.g. `<md-text-button>`) into `slot="action"`. Set `lines="two"`
 * for the multi-line layout, `stacked` to move the actions onto their own
 * row beneath the content (the M3 mobile two-line layout), and `closeable`
 * for a trailing dismiss affordance that fires a `close` event.
 *
 * ```html
 * <md-banner lines="two">
 *   <img slot="icon" src="…" alt="" />
 *   Two files could not be synced to this device because they are too large.
 *   <md-text-button slot="action">Dismiss</md-text-button>
 *   <md-text-button slot="action">Retry</md-text-button>
 * </md-banner>
 * ```
 *
 * @fires close {Event} Fired when the user activates the dismiss affordance.
 */
export class Banner extends LitElement {
  /** Whether the banner is shown. Reflected so CSS can target `[open]`. */
  @property({ type: Boolean, reflect: true }) open = true;

  /** `'single'` (default) shows one line of text; `'two'` allows two. */
  @property({ reflect: true }) lines: "single" | "two" = "single";

  /**
   * Moves the actions onto their own row beneath the content instead of
   * trailing it inline — the M3 mobile layout for two-line banners.
   */
  @property({ type: Boolean, reflect: true }) stacked = false;

  /** Renders a bottom divider under the container. */
  @property({ type: Boolean }) divider = false;

  /**
   * When true, renders a trailing close (✕) affordance and lets Escape
   * dismiss the banner.
   */
  @property({ type: Boolean }) closeable = false;

  @queryAssignedElements({ slot: "icon", flatten: true })
  private readonly iconElements!: HTMLElement[];

  @queryAssignedElements({ slot: "action", flatten: true })
  private readonly actionElements!: HTMLElement[];

  override connectedCallback() {
    super.connectedCallback();
    if (!this.hasAttribute("role")) {
      this.setAttribute("role", "region");
    }
    if (!this.hasAttribute("aria-live")) {
      this.setAttribute("aria-live", "polite");
    }
  }

  /** Shows the banner. */
  show(): void {
    this.open = true;
  }

  /** Dismisses the banner and fires `close`. */
  dismiss(): void {
    if (!this.open) {
      return;
    }
    this.open = false;
    this.dispatchEvent(new Event("close", { bubbles: true, composed: true }));
  }

  protected override render(): TemplateResult | typeof nothing {
    if (!this.open) {
      return nothing;
    }
    const classes: ClassInfo = { stacked: this.stacked, divider: this.divider };
    return html`
      <div class="banner ${classMap(classes)}" @keydown=${this.handleKeydown}>
        <div class="icon" aria-hidden="true">
          <slot name="icon" @slotchange=${this.handleIconSlotChange}></slot>
        </div>
        <div class="content"><slot></slot></div>
        <div class="actions" @slotchange=${this.handleActionSlotChange}>
          <slot name="action"></slot>
          ${this.renderCloseButton()}
        </div>
      </div>
    `;
  }

  private handleIconSlotChange(): void {
    this.toggleAttribute("has-icon", this.iconElements.length > 0);
  }

  private handleActionSlotChange(): void {
    this.toggleAttribute("has-action", this.actionElements.length > 0);
  }

  private renderCloseButton(): TemplateResult | typeof nothing {
    if (!this.closeable) {
      return nothing;
    }
    return html`
      <button class="close" aria-label="Dismiss" @click=${this.handleCloseClick}>
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path
            d="M6.4 19 5 17.6l5.6-5.6L5 6.4 6.4 5l5.6 5.6L17.6 5 19 6.4 13.4 12l5.6 5.6-1.4 1.4-5.6-5.6Z"
          ></path>
        </svg>
      </button>
    `;
  }

  private handleCloseClick(): void {
    this.dismiss();
  }

  private handleKeydown(event: KeyboardEvent): void {
    if (event.key === "Escape" && this.closeable) {
      event.stopPropagation();
      this.dismiss();
    }
  }
}
