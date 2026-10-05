<!-- SPDX-License-Identifier: Apache-2.0 AND MIT -->

# @aphrody/m3-forms

Material Design 3 form fields for React, wired to [react-hook-form](https://react-hook-form.com).
Each field composes a control from `@aphrody/m3-primitives` with the M3 text-field anatomy: a label,
the control, then supporting text (or error text) 4dp below it.

This is SpaceUI's `@spacedrive/forms` rebuilt on Material Design 3. The upstream source lives in
`packages/aphrody-spaceui/packages/forms`; the fusion rules are in
[`docs/design/SPACEUI-M3-FUSION.md`](../../docs/architecture/design/SPACEUI-M3-FUSION.md).

## Install

```sh
bun add @aphrody/m3-forms @aphrody/m3-primitives react-hook-form zod @hookform/resolvers
```

Peer dependencies: `react` and `react-dom` 18 or 19, `react-hook-form` 7, `zod` (3 or 4),
`tailwindcss` 4.1+.

## CSS setup

The components use the M3 Tailwind utilities (`text-body-small`, `text-error`,
`bg-surface-container-highest`, …). Import the token sheets and let Tailwind scan the package, as
described in [`SPACEUI-M3-FUSION.md` → Integration](../../docs/architecture/design/SPACEUI-M3-FUSION.md#integration):

```css
@import "tailwindcss";
@import "@aphrody/m3-tokens/m3-tokens.css";
@import "@aphrody/m3-theme/spaceui.css"; /* or tokens.css */
@import "@aphrody/m3-theme/tailwind.css";

@source "../node_modules/@aphrody/m3-primitives/dist";
@source "../node_modules/@aphrody/m3-forms/dist";
```

Error messages carry a Material Symbols `error` glyph: register the font once with
`ensureMaterialSymbols()` from `@aphrody/material-web/icon/material-symbols.js`.

## Example (zod 4 + react-hook-form)

```tsx
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { Button } from "@aphrody/m3-primitives";
import {
  CheckboxField,
  Form,
  InputField,
  RadioGroupField,
  SelectField,
  SwitchField,
  TextAreaField,
} from "@aphrody/m3-forms";

const schema = z.object({
  name: z.string().min(2, "At least 2 characters"),
  email: z.email("Enter a valid email"),
  role: z.enum(["admin", "user"]),
  bio: z.string().max(280).optional(),
  plan: z.enum(["free", "pro"]),
  notifications: z.boolean(),
  terms: z.literal(true, { error: "You must accept the terms" }),
});

type Values = z.infer<typeof schema>;

export function ProfileForm() {
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { name: "", email: "", role: "user", plan: "free", notifications: true },
  });

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(console.log)} className="flex flex-col gap-6">
        <InputField name="name" label="Full name" required />
        <InputField
          name="email"
          label="Email"
          type="email"
          description="Used for sign-in"
          required
        />
        <SelectField
          name="role"
          label="Role"
          options={[
            { value: "admin", label: "Administrator" },
            { value: "user", label: "User" },
          ]}
        />
        <TextAreaField name="bio" label="Bio" rows={3} />
        <RadioGroupField
          name="plan"
          label="Plan"
          options={[
            { value: "free", label: "Free" },
            { value: "pro", label: "Pro" },
          ]}
        />
        <SwitchField
          name="notifications"
          label="Notifications"
          description="Push alerts on this device"
        />
        <CheckboxField name="terms" label="I accept the terms" required />
        <Button type="submit" variant="filled">
          Save
        </Button>
      </form>
    </Form>
  );
}
```

## Components

| Export                                            | Role                                                                                                                                                                                        |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Form`                                            | react-hook-form's `FormProvider`.                                                                                                                                                           |
| `FormField`                                       | `Controller` plus the field-name context.                                                                                                                                                   |
| `FormItem`                                        | One field: a column with 4dp gaps. Set `data-disabled` to dim label and supporting text to 38 %.                                                                                            |
| `FormLabel`                                       | `text-label-large` above a text field (`variant="field"`, error-colored when invalid) or `text-body-large` beside a checkbox, radio or switch (`variant="inline"`). `required` appends `*`. |
| `FormControl`                                     | Wires `id`, `aria-invalid` and `aria-describedby` (description, then message) onto its child.                                                                                               |
| `FormDescription`                                 | M3 supporting text: `text-body-small text-on-surface-variant`.                                                                                                                              |
| `FormMessage`                                     | M3 error text: `text-body-small text-error` with a leading 16px `error` icon. Renders the field error, or its children.                                                                     |
| `useFormField`                                    | Ids and field state of the enclosing field.                                                                                                                                                 |
| `InputField`, `TextAreaField`, `SelectField`      | Text-field family: the control shows the error outline (`border-error`); supporting text is inset 16px to line up with the input text.                                                      |
| `CheckboxField`, `RadioGroupField`, `SwitchField` | Selection controls with inline labels; supporting and error text sit under the label.                                                                                                       |

Every field takes `name`, `label`, `description`, `disabled` and `required`; `InputField` adds
`placeholder` and `type`, `TextAreaField` adds `placeholder` and `rows`, `SelectField` adds
`placeholder` and `options`, `RadioGroupField` adds `options`.

## Differences from `@spacedrive/forms`

- M3 anatomy and roles: supporting text in `on-surface-variant`, error text in `error` with an icon,
  label in `error` when the field is invalid, disabled at 38 %.
- `required` on every field (`*` marker, `required` / `aria-required` on the control).
- `TextAreaField` composes the `TextArea` primitive instead of a raw `<textarea>`.
- Field props types (`InputFieldProps`, …) and `FormLabelProps` are exported.

## Credits and license

Derived from [SpaceUI](https://github.com/spacedriveapp/spaceui) `@spacedrive/forms`, MIT,
© Spacedrive (see `LICENSE.spaceui`). The Material Design 3 rebuild is Apache-2.0; the package is
published as `Apache-2.0 AND MIT`.
