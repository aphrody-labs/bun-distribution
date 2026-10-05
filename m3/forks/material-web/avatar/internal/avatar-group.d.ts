/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { LitElement, TemplateResult } from "lit";
/**
 * An avatar group lays out a set of `<md-avatar>` children with a configurable
 * overlap and optionally collapses any surplus past `max` into a trailing
 * "+N" surplus pill (using the `--md-sys-color-surface-variant` /
 * `on-surface-variant` tokens).
 *
 * ```html
 * <md-avatar-group max="3" overlap="8">
 *   <md-avatar src="a.jpg"></md-avatar>
 *   <md-avatar src="b.jpg"></md-avatar>
 *   <md-avatar src="c.jpg"></md-avatar>
 *   <md-avatar src="d.jpg"></md-avatar>
 * </md-avatar-group>
 * ```
 */
export declare class AvatarGroup extends LitElement {
    /**
     * Maximum number of avatars to display. Any beyond this count are hidden and
     * summarised by the surplus pill. A value `<= 0` shows all avatars.
     */
    max: number;
    /** Overlap between adjacent avatars, in pixels. */
    overlap: number;
    /** Total number of slotted avatars. */
    private total;
    private readonly items;
    protected render(): TemplateResult;
    private renderSurplus;
    private handleSlotChange;
}
