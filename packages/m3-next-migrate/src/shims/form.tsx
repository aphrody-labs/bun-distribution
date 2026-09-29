// SPDX-License-Identifier: Apache-2.0
"use client";

import { forwardRef, type FormHTMLAttributes, type ReactNode } from "react";
import { useNextMigrateContext } from "./provider";

export interface FormProps extends Omit<FormHTMLAttributes<HTMLFormElement>, "action"> {
  action: string | ((formData: FormData) => void | Promise<void>);
  replace?: boolean;
  scroll?: boolean;
  prefetch?: boolean;
  children?: ReactNode;
}

export const Form = forwardRef<HTMLFormElement, FormProps>(function Form(
  { action, replace = false, scroll = true, prefetch: _prefetch, onSubmit, children, ...rest },
  ref
) {
  const ctx = useNextMigrateContext();

  const handleSubmit = async (e: any) => {
    onSubmit?.(e);
    if (e.defaultPrevented) return;

    if (typeof action === "function") {
      e.preventDefault();
      const formData = new FormData(e.currentTarget);
      await action(formData);
      return;
    }

    if (typeof action === "string") {
      e.preventDefault();
      const formData = new FormData(e.currentTarget);
      const params = new URLSearchParams();
      formData.forEach((value, key) => {
        if (typeof value === "string") {
          params.append(key, value);
        }
      });
      const queryString = params.toString();
      const targetUrl = queryString ? `${action}?${queryString}` : action;
      ctx.navigate(targetUrl, { replace, scroll });
    }
  };

  return (
    <form ref={ref} onSubmit={handleSubmit} {...rest}>
      {children}
    </form>
  );
});

export default Form;
