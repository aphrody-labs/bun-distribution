/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { LitElement, TemplateResult } from "lit";
import { TreeItem } from "./tree-item.js";
/** Selection behaviour of an `<md-tree>`. */
export type TreeSelectionMode = "single" | "multiple";
/** `detail` of the `tree:select` event. */
export interface TreeSelectEventDetail {
    /** The value that triggered the change (`''` for bulk select/clear). */
    value: string;
    /** The full set of currently selected values. */
    values: string[];
}
/** `detail` of the `tree:label-edit` event. */
export interface TreeLabelEditEventDetail {
    /** The edited item's stable value. */
    itemValue: string;
    /** The previous label (before the edit). */
    value: string;
    /** The newly committed label. */
    newLabel: string;
}
/**
 * A data-driven tree node. Pass an array of these to `<md-tree>.items` instead
 * of slotting `<md-tree-item>` elements. `children` nests recursively.
 */
export interface TreeNode {
    /** Stable value identifying the node (used for selection). */
    value: string;
    /** Display label. */
    label: string;
    /** Optional Material icon name rendered as a leading `md-icon`-style glyph. */
    icon?: string;
    /** Whether the node starts expanded. */
    expanded?: boolean;
    /** Whether the node is disabled. */
    disabled?: boolean;
    /** Child nodes. */
    children?: TreeNode[];
}
/**
 * A tree displays a hierarchical list of `<md-tree-item>` nodes (slotted, or
 * supplied data-driven via the `items` property). It owns keyboard navigation
 * (roving `tabindex`), expand/collapse and selection across the whole subtree,
 * implementing the WAI-ARIA tree pattern (`role="tree"` with `role="treeitem"`
 * descendants and `aria-selected` / `aria-expanded`).
 *
 * Selection supports `single` (default, backward compatible) and `multiple`
 * modes. In multiple mode, `checkboxes` renders an `md-checkbox` per row,
 * selecting a parent cascades to its descendants, and a parent with a partial
 * selection shows the indeterminate state.
 *
 * Keyboard: ArrowUp / ArrowDown move between *visible* items; ArrowRight
 * expands (or descends into) a node; ArrowLeft collapses (or ascends to the
 * parent); Home / End jump to the first / last visible item; `*` expands all
 * siblings of the focused node; Enter / Space activate (toggle selection of)
 * the focused item; in multiple mode Ctrl+A selects all; printable characters
 * type-ahead to the next matching label.
 *
 * Note: drag-and-drop reordering is intentionally out of scope.
 *
 * @fires tree:select {CustomEvent<{value: string, values: string[]}>} Fired
 *     when the selection changes.
 * @fires tree:label-edit {CustomEvent<TreeLabelEditEventDetail>} Fired when an
 *     item's label is committed after an inline edit (only when `editable`).
 */
export declare class Tree extends LitElement {
    /**
     * The `value` of the currently selected tree item, if any (single-select).
     * In multiple mode this reflects the most recently toggled value.
     */
    selected: string;
    /** Selection behaviour: `single` (default) or `multiple`. */
    selectionMode: TreeSelectionMode;
    /** Whether to render a leading `md-checkbox` per row (multi-select affordance). */
    checkboxes: boolean;
    /**
     * When true, item labels may be edited inline (F2 or double-click enters edit
     * mode; Enter/blur commits, Escape cancels). Works in both slotted and
     * data-driven (`items`) modes; commits emit `tree:label-edit`.
     */
    editable: boolean;
    /**
     * Optional data-driven node tree. When set (non-empty), the tree renders
     * `<md-tree-item>` elements from this array instead of slotted children.
     */
    items: TreeNode[];
    /** The set of currently selected values (authoritative in multiple mode). */
    private selectedSet;
    /** The value of the item currently being edited inline (`null` = none). */
    private editingValue;
    connectedCallback(): void;
    disconnectedCallback(): void;
    willUpdate(changed: Map<string, unknown>): void;
    updated(changed: Map<string, unknown>): void;
    /** Returns every `<md-tree-item>` in the subtree, in document order. */
    get treeItems(): TreeItem[];
    /** The list of currently selected values. */
    get selectedValues(): string[];
    set selectedValues(values: string[]);
    private get dataDriven();
    protected render(): TemplateResult<1>;
    private renderNode;
    private handleSlotChange;
    /**
     * Recomputes each item's nesting `level`, propagates checkbox mode, applies
     * the current selection, computes parent indeterminate states, and installs a
     * single roving `tabindex` (the first selected item, or the first item).
     */
    private refreshStructure;
    private get rootItems();
    private assignLevels;
    /** Pushes the selected/indeterminate flags onto every item. */
    private applySelectionToItems;
    /**
     * Computes, bottom-up, whether each parent is fully selected (selected,
     * not indeterminate), partially selected (indeterminate), or unselected.
     * Returns `'all' | 'some' | 'none'` for the subtree rooted at `item`.
     */
    private computeIndeterminate;
    /** Visible items = those whose every ancestor tree item is expanded. */
    private get visibleItems();
    private isVisible;
    private readonly handleActivate;
    private readonly handleEditRequest;
    private readonly handleEditCommit;
    private readonly handleEditCancel;
    /** Depth-first search for a node by value in a data-driven tree. */
    private findNode;
    /** Single-select: replace the selection with `value`. */
    private selectValue;
    /** Multi-select: toggle `value` and cascade to descendants. */
    private toggleValue;
    private setSubtreeSelected;
    private emitSelect;
    /** Expands every node with children. */
    expandAll(): void;
    /** Collapses every node. */
    collapseAll(): void;
    /** Selects every (non-disabled) node. Multi-select only. */
    selectAll(): void;
    /** Clears the selection. */
    clearSelection(): void;
    private readonly handleKeydown;
    /** Expands all siblings of `item` at the same level. */
    private expandSiblings;
    private lastTypeahead;
    private typeaheadTimer;
    private handleTypeahead;
    /** Resolves the focused tree item from the event's composed path. */
    private activeItem;
    private handleArrowRight;
    private handleArrowLeft;
    private focusByIndex;
    private focusItem;
}
