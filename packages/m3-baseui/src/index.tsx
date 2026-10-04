// SPDX-License-Identifier: Apache-2.0
// Material 3 styling for Base UI parts. Behaviour, a11y and state attributes come from Base UI
// (the aphrody-labs fork in forks/base-ui, consumed as `@base-ui/react` through the workspace catalog);
// appearance comes from `m3-baseui.css` driven by the `--md-sys-*` tokens of @aphrody/m3-tokens.
import { Button as BaseButton } from "@base-ui/react/button";
import { Checkbox as BaseCheckbox } from "@base-ui/react/checkbox";
import { Switch as BaseSwitch } from "@base-ui/react/switch";
import { Tabs as BaseTabs } from "@base-ui/react/tabs";
import * as React from "react";

export type ButtonVariant = "filled" | "tonal" | "outlined" | "text" | "elevated";

/** Join class names, dropping falsy values. */
export const cx = (...names: (string | false | null | undefined)[]): string =>
  names.filter(Boolean).join(" ");

export type M3ButtonProps = Omit<React.ComponentProps<typeof BaseButton>, "className"> & {
  variant?: ButtonVariant;
  className?: string;
};

export const M3Button = React.forwardRef<HTMLButtonElement, M3ButtonProps>(function M3Button(
  { variant = "filled", className, ...props },
  ref,
) {
  return (
    <BaseButton
      ref={ref}
      className={cx("m3-bui-button", `m3-bui-button--${variant}`, className)}
      {...props}
    />
  );
});

export type M3SwitchProps = Omit<React.ComponentProps<typeof BaseSwitch.Root>, "className"> & {
  className?: string;
};

export const M3Switch = React.forwardRef<HTMLButtonElement, M3SwitchProps>(function M3Switch(
  { className, ...props },
  ref,
) {
  return (
    <BaseSwitch.Root ref={ref} className={cx("m3-bui-switch", className)} {...props}>
      <BaseSwitch.Thumb className="m3-bui-switch__thumb" />
    </BaseSwitch.Root>
  );
});

export type M3CheckboxProps = Omit<React.ComponentProps<typeof BaseCheckbox.Root>, "className"> & {
  className?: string;
};

export const M3Checkbox = React.forwardRef<HTMLElement, M3CheckboxProps>(function M3Checkbox(
  { className, ...props },
  ref,
) {
  return (
    <BaseCheckbox.Root
      ref={ref as React.Ref<HTMLButtonElement>}
      className={cx("m3-bui-checkbox", className)}
      {...props}
    >
      <BaseCheckbox.Indicator className="m3-bui-checkbox__indicator">
        <svg viewBox="0 0 18 18" width="18" height="18" aria-hidden="true">
          <path d="M3.5 9.5l3.5 3.5 7.5-8" fill="none" stroke="currentColor" strokeWidth="2" />
        </svg>
      </BaseCheckbox.Indicator>
    </BaseCheckbox.Root>
  );
});

export const M3Tabs = {
  Root: ({
    className,
    ...props
  }: Omit<React.ComponentProps<typeof BaseTabs.Root>, "className"> & { className?: string }) => (
    <BaseTabs.Root className={cx("m3-bui-tabs", className)} {...props} />
  ),
  List: ({
    className,
    ...props
  }: Omit<React.ComponentProps<typeof BaseTabs.List>, "className"> & { className?: string }) => (
    <BaseTabs.List className={cx("m3-bui-tabs__list", className)} {...props} />
  ),
  Tab: ({
    className,
    ...props
  }: Omit<React.ComponentProps<typeof BaseTabs.Tab>, "className"> & { className?: string }) => (
    <BaseTabs.Tab className={cx("m3-bui-tabs__tab", className)} {...props} />
  ),
  Indicator: ({
    className,
    ...props
  }: Omit<React.ComponentProps<typeof BaseTabs.Indicator>, "className"> & {
    className?: string;
  }) => <BaseTabs.Indicator className={cx("m3-bui-tabs__indicator", className)} {...props} />,
  Panel: ({
    className,
    ...props
  }: Omit<React.ComponentProps<typeof BaseTabs.Panel>, "className"> & { className?: string }) => (
    <BaseTabs.Panel className={cx("m3-bui-tabs__panel", className)} {...props} />
  ),
};

/** Re-export the unstyled Base UI parts for anything not yet wrapped. */
export * as BaseUI from "@base-ui/react";
