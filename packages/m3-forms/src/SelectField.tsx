// SPDX-License-Identifier: Apache-2.0 AND MIT
// Derived from SpaceUI (packages/aphrody-spaceui/packages/forms/src/SelectField.tsx), MIT, rebuilt on Material Design 3.
import {
  SelectRoot,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@aphrody/m3-primitives";
import {
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "./Form";

export interface SelectOption {
  value: string;
  label: string;
}

export interface SelectFieldProps {
  name: string;
  label?: string;
  description?: string;
  placeholder?: string;
  options: SelectOption[];
  disabled?: boolean;
  /** Marks the field required (`*` after the label, `aria-required` on the trigger). */
  required?: boolean;
}

function SelectField({
  name,
  label,
  description,
  placeholder,
  options,
  disabled,
  required,
}: SelectFieldProps) {
  return (
    <FormField
      name={name}
      render={({ field, fieldState }) => (
        <FormItem
          data-disabled={disabled || undefined}
          data-m3-component="SelectField"
          data-testid={`field-${name}`}
        >
          {label && <FormLabel required={required}>{label}</FormLabel>}
          <SelectRoot
            onValueChange={field.onChange}
            value={field.value ?? ""}
            disabled={disabled ?? field.disabled}
            name={field.name}
            required={required}
          >
            <FormControl>
              <SelectTrigger
                ref={field.ref}
                onBlur={field.onBlur}
                aria-required={required || undefined}
                className={
                  fieldState.error ? "border-error text-error" : undefined
                }
              >
                <SelectValue placeholder={placeholder} />
              </SelectTrigger>
            </FormControl>
            <SelectContent>
              {options.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </SelectRoot>
          {description && (
            <FormDescription className="px-4">{description}</FormDescription>
          )}
          <FormMessage className="px-4" />
        </FormItem>
      )}
    />
  );
}

export { SelectField };
