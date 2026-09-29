/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { css } from "lit";

/**
 * Material 3 banner styles. Container uses `surface-container-low` at
 * elevation level 1, per `md.comp.banner.*` tokens. Per-instance overrides via
 * `--md-banner-*`.
 */
export const styles = css`
  :host {
    display: block;
    --_container-color: var(
      --md-banner-container-color,
      var(--md-sys-color-surface-container-low, #f7f2fa)
    );
    --_supporting-text-color: var(
      --md-banner-supporting-text-color,
      var(--md-sys-color-on-surface-variant, #49454f)
    );
    --_divider-color: var(--md-banner-divider-color, var(--md-sys-color-outline-variant, #cac4d0));
    --_action-color: var(--md-banner-action-color, var(--md-sys-color-primary, #6750a4));
  }

  :host(:not([open])) {
    display: none;
  }

  .banner {
    box-sizing: border-box;
    display: flex;
    align-items: center;
    gap: 16px;
    min-height: 52px;
    padding: 8px 16px;
    background: var(--_container-color);
    color: var(--_supporting-text-color);
    /* M3 elevation level 1 */
    box-shadow: var(--md-sys-elevation-level1, 0 1px 2px 0 rgba(0, 0, 0, 0.3));
  }

  .banner.divider {
    border-block-end: 1px solid var(--_divider-color);
  }

  .icon {
    display: none;
    flex: none;
    align-items: center;
    justify-content: center;
    width: 40px;
    height: 40px;
  }

  :host([has-icon]) .icon {
    display: inline-flex;
  }

  ::slotted([slot="icon"]) {
    width: 40px;
    height: 40px;
    object-fit: cover;
    border-radius: var(--md-sys-shape-corner-full, 9999px);
  }

  .content {
    flex: 1;
    min-width: 0;
    padding-block: 10px;
    font-family: var(
      --md-sys-typescale-body-medium-font,
      "Google Sans Flex",
      Roboto,
      system-ui,
      sans-serif
    );
    font-size: var(--md-sys-typescale-body-medium-size, 14px);
    line-height: var(--md-sys-typescale-body-medium-line-height, 20px);
    letter-spacing: var(--md-sys-typescale-body-medium-tracking, 0.25px);
    font-weight: var(--md-sys-typescale-body-medium-weight, 400);
  }

  /* single-line banners clip overflow to one line. */
  :host([lines="single"]) .content {
    display: -webkit-box;
    -webkit-line-clamp: 1;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  /* two-line banners clip overflow to two lines. */
  :host([lines="two"]) .content {
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  .actions {
    display: none;
    align-items: center;
    gap: 4px;
    flex: none;
    align-self: center;
  }

  :host([has-action]) .actions,
  :host([closeable]) .actions {
    display: flex;
  }

  /* stacked: actions move to their own row beneath the content. */
  .banner.stacked {
    flex-wrap: wrap;
    align-items: flex-start;
  }

  .banner.stacked .content {
    flex-basis: 100%;
  }

  .banner.stacked .actions {
    flex-basis: 100%;
    justify-content: flex-end;
    padding-inline-start: 56px;
  }

  ::slotted([slot="action"]) {
    --md-text-button-label-text-color: var(--_action-color);
    color: var(--_action-color);
  }

  .close {
    appearance: none;
    border: none;
    background: none;
    display: inline-flex;
    flex: none;
    align-items: center;
    justify-content: center;
    width: 40px;
    height: 40px;
    padding: 8px;
    border-radius: var(--md-sys-shape-corner-full, 9999px);
    color: var(--_supporting-text-color);
    cursor: pointer;
  }

  .close:hover {
    background: color-mix(in srgb, currentColor 8%, transparent);
  }

  .close:focus-visible {
    outline: 2px solid var(--_action-color);
    outline-offset: 2px;
  }

  .close svg {
    width: 24px;
    height: 24px;
    fill: currentColor;
  }

  @media (forced-colors: active) {
    .banner {
      outline: 1px solid CanvasText;
    }
  }
`;
