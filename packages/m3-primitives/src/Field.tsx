// SPDX-License-Identifier: Apache-2.0 AND MIT
// Material Design 3 Field & Form control primitive built on Base UI (@base-ui/react/field).
"use client";

import { Field as FieldPrimitive } from "@base-ui/react/field";
import { forwardRef } from "react";

import { withClassName } from "./base-ui";

export type FieldRootProps = FieldPrimitive.Root.Props;
export const FieldRoot = forwardRef<HTMLDivElement, FieldRootProps>(
  ({ className, ...props }, ref) => (
    <FieldPrimitive.Root
      ref={ref}
      className={withClassName("flex flex-col gap-1.5 w-full", className)}
      {...props}
    />
  ),
);
FieldRoot.displayName = "FieldRoot";

export type FieldLabelProps = FieldPrimitive.Label.Props;
export const FieldLabel = forwardRef<HTMLLabelElement, FieldLabelProps>(
  ({ className, ...props }, ref) => (
    <FieldPrimitive.Label
      ref={ref}
      className={withClassName(
        "text-label-large font-medium text-on-surface data-[disabled]:opacity-38 data-[invalid]:text-error",
        className,
      )}
      {...props}
    />
  ),
);
FieldLabel.displayName = "FieldLabel";

export type FieldControlProps = FieldPrimitive.Control.Props;
export const FieldControl = FieldPrimitive.Control;

export type FieldDescriptionProps = FieldPrimitive.Description.Props;
export const FieldDescription = forwardRef<
  HTMLParagraphElement,
  FieldDescriptionProps
>(({ className, ...props }, ref) => (
  <FieldPrimitive.Description
    ref={ref}
    className={withClassName(
      "m-0 text-body-small text-on-surface-variant",
      className,
    )}
    {...props}
  />
));
FieldDescription.displayName = "FieldDescription";

export type FieldErrorProps = FieldPrimitive.Error.Props;
export const FieldError = forwardRef<HTMLParagraphElement, FieldErrorProps>(
  ({ className, ...props }, ref) => (
    <FieldPrimitive.Error
      ref={ref}
      className={withClassName(
        "m-0 text-body-small font-medium text-error",
        className,
      )}
      {...props}
    />
  ),
);
FieldError.displayName = "FieldError";

export type FieldValidityProps = FieldPrimitive.Validity.Props;
export const FieldValidity = FieldPrimitive.Validity;

export const Field = {
  Root: FieldRoot,
  Label: FieldLabel,
  Control: FieldControl,
  Description: FieldDescription,
  Error: FieldError,
  Validity: FieldValidity,
};
