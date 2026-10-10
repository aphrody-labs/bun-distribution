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
  ref,
) {
  const ctx = useNextMigrateContext();

  const handleSubmit: NonNullable<FormHTMLAttributes<HTMLFormElement>["onSubmit"]> = (event) => {
    onSubmit?.(event);
    if (event.defaultPrevented || typeof action === "function") return;

    const form = event.currentTarget;
    const submitter = (event.nativeEvent as SubmitEvent).submitter;
    const method = submitter?.getAttribute("formmethod") ?? form.method;
    const target = submitter?.getAttribute("formtarget") ?? form.target;
    const encoding = submitter?.getAttribute("formenctype") ?? form.enctype;
    // Preserve native form semantics for POST, uploads, and another browsing context.
    if (
      method.toLowerCase() !== "get" ||
      (target && target !== "_self") ||
      (encoding && encoding !== "application/x-www-form-urlencoded")
    )
      return;
    const destination = new URL(
      submitter?.getAttribute("formaction") ?? action,
      window.location.href,
    );
    if (
      destination.origin !== window.location.origin ||
      (destination.protocol !== "http:" && destination.protocol !== "https:")
    )
      return;
    destination.search = "";
    const data = new FormData(form, submitter);
    for (const [name, value] of data) {
      destination.searchParams.append(name, typeof value === "string" ? value : value.name);
    }
    event.preventDefault();
    ctx.navigate(destination.pathname + destination.search + destination.hash, { replace, scroll });
  };

  return (
    <form ref={ref} action={action} onSubmit={handleSubmit} {...rest}>
      {children}
    </form>
  );
});

export default Form;
