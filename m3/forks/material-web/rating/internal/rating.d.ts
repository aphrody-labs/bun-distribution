/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { LitElement, TemplateResult } from "lit";
/**
 * A rating lets users view and optionally set a value on an ordinal scale —
 * the Material 3 / MUI `Rating` equivalent. It renders a row of star icons;
 * the active portion uses `--md-sys-color-primary`, the inactive portion
 * `--md-sys-color-outline`.
 *
 * The default icon is a filled star. Provide a custom icon by slotting an
 * element (e.g. an `<svg>` or `<md-icon>`) into the default slot — it is
 * cloned for every item and clipped for half-star fills.
 *
 * Implemented on top of the `--md-sys-*` tokens and self-contained. The element
 * is form-associated: when a `name` is set it contributes its `value` to the
 * enclosing `<form>`. It fires native `input` (on hover-commit/keyboard change)
 * and `change` events; read the value via `event.target.value`.
 *
 * @fires input {Event} Fired when the value changes via user interaction.
 * @fires change {Event} Fired when the value is committed.
 */
export declare class Rating extends LitElement {
    static formAssociated: boolean;
    /** The current rating value. */
    value: number;
    /** The maximum rating (number of icons). */
    max: number;
    /**
     * The minimum increment. `1` for whole-star ratings, `0.5` to allow
     * half-stars. Any other value is treated as `1`.
     */
    precision: number;
    /** When true, the rating is displayed but cannot be changed. */
    readonly: boolean;
    /** When true, the rating is non-interactive and dimmed. */
    disabled: boolean;
    /** The form name for the contributed value. */
    name: string;
    /** The hover-preview value, or `-1` when not hovering. */
    private hoverValue;
    private readonly list;
    private readonly internals;
    /** The owning form, when the element is form-associated. */
    get form(): HTMLFormElement | null;
    connectedCallback(): void;
    disconnectedCallback(): void;
    protected willUpdate(changed: Map<string, unknown>): void;
    protected updated(changed: Map<string, unknown>): void;
    private get step();
    /** The value currently shown (hover preview wins over `value`). */
    private get displayValue();
    protected render(): TemplateResult<1>;
    private renderItem;
    private renderIcon;
    /** Translate the pointer x-position within an item to a fractional value. */
    private valueFromPointer;
    private handleMouseMove;
    private readonly handleMouseLeave;
    private handleClick;
    private handleKeydown;
    private commit;
    private handleSlotChange;
    /** Reset the value when the owning form is reset. */
    formResetCallback(): void;
    /** Restore the value when the form state is restored. */
    formStateRestoreCallback(formState: string): void;
    focus(): void;
}
