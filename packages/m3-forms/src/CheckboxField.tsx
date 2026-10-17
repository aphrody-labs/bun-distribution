// SPDX-License-Identifier: Apache-2.0 AND MIT
// Derived from SpaceUI (packages/aphrody-spaceui/packages/forms/src/CheckboxField.tsx), MIT, rebuilt on Material Design 3.
import { CheckBox as Checkbox } from "@aphrody/m3-primitives";
import { FieldText, FormControl, FormField, FormItem } from "./Form";

export interface CheckboxFieldProps {
  name: string;
  label?: string;
  description?: string;
  disabled?: boolean;
  /** Marks the field required (`*` after the label, `required` on the checkbox). */
  required?: boolean;
}

function CheckboxField({ name, label, description, disabled, required }: CheckboxFieldProps) {
  return (
    <FormField
      name={name}
      render={({ field, fieldState }) => (
        <FormItem data-disabled={disabled || undefined} data-m3-component="CheckboxField" data-testid={`field-${name}`}>
          <div className="flex flex-row items-start gap-3">
            <FormControl>
              <Checkbox
                name={field.name}
                ref={field.ref}
                checked={!!field.value}
                onChange={field.onChange}
                onBlur={field.onBlur}
                disabled={disabled ?? field.disabled}
                required={required}
                className={fieldState.error ? "border-error accent-error" : undefined}
              />
            </FormControl>
            <FieldText label={label} description={description} required={required} />
          </div>
        </FormItem>
      )}
    />
  );
}

export { CheckboxField };
