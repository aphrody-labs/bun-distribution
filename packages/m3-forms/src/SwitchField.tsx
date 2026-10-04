// SPDX-License-Identifier: Apache-2.0 AND MIT
// Derived from SpaceUI (packages/aphrody-spaceui/packages/forms/src/SwitchField.tsx), MIT, rebuilt on Material Design 3.
import { Switch } from "@aphrody/m3-primitives";
import { FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "./Form";

export interface SwitchFieldProps {
  name: string;
  label?: string;
  description?: string;
  disabled?: boolean;
  /** Marks the field required (`*` after the label, `aria-required` on the switch). */
  required?: boolean;
}

function SwitchField({ name, label, description, disabled, required }: SwitchFieldProps) {
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
            <div className="flex flex-col gap-1">
              {label && (
                <FormLabel variant="inline" required={required}>
                  {label}
                </FormLabel>
              )}
              {description && <FormDescription>{description}</FormDescription>}
              <FormMessage />
            </div>
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
