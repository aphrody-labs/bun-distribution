// SPDX-License-Identifier: Apache-2.0 AND MIT
// Derived from SpaceUI (packages/aphrody-spaceui/packages/forms/src/RadioGroupField.tsx), MIT, rebuilt on Material Design 3.
import {
  RadioGroupRoot as RadioGroup,
  RadioGroupItem,
} from "@aphrody/m3-primitives";
import {
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "./Form";

export interface RadioOption {
  value: string;
  label: string;
}

export interface RadioGroupFieldProps {
  name: string;
  label?: string;
  description?: string;
  options: RadioOption[];
  disabled?: boolean;
  /** Marks the group required (`*` after the label, `required` on the radio group). */
  required?: boolean;
}

function RadioGroupField({
  name,
  label,
  description,
  options,
  disabled,
  required,
}: RadioGroupFieldProps) {
  return (
    <FormField
      name={name}
      render={({ field, fieldState }) => (
        <FormItem
          data-disabled={disabled || undefined}
          data-m3-component="RadioGroupField"
          data-testid={`field-${name}`}
        >
          {label && <FormLabel required={required}>{label}</FormLabel>}
          <FormControl>
            <RadioGroup
              onValueChange={field.onChange}
              defaultValue={field.value}
              className="flex flex-col"
              disabled={disabled}
              required={required}
              name={field.name}
            >
              {options.map((option) => (
                <FormItem key={option.value}>
                  <div className="flex min-h-12 flex-row items-center gap-3">
                    <FormControl>
                      <RadioGroupItem
                        value={option.value}
                        className={
                          fieldState.error
                            ? "border-error text-error"
                            : undefined
                        }
                      />
                    </FormControl>
                    <FormLabel variant="inline">{option.label}</FormLabel>
                  </div>
                </FormItem>
              ))}
            </RadioGroup>
          </FormControl>
          {description && <FormDescription>{description}</FormDescription>}
          <FormMessage />
        </FormItem>
      )}
    />
  );
}

export { RadioGroupField };
