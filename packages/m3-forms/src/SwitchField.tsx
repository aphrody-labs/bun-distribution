// SPDX-License-Identifier: Apache-2.0 AND MIT
// Derived from SpaceUI (packages/aphrody-spaceui/packages/forms/src/SwitchField.tsx), MIT, rebuilt on Material Design 3.
import { Switch } from "@aphrody/m3-primitives";
import { FieldText, FormControl, FormField, FormItem } from "./Form";

export interface SwitchFieldProps {
  name: string;
  label?: string;
  description?: string;
  disabled?: boolean;
  /** Marks the field required (`*` after the label, `aria-required` on the switch). */
  required?: boolean;
}

function SwitchField({
  name,
  label,
  description,
  disabled,
  required,
}: SwitchFieldProps) {
  return (
    <FormField
      name={name}
      render={({ field }) => (
        <FormItem
          data-disabled={disabled || undefined}
          data-m3-component="SwitchField"
          data-testid={`field-${name}`}
        >
          <div className="flex min-h-14 flex-row items-center justify-between gap-4">
            <FieldText
              label={label}
              description={description}
              required={required}
            />
            <FormControl>
              <Switch
                name={field.name}
                checked={!!field.value}
                onCheckedChange={field.onChange}
                onBlur={field.onBlur}
                disabled={disabled ?? field.disabled}
                aria-required={required || undefined}
              />
            </FormControl>
          </div>
        </FormItem>
      )}
    />
  );
}

export { SwitchField };
