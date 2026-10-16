"use client";

import * as React from "react";
import { type VariantProps } from "class-variance-authority";
import { ToggleGroup as ToggleGroupPrimitive } from "@base-ui/react/toggle-group";
import { Toggle as TogglePrimitive } from "@base-ui/react/toggle";
import { childRender, type PrimitiveProps } from "../lib/render";

import { cn } from "../lib/utils";
import { toggleVariants } from "./toggle";

const ToggleGroupContext = React.createContext<
  VariantProps<typeof toggleVariants> & {
    spacing?: number;
    rovingFocus?: boolean;
  }
>({
  size: "default",
  variant: "default",
  spacing: 0,
});

function ToggleGroup({
  className,
  variant,
  size,
  spacing = 0,
  children,
  asChild,
  type,
  value,
  defaultValue,
  onValueChange,
  loop,
  rovingFocus = true,
  ...props
}: Omit<PrimitiveProps<typeof ToggleGroupPrimitive>, "value" | "defaultValue" | "onValueChange" | "multiple"> &
  (
    | {
        type: "single";
        value?: string;
        defaultValue?: string;
        onValueChange?: (value: string) => void;
      }
    | {
        type: "multiple";
        value?: string[];
        defaultValue?: string[];
        onValueChange?: (value: string[]) => void;
      }
  ) & { loop?: boolean; rovingFocus?: boolean } & VariantProps<typeof toggleVariants> & {
    spacing?: number;
  }) {
  const contextValue = React.useMemo(
    () => ({ variant, size, spacing, rovingFocus }),
    [variant, size, spacing, rovingFocus],
  );
  return (
    <ToggleGroupContext.Provider value={contextValue}>
      <ToggleGroupPrimitive
        data-slot="toggle-group"
        render={childRender(asChild, children)}
        multiple={type === "multiple"}
        value={value === undefined ? undefined : Array.isArray(value) ? value : value ? [value] : []}
        defaultValue={
          defaultValue === undefined
            ? undefined
            : Array.isArray(defaultValue)
              ? defaultValue
              : defaultValue
                ? [defaultValue]
                : []
        }
        loopFocus={loop}
        onValueChange={(next: string[]) => {
          if (type === "single") (onValueChange as ((value: string) => void) | undefined)?.(next[0] ?? "");
          else (onValueChange as ((value: string[]) => void) | undefined)?.(next);
        }}
        data-variant={variant}
        data-size={size}
        data-spacing={spacing}
        style={{ "--gap": spacing } as React.CSSProperties}
        className={cn(
          "group/toggle-group flex w-fit items-center gap-[--spacing(var(--gap))] rounded-md data-[spacing=default]:data-[variant=outline]:shadow-xs",
          className,
        )}
        {...props}
      >
        {asChild ? undefined : children}
      </ToggleGroupPrimitive>
    </ToggleGroupContext.Provider>
  );
}

function ToggleGroupItem({
  className,
  onKeyDown,
  asChild,
  children,
  variant,
  size,
  ...props
}: PrimitiveProps<typeof TogglePrimitive> & { value: string } & VariantProps<typeof toggleVariants>) {
  const context = React.useContext(ToggleGroupContext);

  return (
    <TogglePrimitive
      data-slot="toggle-group-item"
      tabIndex={context.rovingFocus === false ? 0 : undefined}
      onKeyDown={event => {
        onKeyDown?.(event);
        if (context.rovingFocus === false && event.key.startsWith("Arrow")) event.stopPropagation();
      }}
      render={childRender(asChild, children)}
      data-variant={context.variant || variant}
      data-size={context.size || size}
      data-spacing={context.spacing}
      className={cn(
        toggleVariants({
          variant: context.variant || variant,
          size: context.size || size,
        }),
        "w-auto min-w-0 shrink-0 px-3 focus:z-10 focus-visible:z-10",
        "data-[spacing=0]:rounded-none data-[spacing=0]:shadow-none data-[spacing=0]:first:rounded-l-md data-[spacing=0]:last:rounded-r-md data-[spacing=0]:data-[variant=outline]:border-l-0 data-[spacing=0]:data-[variant=outline]:first:border-l",
        className,
      )}
      {...props}
    >
      {asChild ? undefined : children}
    </TogglePrimitive>
  );
}

export { ToggleGroup, ToggleGroupItem };
