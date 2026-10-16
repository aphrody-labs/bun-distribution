// SPDX-License-Identifier: Apache-2.0 AND MIT
// Derived from SpaceUI (packages/aphrody-spaceui/packages/explorer/src/TagPill.tsx), MIT, rebuilt on Material Design 3.
import { Icon } from "@aphrody/m3-primitives";
import { clsx } from "clsx";

export interface TagPillProps {
  /** Tag color (user data): rendered as the leading dot. */
  color: string;
  children: React.ReactNode;
  /** M3 density steps: `md` is the 32dp baseline chip, `sm` 28dp, `xs` 24dp. */
  size?: "xs" | "sm" | "md";
  /** Selected (filter chip) state: secondary container fill, no outline. */
  selected?: boolean;
  onClick?: (e: React.MouseEvent) => void;
  onRemove?: (e: React.MouseEvent) => void;
  className?: string;
}

/**
 * An M3 input / filter chip carrying a colored tag dot. The chip body and the trailing remove
 * icon are two sibling buttons inside the chip container, so both are focusable and keyboard
 * operable.
 */
export function TagPill({
  color,
  children,
  size = "sm",
  selected = false,
  onClick,
  onRemove,
  className,
}: TagPillProps) {
  const interactive = !!(onClick || onRemove);

  return (
    <span
      data-m3-component="TagPill"
      className={clsx(
        "relative isolate inline-flex max-w-full items-center rounded-small border",
        "transition-colors duration-200 ease-standard",
        selected
          ? "border-transparent bg-secondary-container text-on-secondary-container"
          : "border-outline-variant bg-transparent text-on-surface-variant",
        size === "xs" && "h-6 gap-1.5 text-label-medium",
        size === "sm" && "h-7 gap-2 text-label-large",
        size === "md" && "h-8 gap-2 text-label-large",
        onRemove && (size === "xs" ? "pr-2" : "pr-1"),
        className,
      )}
    >
      <button
        type="button"
        onClick={onClick}
        aria-pressed={onClick && selected ? true : undefined}
        className={clsx(
          "inline-flex h-full min-w-0 items-center rounded-[inherit] pl-2",
          "focus-visible:outline-3 focus-visible:outline-secondary focus-visible:outline-offset-2",
          size === "xs" ? "gap-1.5" : "gap-2",
          !onRemove && (size === "xs" ? "pr-2" : "pr-3"),
          // State layer over the whole chip (the container is the positioned ancestor):
          // content color at 8 % (hover) / 10 % (pressed), under the content.
          interactive &&
            "cursor-pointer before:absolute before:inset-0 before:-z-10 before:rounded-[inherit] before:bg-current before:opacity-0 before:transition-opacity hover:before:opacity-8 active:before:opacity-10",
          !interactive && "cursor-default",
        )}
      >
        <span
          aria-hidden="true"
          className={clsx(
            "flex-shrink-0 rounded-full",
            size === "xs" && "size-1.5",
            size === "sm" && "size-2",
            size === "md" && "size-2.5",
          )}
          style={{ backgroundColor: color }}
        />
        <span className="truncate">{children}</span>
      </button>
      {onRemove && (
        <button
          type="button"
          aria-label="Remove"
          onClick={(e) => {
            e.stopPropagation();
            onRemove(e);
          }}
          className={clsx(
            "inline-flex flex-shrink-0 cursor-pointer items-center justify-center rounded-full transition-colors hover:bg-on-surface/8 active:bg-on-surface/10",
            "focus-visible:outline-3 focus-visible:outline-secondary focus-visible:outline-offset-2",
            size === "xs" ? "size-4" : "size-6",
          )}
        >
          <Icon name="close" size={size === "xs" ? 14 : 18} />
        </button>
      )}
    </span>
  );
}
