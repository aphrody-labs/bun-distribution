// SPDX-License-Identifier: Apache-2.0 AND MIT
// Derived from SpaceUI (packages/aphrody-spaceui/packages/forms/src/InputField.tsx), MIT, rebuilt on Material Design 3.
import { Input } from "@aphrody/m3-primitives";
import { FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "./Form";

export interface InputFieldProps {
  name: string;
  label?: string;
  description?: string;
  placeholder?: string;
  type?: string;
  disabled?: boolean;
  /** Marks the field required (`*` after the label, `aria-required` on the input). */
  required?: boolean;
}

function InputField({
  name,
  label,
  description,
  placeholder,
  type = "text",
  disabled,
  required,
}: InputFieldProps) {
  return (
    <FormField
      name={name}
      render={({ field, fieldState }) => (
        <FormItem
          data-disabled={disabled || undefined}
          data-m3-component="InputField"
          data-testid={`field-${name}`}
        >
          {label && <FormLabel required={required}>{label}</FormLabel>}
          <FormControl>
            <Input
              {...field}
              value={field.value ?? ""}
              placeholder={placeholder}
              type={type}
              disabled={disabled ?? field.disabled}
              required={required}
              aria-required={required || undefined}
              error={!!fieldState.error}
            />
          </FormControl>
          {description && <FormDescription className="px-4">{description}</FormDescription>}
          <FormMessage className="px-4" />
        </FormItem>
      )}
    />
  );
}

export { InputField };
