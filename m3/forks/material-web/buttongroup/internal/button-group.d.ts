/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { LitElement } from "lit";
/**
 * The `detail` payload of the `button-group:change` event.
 *
 * `value` is the currently selected value (single-select) or the array of
 * selected values (multiselect).
 */
export interface ButtonGroupChangeDetail {
    value: string | string[];
}
/**
 * A connected button group orchestrates a row of related buttons, applying the
 * Material 3 "connected" shape treatment (the leading child is rounded on the
 * leading edge, the trailing child on the trailing edge, inner children get a
 * small 4px radius) and a single/multi selection model.
 *
 * This is the M3 successor to the segmented button: the children are ordinary
 * buttons (or any focusable element) slotted as the default content. Selection
 * is tracked by each child's `value` attribute (falling back to its index).
 *
 * @fires button-group:change {CustomEvent<ButtonGroupChangeDetail>} Fired when
 *     the selection changes through user interaction.
 */
export declare class ButtonGroup extends LitElement {
    /** When true, multiple children can be selected independently (toggle). */
    multiselect: boolean;
    /**
     * The selected value. A single string in single-select mode, or a
     * comma-separated string of values reflected to the attribute in multiselect
     * mode. Read {@link selectedValues} for the parsed array.
     */
    value: string;
    private readonly items;
    /** The parsed list of currently selected values. */
    selectedValues(): string[];
    connectedCallback(): void;
    protected render(): import("lit-html").TemplateResult<1>;
    protected updated(): void;
    private itemValueOf;
    private handleSlotChange;
    /**
     * Reflects the current selection and roving-tabindex onto the slotted
     * children, and applies the connected-shape data attributes the styles key
     * off of.
     */
    private syncChildren;
    private handleClick;
    private select;
    private handleKeydown;
    private itemFromEvent;
}
