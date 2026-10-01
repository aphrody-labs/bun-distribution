// SPDX-License-Identifier: Apache-2.0
import { clsx } from "clsx";
import {
  type ComponentType,
  type CSSProperties,
  type ElementType,
  forwardRef,
  type HTMLAttributes,
  isValidElement,
  type ReactNode,
} from "react";

/**
 * A Material Symbols glyph, rendered as a ligature in the variable icon font.
 *
 * It honours the same tokens as `<md-icon>` (`--md-icon-font`, `--md-icon-size`, `--md-icon-fill`,
 * `--md-icon-wght`, `--md-icon-grad`, `--md-icon-opsz`) so light-DOM icons and Material Web icons
 * theme together. The font is not bundled: register it once, e.g. with `ensureMaterialSymbols()`
 * from `@aphrody/material-web/icon/material-symbols.js`, or self-host the woff2 shipped by
 * `crates/ui/bun/icons`.
 */
export interface IconProps extends Omit<HTMLAttributes<HTMLSpanElement>, "children"> {
  /** Material Symbols name, snake_case (`search`, `chevron_right`, `more_horiz`). */
  name: string;
  /** Optical size in px (the M3 sizes are 20, 24, 40 and 48). Default 24. */
  size?: number;
  /** Filled glyph (the `FILL` axis). M3 uses filled icons for selected states. */
  filled?: boolean;
  /** Stroke weight, 100–700. Default 400. */
  weight?: number;
  /** Grade, -50–200. Default 0. */
  grade?: number;
  /** Accessible label. Without one the icon is decorative (`aria-hidden`). */
  label?: string;
}

export const Icon = forwardRef<HTMLSpanElement, IconProps>(
  ({ name, size, filled, weight, grade, label, className, style, ...props }, ref) => {
    const vars: CSSProperties & Record<string, string | number> = {};
    if (size !== undefined) vars["--md-icon-size"] = `${size}px`;
    if (filled !== undefined) vars["--md-icon-fill"] = filled ? 1 : 0;
    if (weight !== undefined) vars["--md-icon-wght"] = weight;
    if (grade !== undefined) vars["--md-icon-grad"] = grade;
    return (
      <span
        ref={ref}
        role={label ? "img" : undefined}
        aria-label={label}
        aria-hidden={label ? undefined : true}
        translate="no"
        data-m3-component="Icon"
        className={clsx("m3-icon", className)}
        style={{
          fontFamily: "var(--md-icon-font, 'Material Symbols Outlined')",
          fontSize: "var(--md-icon-size, 24px)",
          width: "1em",
          height: "1em",
          lineHeight: 1,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
          overflow: "hidden",
          fontWeight: "normal",
          fontStyle: "normal",
          letterSpacing: "normal",
          textTransform: "none",
          whiteSpace: "nowrap",
          direction: "ltr",
          userSelect: "none",
          fontFeatureSettings: "'liga'",
          WebkitFontSmoothing: "antialiased",
          fontVariationSettings:
            "'FILL' var(--md-icon-fill, 0), 'wght' var(--md-icon-wght, 400), " +
            "'GRAD' var(--md-icon-grad, 0), 'opsz' var(--md-icon-opsz, 24)",
          ...vars,
          ...style,
        }}
        {...props}
      >
        {name}
      </span>
    );
  },
);
Icon.displayName = "Icon";

/** Props every icon component receives from the primitives that render one. */
export interface IconComponentProps {
  className?: string;
  size?: number;
  filled?: boolean;
  weight?: number;
}

/**
 * What components accept wherever SpaceUI took a Phosphor icon: a Material Symbols name, an
 * element, or a component (a Phosphor icon still works, its `weight` prop being ignored).
 */
export type IconSource = string | ReactNode | ElementType;

/** Render an {@link IconSource}. */
export function renderIcon(icon: IconSource, props: IconComponentProps = {}): ReactNode {
  if (icon === null || icon === undefined || icon === false) return null;
  if (typeof icon === "string") return <Icon name={icon} {...props} />;
  if (isValidElement(icon)) return icon;
  if (
    typeof icon === "function" ||
    (typeof icon === "object" && icon !== null && "$$typeof" in icon)
  ) {
    const Component = icon as ComponentType<IconComponentProps>;
    return <Component {...props} />;
  }
  return icon as ReactNode;
}

/**
 * The Phosphor glyphs SpaceUI used, and their Material Symbols equivalents. Keeps the upstream
 * vocabulary searchable when porting code that still names Phosphor icons.
 */
export const PHOSPHOR_TO_SYMBOL = {
  ArrowCircleDown: "arrow_circle_down",
  ArrowDown: "arrow_downward",
  ArrowUp: "arrow_upward",
  CaretDown: "expand_more",
  CaretLeft: "chevron_left",
  CaretRight: "chevron_right",
  CaretUp: "expand_less",
  Check: "check",
  Circle: "circle",
  DotsThree: "more_horiz",
  Equals: "drag_handle",
  Eye: "visibility",
  EyeSlash: "visibility_off",
  Info: "info",
  MagnifyingGlass: "search",
  Microphone: "mic",
  Minus: "remove",
  Plus: "add",
  Sparkle: "auto_awesome",
  Warning: "warning",
  WarningCircle: "error",
  X: "close",
} as const;
