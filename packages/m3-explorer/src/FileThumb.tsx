// SPDX-License-Identifier: Apache-2.0 AND MIT
// Derived from SpaceUI (packages/aphrody-spaceui/packages/explorer/src/FileThumb.tsx), MIT, rebuilt on Material Design 3.
"use client";

import { useState } from "react";
import { clsx } from "clsx";

/**
 * An icon source — either a URL string or an object with a .src property (e.g., Next.js StaticImageData).
 * `@aphrody/assets` (`getIcon`, `getBeardedIcon`) returns values of this shape.
 */
export type IconSource = string | { src: string };

/** Resolve an IconSource to a URL string */
function resolveIconSrc(src: IconSource): string {
  return typeof src === "string" ? src : src.src;
}

export interface FileThumbProps {
  /** Kind icon (e.g., Document, Folder PNG). Accepts URL string or StaticImageData. */
  iconSrc: IconSource;
  /** Optional thumbnail image (photo, video poster, etc.). Accepts URL string or StaticImageData. */
  thumbnailSrc?: IconSource | null;
  /** Optional extension badge overlay (bearded icon SVG URL) */
  beardedIconSrc?: string | null;
  /** Size in pixels (width and height) */
  size?: number;
  /** Scale factor for fallback icon relative to size (0-1, default 1) */
  iconScale?: number;
  /** Custom frame class for the thumbnail image (border, radius, bg) */
  frameClassName?: string;
  /** Draws the M3 selection outline (2dp primary) around the thumbnail frame. */
  selected?: boolean;
  /** Optional controlled load state, used by hosts that cache thumbnail state. */
  thumbnailLoaded?: boolean;
  thumbnailError?: boolean;
  onThumbnailLoad?: () => void;
  onThumbnailError?: () => void;
  className?: string;
}

/** Below this size the M3 small corner (8dp) is too round: the radius scales down with the thumb. */
const SMALL_CORNER_MIN_SIZE = 100;

export function FileThumb({
  iconSrc,
  thumbnailSrc,
  beardedIconSrc,
  size = 100,
  iconScale = 1,
  frameClassName,
  selected = false,
  thumbnailLoaded,
  thumbnailError,
  onThumbnailLoad,
  onThumbnailError,
  className,
}: FileThumbProps) {
  const [internalLoaded, setInternalLoaded] = useState(false);
  const [internalError, setInternalError] = useState(false);
  const thumbLoaded = thumbnailLoaded ?? internalLoaded;
  const thumbError = thumbnailError ?? internalError;

  const resolvedIcon = resolveIconSrc(iconSrc);
  const resolvedThumb = thumbnailSrc ? resolveIconSrc(thumbnailSrc) : null;

  // Reset the internal load state when the thumbnail source changes (adjust state during render).
  const [seenThumb, setSeenThumb] = useState(resolvedThumb);
  if (seenThumb !== resolvedThumb) {
    setSeenThumb(resolvedThumb);
    setInternalLoaded(false);
    setInternalError(false);
  }

  const iconSize = size * iconScale;

  // Below 60px, show only bearded icon at full size; above, show as overlay at 40%
  const isSmallIcon = size < 60;
  const badgeSize = isSmallIcon ? iconSize : iconSize * 0.4;

  // Scale border radius with size (8% of size, clamped between 2px and 8px); from 100px up this
  // is the M3 small corner itself, applied as `rounded-small`.
  const borderRadius = Math.min(8, Math.max(2, size * 0.08));
  const useSmallCorner = size >= SMALL_CORNER_MIN_SIZE;

  return (
    <div
      data-m3-component="FileThumb"
      className={clsx("relative pointer-events-none flex shrink-0 grow-0 items-center justify-center", className)}
      style={{
        width: size,
        height: size,
        minWidth: size,
        minHeight: size,
        maxWidth: size,
        maxHeight: size,
      }}
    >
      {/* Base kind icon — always rendered first (instant), thumbnail loads over it */}
      {/* Hide document icon if small and showing bearded badge */}
      {!(isSmallIcon && beardedIconSrc) && (
        <img
          src={resolvedIcon}
          alt=""
          className={clsx(
            "object-contain transition-opacity duration-200 ease-standard",
            thumbLoaded && resolvedThumb && "opacity-0",
          )}
          style={{
            width: iconSize,
            height: iconSize,
            maxWidth: "100%",
            maxHeight: "100%",
          }}
        />
      )}

      {/* Thumbnail image (loads over the icon) */}
      {resolvedThumb && !thumbError && (
        <img
          src={resolvedThumb}
          alt=""
          className={clsx(
            "absolute inset-0 m-auto max-h-full max-w-full object-contain transition-opacity duration-200 ease-standard",
            frameClassName ||
              clsx("border border-outline-variant bg-surface-container-high", useSmallCorner && "rounded-small"),
            selected && "outline-2 outline-offset-0 outline-primary",
            !thumbLoaded && "opacity-0",
          )}
          style={frameClassName || useSmallCorner ? undefined : { borderRadius: `${borderRadius}px` }}
          onLoad={() => {
            setInternalLoaded(true);
            onThumbnailLoad?.();
          }}
          onError={() => {
            setInternalError(true);
            onThumbnailError?.();
          }}
        />
      )}

      {/* Bearded icon badge overlay */}
      {beardedIconSrc && (
        <img
          src={beardedIconSrc}
          alt=""
          className="absolute left-1/2 top-[55%] -translate-x-1/2 -translate-y-1/2"
          style={{
            width: badgeSize,
            height: badgeSize,
          }}
        />
      )}
    </div>
  );
}
