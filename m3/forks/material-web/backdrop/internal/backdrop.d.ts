/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { LitElement } from "lit";
/**
 * A full-screen scrim, the Material 3 equivalent of MUI's `Backdrop`.
 *
 * Renders a fixed, full-viewport overlay tinted with `--md-sys-color-scrim`.
 * It fades in/out when `open` toggles and forwards a `click` event so the host
 * can dismiss whatever it sits behind. Set `invisible` for a transparent (but
 * still click-catching) scrim, or `blur` to frost the content behind it.
 *
 * The scrim is `aria-hidden` — it is purely decorative and must not be exposed
 * to assistive tech; the dismiss interaction is mirrored by the dialog/menu it
 * backs.
 *
 * ```html
 * <md-backdrop open blur @click=${close}></md-backdrop>
 * ```
 *
 * @fires click {MouseEvent} Fired when the scrim is clicked (native).
 */
export declare class Backdrop extends LitElement {
    /** Whether the scrim is shown. Reflected so CSS can target `[open]`. */
    open: boolean;
    /**
     * Renders a transparent scrim that still intercepts pointer events. Useful
     * for click-away dismissal without dimming the UI (M3 "transparent scrim").
     */
    invisible: boolean;
    /**
     * Applies a backdrop blur to the content behind the scrim. Named `blurred`
     * to avoid shadowing `HTMLElement.prototype.blur()`; the attribute is `blur`.
     */
    blurred: boolean;
    connectedCallback(): void;
    protected render(): import("lit-html").TemplateResult<1>;
}
