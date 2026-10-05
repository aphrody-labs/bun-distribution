/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { LitElement } from "lit";
/**
 * The way the search view expands from the bar.
 *
 * - `docked` — the view drops below the bar (default; suited to expanded
 *   windows and supporting panes).
 * - `fullscreen` — the view covers the viewport (suited to compact windows).
 */
export type SearchView = "docked" | "fullscreen";
/**
 * A search bar with an expanding search view, implementing the Material 3
 * search pattern. The bar shows a leading search icon, an input, and optional
 * trailing content; focusing it opens a view that hosts the slotted results
 * (typically an `<md-list>`).
 *
 * @fires input {Event} Re-dispatched from the internal input on every keystroke.
 * @fires search {CustomEvent<{value: string}>} Fired when the user submits
 *     (Enter) the query.
 * @fires search:open {Event} Fired when the search view opens.
 * @fires search:close {Event} Fired when the search view closes.
 */
export declare class SearchBar extends LitElement {
    /** Current query text. */
    value: string;
    /** Placeholder / supporting text shown when empty. */
    placeholder: string;
    /** Accessible name for the results region. */
    resultsLabel: string;
    /** How the results view expands. */
    view: SearchView;
    /** Whether the search view is open. */
    open: boolean;
    private hasResults;
    private readonly input;
    /** Opens the search view and focuses the input. */
    show(): void;
    /** Closes the search view. */
    close(): void;
    protected render(): import("lit-html").TemplateResult<1>;
    private handleInput;
    private handleKeydown;
    private handleCloseClick;
    private handleResultsChange;
}
