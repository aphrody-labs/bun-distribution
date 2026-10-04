// SPDX-License-Identifier: Apache-2.0 AND MIT
// Derived from SpaceUI (packages/aphrody-spaceui/packages/forms/src/Form.tsx), MIT, rebuilt on Material Design 3.
import { Icon } from "@aphrody/m3-primitives";
import { clsx } from "clsx";
import {
  Children,
  cloneElement,
  createContext,
  Fragment,
  isValidElement,
  useContext,
  useId,
  useMemo,
} from "react";
import {
  Controller,
  FormProvider,
  useFormContext,
  type ControllerProps,
  type FieldPath,
  type FieldValues,
} from "react-hook-form";

const Form = FormProvider;

type FormFieldContextValue<
  TFieldValues extends FieldValues = FieldValues,
  TName extends FieldPath<TFieldValues> = FieldPath<TFieldValues>,
> = {
  name: TName;
};

const FormFieldContext = createContext<FormFieldContextValue>({} as FormFieldContextValue);

const FormField = <
  TFieldValues extends FieldValues = FieldValues,
  TName extends FieldPath<TFieldValues> = FieldPath<TFieldValues>,
>({
  ...props
}: ControllerProps<TFieldValues, TName>) => {
  const fieldContext = useMemo(() => ({ name: props.name }), [props.name]);
  return (
    <FormFieldContext.Provider value={fieldContext}>
      <Controller {...props} />
    </FormFieldContext.Provider>
  );
};

const useFormField = () => {
  const fieldContext = useContext(FormFieldContext);
  const itemContext = useContext(FormItemContext);
  const { getFieldState, formState } = useFormContext();

  const fieldState = getFieldState(fieldContext.name, formState);

  if (!fieldContext) {
    throw new Error("useFormField should be used within <FormField>");
  }

  const { id } = itemContext;

  return {
    id,
    name: fieldContext.name,
    formItemId: `${id}-form-item`,
    formDescriptionId: `${id}-form-item-description`,
    formMessageId: `${id}-form-item-message`,
    ...fieldState,
  };
};

type FormItemContextValue = {
  id: string;
  /**
   * False only when the item's children provably hold no `FormDescription`, so `FormControl`
   * does not point `aria-describedby` at an id that is not in the document. A self-closing custom
   * component counts as "might render one" (the previous behavior).
   */
  hasDescription?: boolean;
};

/** Scans the element tree of one item for a `FormDescription`; nested items and the control have their own scope. */
function mayHaveDescription(children: React.ReactNode): boolean {
  let found = false;
  Children.forEach(children, (child) => {
    if (found || !isValidElement(child)) return;
    const type = child.type as unknown;
    if (type === FormDescription) found = true;
    else if (
      type === FormControl ||
      type === FormLabel ||
      type === FormMessage ||
      type === FormItem
    )
      return;
    else {
      // Host elements, fragments and wrappers that receive their content as children are scanned;
      // a self-closing custom component might render a description itself.
      const inner = (child.props as { children?: React.ReactNode }).children;
      if (
        typeof type === "string" ||
        type === Fragment ||
        typeof type === "function" ||
        typeof type === "object"
      ) {
        if (
          inner === undefined
            ? typeof type !== "string" && type !== Fragment
            : mayHaveDescription(inner)
        )
          found = true;
      } else found = true;
    }
  });
  return found;
}

const FormItemContext = createContext<FormItemContextValue>({} as FormItemContextValue);

/**
 * One field: label, control, then supporting text 4px below the control (M3 text-field anatomy).
 * Set `data-disabled` to dim the label and supporting text to 38 % along with the control.
 */
const FormItem = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => {
  const id = useId();
  const hasDescription = mayHaveDescription(props.children);
  const itemContext = useMemo(() => ({ id, hasDescription }), [id, hasDescription]);

  return (
    <FormItemContext.Provider value={itemContext}>
      <div
        className={clsx("group/field flex flex-col gap-1", className)}
        data-m3-component="FormItem"
        {...props}
      />
    </FormItemContext.Provider>
  );
};

interface FormLabelProps extends React.LabelHTMLAttributes<HTMLLabelElement> {
  /** Appends the M3 required marker (`*`) to the label. */
  required?: boolean;
  /**
   * `field` (default): label above a text field, `text-label-large`, error-colored when invalid.
   * `inline`: label beside a checkbox, radio or switch, `text-body-large`.
   */
  variant?: "field" | "inline";
}

const FormLabel = ({
  className,
  children,
  required,
  variant = "field",
  ...props
}: FormLabelProps) => {
  const { error, formItemId } = useFormField();

  return (
    <label
      data-m3-component="FormLabel"
      htmlFor={formItemId}
      className={clsx(
        "text-on-surface group-data-[disabled]/field:cursor-not-allowed group-data-[disabled]/field:opacity-38",
        variant === "field" ? "text-label-large" : "text-body-large",
        variant === "field" && error && "text-error",
        className,
      )}
      {...props}
    >
      {children}
      {required && (
        <span aria-hidden="true" className="ms-0.5">
          *
        </span>
      )}
    </label>
  );
};

interface FormControlProps {
  children: React.ReactElement;
}

const FormControl = ({ children }: FormControlProps) => {
  const { error, formItemId, formDescriptionId, formMessageId } = useFormField();
  const { hasDescription } = useContext(FormItemContext);
  const describedBy = [
    hasDescription !== false ? formDescriptionId : undefined,
    error ? formMessageId : undefined,
  ]
    .filter(Boolean)
    .join(" ");

  if (!isValidElement(children)) {
    return null;
  }

  const childProps = children.props as { "aria-describedby"?: string };
  const existingDescribed = childProps["aria-describedby"];
  const mergedDescribed = Array.from(
    new Set(
      [existingDescribed, describedBy]
        .filter(Boolean)
        .flatMap((value) => value!.split(/\s+/).filter(Boolean)),
    ),
  ).join(" ");

  return cloneElement(children, {
    id: formItemId,
    "aria-describedby": mergedDescribed || undefined,
    "aria-invalid": !!error,
  } as React.HTMLAttributes<HTMLElement>);
};

/** M3 supporting text. Text fields add `px-4` so it lines up with the input text. */
const FormDescription = ({ className, ...props }: React.HTMLAttributes<HTMLParagraphElement>) => {
  const { formDescriptionId } = useFormField();

  return (
    <p
      id={formDescriptionId}
      data-m3-component="FormDescription"
      className={clsx(
        "text-body-small text-on-surface-variant group-data-[disabled]/field:opacity-38",
        className,
      )}
      {...props}
    />
  );
};

/** M3 error supporting text, with a leading `error` icon. */
const FormMessage = ({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLParagraphElement>) => {
  const { error, formMessageId } = useFormField();
  const body = error ? String(error.message) : children;

  if (!body) {
    return null;
  }

  return (
    <p
      id={formMessageId}
      data-m3-component="FormMessage"
      className={clsx("flex items-start gap-1 text-body-small text-error", className)}
      {...props}
    >
      <Icon name="error" size={16} className="mt-px" />
      <span>{body}</span>
    </p>
  );
};

/** Label, description and error message, stacked: the text side of an inline (checkbox, switch) field. */
const FieldText = ({
  label,
  description,
  required,
}: {
  label?: string;
  description?: string;
  required?: boolean;
}) => (
  <div className="flex flex-col gap-1">
    {label && (
      <FormLabel variant="inline" required={required}>
        {label}
      </FormLabel>
    )}
    {description && <FormDescription>{description}</FormDescription>}
    <FormMessage />
  </div>
);

export {
  FieldText,
  useFormField,
  Form,
  FormItem,
  FormLabel,
  FormControl,
  FormDescription,
  FormMessage,
  FormField,
};
export type { FormLabelProps };
