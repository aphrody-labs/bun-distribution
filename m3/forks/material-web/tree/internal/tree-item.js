/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { __decorate } from "tslib";
import "../../checkbox/checkbox.js";
import { html, LitElement, nothing } from "lit";
import { property, queryAssignedElements } from "lit/decorators.js";
import { classMap } from "lit/directives/class-map.js";
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
export class TreeItem extends LitElement {
    constructor() {
        super(...arguments);
        /** The text label for this node. */
        this.label = "";
        /** The stable value identifying this node (used for selection). */
        this.value = "";
        /** Whether this node is expanded (children visible). Reflected for CSS. */
        this.expanded = false;
        /** Whether this node is selected. Reflected for CSS. */
        this.selected = false;
        /**
         * Whether this node is in an indeterminate state — only meaningful for parent
         * nodes in checkbox/multi-select mode (some but not all descendants selected).
         * Reflected for CSS.
         */
        this.indeterminate = false;
        /** Whether this node is disabled (not selectable or focusable). */
        this.disabled = false;
        /** The nesting depth, used for indentation. Set by the parent tree. */
        this.level = 0;
        /** Whether the owning tree displays a leading checkbox. Set by the tree. */
        this.hasCheckbox = false;
        /**
         * Whether the owning tree allows editing this item's label (enables F2 /
         * double-click to enter inline edit mode). Set by the tree.
         */
        this.editable = false;
        /**
         * Whether this item is currently being edited inline. The owning tree drives
         * this (only one item edits at a time). Reflected for CSS.
         */
        this.editing = false;
        /** When the editor opens it should grab focus on the next render. */
        this.editorNeedsFocus = false;
    }
    /** Returns the direct child `<md-tree-item>` elements. */
    get childItems() {
        return this.assignedChildItems ?? [];
    }
    /** Whether this node has any child tree items. */
    get hasChildren() {
        return this.childItems.length > 0;
    }
    /** Toggles the expanded state (no-op for leaf nodes). */
    toggle() {
        if (!this.hasChildren) {
            return;
        }
        this.expanded = !this.expanded;
        this.dispatchEvent(new CustomEvent("tree-item:toggle", {
            detail: { value: this.value, expanded: this.expanded },
            bubbles: true,
            composed: true,
        }));
    }
    updated(changed) {
        // Focus + select the editor the first render after entering edit mode.
        if (changed.has("editing")) {
            if (this.editing) {
                this.editorNeedsFocus = true;
            }
            if (this.editorNeedsFocus && this.editing) {
                this.editorNeedsFocus = false;
                const input = this.renderRoot.querySelector(".label-editor");
                if (input) {
                    input.focus();
                    input.select();
                }
            }
        }
    }
    requestEdit() {
        if (!this.editable || this.disabled || this.editing) {
            return;
        }
        this.dispatchEvent(new CustomEvent("tree-item:edit-request", {
            detail: { value: this.value },
            bubbles: true,
            composed: true,
        }));
    }
    handleRowDblClick(event) {
        if (!this.editable || this.disabled) {
            return;
        }
        event.stopPropagation();
        event.preventDefault();
        this.requestEdit();
    }
    handleRowKeydown(event) {
        if (event.key === "F2") {
            event.preventDefault();
            event.stopPropagation();
            this.requestEdit();
        }
    }
    handleEditorClick(event) {
        // Keep clicks inside the editor from selecting/toggling the row.
        event.stopPropagation();
    }
    handleEditorKeydown(event) {
        // Keep navigation/selection keys from reaching the tree while editing.
        event.stopPropagation();
        if (event.key === "Enter") {
            event.preventDefault();
            this.commitEdit(event.target.value);
        }
        else if (event.key === "Escape") {
            event.preventDefault();
            this.cancelEdit();
        }
    }
    handleEditorBlur(event) {
        if (this.editing) {
            this.commitEdit(event.target.value);
        }
    }
    commitEdit(newLabel) {
        this.dispatchEvent(new CustomEvent("tree-item:edit-commit", {
            detail: { value: this.value, newLabel },
            bubbles: true,
            composed: true,
        }));
    }
    cancelEdit() {
        this.dispatchEvent(new CustomEvent("tree-item:edit-cancel", {
            detail: { value: this.value },
            bubbles: true,
            composed: true,
        }));
    }
    render() {
        const hasChildren = this.hasChildren;
        const indent = `${this.level * 24}px`;
        return html `
      <div
        class="row"
        role="treeitem"
        aria-level=${this.level + 1}
        aria-selected=${this.selected ? "true" : "false"}
        aria-disabled=${this.disabled ? "true" : "false"}
        aria-expanded=${hasChildren ? (this.expanded ? "true" : "false") : nothing}
        style="padding-inline-start:${indent}"
        @click=${this.handleRowClick}
        @dblclick=${this.handleRowDblClick}
        @keydown=${this.handleRowKeydown}
      >
        <span
          class=${classMap({
            chevron: true,
            "has-children": hasChildren,
            leaf: !hasChildren,
        })}
          aria-hidden="true"
          @click=${this.handleChevronClick}
        >
          ${hasChildren
            ? html `<svg viewBox="0 0 24 24" class="chevron-icon">
                <path d="M8.6 16.6 13.2 12 8.6 7.4 10 6l6 6-6 6Z"></path>
              </svg>`
            : nothing}
        </span>
        ${this.hasCheckbox
            ? html `<md-checkbox
              class="checkbox"
              aria-hidden="true"
              tabindex="-1"
              ?checked=${this.selected}
              ?indeterminate=${this.indeterminate}
              ?disabled=${this.disabled}
              @click=${this.handleCheckboxClick}
              @change=${this.handleCheckboxChange}
            ></md-checkbox>`
            : nothing}
        <span class="icon"><slot name="icon"></slot></span>
        ${this.editing
            ? html `<input
              class="label-editor"
              aria-label="Edit label"
              .value=${this.label}
              @click=${this.handleEditorClick}
              @keydown=${this.handleEditorKeydown}
              @blur=${this.handleEditorBlur}
            />`
            : html `<span class="label">${this.label}</span>`}
      </div>
      <div class="children" role="group" ?hidden=${!this.expanded}>
        <slot @slotchange=${this.handleSlotChange}></slot>
      </div>
    `;
    }
    handleRowClick(event) {
        event.stopPropagation();
        if (this.disabled) {
            return;
        }
        // Activating the row selects the node (and the tree handles expand-on-click
        // / multi-select semantics).
        this.dispatchActivate();
    }
    handleChevronClick(event) {
        if (!this.hasChildren) {
            return;
        }
        // Chevron clicks only toggle; they should not bubble to the row handler.
        event.stopPropagation();
        this.toggle();
    }
    handleCheckboxClick(event) {
        // The checkbox is a visual proxy; prevent it from toggling itself and let
        // the row's activate flow drive selection (so the tree stays the source of
        // truth, including cascading to descendants).
        event.stopPropagation();
        event.preventDefault();
        if (this.disabled) {
            return;
        }
        this.dispatchActivate();
        // Re-sync the checkbox UI to the authoritative state on the next frame.
        void this.updateComplete.then(() => {
            const checkbox = this.renderRoot.querySelector(".checkbox");
            if (checkbox) {
                checkbox.checked = this.selected;
                checkbox.indeterminate = this.indeterminate;
            }
        });
    }
    handleCheckboxChange(event) {
        event.stopPropagation();
    }
    dispatchActivate() {
        this.dispatchEvent(new CustomEvent("tree-item:activate", {
            detail: { value: this.value },
            bubbles: true,
            composed: true,
        }));
    }
    handleSlotChange() {
        // Re-render so the chevron appears/disappears as children are added.
        this.requestUpdate();
    }
}
__decorate([
    property()
], TreeItem.prototype, "label", void 0);
__decorate([
    property()
], TreeItem.prototype, "value", void 0);
__decorate([
    property({ type: Boolean, reflect: true })
], TreeItem.prototype, "expanded", void 0);
__decorate([
    property({ type: Boolean, reflect: true })
], TreeItem.prototype, "selected", void 0);
__decorate([
    property({ type: Boolean, reflect: true })
], TreeItem.prototype, "indeterminate", void 0);
__decorate([
    property({ type: Boolean, reflect: true })
], TreeItem.prototype, "disabled", void 0);
__decorate([
    property({ type: Number, reflect: true })
], TreeItem.prototype, "level", void 0);
__decorate([
    property({ type: Boolean, reflect: true, attribute: "has-checkbox" })
], TreeItem.prototype, "hasCheckbox", void 0);
__decorate([
    property({ type: Boolean, reflect: true })
], TreeItem.prototype, "editable", void 0);
__decorate([
    property({ type: Boolean, reflect: true })
], TreeItem.prototype, "editing", void 0);
__decorate([
    queryAssignedElements({ flatten: true, selector: "md-tree-item" })
], TreeItem.prototype, "assignedChildItems", void 0);
//# sourceMappingURL=tree-item.js.map