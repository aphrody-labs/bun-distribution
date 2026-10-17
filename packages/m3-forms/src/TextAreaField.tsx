// SPDX-License-Identifier: Apache-2.0 AND MIT
// Derived from SpaceUI (packages/aphrody-spaceui/packages/forms/src/TextAreaField.tsx), MIT, rebuilt on Material Design 3.
import { TextArea } from "@aphrody/m3-primitives";
import { FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "./Form";

export interface TextAreaFieldProps {
  name: string;
  label?: string;
  description?: string;
  placeholder?: string;
  disabled?: boolean;
  rows?: number;
  /** Marks the field required (`*` after the label, `aria-required` on the textarea). */
  required?: boolean;
}

function TextAreaField({ name, label, description, placeholder, disabled, rows = 4, required }: TextAreaFieldProps) {
  return (
    <FormField
      name={name}
      render={({ field, fieldState }) => (
        <FormItem data-disabled={disabled || undefined} data-m3-component="TextAreaField" data-testid={`field-${name}`}>
          {label && <FormLabel required={required}>{label}</FormLabel>}
          <FormControl>
            <TextArea
              {...field}
              value={field.value ?? ""}
              className="min-h-[88px] w-full px-4 py-4 text-body-large"
              placeholder={placeholder}
              disabled={disabled ?? field.disabled}
              required={required}
              aria-required={required || undefined}
              error={!!fieldState.error}
              rows={rows}
            />
          </FormControl>
          {description && <FormDescription className="px-4">{description}</FormDescription>}
          <FormMessage className="px-4" />
        </FormItem>
      )}
    />
  );
}

export { TextAreaField };
