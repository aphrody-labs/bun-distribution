// SPDX-License-Identifier: Apache-2.0 AND MIT
// Derived from SpaceUI (packages/aphrody-spaceui/packages/primitives/src/Input.tsx), MIT, rebuilt on Material Design 3.
"use client";

import { cva, type VariantProps } from "class-variance-authority";
import { clsx } from "clsx";
import { forwardRef, type ReactNode, useState } from "react";

import { Icon, type IconSource, renderIcon } from "./Icon";

/**
 * M3 text field.
 *
 * - `variant`: `default` / `outlined` (M3 outlined text field), `filled` (M3 filled text field),
 *   `transparent` (upstream borderless field, no container).
 * - `size`: the M3 baseline is 56dp (`xl`, the default). The upstream SpaceUI sizes map to the
 *   M3 density steps: `lg` 48, `md` 40, `sm` 36, `xs` 32. Dense sizes (`xs`, `sm`) use
 *   `body-medium` and 20px icons, the others `body-large` and 24px icons.
 */
export interface InputBaseProps extends VariantProps<typeof inputStyles> {
  icon?: IconSource;
  iconPosition?: "left" | "right";
  inputElementClassName?: string;
  right?: ReactNode;
  /** M3 supporting text under the field (turns `error` colored when `error` is set). */
  supportingText?: ReactNode;
}

export type InputProps = InputBaseProps & Omit<React.ComponentProps<"input">, "size">;

export type TextareaProps = InputBaseProps & React.ComponentProps<"textarea">;

/** Field heights and input typescale per size (M3 density steps under the 56dp baseline). */
export const inputSizes = {
  xs: "h-8 text-body-medium",
  sm: "h-9 text-body-medium",
  md: "h-10 text-body-large",
  lg: "h-12 text-body-large",
  xl: "h-14 text-body-large",
};

type InputSize = keyof typeof inputSizes;

const isDense = (size: InputSize | null | undefined) => size === "xs" || size === "sm";

const outlined = [
  "rounded-extra-small border border-outline bg-transparent",
  "hover:border-on-surface",
  // Focused: 2dp primary outline (1dp border + 1dp inset ring, so the content does not shift).
  "focus-within:border-primary focus-within:ring-1 focus-within:ring-inset focus-within:ring-primary focus-within:hover:border-primary",
];

const filled = [
  "rounded-t-extra-small rounded-b-none border-0 border-b border-on-surface-variant bg-surface-container-highest",
  "hover:border-on-surface",
  // Hover state layer (on-surface 8 %).
  "before:pointer-events-none before:absolute before:inset-0 before:rounded-[inherit] before:bg-on-surface before:opacity-0 before:transition-opacity before:content-[''] hover:before:opacity-8",
  // Active indicator: 1dp on-surface-variant, 2dp primary when focused.
  "focus-within:border-primary focus-within:shadow-[inset_0_-1px_0_0_var(--md-sys-color-primary)] focus-within:hover:border-primary",
];

export const inputStyles = cva(
  [
    "relative text-on-surface caret-primary",
    "outline-none transition-[background-color,border-color,box-shadow] duration-200 ease-standard",
    "has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-38",
  ],
  {
    variants: {
      variant: {
        default: outlined,
        outlined,
        filled,
        transparent: [
          "border border-transparent bg-transparent placeholder-on-surface-variant focus-within:bg-transparent",
          "focus-within:border-transparent focus-within:ring-transparent",
        ],
      },
      error: {
        true: "caret-error",
      },
      size: inputSizes,
    },
    compoundVariants: [
      {
        variant: ["default", "outlined"],
        error: true,
        className:
          "border-error hover:border-on-error-container focus-within:border-error focus-within:ring-error focus-within:hover:border-error",
      },
      {
        variant: "filled",
        error: true,
        className:
          "border-error hover:border-on-error-container focus-within:border-error focus-within:shadow-[inset_0_-1px_0_0_var(--md-sys-color-error)] focus-within:hover:border-error",
      },
    ],
    defaultVariants: {
      variant: "default",
      size: "xl",
    },
  },
);

function SupportingText({ error, children }: { error?: boolean | null; children: ReactNode }) {
  return <p className={clsx("px-4 text-body-small", error ? "text-error" : "text-on-surface-variant")}>{children}</p>;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  (
    {
      variant,
      size,
      right,
      icon,
      iconPosition = "left",
      className,
      error,
      inputElementClassName,
      supportingText,
      ...props
    },
    ref,
  ) => {
    const resolvedSize: InputSize = size ?? "xl";
    const dense = isDense(resolvedSize);

    const field = (
      <div
        data-m3-component="Input"
        className={clsx(
          "group flex",
          inputStyles({
            variant,
            size: resolvedSize,
            error,
            className,
          }),
        )}
      >
        <div className={clsx("flex h-full flex-1 overflow-hidden", iconPosition === "right" && "flex-row-reverse")}>
          {icon && (
            <div
              className={clsx(
                "flex h-full items-center text-on-surface-variant",
                iconPosition === "left" ? (dense ? "pl-2 pr-2" : "pl-3 pr-4") : dense ? "pl-2 pr-2" : "pl-4 pr-3",
              )}
            >
              {renderIcon(icon, {
                size: dense ? 20 : 24,
                className: "text-on-surface-variant",
              })}
            </div>
          )}

          <input
            className={clsx(
              "h-full min-w-0 flex-1 truncate border-none bg-transparent text-on-surface outline-none",
              "placeholder:text-on-surface-variant focus:ring-0 disabled:cursor-not-allowed",
              dense ? "px-3 text-body-medium" : "px-4 text-body-large",
              (right || (icon && iconPosition === "right")) && "pr-0",
              icon && iconPosition === "left" && "pl-0",
              resolvedSize === "xs" && "py-0",
              inputElementClassName,
            )}
            onKeyDown={e => {
              e.stopPropagation();
            }}
            ref={ref}
            autoComplete={props.autoComplete || "off"}
            aria-invalid={error ? true : undefined}
            {...props}
          />
        </div>

        {right && (
          <div
            className={clsx("flex h-full min-w-[12px] items-center text-on-surface-variant", dense ? "px-0.5" : "px-1")}
          >
            {right}
          </div>
        )}
      </div>
    );

    if (supportingText === undefined || supportingText === null) return field;

    return (
      <div className="flex flex-col gap-1">
        {field}
        <SupportingText error={error}>{supportingText}</SupportingText>
      </div>
    );
  },
);

Input.displayName = "Input";

/** @deprecated Use `SearchBar` instead. */
export const SearchInput = forwardRef<HTMLInputElement, InputProps>((props, ref) => (
  <Input {...props} ref={ref} icon="search" />
));

SearchInput.displayName = "SearchInput";

export const TextArea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  (
    {
      size,
      variant,
      error,
      className,
      icon: _icon,
      iconPosition: _iconPosition,
      inputElementClassName: _inputElementClassName,
      right: _right,
      supportingText,
      ...props
    },
    ref,
  ) => {
    const dense = isDense(size);
    const area = (
      <textarea
        data-m3-component="TextArea"
        {...props}
        ref={ref}
        aria-invalid={error ? true : undefined}
        onKeyDown={e => {
          e.stopPropagation();
        }}
        className={clsx(
          "h-auto placeholder:text-on-surface-variant",
          dense ? "min-h-9 px-3 py-2 text-body-medium" : "min-h-14 px-4 py-4 text-body-large",
          inputStyles({ size: null, variant, error }),
          "disabled:cursor-not-allowed disabled:opacity-38",
          className,
        )}
      />
    );

    if (supportingText === undefined || supportingText === null) return area;

    return (
      <div className="flex flex-col gap-1">
        {area}
        <SupportingText error={error}>{supportingText}</SupportingText>
      </div>
    );
  },
);

TextArea.displayName = "TextArea";

export interface LabelProps extends Omit<React.ComponentProps<"label">, "htmlFor"> {
  slug?: string;
}

/** Field label: M3 `label-large` in `on-surface`. */
export function Label({ slug, children, className, ...props }: LabelProps) {
  return (
    <label
      data-m3-component="Label"
      htmlFor={slug}
      className={clsx("text-label-large text-on-surface", className)}
      {...props}
    >
      {children}
    </label>
  );
}

interface PasswordInputProps extends InputProps {
  buttonClassnames?: string;
}

export const PasswordInput = forwardRef<HTMLInputElement, PasswordInputProps>(({ buttonClassnames, ...props }, ref) => {
  const [showPassword, setShowPassword] = useState(false);
  const dense = isDense(props.size);

  return (
    <Input
      {...props}
      type={showPassword ? "text" : "password"}
      ref={ref}
      onKeyDown={e => {
        e.stopPropagation();
      }}
      right={
        <button
          type="button"
          tabIndex={0}
          onClick={() => setShowPassword(!showPassword)}
          aria-label={showPassword ? "Hide Password" : "Show Password"}
          aria-pressed={showPassword}
          disabled={props.disabled}
          className={clsx(
            "inline-flex shrink-0 items-center justify-center rounded-full text-on-surface-variant outline-none",
            "transition-colors duration-200 ease-standard hover:bg-on-surface-variant/8 active:bg-on-surface-variant/10",
            "focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-secondary",
            "disabled:pointer-events-none disabled:opacity-38",
            dense ? "size-8" : "size-10",
            buttonClassnames,
          )}
        >
          <Icon
            name={showPassword ? "visibility_off" : "visibility"}
            size={dense ? 20 : 24}
            className="pointer-events-none"
          />
        </button>
      }
    />
  );
});

PasswordInput.displayName = "PasswordInput";
