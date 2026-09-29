// SPDX-License-Identifier: Apache-2.0 AND MIT
// Derived from SpaceUI (packages/aphrody-spaceui/packages/primitives/src/forms/Form.tsx), MIT, rebuilt on Material Design 3.
"use client";

import { m3Durations, m3Easings } from "@aphrody/m3-motion";
import { cva, type VariantProps } from "class-variance-authority";
import { AnimatePresence, motion } from "motion/react";
import { type ComponentProps } from "react";
import {
  type FieldErrors,
  type FieldValues,
  FormProvider,
  get,
  useFormContext,
  type UseFormHandleSubmit,
  type UseFormReturn,
} from "react-hook-form";

import { Icon } from "../Icon";

export interface FormProps<T extends FieldValues> extends Omit<ComponentProps<"form">, "onSubmit"> {
  form: UseFormReturn<T>;
  disabled?: boolean;
  onSubmit?: ReturnType<UseFormHandleSubmit<T>>;
}

export const Form = <T extends FieldValues>({
  form,
  disabled,
  onSubmit,
  children,
  ...props
}: FormProps<T>) => {
  return (
    <FormProvider {...form}>
      <form
        onSubmit={(e) => {
          e.stopPropagation();
          e.preventDefault();
          return onSubmit?.(e);
        }}
        {...props}
      >
        <fieldset disabled={disabled || form.formState.isSubmitting} className="min-w-0">
          {children}
        </fieldset>
      </form>
    </FormProvider>
  );
};

/** Unambiguous alias for the HTML form element wrapper with FormProvider */
export const FormRoot = Form;
export type FormRootProps<T extends FieldValues> = FormProps<T>;

/**
 * M3 error supporting text: `error` role, leading filled `error` icon. `default` is the field
 * supporting text (`body-small`), `large` a form-level message (`body-medium`).
 */
export const errorStyles = cva("flex items-start gap-1 whitespace-normal break-words text-error", {
  variants: {
    variant: {
      none: "",
      default: "w-full px-4 text-body-small",
      large: "gap-2 text-left text-body-medium",
    },
  },
  defaultVariants: {
    variant: "default",
  },
});

export interface ErrorMessageProps extends VariantProps<typeof errorStyles> {
  name: string;
  className: string;
}

export const ErrorMessage = ({ name, variant, className }: ErrorMessageProps) => {
  const methods = useFormContext();
  const error = get(methods.formState.errors, name) as FieldErrors | undefined;
  const message = error?.message;

  return (
    <AnimatePresence mode="wait" initial={false}>
      {typeof message === "string" ? (
        <motion.div
          key={message}
          role="alert"
          className={errorStyles({ variant, className })}
          initial={{ opacity: 0, y: -4 }}
          animate={{
            opacity: 1,
            y: 0,
            transition: {
              duration: m3Durations.short4,
              ease: m3Easings.emphasizedDecelerate,
            },
          }}
          exit={{
            opacity: 0,
            transition: {
              duration: m3Durations.short3,
              ease: m3Easings.emphasizedAccelerate,
            },
          }}
        >
          <Icon name="error" filled size={variant === "large" ? 20 : 16} className="mt-px" />
          <p className="whitespace-normal">{message}</p>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
};

export { z } from "zod";
