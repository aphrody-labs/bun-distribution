// SPDX-License-Identifier: Apache-2.0 AND MIT
// Derived from SpaceUI (packages/aphrody-spaceui/packages/explorer/src/GridItem.tsx), MIT, rebuilt on Material Design 3.
"use client";

import { clsx } from "clsx";
import { FileThumb, type FileThumbProps } from "./FileThumb";

export interface GridItemTag {
  color: string;
  name: string;
}

export interface GridItemProps {
  /** File/folder display name */
  name: string;
  /** File extension (shown appended to name) */
  extension?: string | null;
  /** File size formatted as string (e.g., "1.2 MB") */
  sizeText?: string | null;
  /** Whether this item is currently selected */
  selected?: boolean;
  /** Tags to display as colored dots below the name */
  tags?: GridItemTag[];
  /** Size of the thumbnail area in pixels */
  thumbSize?: number;
  /** Props passed through to FileThumb (icon source accepts URL string or StaticImageData) */
  thumb: Pick<FileThumbProps, "iconSrc" | "thumbnailSrc" | "beardedIconSrc" | "frameClassName">;
  /** Volume capacity bar (optional, for volume items) */
  volumeBar?: React.ReactNode;
  /** Event handlers */
  onClick?: (e: React.MouseEvent) => void;
  onDoubleClick?: (e: React.MouseEvent) => void;
  onContextMenu?: (e: React.MouseEvent) => void;
  className?: string;
}

/** An M3 selectable grid tile: medium corner, state layer on hover/press, secondary container when selected. */
export function GridItem({
  name,
  extension,
  sizeText,
  selected = false,
  tags,
  thumbSize = 80,
  thumb,
  volumeBar,
  onClick,
  onDoubleClick,
  onContextMenu,
  className,
}: GridItemProps) {
  const displayName = extension ? `${name}.${extension}` : name;

  return (
    <button
      type="button"
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      onContextMenu={onContextMenu}
      aria-pressed={selected}
      title={displayName}
      data-m3-component="GridItem"
      data-testid={`grid-item-${displayName}`}
      className={clsx(
        "relative isolate flex cursor-default flex-col items-center gap-2 rounded-medium border-0 p-2",
        "transition-colors duration-200 ease-standard",
        "focus-visible:outline-3 focus-visible:outline-secondary focus-visible:outline-offset-2",
        // State layer: on-surface at 8 % (hover) / 10 % (pressed), under the content.
        "before:absolute before:inset-0 before:-z-10 before:rounded-[inherit] before:bg-on-surface before:opacity-0 before:transition-opacity hover:before:opacity-8 active:before:opacity-10",
        selected ? "bg-secondary-container" : "bg-transparent",
        className,
      )}
    >
      {/* Thumbnail */}
      <FileThumb {...thumb} size={thumbSize} selected={selected} />

      {/* Name + metadata */}
      <div className="flex w-full flex-col items-center">
        <div
          className={clsx(
            "line-clamp-2 max-w-full break-words text-center text-label-medium",
            selected ? "text-on-secondary-container" : "text-on-surface",
          )}
        >
          {displayName}
        </div>

        {/* Volume capacity bar */}
        {volumeBar}

        {/* File size */}
        {sizeText && !volumeBar && (
          <div
            className={clsx(
              "mt-0.5 text-label-small",
              selected ? "text-on-secondary-container" : "text-on-surface-variant",
            )}
          >
            {sizeText}
          </div>
        )}

        {/* Tag dots */}
        {tags && tags.length > 0 && (
          <div className="mt-1 flex items-center gap-1" title={tags.map((t) => t.name).join(", ")}>
            {tags.slice(0, 3).map((tag) => (
              <div
                key={tag.name}
                className="size-2 rounded-full ring-1 ring-surface"
                style={{ backgroundColor: tag.color }}
                title={tag.name}
              />
            ))}
            {tags.length > 3 && (
              <span
                className={clsx(
                  "text-label-small",
                  selected ? "text-on-secondary-container" : "text-on-surface-variant",
                )}
              >
                +{tags.length - 3}
              </span>
            )}
          </div>
        )}
      </div>
    </button>
  );
}
