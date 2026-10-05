/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import "../../checkbox/checkbox.js";
import { LitElement } from "lit";
/**
 * A single node in an `<md-tree>`. Renders a row (indented by `level × 24px`)
 * containing an expand/collapse chevron (when it has child items), an optional
 * leading `md-checkbox` (when the owning tree shows checkboxes), an optional
 * leading icon (slot `icon`), and the `label`. Nested `<md-tree-item>` children
 * live in the default slot and are hidden unless this item is `expanded`.
 *
 * The owning `<md-tree>` manages roving focus, selection, the computed `level`,
 * and the parent `indeterminate` state; this element only renders its own row
 * plus its children.
 *
 * @fires tree-item:toggle {CustomEvent<{value: string, expanded: boolean}>}
 *     Fired when the item is expanded or collapsed.
 * @fires tree-item:edit-request {CustomEvent<{value: string}>} Fired when the
 *     user asks to edit this item's label (F2 or double-click).
 * @fires tree-item:edit-commit {CustomEvent<{value: string, newLabel: string}>}
 *     Fired when an inline label edit is committed (Enter or blur).
 * @fires tree-item:edit-cancel {CustomEvent<{value: string}>} Fired when an
 *     inline label edit is abandoned (Escape).
 */
export declare class TreeItem extends LitElement {
    /** The text label for this node. */
    label: string;
    /** The stable value identifying this node (used for selection). */
    value: string;
    /** Whether this node is expanded (children visible). Reflected for CSS. */
    expanded: boolean;
    /** Whether this node is selected. Reflected for CSS. */
    selected: boolean;
    /**
     * Whether this node is in an indeterminate state — only meaningful for parent
     * nodes in checkbox/multi-select mode (some but not all descendants selected).
     * Reflected for CSS.
     */
    indeterminate: boolean;
    /** Whether this node is disabled (not selectable or focusable). */
    disabled: boolean;
    /** The nesting depth, used for indentation. Set by the parent tree. */
    level: number;
    /** Whether the owning tree displays a leading checkbox. Set by the tree. */
    hasCheckbox: boolean;
    /**
     * Whether the owning tree allows editing this item's label (enables F2 /
     * double-click to enter inline edit mode). Set by the tree.
     */
    editable: boolean;
    /**
     * Whether this item is currently being edited inline. The owning tree drives
     * this (only one item edits at a time). Reflected for CSS.
     */
    editing: boolean;
    /** When the editor opens it should grab focus on the next render. */
    private editorNeedsFocus;
    private readonly assignedChildItems;
    /** Returns the direct child `<md-tree-item>` elements. */
    get childItems(): TreeItem[];
    /** Whether this node has any child tree items. */
    get hasChildren(): boolean;
    /** Toggles the expanded state (no-op for leaf nodes). */
    toggle(): void;
    updated(changed: Map<string, unknown>): void;
    private requestEdit;
    private handleRowDblClick;
    private handleRowKeydown;
    private handleEditorClick;
    private handleEditorKeydown;
    private handleEditorBlur;
    private commitEdit;
    private cancelEdit;
    protected render(): import("lit-html").TemplateResult<1>;
    private handleRowClick;
    private handleChevronClick;
    private handleCheckboxClick;
    private handleCheckboxChange;
    private dispatchActivate;
    private handleSlotChange;
}
