// SPDX-License-Identifier: Apache-2.0
// The Aphrody avatar: the brand emblem in an M3 full-radius container (primary-container role).
import type { CSSProperties } from "react";
import { brandIcon, brandSrcSet } from "./brand";

export interface AphrodyAvatarProps {
  /** Diameter in CSS pixels (default 32). */
  size?: number;
  /** Accessible name; omit for a decorative avatar next to a visible "Aphrody" label. */
  label?: string;
  className?: string;
  style?: CSSProperties;
}

export function AphrodyAvatar({
  size = 32,
  label,
  className,
  style,
}: AphrodyAvatarProps) {
  return (
    <span
      className={className}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      style={{
        display: "inline-flex",
        flexShrink: 0,
        width: size,
        height: size,
        overflow: "hidden",
        borderRadius: "var(--md-sys-shape-corner-full, 9999px)",
        background: "var(--md-sys-color-primary-container)",
        ...style,
      }}
    >
      <img
        src={brandIcon(size)}
        srcSet={brandSrcSet(size)}
        width={size}
        height={size}
        alt=""
        draggable={false}
      />
    </span>
  );
}
