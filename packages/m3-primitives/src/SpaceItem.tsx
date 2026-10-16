// SPDX-License-Identifier: Apache-2.0 AND MIT
// Derived from SpaceUI (packages/aphrody-spaceui/packages/primitives/src/SpaceItem.tsx), MIT, rebuilt on Material Design 3.

"use client";

import { forwardRef } from "react";
import { clsx } from "clsx";

import { type IconSource, renderIcon } from "./Icon";
import { m3FocusRing, m3StateLayer } from "./utils";

export interface SpaceItemProps {
  /**
   * Icon: a Material Symbols name (`folder`), an image URL (anything with `/`, `.` or `:`, as in
   * SpaceUI), an icon component (a Phosphor component still works) or an element.
   */
  icon?: IconSource | React.ElementType | string;
  /** Display label */
  label: string;
  /** Active/selected state */
  active?: boolean;
  /** Colored dot instead of icon (e.g., tag color) */
  color?: string;
  /** Custom icon element (overrides icon prop — use for thumbnails, composed icons, etc.) */
  iconElement?: React.ReactNode;
  /** Right-side content (badge, count, indicator) */
  right?: React.ReactNode;
  onClick?: (e?: React.MouseEvent) => void;
  onContextMenu?: (e: React.MouseEvent) => void;
  className?: string;
}

const isImageUrl = (icon: unknown): icon is string =>
  typeof icon === "string" && /[/.:]/.test(icon);

/**
 * M3 navigation-drawer item at desktop density: 40 dp row, full-shape active indicator on
 * `secondary-container`, `label-large`, filled icon when active.
 */
export const SpaceItem = forwardRef<HTMLButtonElement, SpaceItemProps>(function SpaceItem(
  { icon, label, active, color, iconElement, right, onClick, onContextMenu, className },
  ref,
) {
  return (
    <button
      ref={ref}
      type="button"
      aria-current={active ? "page" : undefined}
      onClick={onClick}
      onContextMenu={onContextMenu}
      className={clsx(
        "flex h-10 w-full cursor-default items-center gap-3 rounded-full px-4 text-label-large",
        "transition-colors duration-200 ease-standard",
        m3StateLayer,
        m3FocusRing,
        active ? "bg-secondary-container text-on-secondary-container" : "text-on-surface-variant",
        className,
      )}
    >
      {iconElement ? (
        iconElement
      ) : color ? (
        <span className="size-4 shrink-0 rounded-full" style={{ backgroundColor: color }} />
      ) : isImageUrl(icon) ? (
        <img src={icon} alt="" width={20} height={20} className="size-5 shrink-0" />
      ) : (
        icon !== undefined &&
        renderIcon(icon as IconSource, {
          size: 20,
          filled: active || undefined,
          className: "shrink-0",
        })
      )}
      <span className="flex-1 truncate text-left">{label}</span>
      {right}
    </button>
  );
});
