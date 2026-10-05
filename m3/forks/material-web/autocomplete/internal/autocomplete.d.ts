/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { LitElement } from "lit";
/** A single autocomplete option. */
export interface AutocompleteOption {
    /** The stable value emitted on selection. */
    value: string;
    /** The human-readable label shown in the list. */
    label: string;
}
/** Filtering strategy for matching options against the typed text. */
export type AutocompleteFilter = "contains" | "startsWith";
/**
 * An autocomplete combines a Material 3 outlined text field with a filtered,
 * floating list of suggestions. As the user types, the option list is filtered
 * in real time (case-insensitive) using the configured `filter` strategy.
 *
 * Keyboard support: ArrowDown / ArrowUp move the highlight through visible
 * options, Enter selects the highlighted option, and Escape closes the panel.
 * Clicking an option selects it. Implements the WAI-ARIA combobox pattern
 * (`role="combobox"` input owning a `role="listbox"` popup with
 * `aria-activedescendant`).
 *
 * @fires input {Event} Re-dispatched whenever the typed text changes.
 * @fires autocomplete:select {CustomEvent<{value: string, label: string}>}
 *     Fired when an option is chosen (click or Enter).
 */
export declare class Autocomplete extends LitElement {
    /** The list of selectable options. Set via the `.options` property. */
    options: AutocompleteOption[];
    /** The current text value of the input. */
    value: string;
    /** Floating label shown above the field. */
    label: string;
    /** Filtering strategy. Defaults to substring (`contains`) matching. */
    filter: AutocompleteFilter;
    /** Whether the suggestions panel is open. Reflected for CSS targeting. */
    open: boolean;
    /** Whether the field is disabled. */
    disabled: boolean;
    /** Index of the highlighted option within the *filtered* list, or -1. */
    private activeIndex;
    private readonly input;
    private readonly listboxId;
    /** Options matching the current `value` under the active filter strategy. */
    get filteredOptions(): AutocompleteOption[];
    connectedCallback(): void;
    disconnectedCallback(): void;
    /** Opens the suggestions panel. */
    show(): void;
    /** Closes the suggestions panel and clears the highlight. */
    close(): void;
    protected render(): import("lit-html").TemplateResult<1>;
    private renderOption;
    private handleInput;
    private readonly handleFocus;
    private readonly handleFocusOut;
    private handleKeydown;
    private moveActive;
    private selectOption;
}
